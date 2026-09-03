"""
HyperCode 估值速查 — 自动化获客的免费工具后端

输入股票代码 → 实时行情 + DeepSeek 估值简版报告 → 输出 JSON/HTML
免责声明:AI 生成,非投资建议。

用法:
  uvicorn valuation_server:app --port 8787
  GET /api/valuation?ticker=600519    → JSON
  GET /valuation?ticker=600519        → HTML 页面
"""
import os
import re
import time
from datetime import date
from typing import Optional

import json
import os
import re
import sqlite3
import time
from datetime import date
from pathlib import Path

import auth  # noqa: E402  # HyperCode 邮箱账户体系

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Query, Header, Depends
from fastapi.responses import HTMLResponse, RedirectResponse

try:
    import load_env  # noqa: F401  # 自动加载 .env(服务器部署用)
except ImportError:
    pass

# ── 管理面板鉴权(ADMIN_TOKEN 存服务器 .env,绝不提交 Git)──
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")


def require_admin(authorization: Optional[str] = Header(default=None)) -> None:
    """校验管理面板请求头:Authorization: Bearer <ADMIN_TOKEN>"""
    if not ADMIN_TOKEN:
        raise HTTPException(501, "管理面板未启用:缺少 ADMIN_TOKEN")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "未授权")
    token = authorization[7:]
    if token.strip() != ADMIN_TOKEN:
        raise HTTPException(403, "无效的管理令牌")

# ── DeepSeek(从环境变量读 key,绝不硬编码)──
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE = "https://api.deepseek.com/v1"
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash")

# 简易缓存:{ticker_date: (ts, result)}
_cache: dict = {}
CACHE_TTL = 86400  # 24h

app = FastAPI(title="HyperCode 估值速查", docs_url=None, redoc_url=None)

TEN_HEADERS = {"Referer": "https://gu.qq.com/"}


# ── 数据层 ──
def fetch_quote(ticker: str) -> dict:
    """腾讯行情。ticker 形如 600519 / sh600519 / 000001。"""
    code = ticker.lower()
    if not code.startswith(("sh", "sz", "bj")):
        code = ("sh" if code.startswith("6") else "sz") + code
    url = f"https://qt.gtimg.cn/q={code}"
    r = httpx.get(url, timeout=8)
    r.encoding = "gbk"
    m = re.search(r'="(.*)"', r.text)
    if not m:
        raise HTTPException(404, f"未找到 {ticker}")
    f = m.group(1).split("~")
    if len(f) < 45:
        raise HTTPException(404, f"数据异常 {ticker}")
    return {
        "code": code,
        "name": f[1],
        "price": float(f[3]),
        "prev_close": float(f[4]),
        "open": float(f[5]),
        "change_pct": float(f[32]),
        "volume": f[36],          # 万手
        "amount": f[37],          # 万元
        "market_cap": float(f[45]),   # 亿
        "pe": float(f[39]),
        "pb": float(f[46]),
        "ts": f[30],
    }


def fetch_history(ticker: str, days: int = 60) -> list:
    """近 N 日收盘价(用于 52 周高低/区间展示)。"""
    code = ticker.lower()
    if not code.startswith(("sh", "sz", "bj")):
        code = ("sh" if code.startswith("6") else "sz") + code
    url = (f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
           f"?param={code},day,,,{days},qfq")
    r = httpx.get(url, timeout=8)
    j = r.json()
    node = j.get("data", {}).get(code, {})
    kline = node.get("qfqday") or node.get("day") or []
    closes = [float(row[2]) for row in kline]
    return {"high_52w": max(closes), "low_52w": min(closes),
            "last_close": closes[-1] if closes else None, "points": len(closes)}


# ── 模型层 ──
DCF_PROMPT = """你是投行分析师,做 DCF 情景分析的教学演示(非投资建议)。对 {name}(现价 {price},市值 {market_cap} 亿,PE {pe}),用文字描述:1) 假设收入增速、营业利润率、WACC 三个纯假设参数(明确标注非财报数据);2) 在此假设下,模型测算的合理估值区间相对于现价是偏上还是偏下;3) 一句话说明这是教学演示。不要给出任何具体目标价或具体数字。150 字以内,中文,纯文本。"""

COMPS_PROMPT = """对 {name}(现价 {price},PE {pe}),给出同行业 3 家可比公司及各自典型 PE 区间,
对比判断相对估值位置(低估/合理/高估)。必须含:非投资建议。150 字以内,中文。"""


def ask_deepseek(prompt: str, retries: int = 4) -> str:
    """调用 DeepSeek。返回文本。空响应/限流时指数退避重试。

    批量运行时 DeepSeek 可能限流(尤其 DCF 这类具体价格预测),固定 1s 重试
    无法恢复;用 1s/2s/4s/8s 指数退避让限流窗口过去。
    """
    if not DEEPSEEK_API_KEY:
        return "模型未配置(需 DEEPSEEK_API_KEY 环境变量)"
    backoff = [1, 2, 4, 8]
    for attempt in range(retries + 1):
        try:
            r = httpx.post(
                f"{DEEPSEEK_BASE}/chat/completions",
                headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}"},
                json={
                    "model": DEEPSEEK_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 600,
                    "temperature": 0.3,
                },
                timeout=60,
            )
            r.raise_for_status()
            text = r.json()["choices"][0]["message"]["content"].strip()
            if text:
                return text
        except Exception:
            pass
        if attempt < retries:
            time.sleep(backoff[min(attempt, len(backoff) - 1)])
    return "(模型未返回内容,请稍后重试)"


def build_report(ticker: str) -> dict:
    """组装估值报告:行情 + DCF + Comps。带缓存。"""
    now = date.today().isoformat()
    key = f"{ticker.lower()}:{now}"
    if key in _cache and time.time() - _cache[key][0] < CACHE_TTL:
        return _cache[key][1]

    q = fetch_quote(ticker)
    hist = fetch_history(ticker)
    q.update(hist)
    try:
        dcf = ask_deepseek(DCF_PROMPT.format(**q))
    except Exception as e:
        dcf = f"(DCF 生成失败: {e})"
    try:
        comps = ask_deepseek(COMPS_PROMPT.format(**q))
    except Exception as e:
        comps = f"(Comps 生成失败: {e})"

    report = {
        "ticker": ticker,
        "quote": {**q, **hist},
        "dcf": dcf,
        "comps": comps,
        "generated": now,
        "disclaimer": "AI 生成,仅供参考,非投资建议。假设值未使用财报级数据。",
        "cta": "想要完整 DCF/LBO 模型?下载 HyperCode → https://awareliquid.ai/hypercode",
    }
    _cache[key] = (time.time(), report)
    return report


# ── API ──
@app.get("/api/valuation")
def api_valuation(ticker: str = Query(..., description="股票代码,如 600519")):
    return build_report(ticker)


# Caddy 保留 /valuation 前缀时的兼容路由(Caddy handle 不剥离前缀)
@app.get("/valuation/api/valuation")
def api_valuation_prefixed(ticker: str = Query(..., description="股票代码,如 600519")):
    return build_report(ticker)


# ── 邮箱收集(获客转化闭环)──
_DB_PATH = os.environ.get("LEADS_DB", "/opt/valuation/leads.db")


def _leads_db() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS leads ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "email TEXT UNIQUE NOT NULL, "
        "ticker TEXT, "
        "created_at TEXT DEFAULT (datetime('now')))")
    conn.commit()
    return conn


