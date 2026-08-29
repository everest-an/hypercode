"""重建 awareliquid.ai 的 sitemap.xml,登记全部估值快照页。

流程:
1. 扫描 /opt/valuation/snapshots/*.html
2. 读现有 /root/AwareLiquid-Web/web/sitemap.xml
3. 移除旧的 /snapshots/ 条目,注入全部当前快照条目
4. 写回 sitemap.xml

用途:批量快照生成完成后调用,让搜索引擎能发现所有 300 个长尾页面。
"""
import glob
import os
import re
from datetime import date

SNAP_DIR = "/opt/valuation/snapshots"
SITEMAP = "/root/AwareLiquid-Web/web/sitemap.xml"
BASE = "https://awareliquid.ai"
TODAY = date.today().isoformat()


def gen_snapshot_entries() -> str:
    files = sorted(glob.glob(os.path.join(SNAP_DIR, "*.html")))
    entries = []
    for f in files:
        name = os.path.basename(f).replace(".html", "")
        entries.append(
            "  <url>\n"
            f"    <loc>{BASE}/snapshots/{name}.html</loc>\n"
            f"    <lastmod>{TODAY}</lastmod>\n"
            "    <changefreq>weekly</changefreq>\n"
            "    <priority>0.5</priority>\n"
            "  </url>"
        )
    return "\n".join(entries), len(files)


def main():
    if not os.path.exists(SITEMAP):
        print(f"[错误] sitemap 不存在: {SITEMAP}")
        return

    entries, count = gen_snapshot_entries()
    if count == 0:
        print("[错误] 无快照文件")
        return

    content = open(SITEMAP, encoding="utf-8").read()

    # 移除所有旧的 /snapshots/ 条目(每个 <url>...</url> 块)
    content = re.sub(
        r"\s*<url>\s*<loc>[^<]*/snapshots/[^<]*</loc>.*?</url>",
        "", content, flags=re.DOTALL)

    # 在 </urlset> 前插入新条目
    new_entries = entries + "\n"
    content = content.replace("</urlset>", new_entries + "</urlset>", 1)

    open(SITEMAP, "w", encoding="utf-8").write(content)
    print(f"[完成] sitemap 已更新,登记 {count} 个估值快照页")


if __name__ == "__main__":
    main()
