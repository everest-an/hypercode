"""
publish_morning.py — 晨报发布到 awareliquid.ai/morning-notes/(静态页面)

cron 生成晨报后运行:把 .md 转成 .html,写入 web/morning-notes/,
通过 git push 部署(或由部署脚本同步)。

用法:
  python publish_morning.py --md /opt/valuation/morning_notes/morning_2026-08-29.md
"""
import argparse
import html as _h
import os
import re
from datetime import date
from pathlib import Path


def md_to_html(md_text: str) -> str:
    """极简 Markdown→HTML(晨报结构固定,够用)。"""
    lines = []
    for line in md_text.splitlines():
        line = line.rstrip()
        if not line:
            continue
        if line.startswith("## "):
            lines.append(f"<h2>{_h.escape(line[3:])}</h2>")
        elif line.startswith("### "):
            lines.append(f"<h3>{_h.escape(line[4:])}</h3>")
        elif line.startswith("- "):
            lines.append(f"<li>{_h.escape(line[2:])}</li>")
        elif line.startswith("**"):
            lines.append(f"<p>{_h.escape(line)}</p>")
        else:
            lines.append(f"<p>{_h.escape(line)}</p>")
    # 合并连续 li
    out = []
    in_ul = False
    for l in lines:
        if l.startswith("<li>"):
            if not in_ul:
                out.append("<ul>")
                in_ul = True
            out.append(l)
        else:
            if in_ul:
                out.append("</ul>")
                in_ul = False
            out.append(l)
    if in_ul:
        out.append("</ul>")
    return "\n".join(out)


PAGE = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} — HyperCode AI 估值速查</title>
<meta name="description" content="{desc}">
<meta name="robots" content="index, follow">
<style>
:root{{--bg:#0e0e10;--fg:#f5f5f7;--muted:#9a9aa5;--line:#26262c;--card:#16161a;}}
*{{margin:0;padding:0;box-sizing:border-box}}
body{{background:var(--bg);color:var(--fg);font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.8;font-size:15px}}
.wrap{{max-width:720px;margin:0 auto;padding:40px 20px}}
h1{{font-size:26px;margin-bottom:24px}}
h2{{font-size:19px;margin:28px 0 10px;border-bottom:1px solid var(--line);padding-bottom:8px}}
h3{{font-size:16px;margin:18px 0 8px}}
p{{color:var(--fg);margin:8px 0}}
ul{{margin:8px 0 8px 20px;color:var(--fg)}}
li{{margin:4px 0}}
a{{color:var(--fg)}}
.nav{{color:var(--muted);font-size:13px;margin-bottom:30px}}
.nav a{{color:var(--muted)}}
.cta{{display:block;text-align:center;background:var(--fg);color:var(--bg);padding:14px;border-radius:10px;font-weight:600;text-decoration:none;margin-top:30px}}
.cta:hover{{opacity:.9}}
.note{{color:var(--muted);font-size:12px;margin-top:16px;text-align:center}}
</style></head><body><div class="wrap">
<p class="nav">← <a href="/">AwareLiquid</a> · <a href="/morning-notes/">晨报归档</a> · <a href="/valuation">估值速查</a></p>
{content}
<a class="cta" href="https://awareliquid.ai/valuation">💡 想深入分析个股估值?试试 AI 估值速查 →</a>
<p class="note">AI 生成,仅供参考,非投资建议。AwareLiquid · HyperCode</p>
</div></body></html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--md", required=True, help="晨报 .md 文件路径")
    ap.add_argument("--out-dir", default=r"E:\AwareLiquid-Web\web\morning-notes",
                    help="输出 HTML 目录")
    args = ap.parse_args()

    md_text = Path(args.md).read_text(encoding="utf-8")
    # 提取标题(第一个 ## 行)
    m = re.search(r"## (.+)", md_text)
    title = m.group(1).strip() if m else f"晨报 {date.today().isoformat()}"
    desc = md_text.splitlines()[1][:80] if len(md_text.splitlines()) > 1 else title

    os.makedirs(args.out_dir, exist_ok=True)
    fname = Path(args.md).stem  # morning_2026-08-29
    out = Path(args.out_dir) / f"{fname}.html"
    content = md_to_html(md_text)
    out.write_text(PAGE.format(title=_h.escape(title),
                               desc=_h.escape(desc),
                               content=content), encoding="utf-8")
    print(f"已发布: {out}")


if __name__ == "__main__":
    main()