@app.post("/api/leads")
def collect_lead(email: str = Query(..., description="邮箱"), ticker: str = Query("")):
    email = email.strip().lower()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(400, "邮箱格式不正确")
    conn = _leads_db()
    try:
        conn.execute("INSERT OR IGNORE INTO leads (email, ticker) VALUES (?, ?)",
                     (email, ticker))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, "email": email, "message": "已记录,完整模型模板将通过邮件发送"}


@app.get("/api/leads/count")
def leads_count():
    conn = _leads_db()
    try:
        row = conn.execute("SELECT COUNT(*) FROM leads").fetchone()
        return {"count": row[0]}
    finally:
        conn.close()


# Caddy 前缀兼容路由
@app.post("/valuation/api/leads")
def collect_lead_prefixed(email: str = Query(...), ticker: str = Query("")):
    return collect_lead(email, ticker)


@app.get("/valuation/api/leads/count")
def leads_count_prefixed():
    return leads_count()


# ── HyperCode 邮箱账户体系 ──
# 方案 A:网页邮箱注册 + 验证码登录。plan/status/uuid 字段预留,便于统计与后续付费。

# 邮件发送回调(可插拔):默认空实现(仅打日志)。接入 Resend/SendGrid 时替换。
SEND_MAIL = os.environ.get("SEND_MAIL", "")  # 预留:一封邮件 API 的配置


def _deliver_code(email: str, code: str) -> bool:
    """发送验证码邮件(通过 auth.send_code_email 的 SMTP)。"""
    return auth.send_code_email(email, code)


@app.post("/api/auth/register")
def auth_register(email: str = Query(..., description="邮箱")):
    email = email.strip().lower()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(400, "邮箱格式不正确")
    code = auth.issue_code(email)
    _deliver_code(email, code)
    return {"ok": True, "message": "验证码已发送,5 分钟内有效"}


# Caddy 前缀兼容(前端用 /auth/register,但 Caddy handle 保留 /valuation)
@app.post("/valuation/api/auth/register")
def auth_register_prefixed(email: str = Query(...)):
    return auth_register(email)


@app.post("/api/auth/verify")
def auth_verify(email: str = Query(...), code: str = Query(...), ref: Optional[str] = Query(default=None)):
    email = email.strip().lower()
    if not auth.verify_code(email, code.strip()):
        raise HTTPException(400, "验证码错误或已过期")
    user = auth.upsert_user(email, referrer_uuid=ref)
    return {"ok": True, "user": {
        "uuid": user["uuid"], "email": user["email"],
        "plan": user["plan"], "status": user["status"],
    }, "message": "登录成功"}


@app.post("/valuation/api/auth/verify")
def auth_verify_prefixed(email: str = Query(...), code: str = Query(...), ref: Optional[str] = Query(default=None)):
    return auth_verify(email, code, ref)


@app.get("/api/user/referral")
def user_referral(uuid: str = Query(...)):
    """查询某个 uuid 带来的注册用户数(增长推荐循环)。"""
    return {"uuid": uuid, "referrals": auth.get_user_referrals(uuid)}


@app.get("/api/user/me")
def user_me(email: str = Query(...)):
    user = auth.get_user_by_email(email.strip().lower())
    if not user:
        raise HTTPException(404, "用户不存在")
    return {"user": user}


@app.get("/api/user/count")
def user_count():
    return {"count": auth.user_count()}


@app.get("/valuation/api/user/count")
def user_count_prefixed():
    return {"count": auth.user_count()}


# ── 管理面板 API ──
@app.get("/api/admin/stats", dependencies=[Depends(require_admin)])
def admin_stats():
    conn = auth._db()
    try:
        total = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        by_plan = {r[0]: r[1] for r in conn.execute("SELECT plan, COUNT(*) FROM users GROUP BY plan")}
        by_status = {r[0]: r[1] for r in conn.execute("SELECT status, COUNT(*) FROM users GROUP BY status")}
        today = conn.execute("SELECT COUNT(*) FROM users WHERE date(created_at)=date('now')").fetchone()[0]
        latest = conn.execute("SELECT email, created_at FROM users ORDER BY created_at DESC LIMIT 1").fetchone()
        codes = conn.execute("SELECT COUNT(*) FROM auth_codes").fetchone()[0]
        # 增长推荐循环:带 referrer_uuid 注册的用户数(= 被推荐来的)
        referred = conn.execute("SELECT COUNT(*) FROM users WHERE referrer_uuid IS NOT NULL AND referrer_uuid != ''").fetchone()[0]
        # 有推荐关系(即通过他人链接注册)的用户占比用于观察裂变健康度
        referrals = conn.execute("SELECT COUNT(DISTINCT referrer_uuid) FROM users WHERE referrer_uuid IS NOT NULL AND referrer_uuid != ''").fetchone()[0]
    finally:
        conn.close()
    # 访问统计(由 traffic_stats.py 生成, 供 SEO 效果追踪)
    traffic = {}
    try:
        import json as _json
        with open("/opt/valuation/traffic.json", encoding="utf-8") as _f:
            traffic = _json.load(_f)
    except Exception:
        traffic = {}
    return {"total": total, "by_plan": by_plan, "by_status": by_status,
            "today": today, "codes_sent": codes,
            "referred": referred, "referral_helpers": referrals,
            "traffic": traffic,
            "latest": {"email": latest[0], "created_at": latest[1]} if latest else None}


@app.get("/api/admin/users", dependencies=[Depends(require_admin)])
def admin_users(limit: int = Query(50, ge=1, le=200), order: str = Query("desc")):
    order_sql = "DESC" if order == "asc" else "DESC"
    conn = auth._db()
    try:
        rows = conn.execute(
            f"SELECT id, email, uuid, plan, status, trialed_at, created_at, last_seen_at "
            f"FROM users ORDER BY created_at {order_sql} LIMIT ?", (limit,)).fetchall()
    finally:
        conn.close()
    cols = ["id", "email", "uuid", "plan", "status", "trialed_at", "created_at", "last_seen_at"]
    return {"users": [dict(zip(cols, r)) for r in rows], "count": len(rows)}


@app.get("/valuation/api/admin/stats", dependencies=[Depends(require_admin)])
def admin_stats_prefixed():
    return admin_stats()


@app.get("/valuation/api/admin/users", dependencies=[Depends(require_admin)])
def admin_users_prefixed(limit: int = Query(100, ge=1, le=200)):
    return admin_users(limit=limit)


