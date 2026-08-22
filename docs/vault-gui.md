# Vault 知识库 GUI(类 Obsidian 导览面板)

> 2026-08-23 · 状态:已实现,三条验证链路真实(零 mock)测试通过

## 是什么

HyperCode Desktop 内置的 Obsidian 式知识库界面:选择本地文件夹作为 Vault,左侧文件树 + 右侧 Markdown 预览/知识图谱,底部 Prometheus 任务面板。Agent 的所有写操作仍走文件系统 + hook 校验,GUI 只做展示与任务提交,不直接写磁盘。

## 入口

- 首页 projects 侧栏 "Open Vault" 按钮,或命令面板 `vault.open`
- 路由:`/vault/:dir`(base64 目录)

## 代码位置

| 部分 | 文件 |
|---|---|
| 路由/包装 | `packages/app/src/pages/vault/vault-route.tsx`,`app.tsx` 注册 |
| 页面布局 | `packages/app/src/pages/vault/vault-page.tsx` |
| 文件树(🔒/✨标记) | `vault-tree.tsx` |
| Markdown 预览(wiki 双链跳转) | `vault-preview.tsx` |
| 知识图谱(force-graph) | `vault-graph.tsx` + `vault-graph-data.ts`(纯逻辑,有单测) |
| Prometheus 任务面板 | `vault-task-panel.tsx`(会话创建/事件日志/拦截弹窗) |
| 标记配置 | `vault-config.ts`(读 `.opencode/vault.json`,缺失回退默认) |
| 模板初始化 | `packages/desktop/src/main/vault-template/`(`scaffold.ts` + 7 个模板,IPC `vault-init`,preload `window.api.vaultInit`) |

## 权限模型(双层)

1. **vault-guard plugin**(模板生成 `.opencode/plugin/vault-guard.ts`):`tool.execute.before` hook 拦截 Edit/Write/apply_patch 对保护路径(`TODO-Colonization.md`、`sisyphus/plans/**`)的调用,**对所有 agent 生效且不可被 agent 权限规则覆盖**。
2. **引擎 permission 配置**(`.opencode/opencode.jsonc` deny 规则):对原生 agent 兜底。
   ⚠️ 注意:插件定义的 agent(如 oh-my-openagent 的 Sisyphus)会在 `agent.ts:293` 把自己的 `"*": allow` 追加到项目规则**之后**,findLast 语义下覆盖项目 deny——所以**只靠 permission 配置保护不了插件 agent,必须有 vault-guard**(测试实锤,见下)。

AI 写笔记唯一通道:`.opencode/tool/obsidian_write_note.ts`(路径校验限定 `melting-asphalt/**`,防穿越)。

## 验证结果(2026-08-23,真实 LLM + 真实引擎,零 mock)

| Journey | 结果 |
|---|---|
| 1. Agent Edit 保护文件 | ✅ vault-guard 抛错拦截,文件未变,错误文案含 `prometheus-md-only` 触发 GUI 弹窗匹配 |
| 2. Agent 用 obsidian_write_note 写 melting-asphalt | ✅ 笔记落盘、含 H1 + wiki 链接 |
| 3. CLI 写文件 → GUI 刷新 | ✅ `file.watcher.updated` SSE 事件确认(目录作用域流) |

单测:scaffold 4 个、graph-data 6 个全过;`tsgo -b` app/desktop 全绿;electron-vite 生产构建通过。

## 踩坑记录

- **watcher 只订阅 git 仓库**(`packages/core/src/filesystem/watcher.ts:109` `location.vcs` 判断):非 git 目录无 `file.watcher.updated` 事件,GUI 自动刷新静默失效。scaffold 已加 best-effort `git init`。
- **DOMPurify 会剥掉自定义协议 href**:wiki 链接用 `#wikilink:` 前缀存活。
- **force-graph ≥1.51 是 class API**(`new ForceGraph(el)`),不是旧的工厂调用。
- **prometheus agent 可能缺失**(omo 配置迁移失败时插件部分加载):任务面板已做 fallback(create 失败→无 agent 参数重试)。
