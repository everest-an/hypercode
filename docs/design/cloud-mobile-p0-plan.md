# HyperCode 云端 P0 落地计划（v2 · 统一到 workbench · 每客户一套栈）

> 状态：**待开工**
> 决策：**A —— 并入 `workbench`，只保留一条产品线**；`packages/`(opencode Electron IDE) 降为"本地/高级桌面形态"。
> 目标：**去掉"配对遥控"，改成"登录即得云 workspace"**；手机(iOS App Store)与电脑(web)是**同一套 UI、同一个 workspace**。

---

## 0. 版本记录

| 版本 | 变更 |
|---|---|
| v1 / v1.1 | 基于 `packages/` 的 opencode CLI 自建沙箱 + PWA（**已废弃**） |
| **v2** | 统一到 **`workbench/`**（OpenMuse 派生，Expo：iOS/Android/web 一套）；云 = 每客户一套栈；复用 `apps/computer`/`apps/worker`；**去配对** |

---

## 1. workbench 现状（能直接用，别重写）

| 能力 | 现状 |
|---|---|
| UI | `apps/mobile` = **Expo RN → iOS / Android / web 同一套代码**（"一个版本"已具备） |
| 出 iOS 包 | `.github/workflows/build-mobile.yml`：macOS runner → .ipa → TestFlight / App Store Connect（bundle `ai.awareliquid.hypercode.ios`） |
| API | `apps/server`：Hono + CopilotKit runtime、auth、pairing、workspace、computer、files、db |
| 任务 | `apps/worker`：Playwright 浏览器服务 + 持久 profile |
| 执行环境 | `apps/computer`：**非 root Linux 容器**，`/workspace`，终端/文件（`COMPUTER_ENABLED=true`、`COMPUTER_IMAGE`） |
| 存储 | PGlite / PostgreSQL |
| **缺口** | `apps/server` 是**单 owner**（无 tenant 概念）；手机靠 `PAIRING` 配对到本机电脑（= 遥控） |

---

## 2. 目标架构（P0：每客户一套栈）

```
         手机(iOS App) / 电脑(Web)   ← 同一套 Expo UI
                    │ HTTPS
        ┌───────────┴────────────┐
        │  共享 Caddy（宿主机）    │  按租户域名/子域路由
        └───────────┬────────────┘
     ┌──────────────┼──────────────┐
     ▼              ▼              ▼
  hc-<tenantA>   hc-<tenantB>   hc-<tenantC>     ← 每客户一套 docker compose
  ├ server        ├ server        ├ server
  ├ worker(Playwright)            ├ worker
  ├ computer(Linux, /workspace)   ├ computer
  └ postgres                      └ postgres
     │
     └ 各自独立网络 / 独立卷 / 独立配额
```

**为什么每客户一套栈**：
- `apps/server` 目前无多租户模型，改造风险大；
- 与 Awareness 现有 `docker-compose.tenant.yml`（`name: awareness-box`）**同一套经验**；
- 隔离最彻底（网络/DB/卷/进程全独立），符合"面向多个客户 + 要上线"。
- **P1 若要省钱**：再把 server 改成多租户（加 `tenant_id`），computer 仍每客户一个 → 共享 API。

---

## 3. 隔离（复用已有脚本，套到 computer/worker）

| 层面 | 措施 | 复用 |
|---|---|---|
| 租户间 | 独立 compose 项目 `hc-<tenant>`、独立网络、独立 volume、独立 DB | 新增 |
| 容器权限 | 非 root、`--read-only`(能只读的)、cap-drop、no-new-privileges、pids/mem/cpu 配额 | `deploy/cloud-sandbox/*` |
| 出站 | `harden-egress.sh` 封私网段/元数据；只放行模型 API 等 | ✅ 直接复用 |
| 卷 | 只挂 `/<root>/<tenant>/{workspace,data}`，不挂宿主业务目录 | ✅ |
| 资源争抢 | 给 awareness-box 预留 CPU/内存；每租户 mem/cpu 上限 | ✅ |
| 审计 | 每租户独立日志 | P1 |

---

