# 办公连接器目录

> 本目录只收录**经一手来源核实**的产品。查不到可靠实现的，宁可缺也不写——编造的端点和包名比没有更糟。
> 每个 `json` 代码块都是可直接粘贴进 `~/.config/hypercode/hypercode.json` 的 `mcp` 段，并且由
> `packages/opencode/test/mcp/office-connector-presets.test.ts` 用真实配置 schema 校验。

## 三种接入方式

| 方式 | 说明 | 客户机需要什么 |
|---|---|---|
| `remote` | 厂商自己托管的远程 MCP，写在 `url` | 只要能连网 |
| `local` | 厂商只发了 npm 包，写在 `command` | **不需要装 Node**：用 `hypercode x` 借二进制内置的运行时 |
| 本地文件 | Obsidian 这类本地知识库 | 不需要凭据，甚至不需要 MCP |

### 关于 `local` 为什么写 `hypercode x` 而不是 `npx`

产品只下发 `hypercode.exe` 一个二进制，客户机上没有 Node，`npx` 不存在。
`hypercode x <包>` 会被引擎以 `BUN_BE_BUN=1` 启动，让二进制自己充当运行时（等价于 `bun x`），
因此无需任何额外安装。

⚠️ **`bun x` 不支持 `-y`**（其标志只有 `--bun`、`-p/--package`、`--no-install`、`--verbose`、`--silent`）。
照抄 npx 的写法加上 `-y` 会导致服务器直接起不来。

---

## 一、国际产品

### Google Workspace（Gmail / Calendar / Drive / Docs / Sheets）

| 项 | 值 |
|---|---|
| 方式 | `remote`，每个产品一个独立服务端 |
| 认证 | OAuth：需要一个 **Web application** 类型的 Google Cloud OAuth 客户端 |
| 前置 | 在 GCP 项目启用对应的 MCP 服务（`gmailmcp.googleapis.com`、`calendarmcp.googleapis.com`、`drivemcp.googleapis.com`、`docsmcp.googleapis.com`、`sheetsmcp.googleapis.com` 等）以及相应的 Workspace API |
| 注意 | 企业账号可能还需要管理员在 Admin Console 里信任该 OAuth 应用 |

```json
{
  "google-gmail": {
    "type": "remote",
    "url": "https://gmailmcp.googleapis.com/mcp/v1",
    "oauth": {
      "clientId": "<GOOGLE_OAUTH_CLIENT_ID>",
      "clientSecret": "<GOOGLE_OAUTH_CLIENT_SECRET>",
      "scope": "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose"
    },
    "enabled": true
  },
  "google-calendar": {
    "type": "remote",
    "url": "https://calendarmcp.googleapis.com/mcp/v1",
    "oauth": {
      "clientId": "<GOOGLE_OAUTH_CLIENT_ID>",
      "clientSecret": "<GOOGLE_OAUTH_CLIENT_SECRET>",
      "scope": "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events"
    },
    "enabled": true
  },
  "google-drive": {
    "type": "remote",
    "url": "https://drivemcp.googleapis.com/mcp/v1",
    "oauth": {
      "clientId": "<GOOGLE_OAUTH_CLIENT_ID>",
      "clientSecret": "<GOOGLE_OAUTH_CLIENT_SECRET>",
      "scope": "https://www.googleapis.com/auth/drive.readonly"
    },
    "enabled": true
  }
}
```

**凭据获取**：Google Cloud Console → 创建 OAuth 客户端（Web application）→ 记下 Client ID / Secret。
**来源**：`developers.google.com/workspace/guides/configure-mcp-servers`。

### Atlassian（Jira / Confluence）

| 项 | 值 |
|---|---|
| 方式 | `remote`（厂商托管） |
| 端点 | `https://mcp.atlassian.com/v2/mcp` |
| 认证 | OAuth 2.1，或 API token |
| 注意 | **`/v1/sse` 自 2026-06-30 起停止支持**，旧配置必须换成 `/v2/mcp` |

```json
{
  "atlassian": {
    "type": "remote",
    "url": "https://mcp.atlassian.com/v2/mcp",
    "oauth": { "scope": "" },
    "enabled": true
  }
}
```

**来源**：`github.com/atlassian/atlassian-mcp-server`（官方，Apache-2.0）、Atlassian 官方博客。

### Notion

| 项 | 值 |
|---|---|
| 方式 | `remote`（官方托管，已在 Official MCP Registry 登记为 `com.notion/mcp`） |
| 端点 | `https://mcp.notion.com/mcp` |
| 认证 | OAuth，零安装 |
| 注意 | 本地的 `@notionhq/notion-mcp-server` 官方已声明不再积极维护，不要用 |

```json
{
  "notion": {
    "type": "remote",
    "url": "https://mcp.notion.com/mcp",
    "oauth": { "scope": "" },
    "enabled": true
  }
}
```

### Slack

