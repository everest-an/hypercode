#!/usr/bin/env python3
"""Trust3 每日运营检查：LeapNode 余额 + 大客户用量提醒。

触发条件（任一）：
  1. LeapNode 余额低于阈值（默认 ¥100）
  2. 余额可支撑天数 < 3 天（按近 7 日均消耗估算）
  3. 有单个用户 24 小时扣费超过阈值（默认 ¥50，大客户）

邮件里给出建议充值金额，便于直接去 LeapNode 支付宝充值。
只依赖标准库。
"""

import json
import os
import smtplib
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import urllib.request
from datetime import datetime, timedelta, timezone
from email.header import Header
from email.mime.text import MIMEText

LEAP_API = os.environ.get("LEAPNODE_API", "https://console.leapnode.ai")
LEAP_EMAIL = os.environ.get("LEAPNODE_EMAIL", "")
LEAP_PASSWORD = os.environ.get("LEAPNODE_PASSWORD", "")
BALANCE_THRESHOLD = float(os.environ.get("LEAPNODE_BALANCE_THRESHOLD", "100"))
RUNWAY_DAYS = float(os.environ.get("LEAPNODE_RUNWAY_DAYS", "3"))

TRUST3_API = os.environ.get("TRUST3_API", "https://api.trust3.pro")
T3_EMAIL = os.environ.get("TRUST3_ADMIN_EMAIL", "")
T3_PASSWORD = os.environ.get("TRUST3_ADMIN_PASSWORD", "")
BIG_USER_CNY = float(os.environ.get("BIG_USER_CNY", "50"))
FX = float(os.environ.get("USD_CNY_RATE", "7.2"))

ALERT_TO = os.environ.get("ALERT_EMAIL", "")
TZ = timezone(timedelta(hours=8))


def http(base: str, path: str, token: str | None = None, payload: dict | None = None) -> dict:
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(base + path, data=data, method="POST" if data else "GET")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


def send_mail(subject: str, body: str) -> None:
    host = os.environ.get("SMTP_HOST", "")
    port = int(os.environ.get("SMTP_PORT", "465"))
    user = os.environ.get("SMTP_USER", "")
    password = os.environ.get("SMTP_PASS", "")
    to = ALERT_TO or user
    if not (host and user and password and to):
        print("SMTP 未配置，跳过邮件")
        return
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = user
    msg["To"] = to
    with smtplib.SMTP_SSL(host, port, timeout=30) as smtp:
        smtp.login(user, password)
        smtp.sendmail(user, [to], msg.as_string())


def leapnode_snapshot() -> tuple[float, float, float]:
    """返回 (余额, 今日成本, 近7日均日成本)，单位 CNY。"""
    login = http(LEAP_API, "/api/v1/auth/login", payload={"email": LEAP_EMAIL, "password": LEAP_PASSWORD})
    token = login.get("data", {}).get("access_token")
    if not token:
        raise RuntimeError(f"LeapNode 登录失败: {login}")
    me = http(LEAP_API, "/api/v1/auth/me", token=token)
    balance = float(me.get("data", {}).get("balance", 0))
    stats = http(LEAP_API, "/api/v1/usage/dashboard/stats", token=token)
    today_cost = float(stats.get("data", {}).get("today_cost", 0))
    today = datetime.now(TZ).date()
    start = (today - timedelta(days=7)).isoformat()
    trend = http(LEAP_API, f"/api/v1/usage/dashboard/trend?start_date={start}&end_date={today.isoformat()}", token=token)
    points = trend.get("data", {}).get("trend", []) or []
    costs = [float(p.get("cost", 0)) for p in points]
    avg_daily = sum(costs) / len(costs) if costs else today_cost
    return balance, today_cost, avg_daily


def big_users(hours: int = 24) -> list[tuple[str, float]]:
    """Trust3 最近 N 小时按用户汇总用户侧扣费（CNY）。"""
    if not (T3_EMAIL and T3_PASSWORD):
        return []
    login = http(TRUST3_API, "/api/v1/auth/login", payload={"email": T3_EMAIL, "password": T3_PASSWORD})
    token = login.get("data", {}).get("access_token")
    if not token:
        print("Trust3 登录失败，跳过大客户检查")
        return []
    cutoff = datetime.now(TZ) - timedelta(hours=hours)
    totals: dict[str, float] = {}
    page = 1
    while True:
        resp = http(TRUST3_API, f"/api/v1/admin/usage?page={page}&page_size=100", token=token)
        items = resp.get("data", {}).get("items", [])
        if not items:
            break
        stop = False
        for it in items:
            try:
                ts = datetime.fromisoformat(it.get("created_at", "").replace("Z", "+00:00"))
            except ValueError:
                continue
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=TZ)
            if ts < cutoff:
                stop = True
                break
            user = it.get("user") or {}
            label = user.get("email") or f"user#{it.get('user_id')}"
            totals[label] = totals.get(label, 0) + float(it.get("actual_cost") or 0) * FX
        if stop:
            break
        total = int(resp.get("data", {}).get("total") or 0)
        if page * 100 >= total:
            break
        page += 1
    return sorted(totals.items(), key=lambda kv: kv[1], reverse=True)


def main() -> int:
    if not (LEAP_EMAIL and LEAP_PASSWORD):
        print("缺少 LEAPNODE_EMAIL / LEAPNODE_PASSWORD")
        return 1

    balance, today_cost, avg_daily = leapnode_snapshot()
    print(f"LeapNode 余额 ¥{balance:.2f}，今日 ¥{today_cost:.2f}，近 7 日均 ¥{avg_daily:.2f}")

    runway = balance / avg_daily if avg_daily > 0 else float("inf")
    reasons = []
    if balance < BALANCE_THRESHOLD:
        reasons.append(f"余额低于阈值 ¥{BALANCE_THRESHOLD:.0f}")
    if avg_daily > 0 and runway < RUNWAY_DAYS:
        reasons.append(f"仅够 {runway:.1f} 天（阈值 {RUNWAY_DAYS:.0f} 天）")

    users = big_users()
    big = [(name, cost) for name, cost in users if cost >= BIG_USER_CNY]
    if big:
        reasons.append(f"大客户 {len(big)} 个（24h 扣费 ≥ ¥{BIG_USER_CNY:.0f}）")

    if not reasons:
        print("一切正常，无需提醒")
        return 0

    suggested = max(500.0, avg_daily * 30 if avg_daily > 0 else 500.0)
    lines = [
        "Trust3 每日运营提醒",
        "",
        f"触发原因：{'；'.join(reasons)}",
        "",
        f"LeapNode 余额：¥{balance:.2f}",
        f"今日消耗：  ¥{today_cost:.2f}",
        f"近 7 日均： ¥{avg_daily:.2f}",
        f"可支撑：    {'∞' if avg_daily <= 0 else f'{runway:.1f} 天'}",
        "",
        f"建议充值：¥{suggested:,.0f}",
        "充值入口：console.leapnode.ai/purchase（支付宝）",
        "",
    ]
    if big:
        lines.append("大客户（24h）：")
        for name, cost in big:
            lines.append(f"  - {name}: ¥{cost:,.2f}")
        lines.append("")
    body = "\n".join(lines)
    print(body)
    send_mail(f"[Trust3] 运营提醒：{'；'.join(reasons)}", body)
    return 2


if __name__ == "__main__":
    sys.exit(main())