## 4. 客户端（一套，替换旧 mobile）

- 直接改 **`workbench/apps/mobile`**（Expo）：iOS App Store + web(桌面) 同一套 UI。
- **删除配对流程**（`PAIRING`）：改为**云登录** → 直接得到一个云 workspace。
- 桌面端 = 用同一个 web 构建（`expo export --platform web`）包一层（Electron/Tauri，二选一，P0 可先用浏览器直开）。

---

## 5. 认证与开通（去配对）

| 步骤 | 做法 |
|---|---|
| 登录 | P0：每租户 owner 账号（复用 `auth.ts`）；P1：接 trust3 微信/JWT SSO |
| 开通 | 脚本 `provision-tenant.sh <tenantId>`：建 compose 栈 + 卷 + Caddy 路由 + 生成访问地址 |
| 手机 | App 里输入/扫码一次租户地址 → 存 SecureStore → 之后免配 |
| 数据 | 同一 owner，手机与 web 打开**同一 workspace**（会话/任务/审批/文件共享） |

---

## 6. P0 任务

| ID | 任务 | 验收 | 估 |
|---|---|---|---|
| **T1** | 容器化 `apps/server`（Dockerfile）+ 每租户 `docker-compose.tenant.yml`（server/worker/computer/postgres） | `docker compose -p hc-demo up` 起得来 | 2d |
| **T2** | 隔离加固：套用 `deploy/cloud-sandbox`（cap-drop/配额/只读/网络）+ `harden-egress.sh` | 容器跑起来且私网被封 | 1d |
| **T3** | `provision-tenant.sh`（建栈+卷+路由）与 `destroy-tenant.sh` | 一条命令开通/回收 | 1d |
| **T4** | 共享 Caddy：按 `*.cloud.awareliquid.ai` 路由到各租户 server | 两个租户各自可访问 | 1d |
| **T5** | 客户端去配对：`apps/mobile` 改云登录 + 存地址 | 手机登录即用，无需电脑 | 2d |
| **T6** | 桌面 web：`expo export --platform web` 产出 + 打包 | 浏览器打开与手机同一 workspace | 1d |
| **T7** | 计量/空闲停机（停栈保卷） | 空闲自动停，唤醒可用 | 1d |
| **T8** | 验收 Demo | 见 §7 | 1d |

合计 ~**10 人日**（比 v1.1 少，因为 UI 和 computer/worker 都已存在）。

---

## 7. 验收（P0 Done）

1. 手机装 iOS App（TestFlight）→ 云登录 → 得到一个 workspace（**不需要电脑**）
2. 发任务 → agent 在云端跑（浏览器/终端/文件可见）→ 手机审批
3. 电脑浏览器打开同一地址 → **同一 workspace**（会话/任务/文件一致）
4. 租户 A 看不到租户 B 的任何东西（网络/DB/卷隔离）
5. 空闲自动停机，次日唤醒数据还在

---

## 8. 前置条件

| # | 事项 |
|---|---|
| 1 | **一台专用云主机**（≥8vCPU/32G，最好裸金属）；与 awareness-box 隔离 |
| 2 | **域名 + 泛解析**（`*.cloud.awareliquid.ai`）|
| 3 | Apple 签名材料（已有：`IOS_CERT_*`/`IOS_PROFILE_BASE64`/`APPLE_TEAM_ID` secrets）|
| 4 | 镜像仓库（TCR/ACR/Docker Hub）|

---

## 9. 上线前 Gap（P1）

1. server 改多租户（`tenant_id`）以省资源；或按量扩节点
2. computer/worker 升级 microVM（Firecracker/Kata）
3. 接 trust3 计费（容器秒 + token）
4. 审计/日志留存、限流、滥用防护
5. 合规：生成式 AI 备案、数据出境

---

## 10. 与 `packages/` 的关系

- `packages/`（opencode Electron IDE）**保留为本地/高级形态**，不再是云端主线。
- 未来若要把"编码能力"并入 workbench：把 opencode 作为一个 tool/agent 接进 `apps/server`（P2），而不是维护两套 UI。
