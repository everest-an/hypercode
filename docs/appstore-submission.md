# App Store 提审材料包（HyperCode iOS 1.0.1 build 8）

> 用途：在 **App Store Connect** 里逐项复制粘贴即可。ASC 在自动化浏览器里是空白页（Apple 拦截），所以这一步只能人工在浏览器完成。
> 对应 App ID：`ai.awareliquid.hypercode.ios`；已上传 build 8（含 Push）。

---

## 0. 先决检查

| 项 | 值 |
| --- | --- |
| Bundle ID | `ai.awareliquid.hypercode.ios` |
| 版本 | 1.0.1（build 8） |
| 出口合规 | `ITSAppUsesNonExemptEncryption = false`（无需上传加密文档） |
| 演示账号 | 工作区 `acme.cloud.awareliquid.ai` + 密钥见租户 env 的 `HYPERCODE_ACCESS_KEY` |

---

## 1. 应用信息

| 字段 | 内容 |
| --- | --- |
| 名称（≤30） | `HyperCode AI` |
| 副标题（≤30） | `Autonomous agent for code & work` |
| 主分类 | Developer Tools |
| 副分类 | Productivity |
| 年龄分级 | 4+ |

---

## 2. 关键词（≤100，英文逗号）

```
AI agent,AI coding,autonomous agent,remote workspace,code assistant,DeepSeek,dev tools,AI programmer
```

---

## 3. 描述

```
HyperCode puts a real computer behind your phone. Ask for an outcome and a cloud workspace does the
work: it reads your repo, runs commands, browses, writes files and reports back.

- Your own cloud workspace: one place for chats, tasks, files and terminals, reachable from phone or web.
- Works while you are away: long tasks keep running in the cloud; approvals come back as notifications.
- Review before it ships: every change shows a diff, and you can revert.
- Same workspace everywhere: sign in on iPhone and on the web and you are looking at the same work.

Sign in with the workspace address and access key your team was given.
```

---

## 4. 截图（必须 2 个尺寸，各 3–10 张）

| 设备尺寸 | 像素 | 建议画面 |
| --- | --- | --- |
| 6.9"（iPhone 16 Pro Max） | 1320 × 2868 | 登录页 / 会话页 / 任务与审批 / 文件与终端 |
| 6.5"（iPhone 11 Pro Max 等） | 1242 × 2688 | 同上，同构图可直接缩放 |

> 首页截图务必含**真实对话内容**，不要只有空状态；Apple 常以"看不出功能"为由按 4.2 打回。

---

## 5. App 隐私问卷（Data Collected）

| 数据类型 | 是否收集 | 是否关联身份 | 用途 |
| --- | --- | --- | --- |
| Contact Info → Email | 是 | 是 | 账号与登录 |
| User Content → Other（对话、任务、上传文件） | 是 | 是 | 提供核心功能 |
| Identifiers → Device ID（推送 token） | 是 | 是 | 通知 |
| Diagnostics → Crash / Performance | 否（未接入） | — | — |
| Tracking（跨 App 追踪） | **否** | — | — |

> 关键：**不要勾 Tracking**，否则要额外 ATT 弹窗与隐私清单。

---

## 6. 审核备注（**必填**，否则登录型 App 必拒）

```
This app is a client for a hosted workspace. It has no public sign-up inside the app.

Demo account:
  Workspace address: acme.cloud.awareliquid.ai
  Access key: <paste HYPERCODE_ACCESS_KEY from /srv/hypercode/tenants/acme.env>

After entering both on the first screen, the reviewer lands in a workspace where they can:
  1) open Chat and send "list the files in /workspace" (the agent runs it in a cloud Linux sandbox),
  2) open Files to see the same directory,
  3) open Approvals to review a pending action.

The workspace is a Linux container owned by this demo tenant; nothing is shared with other users.

Note on payments: this app does not sell anything. Subscriptions are sold on the web by our company
for the desktop product; the app only signs in to an existing workspace.
```

---

## 7. 两个被拒风险与对策

| 风险 | 对策 |
| --- | --- |
| **3.1.1** 数字商品必须走 IAP | App 内**不出现任何购买入口/价格/站外支付链接**（当前设计符合）。若后续加订阅按钮，必须接 IAP。 |
| **4.2** minimum functionality | 审核备注里给出演示账号 + 3 步操作路径；截图展示真实对话、文件、审批。 |

---

## 8. 提交前清单

- [ ] App 记录存在且 Bundle ID 一致
- [ ] 1.0.1 build 8 在 TestFlight 处理完成（Processing → Ready to Submit）
- [ ] 已选 build 8 作为本次提交版本
- [ ] 截图 6.9" + 6.5" 各 ≥3 张
- [ ] 隐私政策 URL、支持 URL
- [ ] App 隐私问卷按第 5 节填写
- [ ] 审核备注按第 6 节填写（含演示密钥）
- [ ] 年龄分级、分类
- [ ] 提交审核（Submit for Review）
