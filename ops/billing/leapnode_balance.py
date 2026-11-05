#!/usr/bin/env python3
"""LeapNode 余额监控。

登录 LeapNode 面板读取余额，低于阈值时发邮件告警并以非零码退出（让 CI 变红）。
只依赖标准库，GitHub Actions 可直接跑。
"""

import json
import os
import smtplib
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import urllib.request
from email.header import Header
from email.mime.text import MIMEText

API = os.environ.get("LEAPNODE_API", "https://console.leapnode.ai")
EMAIL = os.environ.get("LEAPNODE_EMAIL", "")
PASSWORD = os.environ.get("LEAPNODE_PASSWORD", "")
THRESHOLD = float(os.environ.get("LEAPNODE_BALANCE_THRESHOLD", "100"))
ALERT_TO = os.environ.get("ALERT_EMAIL", "")


def request(path: str, token: str | None = None, payload: dict | None = None) -> dict:
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(API + path, data=data, method="POST" if data else "GET")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=30) as resp:
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


def main() -> int:
    if not EMAIL or not PASSWORD:
        print("缺少 LEAPNODE_EMAIL / LEAPNODE_PASSWORD")
        return 1

    login = request("/api/v1/auth/login", payload={"email": EMAIL, "password": PASSWORD})
    token = login.get("data", {}).get("access_token")
    if not token:
        print("LeapNode 登录失败:", login)
        return 1

    me = request("/api/v1/auth/me", token=token)
    balance = float(me.get("data", {}).get("balance", 0))
    print(f"LeapNode 余额: ¥{balance:.2f}（阈值 ¥{THRESHOLD:.2f}）")

    if balance >= THRESHOLD:
        print("余额充足，无需告警")
        return 0

    body = (
        f"LeapNode 余额不足\n\n"
        f"当前余额：¥{balance:.2f}\n"
        f"告警阈值：¥{THRESHOLD:.2f}\n\n"
        f"请登录 console.leapnode.ai/purchase 用支付宝充值。\n"
        f"充值后 DeepSeek/Claude 会自动恢复使用，无需改配置。\n"
    )
    send_mail(f"[Trust3] LeapNode 余额不足：¥{balance:.2f}", body)
    print("已发送低余额告警")
    return 2


if __name__ == "__main__":
    sys.exit(main())