| 项 | 值 |
|---|---|
| 方式 | `remote`（官方） |
| 端点 | `https://mcp.slack.com/mcp` |
| 认证 | OAuth，**必须带厂商预注册的 client** |
| 注意 | 不给 client id 直接连会登录失败。预注册值：`clientId = 1601185624273.8899143856786`，`callbackPort = 3118` |

```json
{
  "slack": {
    "type": "remote",
    "url": "https://mcp.slack.com/mcp",
    "oauth": {
      "clientId": "1601185624273.8899143856786",
      "callbackPort": 3118,
      "scope": ""
    },
    "enabled": true
  }
}
```

**来源**：Slack 官方帮助中心（Guide to Model Context Protocol in Slack）。

### Linear

| 项 | 值 |
|---|---|
| 方式 | `remote`（官方，Official MCP Registry `app.linear/linear`） |
| 端点 | `https://mcp.linear.app/mcp` |
| 认证 | OAuth |

```json
{
  "linear": {
    "type": "remote",
    "url": "https://mcp.linear.app/mcp",
    "oauth": { "scope": "" },
    "enabled": true
  }
}
```

### Microsoft 365 / Outlook / Teams

| 项 | 值 |
|---|---|
| 方式 | `local`（**社区实现**，微软没有官方 MCP server） |
| 包 | `microsoft365-mcp-server`（委托式，需用户在浏览器登录） |
| 认证 | Azure / Entra ID 应用注册 + 委托权限（`Mail.Read`、`Calendars.ReadWrite`、`Chat.ReadWrite`、`Files.ReadWrite` 等），多数情况需管理员同意 |
| 注意 | 社区包，请自行评估；企业租户通常需要管理员授权 |

```json
{
  "microsoft365": {
    "type": "local",
    "command": ["hypercode", "x", "microsoft365-mcp-server@1.2.12"],
    "environment": {
      "MS365_AUTH_MODE": "interactive",
      "MS365_CLIENT_ID": "<AZURE_APP_CLIENT_ID>",
      "MS365_TENANT_ID": "common"
    },
    "enabled": true
  }
}
```

---

## 二、国内产品

### 飞书 / Lark（官方）

| 项 | 值 |
|---|---|
| 方式 | `local`（飞书官方 npm 包） |
| 包 | `@larksuiteoapi/lark-mcp` |
| 认证 | 自建应用的 App ID + App Secret |
| 用户身份 | 追加 `--oauth --token-mode user_access_token`；并需在开发者后台把重定向 URL 设为 `http://localhost:3000/callback` |
| 国际版 | 追加 `--domain https://open.larksuite.com` |
| 能力 | 默认启用常用 OpenAPI：消息、群组、云文档、多维表格、Wiki 等 |

```json
{
  "feishu": {
    "type": "local",
    "command": ["hypercode", "x", "@larksuiteoapi/lark-mcp@0.5.1", "mcp", "-a", "<FEISHU_APP_ID>", "-s", "<FEISHU_APP_SECRET>"],
    "enabled": true
  }
}
```

**带用户身份（读写个人文档/以本人发消息）**：

```json
{
  "feishu": {
    "type": "local",
    "command": [
      "hypercode",
      "x",
      "@larksuiteoapi/lark-mcp@0.5.1",
      "mcp",
      "-a",
      "<FEISHU_APP_ID>",
      "-s",
      "<FEISHU_APP_SECRET>",
      "--oauth",
      "--token-mode",
      "user_access_token"
    ],
    "enabled": true
  }
}
```

**凭据获取**：飞书开放平台 → 开发者后台 → 创建自建应用 → 「凭证与基础信息」取 App ID / App Secret。
**来源**：`open.feishu.cn`（OpenAPI MCP 文档）、`github.com/larksuite/lark-openapi-mcp`。

### 钉钉 / DingTalk（官方）

| 项 | 值 |
|---|---|
| 方式 | `local`（钉钉官方 npm 包，作者 `dingtalk`，MIT） |
| 包 | `dingtalk-mcp` |
| 认证 | 钉钉开发者应用的 Client ID + Client Secret |
| 能力开关 | `ACTIVE_PROFILES` 逗号分隔；`dingtalk-contacts` / `dingtalk-calendar` / `dingtalk-tasks` / `dingtalk-report` 等，`ALL` 为全开 |
| 注意 | 首次使用需先在钉钉后台为应用添加对应权限点 |

```json
{
  "dingtalk": {
    "type": "local",
    "command": ["hypercode", "x", "dingtalk-mcp@1.1.21"],
    "environment": {
      "DINGTALK_Client_ID": "<DINGTALK_CLIENT_ID>",
      "DINGTALK_Client_Secret": "<DINGTALK_CLIENT_SECRET>",
      "ACTIVE_PROFILES": "dingtalk-contacts,dingtalk-calendar,dingtalk-tasks"
    },
    "enabled": true
  }
}
```

