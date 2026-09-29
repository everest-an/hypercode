# hc-agui — hypercode(OpenCode fork) → OpenMuse 的最小接入件

一个进程：把 `hypercode run --format json` 的 NDJSON 输出翻译成 AG-UI 事件流，
让 OpenMuse 用**它自己的配置项**把这个流当对话大脑。

**边界：`openmuse/` 与 `hypercode/` 的源码一行未改。**
（`git -C openmuse status --porcelain` 空；`hypercode` 只有 `bun.lock` 被 `bun install` 改写。）

## 接进 OpenMuse（只动 .env，不动代码）

OpenMuse 原生支持外部 AG-UI agent：`apps/server/src/config.ts:88-90` 允许
`AGENT_BACKEND=sample|model|agui`，`agent.ts:41-46` 在 agui 分支注册
`new HttpAgent({ url: AGENT_URL, headers: { Authorization: Bearer AGENT_TOKEN } })`。

```dotenv
# openmuse/.env
AGENT_BACKEND=agui
AGENT_URL=http://127.0.0.1:8791/run
AGENT_TOKEN=<随便一把长随机串>
CPK_INTELLIGENCE_API_KEY=<必需：OpenMuse 在每种模式下都硬要求这把 key>
```

```bash
# 起 shim（在 hypercode 依赖装好后）
cd /Users/aricredemption/Projects/hc-agui
PORT=8791 \
AGENT_TOKEN=<同上> \
HC_ENGINE_CMD="bun --conditions=browser /Users/aricredemption/Projects/hypercode/packages/opencode/src/index.ts run" \
HC_DIR=/Users/aricredemption/Projects/<要让它干活的项目> \
bun shim.ts
```

## shim 的环境变量

| 变量 | 缺省 | 语义 |
|---|---|---|
| `PORT` | 8791 | 监听 127.0.0.1（不外露） |
| `HC_ENGINE_CMD` | 无（不设即报错） | 引擎命令，按空格切词；prompt 永远作为**单个 argv**追加，绝不拼进 shell 字符串 |
| `HC_DIR` | cwd | 引擎的工作目录 |
| `AGENT_TOKEN` | 空 = 不校验 | 设了就必须 `Authorization: Bearer` 完全相等，否则 401 |
| `HC_AUTO` | 不设 | `=1` 才给引擎加 `--auto`（自动批准权限）。**缺省不自动批**，与"发送由人决定"同侧 |

会话连续性：`threadId → 引擎 sessionID` 落 `.sessions.json`，同一 thread 的第二轮带 `--session`。

## 事件映射（按 `@ag-ui/core@1.0.0` 的 schema 逐枚校验后再发出）

| 引擎 NDJSON | AG-UI |
|---|---|
| 收到请求 | `RUN_STARTED{threadId,runId}` |
| `text` part | `TEXT_MESSAGE_START` → `TEXT_MESSAGE_CONTENT{delta}` → `TEXT_MESSAGE_END` |
| `tool_use` part（首次出现） | `TOOL_CALL_START` + `TOOL_CALL_ARGS{delta=JSON(input)}` + `TOOL_CALL_END` |
| `tool_use` completed/error | `TOOL_CALL_RESULT{messageId=msg_tool_*, content}` |
| `error` / 非零退出 / 零事件 / stderr | `RUN_ERROR{message}`，**绝不发 RUN_FINISHED** |
| 正常收尾 | `RUN_FINISHED{threadId,runId}` |

`step_start`/`step_finish`/`reasoning` **故意不发**（`STEP_*` 的字段与语义我还没实测，宁缺毋滥）。
多模态 part（图片/文档）目前丢弃——`contentToText` 对纯字符串 content 会抛，已改用自己的 `textOf`。

## 验收

```bash
bun verify.ts        # 13 项，含负控；退出码即结论
```

已验（真盘）：

- 1a–1d 事件全部通过 `EventSchema.safeParse`；正文完整透传；工具三连 + 结果齐
- 2a 缺 token → 401 且零事件；2b 带 token → 跑完
- 3 畸形 `RunAgentInput`（缺 messages）→ 400
- 4/4b 引擎非零退出 → `RUN_ERROR` 且**没有** `RUN_FINISHED`，真实错误文案上来了
- 5 引擎不输出就退零 → `RUN_ERROR`（堵住"空流绿"）
- 6 引擎静默 13s → 仍 `RUN_FINISHED`（这是真引擎暴露的缺陷：Bun.serve 默认 10s 空闲超时会掐断长任务，已加 `idleTimeout: 255` + 20s 心跳注释行）
- 7 两轮同 thread → 会话键复用
- 8 引擎等 stdin EOF → 不挂死（`stdio: ["ignore",...]`；真 `opencode run` 会继承开着的管道并等 EOF，这条也是真引擎暴露的）
- 真引擎端到端：`RUN_STARTED` → `RUN_ERROR: Authorization Required`，流干净关闭