# ── 注册脚本(与 HTML_TEMPLATE 分离,避免 .format 冲突)──
REG_SCRIPT = """
<script>
(function() {
  var email = document.getElementById('regEmail');
  var code = document.getElementById('regCode');
  var msg = document.getElementById('regMsg');
  var api = '/valuation/api';
  function err(e) { msg.textContent = '❌ ' + (e || '请求失败'); }

  // ── 增长推荐循环:读取 URL 里的 ref=<uuid>,注册时带上 ──
  var REF = (function() {
    try {
      var m = location.search.match(/(?:^|[?&])(?:ref|r)=([a-f0-9]{20,32})/i);
      if (m) { localStorage.setItem('hypercode_ref', m[1]); return m[1]; }
      return localStorage.getItem('hypercode_ref') || '';
    } catch(e) { return ''; }
  })();

  document.getElementById('regCodeBtn').addEventListener('click', async function() {
    var v = email.value.trim();
    if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(v)) { err('请输入正确邮箱'); return; }
    msg.textContent = '发送中...';
    try {
      var r = await fetch(api + '/auth/register?email=' + encodeURIComponent(v), {method:'POST'});
      var j = await r.json();
      msg.textContent = r.ok ? '✅ 验证码已发送到你邮箱' : err(j.detail || '发送失败');
    } catch(e) { err('网络错误'); }
  });

  document.getElementById('regVerifyBtn').addEventListener('click', async function() {
    var v = email.value.trim(), c = code.value.trim();
    if (!v || !c) { err('请输入邮箱和验证码'); return; }
    msg.textContent = '验证中...';
    try {
      var url = api + '/auth/verify?email=' + encodeURIComponent(v) + '&code=' + encodeURIComponent(c);
      if (REF) url += '&ref=' + encodeURIComponent(REF);
      var r = await fetch(url, {method:'POST'});
      var j = await r.json();
      if (r.ok) {
        msg.textContent = '✅ 注册成功!欢迎 ' + j.user.email + ' · 档位:' + j.user.plan;
        code.value = ''; email.readOnly = true;
        saveLogin(j.user);
        refreshNav();
        unlockContent();
        buildShare();
      } else { err(j.detail || '验证码错误'); }
    } catch(e) { err('网络错误'); }
  });

  // ── 登录态:localStorage 记忆,供导航栏显示 ──
  var NAV_ACCOUNT = document.getElementById('navAccount');
  function saveLogin(u) {
    try { localStorage.setItem('hypercode_user', JSON.stringify({email:u.email, uuid:u.uuid, plan:u.plan})); } catch(e) {}
  }
  // ── 产品闭环:已登录解锁 DCF/Comps 全文 ──
  function unlockContent() {
    var u = null;
    try { u = JSON.parse(localStorage.getItem('hypercode_user') || 'null'); } catch(e) {}
    var loggedIn = u && u.email;
    var dcfCard = document.getElementById('dcfCard');
    var compsCard = document.getElementById('compsCard');
    if (loggedIn) {
      dcfCard.classList.remove('locked'); compsCard.classList.remove('locked');
      var dLock = document.getElementById('dcfLock'); if (dLock) dLock.style.display='none';
      var cLock = document.getElementById('compsLock'); if (cLock) cLock.style.display='none';
      // 底部注册表单:已登录则显示"已解锁,欢迎"
      var regForm = document.getElementById('regForm');
      if (regForm) { regForm.style.display='none'; var rm=document.getElementById('regMsg'); if(rm) rm.textContent='✅ 已登录 '+u.email+',完整 DCF/Comps 已解锁。领模板请到 /auth。'; }
    } else {
      dcfCard.classList.add('locked'); compsCard.classList.add('locked');
    }
  }
  // ── 增长推荐循环:登录后生成带 uuid 的邀请链接 + 分享 ──
  function buildShare() {
    var u = null;
    try { u = JSON.parse(localStorage.getItem('hypercode_user') || 'null'); } catch(e) {}
    var box = document.getElementById('shareBox');
    if (!box) return;
    box.style.display = 'block';
    if (!u || !u.uuid) { box.innerHTML = '<p class="note">登录后即可生成专属邀请链接,好友通过链接注册,你就获得一次推荐。</p>'; return; }
    var link = location.origin + '/valuation?ref=' + u.uuid;
    var inp = document.getElementById('shareLink');
    if (inp) inp.value = link;
    // 查询当前推荐数
    try {
      fetch(api + '/user/referral?uuid=' + encodeURIComponent(u.uuid)).then(function(r){return r.json();}).then(function(j){
        var cnt = document.getElementById('shareCount');
        if (cnt) cnt.textContent = '已成功推荐 ' + (j.referrals||0) + ' 位好友';
      }).catch(function(e){});
    } catch(e) {}
  }
  function refreshNav() {
    var u = null;
    try { u = JSON.parse(localStorage.getItem('hypercode_user') || 'null'); } catch(e) {}
    if (u && u.email) {
      // 已登录:导航栏显示"我的账户",隐藏右上注册按钮
      var acct = document.getElementById('navAccount');
      if (acct) acct.innerHTML = '<span style="color:var(--muted)">👤 ' + u.email + '</span>';
      var regBtn = document.querySelector('.nav .btn');
      if (regBtn) regBtn.href = '/valuation'; regBtn.textContent = '我的账户';
    }
  }
  refreshNav();
  unlockContent();
  buildShare();
})();
// 全局复制函数(供 onclick 调用)
function copyShare() {
  var inp = document.getElementById('shareLink');
  if (!inp) return;
  inp.select();
  try { document.execCommand('copy'); } catch(e) {}
  var b = document.getElementById('shareCopyBtn');
  if (b) { var t = b.textContent; b.textContent = '✅ 已复制'; setTimeout(function(){b.textContent=t;}, 1500); }
}
</script>
"""


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{name} 估值速查 — HyperCode AI</title>
<meta name="description" content="{meta_desc}">
<link rel="canonical" href="{canonical}">
<link rel="alternate" hreflang="zh-CN" href="{canonical}" />
<link rel="alternate" hreflang="x-default" href="{canonical}" />
<meta property="og:type" content="article">
<meta property="og:title" content="{og_title}">
<meta property="og:description" content="{og_desc}">
<meta property="og:locale" content="zh_CN">
<meta property="og:site_name" content="HyperCode">
<meta name="robots" content="index, follow">
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "{name_esc}估值速查 - AI 估值分析",
  "inLanguage": "zh-CN",
  "dateModified": "{date_iso}",
  "datePublished": "{date_iso}",
  "author": {{"@type": "Organization", "name": "AwareLiquid", "url": "https://awareliquid.ai"}},
  "publisher": {{"@type": "Organization", "name": "AwareLiquid", "url": "https://awareliquid.ai"}},
  "mainEntityOfPage": "{canonical}",
  "description": "{meta_desc}"
}}
</script>
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "inLanguage": "zh-CN",
  "mainEntity": [
    {{"@type": "Question", "name": "{name_esc}({ticker_esc})估值怎么样?", "acceptedAnswer": {{"@type": "Answer", "text": "AI 生成 DCF 与 Comps 估值快照:现价 {price_esc}。估值基于假设,非投资建议,完整模型可下载 HyperCode 生成。"}}}},
    {{"@type": "Question", "name": "DCF 和 Comps 是什么?", "acceptedAnswer": {{"@type": "Answer", "text": "DCF(现金流折现)和 Comps(可比公司)是主流估值方法,本页由 HyperCode 金融技能自动生成,深度建模可下载 HyperCode。"}}}}
  ]
}}
</script>
<style>
:root{{--bg:#0e0e10;--fg:#f5f5f7;--muted:#9a9aa5;--line:#26262c;--card:#16161a;}}
*{{margin:0;padding:0;box-sizing:border-box}}
body{{background:var(--bg);color:var(--fg);font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.7}}
.wrap{{max-width:720px;margin:0 auto;padding:40px 20px}}
h1{{font-size:28px;margin-bottom:6px}}
.sub{{color:var(--muted);font-size:14px;margin-bottom:30px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px;margin-bottom:18px}}
.card h2{{font-size:17px;margin-bottom:12px}}
.grid{{display:grid;grid-template-columns:1fr 1fr;gap:12px}}
.grid div{{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px}}
.grid .k{{color:var(--muted);font-size:12px}}
.grid .v{{font-size:18px;font-weight:600}}
.md{{white-space:pre-wrap;font-size:14px}}
.note{{color:var(--muted);font-size:12px;margin-top:16px}}
.cta{{display:block;text-align:center;background:var(--fg);color:var(--bg);padding:14px;border-radius:10px;font-weight:600;text-decoration:none;margin-top:10px}}
.cta:hover{{opacity:.9}}
form{{display:flex;gap:8px;margin-bottom:30px}}
input{{flex:1;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);font-size:15px}}
button{{padding:12px 20px;border:none;border-radius:8px;background:var(--fg);color:var(--bg);font-weight:600;cursor:pointer}}
.nav{{display:flex;align-items:center;gap:12px;margin-bottom:26px}}
.nav .brand{{font-weight:700;font-size:16px;color:var(--fg);text-decoration:none}}
.nav .spacer{{flex:1}}
.nav .btn{{background:var(--fg);color:var(--bg);padding:8px 16px;border-radius:8px;font-weight:600;font-size:13px;text-decoration:none;cursor:pointer}}
.nav .btn:hover{{opacity:.9}}
.nav .account{{color:var(--muted);font-size:13px}}
.lock{{text-align:center;padding:22px;border:1px dashed var(--line);border-radius:10px;margin-top:8px}}
.lock .btn{{display:inline-block;margin-top:10px}}
.lock p{{color:var(--muted);font-size:14px}}
.locked#dcfCard .md{{opacity:0;max-height:0;overflow:hidden}}
.locked#compsCard .md{{opacity:0;max-height:0;overflow:hidden}}
.card .unlocked-tip{{color:var(--muted);font-size:12px;margin-top:10px}}
</style></head><body><div class="wrap">
<nav class="nav"><a class="brand" href="/valuation">HyperCode</a><span class="spacer"></span><span class="account" id="navAccount"></span><a class="btn" href="/auth">注册账户</a></nav>
<p class="note" style="text-align:center;margin-bottom:0;font-size:12px">最后更新:{date_iso} · AI 生成,非投资建议</p>
<h1>HyperCode 估值速查</h1>
<p class="sub">输入 A股代码,AI 生成 DCF + Comps 估值快照。想要完整金融建模?<a href="/hypercode" style="color:var(--fg)">HyperCode</a> 内置 55 个投行技能。</p>
<form method="get" action="/valuation">
<input name="ticker" placeholder="股票代码,如 600519" value="{ticker}" required>
<button type="submit">估值</button>
</form>
<div class="card">
<h2>{name} · {code}</h2>
<div class="grid">
<div><div class="k">现价</div><div class="v">{price}</div></div>
<div><div class="k">涨跌幅</div><div class="v">{change_pct}%</div></div>
<div><div class="k">市值</div><div class="v">{mcap}亿</div></div>
<div><div class="k">PE</div><div class="v">{pe}</div></div>
<div><div class="k">52周高</div><div class="v">{high_52w}</div></div>
<div><div class="k">52周低</div><div class="v">{low_52w}</div></div>
</div>
</div>
<div class="card" id="dcfCard">
<h2>📊 DCF 简版(AI 生成)</h2>
<div class="md" id="dcfFull">{dcf}</div>
<div class="lock" id="dcfLock"><p>🔒 DCF 全文仅登录用户可见</p><a class="btn" href="/auth">登录解锁完整 DCF</a></div>
</div>
<div class="card" id="compsCard">
<h2>📊 Comps 对比(AI 生成)</h2>
<div class="md" id="compsFull">{comps}</div>
<div class="lock" id="compsLock"><p>🔒 Comps 全文仅登录用户可见</p><a class="btn" href="/auth">登录解锁完整 Comps</a></div>
</div>
<p class="note">⚠️ {disclaimer}</p>
<a class="cta" href="https://awareliquid.ai/hypercode">🚀 要完整 DCF/LBO 模型?下载 HyperCode</a>
<div class="card" style="margin-top:24px">
<h2>📩 注册账户:领 DCF 模型模板 + 每日晨报</h2>
<p class="md" style="color:var(--muted)">邮箱注册即可领取完整 DCF/LBO Excel 模板(公式即用)+ 每交易日 AI 晨报。绝不自动扣费,随时退订。</p>
<div id="regForm" style="margin-top:12px">
<input type="email" id="regEmail" placeholder="你的工作邮箱" required style="margin-top:12px">
<button type="button" id="regCodeBtn" style="margin-top:12px">获取验证码</button>
<input type="text" id="regCode" placeholder="输入验证码" required style="margin-top:12px">
<button type="button" id="regVerifyBtn" style="margin-top:12px">注册 / 登录</button>
</div>
<p id="regMsg" class="note" style="min-height:18px"></p>
</div>
<div class="card" id="shareBox" style="display:none">
<h2>🎁 邀请好友,解锁更多</h2>
<p class="md" style="color:var(--muted)">把你的专属链接分享给同事/同学,好友注册后你也获得一次推荐。满 3 人可解锁 DCF Excel 模板。</p>
<input type="text" id="shareLink" readonly style="margin-top:12px">
<button type="button" id="shareCopyBtn" style="margin-top:10px" onclick="copyShare()">复制链接</button>
<p class="note" id="shareCount"></p>
</div>
{REG_SCRIPT}
<p class="note" style="text-align:center;margin-top:14px">{cta}</p>
</div></body></html>"""


# ── 英文版估值页(/en/valuation)──
EN_HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{name} ({ticker}) Stock Valuation - AI DCF & Comps | HyperCode</title>
<meta name="description" content="{meta_desc}">
<link rel="canonical" href="{canonical_en}" />
<link rel="alternate" hreflang="en" href="{canonical_en}" />
<link rel="alternate" hreflang="zh-CN" href="{canonical_zh}" />
<link rel="alternate" hreflang="x-default" href="{canonical_zh}" />
<meta property="og:type" content="article">
<meta property="og:title" content="{og_title}">
<meta property="og:description" content="{meta_desc}">
<meta property="og:locale" content="en_US">
<meta property="og:site_name" content="HyperCode">
<meta name="robots" content="index, follow">
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "{name_esc} ({ticker_esc}) Stock Valuation",
  "inLanguage": "en",
  "dateModified": "{date_iso}",
  "datePublished": "{date_iso}",
  "author": {{"@type": "Organization", "name": "AwareLiquid", "url": "https://awareliquid.ai"}},
  "publisher": {{"@type": "Organization", "name": "AwareLiquid", "url": "https://awareliquid.ai"}},
  "mainEntityOfPage": "{canonical_en}"
}}
</script>
<style>
:root{{--bg:#0e0e10;--fg:#f5f5f7;--muted:#9a9aa5;--line:#26262c;--card:#16161a;}}
*{{margin:0;padding:0;box-sizing:border-box}}
body{{background:var(--bg);color:var(--fg);font-family:-apple-system,"Segoe UI","PingFang SC",sans-serif;line-height:1.7}}
.wrap{{max-width:720px;margin:0 auto;padding:40px 20px}}
.nav{{display:flex;align-items:center;gap:12px;margin-bottom:26px}}
.nav .brand{{font-weight:700;font-size:16px;color:var(--fg);text-decoration:none}}
.nav .spacer{{flex:1}}
.nav a{{color:var(--muted);font-size:13px;text-decoration:none}}
h1{{font-size:28px;margin-bottom:6px}}
.sub{{color:var(--muted);font-size:14px;margin-bottom:24px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px;margin-bottom:18px}}
.card h2{{font-size:17px;margin-bottom:12px}}
.grid{{display:grid;grid-template-columns:1fr 1fr;gap:12px}}
.grid div{{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px}}
.grid .k{{color:var(--muted);font-size:12px}}
.grid .v{{font-size:18px;font-weight:600}}
.md{{white-space:pre-wrap;font-size:14px}}
.note{{color:var(--muted);font-size:12px;margin-top:16px}}
form{{display:flex;gap:8px;margin-bottom:24px}}
input{{flex:1;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);font-size:15px}}
button{{padding:12px 20px;border:none;border-radius:8px;background:var(--fg);color:var(--bg);font-weight:600;cursor:pointer}}
.reg{{margin-top:28px;border:1px solid var(--line);border-radius:14px;padding:24px;background:var(--card)}}
.reg h3{{font-size:18px;margin-bottom:8px}}
.reg .msg{{color:var(--muted);font-size:13px;margin-top:10px;min-height:18px}}
</style>
</head><body><div class="wrap">
<nav class="nav"><a class="brand" href="/en/valuation">HyperCode</a><span class="spacer"></span><a href="/valuation">中文版</a></nav>
<h1>{name} ({ticker}) Valuation</h1>
<p class="sub">AI-generated DCF + Comps valuation snapshot. Want full financial modeling? <a href="/en/hypercode" style="color:var(--fg)">HyperCode</a> has 55+ investment banking skills built in.</p>
<form method="get" action="/en/valuation">
<input name="ticker" placeholder="A-share ticker, e.g. 600519" value="{ticker}" required>
<button type="submit">Value it</button>
</form>
<div class="card">
<h2>{name} · {code}</h2>
<div class="grid">
<div><div class="k">Price</div><div class="v">{price}</div></div>
<div><div class="k">Change</div><div class="v">{change_pct}%</div></div>
<div><div class="k">Market Cap</div><div class="v">{mcap}亿</div></div>
<div><div class="k">PE</div><div class="v">{pe}</div></div>
</div>
</div>
<div class="card"><h2>📊 DCF Summary (AI)</h2><div class="md">{dcf}</div></div>
<div class="card"><h2>📊 Comps Comparison (AI)</h2><div class="md">{comps}</div></div>
<p class="note">⚠️ {disclaimer_en}</p>
<div class="reg">
<h3>📩 Free: Complete DCF Model Template</h3>
<p style="color:var(--muted);font-size:14px;margin-bottom:14px">Register to get the full DCF/LBO Excel template + daily AI market briefing. No auto-charge, unsubscribe anytime.</p>
<input type="email" id="enEmail" placeholder="Your work email">
<button type="button" id="enCodeBtn" style="margin-top:8px">Get code</button>
<input type="text" id="enCode" placeholder="6-digit code" style="margin-top:8px">
<button type="button" id="enVerifyBtn" style="margin-top:8px">Register / Login</button>
<p class="msg" id="enMsg"></p>
</div>
</div>
<script>
(function(){{
  var email=document.getElementById('enEmail'),code=document.getElementById('enCode'),msg=document.getElementById('enMsg');
  function err(e){{msg.textContent='❌ '+(e||'Failed');}}
  document.getElementById('enCodeBtn').addEventListener('click',async function(){{
    var v=email.value.trim();
    if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(v)){{err('Enter a valid email');return;}}
    msg.textContent='Sending...';
    try{{var r=await fetch('/valuation/api/auth/register?email='+encodeURIComponent(v),{{method:'POST'}});
      var j=await r.json();
      msg.textContent=r.ok?'✅ Code sent to your email':err(j.detail||'Failed');}}
    catch(e){{err('Network error');}}
  }});
  document.getElementById('enVerifyBtn').addEventListener('click',async function(){{
    var v=email.value.trim(),c=code.value.trim();
    if(!v||!c){{err('Enter email and code');return;}}
    msg.textContent='Verifying...';
    try{{var r=await fetch('/valuation/api/auth/verify?email='+encodeURIComponent(v)+'&code='+encodeURIComponent(c),{{method:'POST'}});
      var j=await r.json();
      if(r.ok){{msg.textContent='✅ Welcome '+j.user.email+'! Full DCF template is on its way.';code.value='';email.readOnly=true;}}
      else err(j.detail||'Wrong code');}}
    catch(e){{err('Network error');}}
  }});
}})();
</script>
</body></html>"""


@app.get("/en/valuation", response_class=HTMLResponse)
def valuation_page_en(ticker: str = "600519"):
    rep = build_report(ticker)
    q = rep["quote"]
    import html as _h
    from datetime import date as _date
    raw_ticker = _h.escape(ticker.strip())
    name_esc = _h.escape(q["name"])
    canonical_en = f"https://awareliquid.ai/en/valuation?ticker={raw_ticker}"
    canonical_zh = f"https://awareliquid.ai/valuation?ticker={raw_ticker}"
    meta_desc = f"{q['name']} ({raw_ticker}) AI stock valuation - DCF and Comps analysis from HyperCode. Current price {q['price']}."
    og_title = f"{q['name']} ({raw_ticker}) Stock Valuation - AI"
    return EN_HTML_TEMPLATE.format(
        ticker=_h.escape(ticker),
        name=name_esc, code=_h.escape(q["code"]),
        price=q["price"], change_pct=q["change_pct"],
        mcap=q["market_cap"], pe=q["pe"],
        canonical_en=canonical_en, canonical_zh=canonical_zh,
        meta_desc=_h.escape(meta_desc),
        og_title=_h.escape(og_title),
        name_esc=name_esc, ticker_esc=raw_ticker,
        date_iso=_date.today().isoformat(),
        dcf=_h.escape(rep["dcf"]).replace("\n", "<br>"),
        comps=_h.escape(rep["comps"]).replace("\n", "<br>"),
        disclaimer_en=_h.escape(rep["disclaimer"]),
    )


@app.get("/valuation", response_class=HTMLResponse)
def valuation_page(ticker: str = "600519"):
    rep = build_report(ticker)
    q = rep["quote"]
    import html as _h
    # 先替换 REG_SCRIPT 为双写花括号的版本,避免 .format 把 JS 里的 {} 当占位符
    tpl = HTML_TEMPLATE.replace("{REG_SCRIPT}", REG_SCRIPT.replace("{", "{{").replace("}", "}}"))
    raw_ticker = _h.escape(ticker.strip())
    name_esc = _h.escape(q["name"])
    price_esc = _h.escape(str(q["price"]))
    from datetime import date as _date
    date_iso = _date.today().isoformat()
    # canonical 使用请求时的原始 ticker,与快照页文件名(/snapshots/<ticker>.html)、
    # sitemap 条目、用户实际访问的 URL 完全一致,保证 AI/搜索引擎不因前缀变体混淆。
    canonical = f"https://awareliquid.ai/valuation?ticker={raw_ticker}"
    # 简明可摘录的 meta description(前 ~150 字,含结论性数据便于 AI 引用)
    price = q["price"]
    meta_desc = f"{name_esc}({raw_ticker})估值速查 - AI 生成 DCF + Comps 估值快照。当前价 {price}。用 HyperCode 的金融技能生成完整模型。"
    og_title = f"{name_esc}({raw_ticker})估值 - AI 估值速查"
    return tpl.format(
        ticker=_h.escape(ticker),
        name=name_esc, code=_h.escape(q["code"]),
        price=q["price"], change_pct=q["change_pct"],
        mcap=q["market_cap"], pe=q["pe"],
        high_52w=q["high_52w"], low_52w=q["low_52w"],
        canonical=_h.escape(canonical),
        meta_desc=_h.escape(meta_desc),
        og_title=_h.escape(og_title),
        og_desc=_h.escape(meta_desc),
        name_esc=name_esc,
        ticker_esc=raw_ticker,
        price_esc=price_esc,
        date_iso=date_iso,
        dcf=_h.escape(rep["dcf"]).replace("\n", "<br>"),
        comps=_h.escape(rep["comps"]).replace("\n", "<br>"),
        disclaimer=_h.escape(rep["disclaimer"]),
        cta=_h.escape(rep["cta"]),
    )


# ── 独立注册/登录页面(/auth)──
AUTH_HTML = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>注册 / 登录 — HyperCode</title>
<meta name="robots" content="noindex">
<style>
:root{--bg:#0e0e10;--fg:#f5f5f7;--muted:#9a9aa5;--line:#26262c;--card:#16161a;}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--fg);font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.7}
.wrap{max-width:440px;margin:0 auto;padding:60px 24px}
h1{font-size:24px;margin-bottom:6px}
.sub{color:var(--muted);font-size:14px;margin-bottom:30px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px;margin-bottom:16px}
input{width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font-size:15px;margin-bottom:12px}
button{width:100%;padding:12px 20px;border:none;border-radius:8px;background:var(--fg);color:var(--bg);font-weight:600;cursor:pointer;font-size:15px;margin-bottom:8px}
button:hover{opacity:.9}
.note{color:var(--muted);font-size:12px;margin-top:8px;min-height:18px}
.back{color:var(--muted);font-size:13px;display:block;margin-top:12px;text-align:center;text-decoration:none}
</style></head><body><div class="wrap">
<h1>HyperCode 账户</h1>
<p class="sub">邮箱验证码登录,领取 DCF 模板 + 每日晨报</p>
<div class="card">
<input type="email" id="authEmail" placeholder="你的工作邮箱">
<button onclick="sendCode()">获取验证码</button>
<input type="text" id="authCode" placeholder="输入 6 位验证码">
<button onclick="verify()">注册 / 登录</button>
<p class="note" id="authMsg"></p>
</div>
<a class="back" href="/valuation">← 返回估值速查</a>
</div>
<script>
function api(p, q) { return '/valuation/api' + p + (q ? '?' + q : ''); }
function msg(t) { document.getElementById('authMsg').textContent = t; }
async function sendCode() {
  var v = document.getElementById('authEmail').value.trim();
  if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(v)) { msg('请输正确邮箱'); return; }
  msg('发送中...');
  var r = await fetch(api('/auth/register', 'email=' + encodeURIComponent(v)), {method:'POST'});
  var j = await r.json();
  msg(r.ok ? '验证码已发送' : (j.detail || '发送失败'));
}
async function verify() {
  var v = document.getElementById('authEmail').value.trim(), c = document.getElementById('authCode').value.trim();
  if (!v || !c) { msg('请输邮箱和验证码'); return; }
  msg('验证中...');
  var r = await fetch(api('/auth/verify', 'email=' + encodeURIComponent(v) + '&code=' + encodeURIComponent(c)), {method:'POST'});
  var j = await r.json();
  if (r.ok) msg('注册成功!欢迎 ' + j.user.email + ' · 档位 ' + j.user.plan);
  else msg(j.detail || '验证码错误');
}
</script>
</body></html>"""


@app.get("/auth", response_class=HTMLResponse)
def auth_page():
    return AUTH_HTML


@app.get("/valuation/auth", response_class=HTMLResponse)
def auth_page_prefixed():
    return AUTH_HTML


# ── 管理面板页面(需 token,存 localStorage)──
ADMIN_HTML = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>管理面板 — HyperCode</title>
<meta name="robots" content="noindex">
<style>
:root{--bg:#0e0e10;--fg:#f5f5f7;--muted:#9a9aa5;--line:#26262c;--card:#16161a;}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--fg);font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.7}
.wrap{max-width:960px;margin:0 auto;padding:40px 24px}
h1{font-size:24px;margin-bottom:8px}
.sub{color:var(--muted);font-size:14px;margin-bottom:24px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:28px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px}
.card .k{color:var(--muted);font-size:12px}
.card .v{font-size:26px;font-weight:700;margin-top:4px}
.card .d{color:var(--muted);font-size:11px;margin-top:4px}
.tbl{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.tbl th{text-align:left;padding:12px 14px;background:rgba(255,255,255,.03);font-size:12px;color:var(--muted);border-bottom:1px solid var(--line)}
.tbl td{padding:12px 14px;font-size:13px;border-bottom:1px solid var(--line)}
.tbl tr:last-child td{border-bottom:none}
.badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px}
.b-trial{background:#1a3a2a;color:#6fdc8c}.b-byok{background:#2a2a55;color:#9db4ff}.b-pro{background:#4a2a2a;color:#ff9d9d}
.b-active{background:#1a3a2a;color:#6fdc8c}
#tok{display:none}
.box{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px;max-width:420px;margin:60px auto}
.box input{width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font-size:15px;margin-bottom:12px}
.box button{width:100%;padding:12px;border:none;border-radius:8px;background:var(--fg);color:var(--bg);font-weight:600;cursor:pointer}
.err{color:#ff9d9d;font-size:13px;margin-top:8px}
.hidden{display:none;}
</style></head><body>
<div id="tokBox" class="box">
<h1 style="font-size:20px">管理面板</h1>
<p class="sub" style="margin-bottom:16px">请输入管理令牌</p>
<input type="password" id="tokInput" placeholder="管理令牌">
<button onclick="doLogin()">进入</button>
<p class="err" id="tokErr"></p>
</div>
<div id="main" class="wrap hidden">
<h1>📊 HyperCode 管理面板</h1>
<p class="sub">注册用户与转化统计</p>
<div class="cards" id="cards"></div>
<table class="tbl">
<thead><tr><th>ID</th><th>邮箱</th><th>档位</th><th>状态</th><th>注册时间</th><th>上次访问</th></tr></thead>
<tbody id="rows"></tbody>
</table>
</div>
<script>
var TOKEN = localStorage.getItem('admin_token') || '';
var API = '/valuation/api/admin';
function show(err){document.getElementById('tokErr').textContent = err || '';}
async function doLogin(){
  var t = document.getElementById('tokInput').value.trim();
  if(!t){show('请输入令牌');return;}
  localStorage.setItem('admin_token', t); TOKEN = t;
  await loadAll();
}
async function api(path){
  var r = await fetch(API + path, {headers:{'Authorization':'Bearer '+TOKEN}});
  if(r.status===401||r.status===403){show('令牌无效,请重新输入');document.getElementById('tokBox').style.display='block';document.getElementById('main').classList.add('hidden');throw new Error('auth');}
  if(r.status===501){show('管理面板未启用');throw new Error('501');}
  if(!r.ok){throw new Error('err');}
  return r.json();
}
async function loadAll(){
  try{
    var s = await api('/stats'); var u = await api('/users?limit=100');
    document.getElementById('tokBox').style.display='none';document.getElementById('main').classList.remove('hidden');
    var c = document.getElementById('cards');
    c.innerHTML = '<div class="card"><div class="k">总注册</div><div class="v">'+s.total+'</div><div class="d">验证码已发 '+s.codes_sent+' 次</div></div>' +
      '<div class="card"><div class="k">今日新增</div><div class="v">'+s.today+'</div><div class="d">当日注册</div></div>' +
      '<div class="card"><div class="k">trial</div><div class="v">'+(s.by_plan.trial||0)+'</div><div class="d">免费试用</div></div>' +
      '<div class="card"><div class="k">byok</div><div class="v">'+(s.by_plan.byok||0)+'</div><div class="d">自带密钥</div></div>' +
      '<div class="card"><div class="k">pro</div><div class="v">'+(s.by_plan.pro||0)+'</div><div class="d">付费</div></div>' +
      '<div class="card"><div class="k">推荐转化</div><div class="v">'+s.referred+'</div><div class="d">'+s.referral_helpers+' 人带来</div></div>' +
      '<div class="card"><div class="k">未激活</div><div class="v">'+(s.by_status.inactive||0)+'</div><div class="d">无效账户</div></div>' +
      '<div class="card"><div class="k">24h 访问</div><div class="v">'+((s.traffic&&s.traffic.total_24h)||0)+'</div><div class="d">目标页访问量</div></div>' +
      '<div class="card"><div class="k">真人访问</div><div class="v">'+((s.traffic&&s.traffic.by_type&&s.traffic.by_type.humans)||0)+'</div><div class="d">24h 真人(SEO效果)</div></div>' +
      '<div class="card"><div class="k">AI爬虫</div><div class="v">'+((s.traffic&&s.traffic.by_type&&s.traffic.by_type.ai_crawlers)||0)+'</div><div class="d">24h 抓取(GEO)</div></div>';
    var rb = document.getElementById('rows');
    rb.innerHTML = u.users.length ? u.users.map(function(x){
      var pb = x.plan==='pro'?'b-pro':(x.plan==='byok'?'b-byok':'b-trial');
      var sb = x.status==='active'?'b-active':'';
      return '<tr><td>'+x.id+'</td><td>'+x.email+'</td><td><span class="badge '+pb+'">'+x.plan+'</span></td><td><span class="badge '+sb+'">'+x.status+'</span></td><td>'+x.created_at+'</td><td>'+(x.last_seen_at||'—')+'</td></tr>';
    }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--muted)">暂无用户</td></tr>';
  }catch(e){ if(e.message!=='auth'&&e.message!=='501') show('加载失败'); }
}
if(TOKEN){ document.getElementById('tokInput').value=TOKEN; loadAll(); }
</script>
</body></html>"""


@app.get("/admin", response_class=HTMLResponse)
def admin_page():
    return ADMIN_HTML


# ── 国企 AI+ 落地成熟度自评系统(/aiplus)──
AI_PLUS_HTML = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>国企 AI+ 落地成熟度自评 — 对标央企 AI+ 专项行动</title>
<meta name="description" content="免费自评你单位的 AI 落地成熟度,生成对标国资委 AI+ 专项行动的诊断报告。5 大维度、30 秒完成。">
<link rel="canonical" href="https://awareliquid.ai/aiplus" />
<meta property="og:title" content="国企 AI+ 落地成熟度自评系统">
<meta property="og:description" content="免费生成 AI 落地成熟度诊断报告,对标央企 AI+ 专项行动。">
<meta name="robots" content="index, follow">
<style>
:root{--bg:#0e0e10;--fg:#f5f5f7;--muted:#9a9aa5;--line:#26262c;--card:#16161a;--accent:#4f9dff;--ok:#6fdc8c;}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--fg);font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.7;-webkit-font-smoothing:antialiased}
.wrap{max-width:760px;margin:0 auto;padding:40px 20px}
.topbar{display:flex;align-items:center;gap:12px;margin-bottom:32px}
.topbar .logo{font-weight:700;font-size:15px}
.topbar .logo span{color:var(--muted);font-weight:400}
.topbar .tag{margin-left:auto;font-size:12px;border:1px solid var(--line);border-radius:999px;padding:3px 12px;color:var(--muted)}
h1{font-size:28px;line-height:1.3;margin-bottom:10px}
.sub{color:var(--muted);font-size:15px;margin-bottom:34px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px;margin-bottom:16px}
.dim-head{display:flex;align-items:baseline;gap:10px;margin-bottom:16px}
.dim-head .no{font-size:13px;color:var(--accent);font-weight:600}
.dim-head .name{font-size:17px;font-weight:700}
.dim-head .hint{font-size:12px;color:var(--muted)}
.q{margin-bottom:14px}
.q .qtext{font-size:14px;margin-bottom:8px}
.opts{display:flex;gap:8px}
.opt{flex:1;border:1px solid var(--line);border-radius:8px;padding:10px 12px;font-size:13px;color:var(--muted);cursor:pointer;text-align:center;transition:.12s}
.opt:hover{border-color:var(--accent);color:var(--fg)}
.opt.sel{border-color:var(--accent);background:rgba(79,157,255,.12);color:var(--fg)}
.submit-btn{width:100%;padding:14px;border:none;border-radius:10px;background:var(--fg);color:var(--bg);font-weight:700;font-size:16px;cursor:pointer;margin-top:8px}
.submit-btn:hover{opacity:.9}
.report{display:none;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px;margin-top:20px}
.report .score-row{display:flex;align-items:baseline;gap:14px;margin-bottom:8px}
.report .score{font-size:44px;font-weight:800;color:var(--accent)}
.report .level{font-size:18px;font-weight:700}
.report .score-sub{color:var(--muted);font-size:13px;margin-bottom:22px}
.radar{display:flex;flex-direction:column;gap:10px;margin:18px 0 24px}
.dim-bar{display:flex;align-items:center;gap:10px}
.dim-bar .dname{width:80px;font-size:12px;color:var(--muted);text-align:right}
.dim-bar .track{flex:1;height:10px;background:var(--bg);border:1px solid var(--line);border-radius:99px;overflow:hidden}
.dim-bar .fill{height:100%;background:var(--accent);border-radius:99px;width:0;transition:.4s}
.dim-bar .dval{width:28px;font-size:12px;color:var(--fg);text-align:left}
.diag{margin:20px 0}
.diag h4{font-size:15px;margin-bottom:8px}
.diag .item{font-size:13px;color:var(--muted);padding:6px 0;border-bottom:1px solid var(--line)}
.accel{background:rgba(79,157,255,.08);border:1px solid var(--accent);border-radius:10px;padding:16px 18px;margin-top:22px}
.accel p{font-size:14px}
.accel a{color:var(--accent);font-weight:600}
.lead{margin-top:24px}
.lead input{flex:1;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font-size:14px}
.lead button{padding:12px 20px;border:none;border-radius:8px;background:var(--accent);color:#fff;font-weight:600;cursor:pointer;font-size:14px}
.lead .msg{font-size:12px;color:var(--muted);margin-top:8px;min-height:16px}
.foot{text-align:center;color:var(--muted);font-size:12px;margin-top:40px}
.foot a{color:var(--muted)}
</style>
</head><body><div class="wrap">
<div class="topbar"><div class="logo">AwareLiquid <span>· AI+ 落地评估</span></div><div class="tag">对标国资委「央企 AI+ 专项行动」</div></div>
<h1>国企 AI+ 落地成熟度自评</h1>
<p class="sub">5 大维度、15 道题、约 2 分钟。填完即时生成一份可汇报的诊断报告,定位你单位的 AI 落地短板。</p>

<div id="quiz"></div>
<button class="submit-btn" id="submitBtn">生成我的 AI 成熟度报告</button>

<div class="report" id="report"></div>

<div class="lead">
<p style="font-size:13px;color:var(--muted);margin-bottom:8px">留邮箱,获取完整版《AI 落地成熟度报告》PDF + 同行业对标参考(可选)</p>
<div style="display:flex;gap:8px">
<input type="email" id="leadEmail" placeholder="工作邮箱(选填)">
<button onclick="submitLead()">获取完整报告</button>
</div>
<p class="msg" id="leadMsg"></p>
</div>

<div class="foot">本自评仅供内部诊断参考,不构成任何认定依据 · <a href="https://awareliquid.ai">AwareLiquid</a></div>
</div>

<script>
// ── 成熟度模型(5 维度 × 3 题 × 3 档)──
var MODEL = [
  { name: "战略与组织", hint: "AI 是否上升为单位战略", qs: [
    { t: "是否将 AI 应用写入年度工作要点或专项规划?", opts: ["未提及", "已立项", "已列为重点"] },
    { t: "是否有明确的 AI 责任部门或工作专班?", opts: ["无", "兼职负责", "专职专班"] },
    { t: "是否有独立的 AI 预算或资源保障?", opts: ["无预算", "临时列支", "单列预算"] },
  ]},
  { name: "数据基础", hint: "数据是否可安全用于 AI", qs: [
    { t: "核心业务数据是否已完成治理/结构化?", opts: ["未治理", "部分治理", "已结构化"] },
    { t: "是否建立数据分级分类与脱敏规范?", opts: ["无", "有制度未落地", "已落地执行"] },
    { t: "数据是否具备不出域/内网使用的条件?", opts: ["无要求", "部分可", "可不出域"] },
  ]},
  { name: "算力与模型", hint: "国产模型与私有化能力", qs: [
    { t: "是否已接触或试点国产大模型?", opts: ["未接触", "试用中", "已采购/部署"] },
    { t: "是否具备本地化/私有化部署条件?", opts: ["无", "规划中", "已具备"] },
    { t: "算力资源是否满足 AI 应用需求?", opts: ["不足", "勉强", "充足"] },
  ]},
  { name: "场景落地", hint: "AI 是否真正用于业务", qs: [
    { t: "是否在具体业务场景试点 AI(写作/审批/风控等)?", opts: ["无试点", "1-2 个", "3 个以上"] },
    { t: "试点场景是否有可量化的减负/提效数据?", opts: ["无数据", "定性", "有量化"] },
    { t: "是否有规模化推广 AI 的时间表?", opts: ["无", "计划中", "已推进"] },
  ]},
  { name: "安全合规", hint: "AI 应用的安全红线", qs: [
    { t: "是否通过等保测评或商用密码应用?", opts: ["未开展", "进行中", "已通过"] },
    { t: "是否对 AI 应用做数据安全审查?", opts: ["无", "有流程", "已审查"] },
    { t: "是否建立 AI 应用管理制度/责任追责?", opts: ["无", "有制度", "制度+执行"] },
  ]},
];

var LEVELS = [
  { min: 0, name: "起步期", desc: "AI 落地尚在观望,建议先从一个高价值场景切入,建立信心。" },
  { min: 12, name: "探索期", desc: "已有 AI 意识,但缺乏系统推进,短板集中在场景落地与合规。" },
  { min: 20, name: "发展期", desc: "AI 已进入试点,下一步是把单点成果规模化、制度化。" },
  { min: 28, name: "成熟期", desc: "AI 已融入核心业务,持续优化数据与安全底座即可。" },
  { min: 36, name: "领先期", desc: "AI 落地处于行业前列,可作为标杆输出经验。" },
];

var DIM_ADVICE = {
  "战略与组织": "把 AI 写入年度工作要点,成立专职专班,单列预算——顶层设计到位,落地才有抓手。",
  "数据基础": "先做数据分级分类与脱敏,再谈 AI——数据不出域是国企 AI 的第一前提。",
  "算力与模型": "优先选择支持本地化/私有化部署的国产模型,避免数据外流风险。",
  "场景落地": "从『写材料』『文档审核』等高频、低风险场景切入,快速见效、建立信心。",
  "安全合规": "等保测评 + 数据安全审查 + 责任制度三件套,是 AI 应用能过审的底线。",
};

// 渲染问卷
var quiz = document.getElementById('quiz');
MODEL.forEach(function(dim, di) {
  var html = '<div class="card"><div class="dim-head"><span class="no">维度' + (di+1) + '</span><span class="name">' + dim.name + '</span><span class="hint">' + dim.hint + '</span></div>';
  dim.qs.forEach(function(q, qi) {
    html += '<div class="q"><div class="qtext">' + (qi+1) + '. ' + q.t + '</div><div class="opts">';
    q.opts.forEach(function(o, oi) {
      html += '<div class="opt" data-d="' + di + '" data-q="' + qi + '" data-o="' + oi + '">' + o + '</div>';
    });
    html += '</div></div>';
  });
  html += '</div>';
  quiz.innerHTML += html;
});

// 选项点击
var answers = {}; // "di-qi" -> oi
document.querySelectorAll('.opt').forEach(function(el) {
  el.addEventListener('click', function() {
    var di = el.dataset.d, qi = el.dataset.q;
    document.querySelectorAll('.opt[data-d="'+di+'"][data-q="'+qi+'"]').forEach(function(o){o.classList.remove('sel');});
    el.classList.add('sel');
    answers[di + '-' + qi] = parseInt(el.dataset.o);
  });
});

// 生成报告
document.getElementById('submitBtn').addEventListener('click', function() {
  var total = 0, dimScores = [];
  MODEL.forEach(function(dim, di) {
    var s = 0;
    dim.qs.forEach(function(q, qi) {
      s += answers[di + '-' + qi] || 0;
    });
    dimScores.push(s);
    total += s;
  });
  var answered = Object.keys(answers).length;
  if (answered < 15) {
    alert('请完成全部 15 道题后再生成报告');
    return;
  }
  var level = LEVELS[0];
  LEVELS.forEach(function(l) { if (total >= l.min) level = l; });

  var bars = MODEL.map(function(dim, di) {
    var pct = Math.round(dimScores[di] / 6 * 100);
    return '<div class="dim-bar"><span class="dname">' + dim.name + '</span><div class="track"><div class="fill" style="width:' + pct + '%"></div></div><span class="dval">' + pct + '%</span></div>';
  }).join('');

  // 短板诊断(分数最低的 2 个维度)
  var sorted = dimScores.map(function(s, i) { return { s: s, name: MODEL[i].name }; }).sort(function(a,b){return a.s-b.s;});
  var weak = sorted.slice(0, 2);

  var report = '<div class="score-row"><span class="score">' + total + '</span><span class="level">/40 · ' + level.name + '</span></div>';
  report += '<div class="score-sub">' + level.desc + '</div>';
  report += '<h4>分维度成熟度</h4>' + bars;
  report += '<div class="diag"><h4>关键短板与建议</h4>';
  weak.forEach(function(w) {
    report += '<div class="item"><strong>' + w.name + '</strong>:' + DIM_ADVICE[w.name] + '</div>';
  });
  report += '</div>';
  report += '<div class="accel"><p>想加速落地?可引入<strong>数据不出域、支持私有化部署的国产 AI 工作智能体</strong>——把『写材料/文档审核/数据整理』这类高频低风险场景先跑起来。<a href="https://awareliquid.ai/hypercode">了解 HyperCode</a></p></div>';

  var r = document.getElementById('report');
  r.innerHTML = report;
  r.style.display = 'block';
  r.scrollIntoView({ behavior: 'smooth' });
});

function submitLead() {
  var email = document.getElementById('leadEmail').value.trim();
  var msg = document.getElementById('leadMsg');
  if (!email || !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) { msg.textContent = '请输入正确邮箱'; return; }
  fetch('/valuation/api/leads?email=' + encodeURIComponent(email) + '&ticker=aiplus', { method: 'POST' })
    .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, j: j }; }); })
    .then(function(x) { msg.textContent = x.ok ? '✅ 已收到,完整报告将发送到你邮箱' : '❌ 提交失败'; })
    .catch(function() { msg.textContent = '网络错误'; });
}
</script>
</body></html>"""


@app.get("/aiplus", response_class=HTMLResponse)
def aiplus_page():
    return AI_PLUS_HTML


@app.get("/valuation/aiplus", response_class=HTMLResponse)
def aiplus_page_prefixed():
    return AI_PLUS_HTML


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8787)
