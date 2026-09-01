#!/usr/bin/env python3
"""解析 Caddy 日志,生成访问统计 JSON(供管理面板读取)。

输出: /opt/valuation/traffic.json
  {"total_24h": N, "today": N, "by_page": {...}, "by_type": {...}, "updated": "..."}
"""
import json
import re
import subprocess
from datetime import date
from collections import Counter

OUT = "/opt/valuation/traffic.json"

def parse_logs(hours=24):
    raw = subprocess.run(
        ["docker", "logs", "caddy_prod", "--since", f"{hours}h"],
        capture_output=True, text=True, timeout=60).stdout
    target = re.compile(r'/(?:snapshots|valuation|morning-notes|hypercode|guides|en/)')
    by_page = Counter()
    by_type = Counter()
    total = 0
    BOTS = ["GPTBot","ClaudeBot","PerplexityBot","Googlebot","bingbot","Baiduspider",
            "CCBot","Bytespider","Applebot","Anthropic","Google-Extended","ChatGPT-User"]
    for line in raw.splitlines():
        try:
            ua_m = re.search(r'"User-Agent": \["([^"]*)"', line)
            uri_m = re.search(r'"uri": "([^"]*)"', line)
            status_m = re.search(r'"status": (\d+)', line)
            if not (ua_m and uri_m and status_m): continue
            ua, uri, st = ua_m.group(1), uri_m.group(1), status_m.group(1)
            if not target.search(uri): continue
            if st != "200": continue
            total += 1
            if "/snapshots/" in uri: by_page["snapshots"] += 1
            elif "/en/valuation" in uri: by_page["en_valuation"] += 1
            elif "/valuation" in uri: by_page["valuation"] += 1
            elif "/morning-notes" in uri: by_page["morning"] += 1
            elif "/en/" in uri: by_page["en_pages"] += 1
            elif "/guides" in uri: by_page["guides"] += 1
            elif "/hypercode" in uri: by_page["hypercode"] += 1
            else: by_page["other"] += 1
            if any(b.lower() in ua.lower() for b in BOTS): by_type["ai_crawlers"] += 1
            elif any(t in ua for t in ["curl","python","wget","Go-http","okhttp"]): by_type["tools"] += 1
            else: by_type["humans"] += 1
        except Exception: continue
    return {"total_24h": total, "by_page": dict(by_page), "by_type": dict(by_type)}

data = parse_logs(24)
data["updated"] = date.today().isoformat()
open(OUT, "w", encoding="utf-8").write(json.dumps(data, ensure_ascii=False, indent=2))
print(f"traffic.json 已生成: 24h={data['total_24h']} humans={data['by_type'].get('humans',0)}")
