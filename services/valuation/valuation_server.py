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

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, RedirectResponse

try:
    import load_env  # noqa: F401  # 自动加载 .env(服务器部署用)
except ImportError:
    pass

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
DCF_PROMPT = """你是投行 DCF 建模师。对 {name}({code},现价 {price},市值 {market_cap} 亿,PE {pe}):
1. 给出 3 个关键假设(收入增速/营业利润率/WACC),明确标注"假设值,非财报数据"
2. 基于假设给出简版 DCF 每股价值区间
3. 一句话结论(低估/合理/高估,注明这是 AI 观点)
4. 必须含:非投资建议
输出结构化 Markdown,300 字以内,中文。"""

COMPS_PROMPT = """对 {name}(现价 {price},PE {pe}),给出同行业 3 家可比公司及各自典型 PE 区间,
对比判断相对估值位置(低估/合理/高估)。必须含:非投资建议。150 字以内,中文。"""


def ask_deepseek(prompt: str, retries: int = 2) -> str:
    """调用 DeepSeek。返回文本。空响应重试。"""
    if not DEEPSEEK_API_KEY:
        return "模型未配置(需 DEEPSEEK_API_KEY 环境变量)"
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
            time.sleep(1)
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


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{name} 估值速查 — HyperCode AI</title>
<meta name="robots" content="index, follow">
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
</style></head><body><div class="wrap">
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
<div class="card"><h2>📊 DCF 简版(AI 生成)</h2><div class="md">{dcf}</div></div>
<div class="card"><h2>📊 Comps 对比(AI 生成)</h2><div class="md">{comps}</div></div>
<p class="note">⚠️ {disclaimer}</p>
<a class="cta" href="https://awareliquid.ai/hypercode">🚀 要完整 DCF/LBO 模型?下载 HyperCode</a>
<div class="card" style="margin-top:24px">
<h2>📩 免费领取:DCF 模型模板 + 每日晨报</h2>
<p class="md" style="color:var(--muted)">留邮箱,我们发送完整的 DCF/LBO Excel 模板(公式即用)+ 每交易日 AI 晨报。绝不自动扣费,随时退订。</p>
<form id="leadForm" style="margin-bottom:0">
<input type="email" id="leadEmail" placeholder="你的工作邮箱" required style="margin-top:12px">
<button type="submit" style="margin-top:12px">领取模板</button>
</form>
<p id="leadMsg" class="note" style="min-height:18px"></p>
</div>
<script>
document.getElementById('leadForm').addEventListener('submit', async function(e) {{
  e.preventDefault();
  const email = document.getElementById('leadEmail').value.trim();
  const msg = document.getElementById('leadMsg');
  if (!email) {{ msg.textContent = '请输入邮箱'; return; }}
  try {{
    const r = await fetch('/valuation/api/leads?email=' + encodeURIComponent(email) + '&ticker={ticker}', {{method:'POST'}});
    const j = await r.json();
    msg.textContent = r.ok ? '✅ ' + j.message : '❌ ' + (j.detail || '提交失败');
  }} catch(err) {{
    msg.textContent = '❌ 网络错误,请稍后重试';
  }}
}});
</script>
<p class="note" style="text-align:center;margin-top:14px">{cta}</p>
</div></body></html>"""


@app.get("/valuation", response_class=HTMLResponse)
def valuation_page(ticker: str = "600519"):
    rep = build_report(ticker)
    q = rep["quote"]
    import html as _h
    return HTML_TEMPLATE.format(
        ticker=_h.escape(ticker),
        name=_h.escape(q["name"]), code=_h.escape(q["code"]),
        price=q["price"], change_pct=q["change_pct"],
        mcap=q["market_cap"], pe=q["pe"],
        high_52w=q["high_52w"], low_52w=q["low_52w"],
        dcf=_h.escape(rep["dcf"]).replace("\n", "<br>"),
        comps=_h.escape(rep["comps"]).replace("\n", "<br>"),
        disclaimer=_h.escape(rep["disclaimer"]),
        cta=_h.escape(rep["cta"]),
    )


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8787)
