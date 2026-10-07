---
name: hc-office
description: 办公软件连接器接入向导。把飞书、钉钉、企业微信、Google Workspace、Microsoft 365/Outlook、Slack、Notion、Atlassian、Linear 等主流国内外办公产品接到 HyperCode 上，并引导用户补齐所需凭据；本地 Obsidian 知识库零配置直连。Use when the user mentions 接飞书、接钉钉、接企业微信、接邮箱、接日历、接 Outlook、接 Google、接 Slack、接 Notion、接 Jira、接 Confluence、连办公软件、办公连接器、office connector、MCP 接入、connect my email/calendar, or asks to use work tools inside HyperCode.
version: 1.0.0
---

# hc-office:办公连接器接入向导

**目的**:把用户日常在用的办公产品接进 HyperCode。产品只下发一个二进制、客户机上没有 Node，
因此本地连接器一律走 `hypercode x` 自举（见 `references/connectors.md` 开头说明）。

## 一、可接入的产品

完整清单、每个产品的端点／包名、凭据获取路径与已知坑位，都在
**`references/connectors.md`**。**只从那里取配置，不要凭印象填端点或包名。**

概览：

| 分组 | 产品 | 方式 | 用户要准备什么 |
|---|---|---|---|
| 国际 | Google Workspace（Gmail/日历/Drive/文档/表格） | remote | GCP OAuth 客户端 |
| 国际 | Atlassian（Jira/Confluence） | remote | OAuth 授权 |
| 国际 | Notion | remote | OAuth 授权 |
| 国际 | Slack | remote | OAuth 授权（厂商预注册 client） |
| 国际 | Linear | remote | OAuth 授权 |
| 国际 | Microsoft 365 / Outlook / Teams | local（社区实现） | Azure 应用注册 |
| 国内 | 飞书 / Lark | local（官方） | 自建应用 App ID + Secret |
| 国内 | 钉钉 | local（官方） | 应用 Client ID + Secret |
| 国内 | 企业微信 | local（第三方） | 群机器人 Key 或企业应用凭据 |
| 本地 | Obsidian | 无需 MCP | 无（直接读目录） |

`connectors.md` 里没有的产品（语雀、腾讯文档、WPS、石墨等）**没有可靠实现**，
如实告诉用户"目前查不到可用的官方实现"，不要编一个出来。

## 二、接入流程

### 第 1 步：先看现状，不要直接列清单

读 `~/.config/hypercode/hypercode.json` 找 `mcp` 段，看已经接了哪些。
已经有对应连接器时先说出来，不要重复接入。

### 第 2 步：问用途，再推荐

不要一口气报十个产品。先问用户**要用它做什么**（收发邮件／看日程／读文档／发消息），
再据此推荐**最少**的几个。零凭据的（Obsidian 本地目录）可以直接提。

### 第 3 步：讲清"需要你准备什么"

对选中的每个连接器，明确告诉用户：

- 去**哪个后台**、**哪个菜单**拿凭据（照抄 `connectors.md` 的「凭据获取」）
- 是 OAuth 授权（浏览器点一下）还是粘贴 key
- 有没有前置条件（如 Google 要启用 MCP 服务、飞书用户身份要配重定向 URL）

### 第 4 步：写入配置

**严格按 `references/config-write.md` 执行**：只做字段级增量修改，
禁止整文件重新序列化（会抹掉用户注释，且配置文件里有 API key）。

### 第 5 步：复验并交付

- 重新解析整个文件，确认合法
- 确认 `provider` / `model` 等段落与改动前逐字相同
- 告诉用户**必须重启 HyperCode** 才会加载
- 首次连接若失败，把引擎报的原始错误念给用户，不要自己编原因

## 三、硬规则

1. **不编造端点、包名或能力**。只写 `connectors.md` 里核实过的内容；没有的就直说没有。
2. **只改 `mcp` 段**。`provider` / `model` / `plugin` 一律不动。
3. **不做整文件覆盖**，操作前先备份（见 `config-write.md`）。
4. **不回显密钥**。用户贴的 key 只写进配置文件；写完后提醒该文件是明文存放。
5. **凭据属于一个人**。只写进该用户的全局配置目录，**绝不**写进会被提交或共享的位置
   （项目级配置、dotfiles 仓库、共享盘、知识库、聊天记录）。写入前确认该目录不在 git 仓库内；
   工作台部署下要明说"能访问该实例的人都能使用这些连接器"。详见 `references/config-write.md`。
6. **未接入 ≠ 可用**。没接的产品要明说未接入，绝不假装能读邮件、日程或消息。
7. **不夸大**：本地连接器依赖二进制内置运行时；若某个包在该运行时下起不来，
   如实报告失败与原始错误，并给出可选项（如改用远程实现或由用户自备 Node），不要硬说成功。
