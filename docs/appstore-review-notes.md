# App Review 备注包（Guideline 2.1 Information Needed 的完整答复）

> 触发原因：两条被拒都指向 **2.1 App Completeness / Information Needed** —— 不是代码 bug，是**审核备注缺材料**。
> 用法：把对应段落整段粘到 ASC → App 审核信息 → **备注**，按提示补上屏幕录制与截图后重新提交。

---

## A. HyperCode AI（`ai.awareliquid.hypercode.ios`，1.0.1 build 8）

### A1. 屏幕录制（必须真机，最新系统）

必须从**启动 App** 开始，依次展示：

1. 启动 → 登录页
2. 输入工作区地址 + 访问密钥 → 进入 workspace
3. Chat 里发一句「list the files in /workspace」→ 展示 agent 执行与流式输出
4. 打开 Files → 看到同一目录
5. 打开 Approvals → 展示一次审批
6. 回到登录页前的 **断开连接（Disconnect）** 动作

> 时长 30–60 秒即可，不要剪辑掉关键步骤，不要用模拟器。

### A2. 用途与目标用户

```
HyperCode AI is a client for a hosted AI workspace. The target user is a developer or operator who
wants a background agent to run long tasks on a real Linux workspace and report back, without
keeping a laptop open. The problem it solves: agent work currently stops when the machine sleeps;
here the workspace lives in the cloud and the phone is only a reviewer/approver.
```

### A3. 设置与访问方式（含演示凭据）

```
1. Launch the app. The first screen asks for a workspace address and an access key.
2. Enter:
     Workspace address: acme.cloud.awareliquid.ai
     Access key:         d9c2088c39854505536b7bebc01ae4417a1c9dee38b12737
3. Tap "Open workspace". You land in Chat.
4. Try: "list the files in /workspace" — the agent runs it in the tenant's cloud Linux container.
5. Open Files to see the same directory; open Approvals to review a pending action.
```

> 这个工作区是演示租户，只有该租户的容器，与其他用户隔离。

### A4. 使用的外部服务 / 平台

| 类别 | 服务 | 用途 |
| --- | --- | --- |
| AI 推理 | DeepSeek 官方 API（`api.deepseek.com`）、智谱开放平台（`open.bigmodel.cn`） | 生成与工具调用 |
| 推送 | Apple Push Notification service（APNs） | 任务完成/待审批通知 |
| 浏览器自动化 | 自托管 Playwright worker | agent 浏览网页 |
| 计算 | 自托管 Linux 容器（每租户一个） | 执行命令与文件操作 |
| 账号 | 自建账号体系（工作区地址 + 访问密钥），**不使用第三方登录** |
| 支付 | **无**（App 内不销售任何数字商品） |

### A5. 地区差异

```
The app functions identically in all regions where it is available. Mainland China distribution
additionally requires the AIGC service declaration and security assessment filings, which we are
submitting separately under App Compliance.
```

### A6. 受监管行业 / 第三方受保护材料

```
Not applicable. The app does not operate in a regulated industry and does not include third-party
protected material. The agent runs only on the tenant's own workspace and the tenant's own accounts.
```

### A7. 常见问题自查（Apple 的 Prevent Common Issues）

- **2.1 崩溃**：已在真机（iPhone，最新 iOS）跑通上面 A1 全流程再提交。
- **2.1 访问**：演示凭据见 A3，长期有效。
- **2.3.3 截图**：截图必须展示 **App 实际使用**（会话、文件、审批），不能只有登录页。
- **3.1.1**：App 内**没有**任何购买入口、价格或站外支付链接。
- **账号删除**：本 App 没有注册流程（邀请密钥开通），因此在「Disconnect」处断开并清除本地会话；如需删除云端工作区，由管理员在服务端执行。

---

## B. SmartSync ERP（`com.planetstore.smartsync`，iOS 1.0 build 2）

Apple 要的是同样 6 项，只是内容换成 SmartSync 自己的。**下面是要填的空表**（我不知道该项目细节，需要产品同事补）：

### B1. 屏幕录制（真机）

必须从启动开始，包含：登录 → 主功能页 →（若有）UGC 的举报/屏蔽 →（若收费）付费内容访问。

### B2. 用途与目标用户

```
<一句话：SmartSync ERP 解决什么问题、给谁用>
```

### B3. 设置与访问方式

```
Demo account:
  URL / 入口: <>
  Username:   <>
  Password:   <>
步骤：<>（3–5 步，能走到核心功能）
```

### B4. 外部服务 / 平台

| 类别 | 服务 | 用途 |
| --- | --- | --- |
| 后端 | <> | API |
| 登录 | <> | 认证 |
| AI（如用到） | <> | 生成/抽取 |
| 支付（如有） | <> | 订阅 |
| 推送 | <> | 通知 |

### B5. 地区差异

```
<>（若一致，写：Identical in all regions.）
```

### B6. 受监管 / 第三方材料

```
<>（ERP 若涉及财务/税务数据，需说明数据处理授权；若不涉及，写 Not applicable.）
```

---

## C. 提交前检查（两个 App 通用）

- [ ] 备注字段粘贴了 A1–A6 / B1–B6
- [ ] 屏幕录制已上传为附件（`App 审核信息 → 附件`）
- [ ] 截图展示真实使用界面（非登录页/启动图）
- [ ] 演示凭据可用（提交前自己先登一次）
- [ ] 无购买入口（3.1.1）
- [ ] 重新提交（Resubmit for Review）