## 「两个脑子」定案（源码级，带路径）

`AGENT_BACKEND=agui` 换掉的只是 CopilotKit 的 `agents.default`（`openmuse/apps/server/src/agent.ts:41-46`）。
delegated task 的执行者不在那条链上：

- `engine/service.ts:55` → `new TaskWorker(db, (owner, task, context) => this.execute(...))`
- `engine/worker.ts:31` → `execute: TaskHandler` 是**注入**进来的，即 AgentService 自己的方法
- `engine/service.ts:729` → `private async execute(...)` 按 `task.kind` 分派（document / monitor / finance / agent）

**结论：成立，两个脑子。** 会话 = 你的 hypercode；`POST /api/agent/tasks` 建出的 `kind=agent` 任务仍由
OpenMuse 自己的模型回路推进（要它跑还得另配 `MODEL=` + provider key）。所以分工定为：
**只借它的耐久层当看板与审批账本（plan / step / waiting_approval / waiting_input / receipt），
"取证与执行"留在 hypercode 侧**，不去接它的 agent-kind 执行回路。

## 正向绿：已拿到（真模型、真工具调用、多轮）

凭证来源：`~/.dsh/.credentials.yaml` 的 `refs.DEEPSEEK_API_KEY`。
**只用环境变量传**，不落 `~/.config/hypercode/`、不进任何文件、不回显；
用空 `XDG_DATA_HOME=/tmp/hc-fresh` 证明不依赖旧的 `auth.json`。产物泄漏检查：`grep -c "$KEY"` = 0。

```bash
export DEEPSEEK_API_KEY=$(python3 -c "import re;t=open('/Users/aricredemption/.dsh/.credentials.yaml').read();print(re.search(r'^\s*DEEPSEEK_API_KEY:\s*(\S+)\s*$',t,re.M).group(1))")
cd /Users/aricredemption/Projects/hc-agui
XDG_DATA_HOME=/tmp/hc-fresh HC_MODEL=deepseek/deepseek-flash bun verify-live.ts
```

真实输出（`LIVE_RC=0`）：

```
第 1 轮事件：RUN_STARTED,TOOL_CALL_START,TOOL_CALL_ARGS,TOOL_CALL_END,TOOL_CALL_RESULT,
             TEXT_MESSAGE_START,TEXT_MESSAGE_CONTENT,TEXT_MESSAGE_END,RUN_FINISHED
PASS  正向绿：正文 + 工具结果 + RUN_FINISHED
第 2 轮事件：RUN_STARTED,TEXT_MESSAGE_START,TEXT_MESSAGE_CONTENT,TEXT_MESSAGE_END,RUN_FINISHED
PASS  多轮：同一 threadId 接住了上一轮的文件名
LIVE GREEN
```

引擎侧单独一发对照（不经 shim）：9 秒、`read` 工具 completed、正文回出 `/tmp/hc-ws/hello.txt`
的真实内容 `hypercode-e2e-marker-42`。所以绿的证据链是：引擎 → shim → AG-UI 事件，三段都各测过。

### 这一轮顺手抓出的两个"仪器自己没电"

- `verify-live` 的 `die()` 用 `process.exit()`，**不会跑 finally** ⇒ 残留 shim 占着 8777，
  下一发脚本去问了旧进程，把上一发的死凭证读成了"本轮失败"。现改成 die 内先 kill，并**等我自己起的
  那台打印 banner**才继续（起不来就当场红）。
- `hypercode auth`/`providers list` 里的两把旧凭证（OpenAI oauth、opencode-go）确实全失效：
  `Token refresh failed: 401` / `Authorization Required`，上游 `opencode` 同样打不通。

历史探针（保留，说明为什么一开始只能走失败路径）：

| 探针 | 结果 |
|---|---|
| `run -m openai/gpt-5.4-mini` | `Token refresh failed: 401` |
| `run -m deepseek/deepseek-flash`（opencode-go key） | `Authorization Required` 401 |
| 上游 `opencode run`（同一份 auth.json） | 也失败 → 不是 fork 的问题 |
| env 里的 `ZAI_API_KEY` 打 `api.z.ai` / `open.bigmodel.cn` | 双 401 |

