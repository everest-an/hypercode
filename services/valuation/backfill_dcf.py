"""DCF backfill — 补全修复前生成的空 DCF 快照。

扫描 /opt/valuation/snapshots/*.html,找出 DCF 为"模型未返回内容"的快照,
重新调用估值 API(已修复的纯文本 prompt)重新生成并覆盖。

用法(在 batch 完成后运行):
  ./venv/bin/python backfill_dcf.py --delay 1.5
"""
import argparse
import glob
import os
import re
import time

import httpx

SNAP_DIR = "/opt/valuation/snapshots"
API_BASE = "http://127.0.0.1:8787"

EMPTY_MARK = "模型未返回内容"


def find_empty_dcf() -> list:
    """返回 DCF 为空的快照 ticker 列表。"""
    empty = []
    for f in glob.glob(os.path.join(SNAP_DIR, "*.html")):
        try:
            content = open(f, encoding="utf-8").read()
        except Exception:
            continue
        if EMPTY_MARK in content:
            ticker = os.path.basename(f).replace(".html", "")
            empty.append(ticker)
    return sorted(empty)


def regenerate(ticker: str) -> bool:
    """重新生成单个快照的 HTML 并覆盖。"""
    try:
        r = httpx.get(f"{API_BASE}/valuation", params={"ticker": ticker},
                      timeout=120)
        if r.status_code != 200:
            return False
        html = r.text
        # 规范化标题(与 batch_snapshots 一致)
        html = re.sub(
            r"<title>[^<]*</title>",
            f"<title>{ticker}估值 — AI 估值速查 | HyperCode</title>",
            html, count=1)
        fname = os.path.join(SNAP_DIR, f"{ticker}.html")
        with open(fname, "w", encoding="utf-8") as f:
            f.write(html)
        return EMPTY_MARK not in html
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--delay", type=float, default=1.5)
    args = ap.parse_args()

    empty = find_empty_dcf()
    print(f"发现 {len(empty)} 个空 DCF 快照,开始补全...")

    ok, fail = 0, 0
    for i, ticker in enumerate(empty, 1):
        success = regenerate(ticker)
        if success:
            ok += 1
        else:
            fail += 1
        print(f"[{i}/{len(empty)}] {ticker}: {'OK' if success else 'FAIL'}")
        time.sleep(args.delay)

    print(f"\n完成: {ok} OK, {fail} FAIL")
    remaining = len(find_empty_dcf())
    print(f"剩余空 DCF 快照: {remaining}")


if __name__ == "__main__":
    main()
