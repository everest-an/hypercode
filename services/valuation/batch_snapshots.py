"""
batch_snapshots.py — 批量生成 A股估值快照页面(SEO 长尾)

对沪深 300 成分股批量调用估值服务,生成每个股票的静态快照页面,
存为 HTML 文件,供搜索引擎收录("XX 公司估值"长尾关键词)。

用法:
  python batch_snapshots.py --limit 5 --out /opt/valuation/snapshots
  python batch_snapshots.py --all          # 全部(分批,注意速率)
"""
import argparse
import os
import time

import httpx

# 沪深300 主要成分股(子集可扩展;完整列表可接官方数据)
TOP300 = [
    ("600519", "贵州茅台"), ("601318", "中国平安"), ("600036", "招商银行"),
    ("000858", "五粮液"), ("601899", "紫金矿业"), ("600030", "中信证券"),
    ("000001", "平安银行"), ("601012", "隆基绿能"), ("300750", "宁德时代"),
    ("002594", "比亚迪"), ("600900", "长江电力"), ("601166", "兴业银行"),
    ("600000", "浦发银行"), ("601398", "工商银行"), ("601988", "中国银行"),
    ("601288", "农业银行"), ("601328", "交通银行"), ("600028", "中国石化"),
    ("601857", "中国石油"), ("600941", "中国移动"), ("601728", "中国电信"),
    ("688981", "中芯国际"), ("600276", "恒瑞医药"), ("300760", "迈瑞医疗"),
    ("601888", "中国中免"), ("600809", "山西汾酒"), ("000568", "泸州老窖"),
    ("603288", "海天味业"), ("000333", "美的集团"), ("000651", "格力电器"),
    ("600690", "海尔智家"), ("002415", "海康威视"), ("601100", "恒立液压"),
    ("603259", "药明康德"), ("300059", "东方财富"), ("601688", "华泰证券"),
    ("600837", "海通证券"), ("601211", "国泰君安"), ("000776", "广发证券"),
    ("600999", "招商证券"), ("601066", "中信建投"), ("600585", "海螺水泥"),
    ("601668", "中国建筑"), ("601186", "中国铁建"), ("601390", "中国中铁"),
    ("600031", "三一重工"), ("000725", "京东方A"), ("002475", "立讯精密"),
    ("300124", "汇川技术"), ("002230", "科大讯飞"), ("600570", "恒生电子"),
    ("688111", "金山办公"), ("002371", "北方华创"), ("688012", "中微公司"),
    ("300014", "亿纬锂能"), ("002460", "赣锋锂业"), ("300274", "阳光电源"),
    ("601012", "隆基绿能"), ("002129", "TCL中环"), ("300316", "晶盛机电"),
]

API_BASE = os.environ.get("VAL_API_BASE", "http://127.0.0.1:8787")


def gen_snapshot(ticker: str, name: str, out_dir: str) -> bool:
    """生成单个股票快照 HTML。返回是否成功。"""
    try:
        r = httpx.get(f"{API_BASE}/valuation", params={"ticker": ticker},
                      timeout=90)
        if r.status_code != 200:
            return False
        html = r.text
        # 将页面标题规范化为 "XX(代码)估值 — AI 估值速查"(SEO 友好)
        import re as _re
        html = _re.sub(
            r"<title>[^<]*</title>",
            f"<title>{name}({ticker})估值 — AI 估值速查 | HyperCode</title>",
            html, count=1)
        fname = os.path.join(out_dir, f"{ticker}.html")
        with open(fname, "w", encoding="utf-8") as f:
            f.write(html)
        return True
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=5)
    ap.add_argument("--out", default="/opt/valuation/snapshots")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--delay", type=float, default=2.0,
                    help="每次调用间隔秒(控制 AI 成本)")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    tickers = TOP300 if args.all else TOP300[:args.limit]

    ok, fail = 0, 0
    for i, (code, name) in enumerate(tickers, 1):
        success = gen_snapshot(code, name, args.out)
        if success:
            ok += 1
        else:
            fail += 1
        print(f"[{i}/{len(tickers)}] {name}({code}): "
              f"{'OK' if success else 'FAIL'}")
        time.sleep(args.delay)

    print(f"\n完成: {ok} OK, {fail} FAIL → {args.out}")
    print("SEO 提示:这些页面由 /valuation?ticker=XX 生成,"
          "确认被 Google/百度收录后即为长尾流量入口。")


if __name__ == "__main__":
    main()