**凭据获取**：`open.dingtalk.com` → 成为开发者 → 创建应用 → 详情页「凭证与基础信息」。
**来源**：`github.com/open-dingtalk/dingtalk-mcp`、钉钉开放平台文档「安装并使用钉钉MCP」。

### 企业微信 / WeCom

| 项 | 值 |
|---|---|
| 方式 | `local`（**第三方实现，非腾讯官方**，请自行评估） |
| 包 | `@china-mcp/wecom-mcp` |
| 认证 | 群机器人 Webhook Key（最简），或企业应用 CorpID + Secret + AgentId（功能完整） |

```json
{
  "wecom": {
    "type": "local",
    "command": ["hypercode", "x", "@china-mcp/wecom-mcp@0.1.0"],
    "environment": { "WECOM_WEBHOOK_KEY": "<WECOM_WEBHOOK_KEY>" },
    "enabled": true
  }
}
```

**来源**：`github.com/huanglei288766/china-mcp-servers`（第三方）。

---

## 三、本地知识库：Obsidian

Obsidian 是本地 markdown 库，**不需要凭据**。有两条路，按需二选一。

### 方式 A：直接用 HyperCode 自带的文件工具（零配置，推荐）

vault 就是普通目录。让 agent 直接读写该目录即可，无需任何 MCP。
`hc-omega` 技能已按这个前提设计（扫描 `~/HyperCodeVault/` 生成知识图谱）。

### 方式 B：接 Obsidian 插件「Vault as MCP」

插件在 Obsidian 内起一个本地 HTTP MCP（默认端口 8765，可设 bearer token），
好处是按 Obsidian API 和路径 ACL 授权，而不是把整个 vault 暴露给文件系统。

```json
{
  "obsidian-vault": {
    "type": "remote",
    "url": "http://localhost:8765/mcp",
    "headers": { "Authorization": "Bearer <VAULT_MCP_TOKEN>" },
    "enabled": true
  }
}
```

**前置**：Obsidian 桌面端 → 设置 → 第三方插件 → 安装并启用「Vault as MCP」→ 记下端口与 token。
**注意**：仅桌面端可用；不开认证时把 `headers` 整行删掉。

---

## 四、未收录的产品（查不到可靠实现）

以下产品**没有**找到可核实的一手 MCP 实现，因此不提供预设。需要时请先确认上游是否存在，不要凭印象填写端点：

语雀、腾讯文档、WPS / 金山文档、石墨文档、Microsoft Teams（独立）、Zoom、Figma。

若后续出现官方实现，按同样格式补入本文件，并保证 `office-connector-presets.test.ts` 通过。

---

## 五、通用坑位

1. **不要写 `npx`**：客户机没有 Node。本地连接器一律用 `hypercode x <包>`。
2. **不要在 `hypercode x` 后面加 `-y`**：`bun x` 不认这个标志。
3. **OAuth 客户端类型**：Google 必须是 Web application；Microsoft 必须是 Web 平台并配置重定向 URI。
4. **回调端口**：Slack 用 3118；飞书用 3000；MCP 客户端默认回调为 `http://127.0.0.1:19876/mcp/oauth/callback`。
5. **一次性只改一个产品的 `mcp` 键**，不要重写整个配置文件（见 `config-write.md`）。
6. **未接入的产品要直说未接入**，不要假装可用，也不要描述做不到的操作。
7. **本地包一律写固定版本号**（如 `dingtalk-mcp@1.1.21`），不要写 `@latest`。
   出货默认值跟着上游浮动，等于让上游一次破坏性变更静默改掉所有客户的行为；
   升级应当是显式动作。改版本时同步更新本节下方记录的版本。
8. **远程端点的探活判据是"返回 401/405"，不是"返回 200"**。出现 DNS 失败或 404
   说明端点搬家了（Atlassian 的 `/v1/sse` 就是这样退役的），必须改 URL。

## 六、预设版本快照

本地连接器固定版本对照（升级时逐个确认）：

| 连接器 | 包 | 固定版本 |
|---|---|---|
| 飞书 / Lark | `@larksuiteoapi/lark-mcp` | `0.5.1` |
| 钉钉 | `dingtalk-mcp` | `1.1.21` |
| Microsoft 365 | `microsoft365-mcp-server` | `1.2.12` |
| 企业微信 | `@china-mcp/wecom-mcp` | `0.1.0` |

## 七、活性巡检

发布前或定期跑一次（开发机执行，不随产品分发）：

```sh
bun bake/verify/connectors-liveness.mjs
```

它直接解析本文件，因此新增连接器后无需改脚本。判定标准见第五节的第 8 条；
指向用户本机的端点（如 Obsidian）自动跳过，不参与判定，避免巡检永远报红而被忽略。

该脚本出口码在存在"端点搬家 / 包不存在 / 不可达 / 降级"时为非 0，可直接挂到任意定时器上。
