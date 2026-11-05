#!/usr/bin/env python3
"""Trust3 月度成本报告 / LeapNode 充值建议。

读取上个月的全部用量记录：
  - total_cost  是上游成本（倍率前的成本，USD）
  - actual_cost 是用户侧扣费（乘倍率后的金额，USD）
据此给出毛利，并建议下月应给 LeapNode 充多少钱（成本 × 1.2 安全系数）。

默认每月 1 日运行；其他日期直接跳过（FORCE=1 可强制）。
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

API = os.environ.get("TRUST3_API", "https://api.trust3.pro")
EMAIL = os.environ.get("TRUST3_ADMIN_EMAIL", "")
PASSWORD = os.environ.get("TRUST3_ADMIN_PASSWORD", "")
FX = float(os.environ.get("USD_CNY_RATE", "7.2"))
ALERT_TO = os.environ.get("ALERT_EMAIL", "")
FORCE = os.environ.get("FORCE", "") == "1"
TZ = timezone(timedelta(hours=8))


def request(path: str, token: str | None = None, payload: dict | None = None) -> dict:
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(API + path, data=data, method="POST" if data else "GET")
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


def last_month_range(now: datetime) -> tuple[datetime, datetime]:
    first_this = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    last_month_end = first_this
    last_month_start = (first_this - timedelta(days=1)).replace(day=1)
    return last_month_start, last_month_end


def main() -> int:
    now = datetime.now(TZ)
    if now.day != 1 and not FORCE:
        print("今天不是 1 号，跳过月度报告（FORCE=1 可强制）")
        return 0
    if not EMAIL or not PASSWORD:
        print("缺少 TRUST3_ADMIN_EMAIL / TRUST3_ADMIN_PASSWORD")
        return 1

    start, end = last_month_range(now)
    login = request("/api/v1/auth/login", payload={"email": EMAIL, "password": PASSWORD})
    token = login.get("data", {}).get("access_token")
    if not token:
        print("Trust3 登录失败:", login)
        return 1

    upstream_usd = 0.0
    revenue_usd = 0.0
    requests = 0
    page = 1
    while True:
        resp = request(f"/api/v1/admin/usage?page={page}&page_size=100", token=token)
        items = resp.get("data", {}).get("items", [])
        if not items:
            break
        done = False
        for it in items:
            created = it.get("created_at", "")
            try:
                ts = datetime.fromisoformat(created.replace("Z", "+00:00"))
            except ValueError:
                continue
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=TZ)
            if ts < start:
                done = True
                break
            if ts < end:
                upstream_usd += float(it.get("total_cost") or 0)
                revenue_usd += float(it.get("actual_cost") or 0)
                requests += 1
        if done:
            break
        total = int(resp.get("data", {}).get("total") or 0)
        if page * 100 >= total:
            break
        page += 1

    upstream_cny = upstream_usd * FX
    revenue_cny = revenue_usd * FX
    margin = (1 - upstream_usd / revenue_usd) * 100 if revenue_usd > 0 else 0
    suggestion = upstream_cny * 1.2

    body = (
        f"Trust3 月度成本报告（{start:%Y-%m}）\n\n"
        f"请求数：{requests}\n"
        f"用户侧扣费：¥{revenue_cny:,.2f}\n"
        f"上游成本：  ¥{upstream_cny:,.2f}\n"
        f"毛利率：    {margin:.1f}%\n\n"
        f"建议本月给 LeapNode 充值：¥{suggestion:,.0f}（成本 × 1.2 安全系数）\n"
        f"充值入口：console.leapnode.ai/purchase（支付宝）\n"
    )
    print(body)
    send_mail(f"[Trust3] {start:%Y-%m} 成本报告：建议充值 ¥{suggestion:,.0f}", body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