清理：`rm -rf /tmp/hc-xdg /tmp/hc-fresh /tmp/hc-fresh-config`（我在 /tmp 造的软链与沙盒）。

## 品牌层：OpenMuse → HyperCode（你选的"真改名"，已落分支）

在 `openmuse` 的 **`brand/hypercode`** 分支上（commit `b687ee3`，74 文件 +309/−186），不是 main：
浅克隆已补成 54 条历史并留 `origin`，将来跟上游 rebase 时改名可重演。

分层（写死在 `tools/rename-brand.mjs` 里，不靠记忆）：

- **改**：`apps/ packages/ tests/` 描述件 `.env.example` `infra/` `.github/` `biome.json` `package.json`
  三类字面量 `OpenMuse→HyperCode`、`OPENMUSE→HYPERCODE`、`openmuse→hypercode`
  （连带 `.openmuse` 数据目录、`OPENMUSE_ACCESS_KEY`、`openmuse-computer` 镜像名、`dev.openmuse.*` 容器标签）
- **绝不改**：`LICENSE`（MIT 署名义务）、`CHANGELOG.md` 与 `docs/VERIFICATION.md`（上游历史验收记录）；
  以及任何指向 `github.com/CopilotKit` / `copilotkit.ai` / `unpkg.com` 的行（URL 守卫，实测残留 4 处全是这类）
- **补**：README 加 Provenance 段，明写"源自 CopilotKit OpenMuse（MIT），品牌不暗示隶属"

命令行：`package.json` 原本 `bin: None`（它没有 CLI，是 pnpm scripts 驱动的），现加
`bin.hypercode → scripts/hypercode.mjs`：

```bash
hypercode doctor            # 逐项点名前置：Intelligence key / shim 目录 / 模型凭证
hypercode start             # 起 hc-agui shim + 本地 API（AGENT_BACKEND=agui 自动注入）
hypercode start --web       # 顺带 Expo web
hypercode start --no-shim   # 只起 API
```

验收：在**同一 HEAD `34b15bc`** 上先取基线再复跑 ⇒ `typecheck rc=0/0`、`test rc=0/0`（两侧同数 **206 tests / 206 pass / 0 fail**）、`lint` 一度 rc=1，
查明是我自己造的两枚（清单文件落进了他们仓库根、`forEach` 返回值），修完 `rc=0`。
**`start` 这一支只实测了 `--help` 与 `doctor`**；真起 API 仍挡在 `CPK_INTELLIGENCE_API_KEY`（`config.ts:108` 硬抛）。
漂移成本：上游有新提交时重跑 `node tools/rename-brand.mjs <目标路径> --apply` 即可（幂等，清单落在 `tools/renamed-manifest.json`）。

## 全本机模式（不接任何云）

`HYPERCODE_THREADS=local` 是加在 openmuse 分支 `brand/hypercode`（commit `456d453`）上的**具名模式**，
默认仍是 cloud——上游 `tests/config.test.ts` 把"缺 key 必须红"当合同守着，我没拆那道闸，只加了显式入口。

```bash
cd /Users/aricredemption/Projects/openmuse
HYPERCODE_THREADS=local node scripts/hypercode.mjs start --web   # 无 CPK key 也能起
```

锚：`bun /Users/aricredemption/Projects/hc-agui/verify-local.ts` ⇒ `ANCHOR_RC=0 / LOCAL GREEN`
（无云 key 起服 → `main-thread` 200 → 一条 run 全事件流 → 正文等于 `/tmp/hc-ws/hello.txt` 的真实内容）。

丢的只有：进程重启后的会话历史、跨设备续聊、侧聊、回放。不丢：任务 plan/step、租约恢复、
审批与回执、产物文件、浏览器/终端工作区（全在本地 `DATA_DIR` 与 PGlite）。

## 故意没做（等可测面）

- OpenMuse 的内联卡片 keyed 在 `AgentTask`/`Evidence` 形状上，任务板要走它的 `POST /api/agent/tasks`、
  `POST /api/actions` + `/actions/:id/decide`。这段等 OpenMuse 真跑起来再写：它需要
  `CPK_INTELLIGENCE_API_KEY`（`config.ts:108` 的 `required()` 直接抛），而 `npx copilotkit login` 是交互式。
  没有可测面之前不写这段码。
- `step_start` / `step_finish` / `reasoning` 不发（字段与语义未实测）；多模态 part 暂丢。
- 微信侧一律不经这里：感知/判断留 `jev-chat-jarvis-mac`，发送永远人按。
