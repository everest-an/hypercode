"""
morning_note.py — 每日金融晨报自动生成器(自动化获客内容引擎)

交易日早 7:30 运行:抓取热点 → DeepSeek 生成晨报 → 输出 Markdown。
发布管道(公众号/雪球)通过回调 hook 扩展。

用法:
  python morning_note.py                # 生成今日晨报
  python morning_note.py --out dir      # 指定输出目录
"""
import argparse
import os
import re
import time
from datetime import datetime, date

import httpx

try:
    import load_env  # noqa: F401  # 自动加载 .env(服务器部署用)
except ImportError:
    pass

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE = "https://api.deepseek.com/v1"
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash")

# 每日关注的蓝筹(用于生成"昨日异动"观察)
WATCH_LIST = [
    ("600519", "贵州茅台"), ("601318", "中国平安"), ("600036", "招商银行"),
    ("000858", "五粮液"), ("601899", "紫金矿业"), ("600030", "中信证券"),
    ("000001", "平安银行"), ("601012", "隆基绿能"), ("300750", "宁德时代"),
    ("002594", "比亚迪"),
]

TEN_HEADERS = {"Referer": "https://gu.qq.com/"}


def fetch_quotes(tickers: list) -> list:
    """批量抓取行情。返回 [{code, name, price, change_pct, pe}]。"""
    codes = [("sh" if t.startswith("6") else "sz") + t for t, _ in tickers]
    out = []
    # 腾讯批量接口:一次最多 50 个
    for i in range(0, len(codes), 50):
        batch = codes[i:i + 50]
        url = f"https://qt.gtimg.cn/q={','.join(batch)}"
        r = httpx.get(url, timeout=10)
        r.encoding = "gbk"
        for line in r.text.strip().split(";"):
            m = re.search(r'="(.*)"', line)
            if not m:
                continue
            f = m.group(1).split("~")
            if len(f) < 40:
                continue
            out.append({
                "code": f[2], "name": f[1], "price": float(f[3]),
                "change_pct": float(f[32]), "pe": float(f[39]) if f[39] else 0,
            })
    return out


def fetch_hot_news() -> str:
    """抓取财经头条(新浪财经滚动)。失败时返回空。"""
    try:
        r = httpx.get("https://feed.mix.sina.com.cn/api/roll/get",
                      params={"pageid": "153", "lid": "2510",
                              "k": "", "num": "8", "page": "1"},
                      headers={"Referer": "https://finance.sina.com.cn"},
                      timeout=10)
        j = r.json()
        items = j.get("result", {}).get("data", [])
        titles = [it.get("title", "") for it in items if it.get("title")]
        return "\n".join(f"- {t}" for t in titles[:8])
    except Exception:
        return ""


MORNING_PROMPT = """你是资深财经晨报编辑。基于以下材料,写一份今日 A股晨报(300 字以内,Markdown):

【昨日收盘观察】(10 只蓝筹)
{watch}

【今日财经头条】
{news}

晨报结构:
## 今日晨报 {date}
### 盘面速览(观察名单涨跌概括 + 1 个数据亮点)
### 市场焦点(从头条挑 2 条展开,每条 2 句)
### 风险提示(1 条,中性客观)
### 估值观察(用估值速查工具了解个股 → https://awareliquid.ai/valuation?ticker=600519)

要求:客观中立,不构成投资建议;结尾固定附 CTA:
"💡 想深入分析个股估值?试试 AI 估值速查 → https://awareliquid.ai/valuation"
"""


def generate_morning_note() -> str:
    quotes = fetch_quotes(WATCH_LIST)
    news = fetch_hot_news()
    watch_lines = "\n".join(
        f"- {q['name']}: {q['price']}({q['change_pct']:+.2f}%)"
        for q in quotes)
    prompt = MORNING_PROMPT.format(
        watch=watch_lines, news=news or "(暂无头条)",
        date=date.today().strftime("%Y-%m-%d"))
    if not DEEPSEEK_API_KEY:
        return "# 晨报\n(未配置 DEEPSEEK_API_KEY)"
    for attempt in range(3):
        try:
            r = httpx.post(
                f"{DEEPSEEK_BASE}/chat/completions",
                headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}"},
                json={"model": DEEPSEEK_MODEL,
                      "messages": [{"role": "user", "content": prompt}],
                      "max_tokens": 800, "temperature": 0.5},
                timeout=90,
            )
            r.raise_for_status()
            note = r.json()["choices"][0]["message"]["content"].strip()
            if note:
                return note
        except Exception:
            pass
        time.sleep(2)
    return "# 晨报\n(生成失败,请检查 DeepSeek 服务)"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="morning_notes")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    note = generate_morning_note()
    fname = os.path.join(args.out, f"morning_{date.today().isoformat()}.md")
    with open(fname, "w", encoding="utf-8") as f:
        f.write(note)
    print(f"晨报已生成: {fname}")
    print(note[:500])
    # 扩展点:发布管道 hook(公众号/雪球)在此接入
    if os.environ.get("PUBLISH_HOOK"):
        print(f"[publish] hook 已配置: {os.environ['PUBLISH_HOOK']}(未调用)")


if __name__ == "__main__":
    main()
