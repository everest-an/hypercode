#!/usr/bin/env python3
"""Onboarding email drip for HyperCode users.

Reads users from the sub2api admin API and sends the D0 / D2 / D5 onboarding emails over the
Aliyun DirectMail SMTP relay. Sent state lives in ops/email/state.json so a re-run never
duplicates a message. Run with --dry-run to see what would be sent without touching SMTP.

Environment:
  SUB2API_EMAIL / SUB2API_PASSWORD   admin credentials used to mint an API token
  SMTP_HOST / SMTP_PORT              default smtpdm.aliyun.com:465
  SMTP_USER / SMTP_PASSWORD          DirectMail sender account
  SMTP_FROM                          From header, default "HyperCode <no-reply@mail.trust3.pro>"
"""

import json
import os
import smtplib
import ssl
import sys
import urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path

API = "https://api.trust3.pro/api/v1"
STATE = Path(__file__).with_name("state.json")
ARGS = set(sys.argv[1:])
DRY = "--dry-run" in ARGS

SUBJECTS = {
    "d0": "HyperCode 已就绪：三步跑通第一个任务",
    "d2": "用 HyperCode 把「补测试」这件事交给 AI",
    "d5": "你的试用还剩 2 天（到期不自动扣费）",
}

BODIES = {
    "d0": """你好，

欢迎使用 HyperCode。三步开始：

1. 打开 HyperCode，选择一个项目目录
2. 在输入框里写下一个目标，例如「把测试补齐并跑绿」
3. 点发送，等它跑完，验收结果

不需要配置 API key：连接一次账号即可。工作区是本地运行的，代码不会离开你的电脑。

有问题直接回复这封邮件。

— AwareLiquid
""",
    "d2": """你好，

HyperCode 最适合做那些「需要连续跑几小时」的任务：

- 补测试：找到没覆盖的分支，写测试并跑到绿
- 迁移：把旧依赖/旧写法换成新版本，跑通测试
- 重构：拆分长函数、清理技术债

做法很简单：把验收标准写清楚（例如「测试全部通过、lint 无新增」），剩下的交给它。

— AwareLiquid
""",
    "d5": """你好，

你的 7 天试用还剩 2 天。到期后有三种选择，不会自动扣费：

1. 订阅：59 元/月（Pro 99 元/月含 180 元额度）
2. 自带 DeepSeek key：免费使用
3. 免费档：保留基础功能

如果试用帮到了你，订阅是最省心的方式；如果还在评估，也可以先用 BYOK。

— AwareLiquid
""",
}


def api(path, token=None, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(API + path, data=data, method="POST" if data else "GET")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def login():
    email = os.environ.get("SUB2API_EMAIL", "")
    password = os.environ.get("SUB2API_PASSWORD", "")
    if not email or not password:
        raise SystemExit("SUB2API_EMAIL / SUB2API_PASSWORD are required")
    return api("/auth/login", payload={"email": email, "password": password})["data"]["access_token"]


def users(token):
    out, page = [], 1
    while True:
        data = api(f"/admin/users?page={page}&page_size=100", token)["data"]
        out.extend(data["items"])
        if page >= data.get("pages", 1):
            return out
        page += 1


def stage_for(user):
    created = datetime.fromisoformat(user["created_at"])
    age = (datetime.now(timezone.utc) - created).days
    paid = float(user.get("total_recharged") or 0) > 0 or float(user.get("balance") or 0) > 0
    if paid:
        return None
    if age >= 5:
        return "d5"
    if age >= 2:
        return "d2"
    if age >= 0:
        return "d0"
    return None


def send(to, subject, body):
    host = os.environ.get("SMTP_HOST", "smtpdm.aliyun.com")
    port = int(os.environ.get("SMTP_PORT", "465"))
    user = os.environ.get("SMTP_USER", "")
    password = os.environ.get("SMTP_PASSWORD", "")
    sender = os.environ.get("SMTP_FROM", "HyperCode <no-reply@mail.trust3.pro>")
    if DRY or not user or not password:
        return False
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body + "\n\n如果不想再收到产品邮件，回复「退订」即可。")
    ctx = ssl.create_default_context()
    with smtplib.SMTP_SSL(host, port, context=ctx, timeout=30) as s:
        s.login(user, password)
        s.send_message(msg)
    return True


def main():
    state = json.loads(STATE.read_text("utf8")) if STATE.exists() else {}
    token = login()
    sent = 0
    for user in users(token):
        email = (user.get("email") or "").strip().lower()
        if not email or "@" not in email or email.endswith("@hypercode.test"):
            continue
        stage = stage_for(user)
        if not stage:
            continue
        done = set(state.get(email, []))
        if stage in done:
            continue
        ok = send(email, SUBJECTS[stage], BODIES[stage])
        print(f"{email}: {stage} -> {'sent' if ok else 'dry-run'}")
        if ok:
            done.add(stage)
            state[email] = sorted(done)
            sent += 1
    if sent:
        STATE.write_text(json.dumps(state, indent=2, ensure_ascii=False), "utf8")
    print(f"done, sent={sent}")


if __name__ == "__main__":
    main()
