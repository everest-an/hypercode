"""
HyperCode 邮箱账户体系 — 核心模块(注册/登录/账户状态)

方案 A:网页邮箱注册 + 验证码登录。
- 数据库:users(id/email/uuid/plan/status/created_at/last_seen)
         + codes(email/code/expires_at) 验证码,5 分钟过期
- 验证码发送:通过 SEND_MAIL 回调(可接 Resend/SendGrid,后续接入)
- 关键字段预留:plan(trial/byok/pro)、status(active)、uuid(对外身份)

本模块只做数据逻辑,不含 HTTP/邮件发送细节(由 valuation_server 调用)。
"""

import hashlib
import os
import secrets
import smtplib
import sqlite3
import time
import uuid as _uuid
from email.mime.text import MIMEText
from email.header import Header

# ── 数据库 ──
DB_PATH = os.environ.get("USERS_DB", "/opt/valuation/users.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    uuid TEXT UNIQUE NOT NULL,
    plan TEXT NOT NULL DEFAULT 'trial',
    status TEXT NOT NULL DEFAULT 'active',
    trialed_at TEXT,
    referrer_uuid TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    last_seen_at TEXT
);
CREATE TABLE IF NOT EXISTS auth_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_auth_email ON auth_codes(email);
"""


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(_SCHEMA)
    # 幂等列迁移:旧库可能缺新列,补齐(保证 CREATE IF NOT EXISTS 后也有新列)
    try:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(users)")]
        if "referrer_uuid" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN referrer_uuid TEXT")
    except sqlite3.Error:
        pass
    conn.commit()
    return conn


def _hash_email(email: str) -> str:
    """邮箱的稳定的哈希 uuid(对外标识用,避免暴露原始邮箱)。"""
    return hashlib.sha256(email.encode()).hexdigest()[:24]


# ── 验证码 ──
def issue_code(email: str, ttl: int = 300) -> str:
    """生成并存储验证码(5 分钟过期)。返回验证码明文。"""
    code = f"{secrets.randbelow(1000000):06d}"
    conn = _db()
    try:
        now = time.time()
        # 清理该邮箱旧验证码,只留最新
        conn.execute("DELETE FROM auth_codes WHERE email=?", (email,))
        conn.execute(
            "INSERT INTO auth_codes (email, code, expires_at) VALUES (?, ?, ?)",
            (email, code, now + ttl))
        conn.commit()
    finally:
        conn.close()
    return code


def verify_code(email: str, code: str) -> bool:
    """校验验证码。正确且未过期返回 True,并删除该验证码。"""
    conn = _db()
    try:
        now = time.time()
        row = conn.execute(
            "SELECT code FROM auth_codes WHERE email=? AND expires_at>?",
            (email, now)).fetchone()
        if not row or row[0] != code:
            return False
        conn.execute("DELETE FROM auth_codes WHERE email=?", (email,))
        conn.commit()
        return True
    finally:
        conn.close()


# ── 用户注册/登录 ──
def upsert_user(email: str, referrer_uuid: str | None = None) -> dict:
    """验证码通过后,确保用户存在并标记活跃。返回用户对象。
    referrer_uuid: 首次注册时的推荐人 uuid,用于增长推荐循环。"""
    conn = _db()
    try:
        row = conn.execute(
            "SELECT * FROM users WHERE email=?", (email.lower(),)).fetchone()
        now_str = time.strftime("%Y-%m-%d %H:%M:%S")
        if row:
            conn.execute(
                "UPDATE users SET last_seen_at=? WHERE email=?",
                (now_str, email.lower()))
            conn.commit()
            user = conn.execute(
                "SELECT * FROM users WHERE email=?", (email.lower(),)).fetchone()
        else:
            uid = _hash_email(email.lower())
            # 防哈希碰撞:若 uuid 撞了,加后缀
            while conn.execute("SELECT 1 FROM users WHERE uuid=?", (uid,)).fetchone():
                uid = uid + "x"
            # 校验 referrer 是存在的活跃用户(且非自己)
            ref = None
            if referrer_uuid and referrer_uuid != uid:
                refrow = conn.execute(
                    "SELECT 1 FROM users WHERE uuid=? AND status='active'",
                    (referrer_uuid,)).fetchone()
                if refrow:
                    ref = referrer_uuid
            conn.execute(
                "INSERT INTO users (email, uuid, plan, status, referrer_uuid, last_seen_at) "
                "VALUES (?, ?, 'trial', 'active', ?, ?)",
                (email.lower(), uid, ref, now_str))
            conn.commit()
            user = conn.execute(
                "SELECT * FROM users WHERE email=?", (email.lower(),)).fetchone()
        return _row_to_dict(user)
    finally:
        conn.close()


def get_user_referrals(uuid: str) -> int:
    """统计某个 uuid 带来的注册用户数(增长推荐循环)。"""
    conn = _db()
    try:
        return conn.execute("SELECT COUNT(*) FROM users WHERE referrer_uuid=?", (uuid,)).fetchone()[0]
    finally:
        conn.close()


def get_user_by_email(email: str) -> dict | None:
    conn = _db()
    try:
        row = conn.execute("SELECT * FROM users WHERE email=?", (email.lower(),)).fetchone()
        return _row_to_dict(row) if row else None
    finally:
        conn.close()


def get_user_by_uuid(uid: str) -> dict | None:
    conn = _db()
    try:
        row = conn.execute("SELECT * FROM users WHERE uuid=?", (uid,)).fetchone()
        return _row_to_dict(row) if row else None
    finally:
        conn.close()


def user_count() -> int:
    conn = _db()
    try:
        return conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    finally:
        conn.close()


def _row_to_dict(row: sqlite3.Row | tuple) -> dict:
    cols = ["id", "email", "uuid", "plan", "status", "trialed_at",
            "created_at", "last_seen_at"]
    return {c: row[i] for i, c in enumerate(cols)} if row else {}


# ── 邮件发送(腾讯企业邮箱 SMTP / 通用 SMTP)──
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.exmail.qq.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "465"))
SMTP_USER = os.environ.get("SMTP_USER", "")        # 完整邮箱地址
SMTP_PASS = os.environ.get("SMTP_PASS", "")        # SMTP 授权码(非登录密码)
MAIL_FROM_NAME = os.environ.get("MAIL_FROM_NAME", "HyperCode")


def send_code_email(to_email: str, code: str) -> bool:
    """通过 SMTP 发送验证码邮件。默认腾讯企业邮箱(smtp.exmail.qq.com,465/SSL)。
    未配置 SMTP_USER/PASS 时返回 False(降级为打日志)。返回是否发送成功。"""
    if not SMTP_USER or not SMTP_PASS:
        print(f"[auth] SMTP 未配置,verification code {code} → {to_email}(dev mode)")
        return False

    subject = f"【{MAIL_FROM_NAME}】验证码 {code}"
    body = (
        f"你的验证码是:{code}\n\n"
        f"验证码 5 分钟内有效,用于登录 {MAIL_FROM_NAME}。\n"
        f"如果不是你本人操作,请忽略本邮件。\n\n"
        f"{MAIL_FROM_NAME}\n"
    )
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = f"{MAIL_FROM_NAME} <{SMTP_USER}>"
    msg["To"] = to_email

    try:
        if SMTP_PORT == 465:
            server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20)
        else:
            server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20)
            server.starttls()
        server.login(SMTP_USER, SMTP_PASS)
        server.sendmail(SMTP_USER, [to_email], msg.as_string())
        server.quit()
        print(f"[auth] 验证码邮件已发送 → {to_email}")
        return True
    except Exception as e:
        print(f"[auth] 验证码邮件发送失败: {e}")
        return False
