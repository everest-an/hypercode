# Omega 可视化层设计(HyperCode 知识视图)

> Omega = HyperCode 的知识可视化层品牌名(用户视角:**"Omega 知识面板"**),替代 PRD 中的"Obsidian Vault"表述。用户永远不会看到 "Obsidian" 字样。

---

## 1. 核心决策:不依赖 Obsidian,只兼容 Obsidian

用户目标"一键式、不折腾"决定了:**不能要求用户安装 Obsidian + BRAT 插件 + 配 CLI**。因此:

| 方案 | 结论 |
|---|---|
| 桥接插件(opencode-obsidian 等) | ❌ 不做为主要路径(要求用户装 Obsidian + Bun + CLI + BRAT,违背一键式) |
| **内置 Omega Viewer** | ✅ 主路径:`hc ui` 本地只读视图,零依赖,开箱即用 |
| Obsidian 兼容 | ✅ 免费赠送:vault 是纯 markdown,用户自己装了 Obsidian 可直接打开,无需我们维护桥接插件 |

**四个调研插件的价值 = 功能灵感,而非依赖**:

| 插件 | 借鉴的功能 | 是否值得 |
|---|---|---|
| opencode-obsidian(1.1k★) | 侧边栏对话 + web UI 嵌入 | 交互灵感✅,实现换成我们的 Viewer |
| opencode-sidebar(1★) | **单篇笔记 / 整个 vault 上下文切换** | ✅ 核心交互,直接借鉴 |
| apply-opencode(4★) | **批量 frontmatter、AI 标题、wiki-link、Canvas、周报** | ✅ 功能集最值钱,全部重实现 |
| Obsidian-OpenCode-Knowledge | 示例 vault 模板 | 仅参考目录结构 |

---

## 2. Omega 的 UI 设计(用户看到什么)

### 2.1 入口

- 命令:`hc ui`(或 TUI 内 `Ctrl+O` 呼出 Omega)
- 首次打开:显示项目"知识地图"——任务树 + 决策流 + 进度条 + 遗留问题,像驾驶舱

### 2.2 三栏布局(桌面)

```
┌──────────┬──────────────────────────┬───────────────┐
│  导航栏   │        内容主区           │    AI 侧边栏   │
│ 任务树    │  当前文档(markdown 渲染)  │  对话 + 上下文  │
│ 决策日志  │  可折叠/搜索/双向链接      │  切换: 单篇/    │
│ 进度      │  文件变更高亮(绿色 diff)  │  整个知识库    │
│ 遗留问题  │                          │               │
│ 架构笔记  │                          │               │
└──────────┴──────────────────────────┴───────────────┘
```

### 2.3 关键交互(直接决定"看得见 Agent 在干什么")

| 视图 | 用户看到 | 数据来源 |
|---|---|---|
| **任务树** | 勾选完成/进行中/失败的原子任务,可点开看每个任务的验证证据 | 规划器 + 调度器实时写入 |
| **决策流** | 时间线式"为什么这么改"记录,含取舍理由 | Agent 决策自动记录 |
| **变更高亮** | 代码文件里新增行绿色标注,像 code review | 编辑器 diff |
| **影响面提示** | 点一个符号,右侧列出"谁依赖它" | Graft 代码地图 |
| **周报视图** | 本周 Agent 干了什么、哪些任务绿了、哪些卡住 | 会话数据聚合 |
| **Canvas 视图** | 项目关系图(模块/任务/依赖),可拖拽 | 代码地图 + 任务树合成 |

### 2.4 上下文切换(借鉴 opencode-sidebar 的核心交互)

侧边栏顶部一个下拉:**"当前文档" / "整个知识库" / "当前模块"**——控制 AI 对话的上下文范围,用户一眼可控。

---

## 3. 数据层:Omega Vault

- 位置:`~/HyperCodeVault/<项目>/`(纯 markdown + frontmatter,无私有格式)
- 结构:

```
HyperCodeVault/<项目>/
├── tasks.md            任务树(自动)
├── progress.md         当前进度(自动)
├── issues.md           遗留问题(自动)
├── decisions/          决策日志(自动,一篇一条)
├── architecture/       架构笔记(半自动,Agent 起草用户可改)
├── weekly/             周报(自动)
└── canvas/             .canvas 视图文件
```

- **用户可编辑**:Agent 写的笔记用户可直接改,Agent 下次读回——这是"人机协作"的粘合点
- **与 Obsidian 兼容**:目录就是标准 markdown,装 Obsidian 的用户直接打开即为知识库

---

## 4. 批量知识加工(借鉴 apply-opencode,重实现为 Omega 内置命令)

| 命令 | 功能 |
|---|---|
| `/omega frontmatter` | 按 vault 已有规范批量补全元数据(学习现有 schema,不覆盖) |
| `/omega title` | AI 批量重命名"未命名"笔记 |
| `/omega links` | 识别实体,建议 `[[wiki-link]]`(diff 预览后应用) |
| `/omega weekly` | 生成本周总结 |
| `/omega canvas` | 自然语言生成关系图 |

这些命令同时存在于 TUI 和 Omega 面板——**用户无需 Obsidian 即可获得全部能力**。

---

## 5. 与智能层的接口

| Omega 视图 | 读取 | 写入 |
|---|---|---|
| 任务树 | 规划器任务图 | 调度器状态变更 |
| 决策流 | 记忆服务(decision 类 observation) | 记忆服务写入 |
| 影响面 | hypercode-codemap(Graft) | — |
| 周报 | 会话统计 | 自动生成 |

**关键**:Omega 是**只读渲染 + 受控编辑**(用户编辑区与 Agent 自动区用 frontmatter 标记分离),避免人机互相覆盖。

---

## 6. 落地顺序

| 阶段 | 内容 |
|---|---|
| M1 | `hc ui` 只读 Viewer:任务树 + 进度 + 决策流(最小可信视图) |
| M2 | 上下文切换 + AI 侧边栏 + 变更高亮 |
| M3 | 批量加工命令(frontmatter/title/links/weekly)+ Canvas |

品牌文案:所有入口统一叫 **Omega**,帮助文本如 "Open Omega knowledge panel"(不得出现 Obsidian)。
