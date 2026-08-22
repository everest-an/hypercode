# HyperCode 技术来源档案(TECH-SOURCES)

> ⚠️ **内部机密文档**——仅供 HyperCode 开发团队使用,**严禁随产品发行物分发**。
> 用途:记录所有上游来源、许可证义务、整合点与更新流程,支撑"用户无感、来源可溯"。

---

## 1. 上游清单总表

| 上游 | 仓库 | 许可证 | 当前基线 | 用途 | 整合方式 |
|---|---|---|---|---|---|
| OpenCode | anomalyco/opencode | MIT | dev @ `1b937c8`(2026-08-21) | CLI 引擎主体 | **深度 fork**(改名 hypercode,Phase 1 已完成) |
| oh-my-openagent(omo) | code-yeongyu/oh-my-openagent | **SUL-1.0** | dev @ 克隆日 HEAD | 智能体编排(子代理/钩子/MCP/技能) | 插件内置(预写配置 + 预置文件)+ 配置层改名 |
| Graft | NanoNets/Graft | MIT | main @ 克隆日 HEAD | 代码地图(hypercode-codemap) | **深度 fork** + 改名(待实施) |
| opencode-obsidian | mtymek/opencode-obsidian | MIT | main(1.1k stars) | Omega 侧边栏对话(Obsidian 桥接) | 方案借鉴 + 重实现为内置 Viewer(不依赖 Obsidian) |
| opencode-sidebar | djschleen/opencode-sidebar | MIT | main(1 star,未到 v1) | 侧边栏上下文切换模式 | 借鉴"单篇/vault 上下文切换"交互 |
| apply-opencode | dpshde/apply-opencode | MIT | main(4 stars) | 批量 frontmatter/标题/wiki-link/周报 | 借鉴功能集,重实现进 Omega |
| Obsidian-OpenCode-Knowledge | zxfccmm4/Obsidian-OpenCode-Knowledge | — | — | 示例 Vault 模板 | 仅参考,不整合 |
| awareness.market | — | 商业 SaaS | — | 记忆服务机制(认知层/知识卡/冲突检测) | **机制借鉴,自研实现**(本地 SQLite,不用其云) |
| anthropics/financial-services | anthropics/financial-services | **Apache-2.0** | main @ `33a3d8a`(2026-08-21) | 金融投研技能(comps/DCF/LBO/pitch-deck 等) | 技能打包内置(仅 methodology,不含付费数据连接器) |
| nature-skills | Yuan1z0825/nature-skills | **Apache-2.0** | main @ `a6e6f34`(2026-08-22) | 学术科研技能(19 个,中英触发词) | 技能打包内置 |
| agentii-investment-intelligence | agentii-ai/agentii-investment-intelligence | Apache-2.0 | — | 金融技能(衍生自 anthropics + 付费数据层) | **弃用**(数据层付费依赖;技能本体与 anthropics 重复) |
| DeepSeek | api.deepseek.com | 商业 | V4 Pro / Flash(2026-08-17 峰谷价) | 主力模型 | API 网关代理 |

---

## 2. 逐上游:整合点与更新流程

### 2.1 OpenCode fork(`hypercode`)

- **fork 位置**:临时 `hypercode-spike/hypercode` → 正式私有仓库(待定)
- **改名清单**:见提交 `75a2f3d`(Phase 1:bin/配置名/logo/文案/mDNS,27 文件)
- **Phase 2 待办**:`.opencode`→`.hypercode` 目录(改 `endsWith` 判断)、子代理名覆盖、omo 内置
- **rebase 纪律**:
  1. 上游 `anomalyco/opencode` dev 分支为唯一上游 remote
  2. 每 1-2 周 `git fetch upstream && git rebase` 一次
  3. 冲突几乎必然出现在改名处(config.ts 文件名候选数组、ui.ts wordmark、cli 描述文案)——冲突解决后跑 `tsgo --noEmit` 三包验证
  4. **红线**:永远不合并上游的 `install/` 脚本与自动更新逻辑(我们有自更新)
- **更新操作步骤**:
  ```bash
  git fetch upstream dev
  git rebase upstream/dev
  # 冲突解决 → 重跑改名断言:
  bun run --cwd packages/opencode typecheck && bun run --cwd packages/core typecheck && bun run --cwd packages/tui typecheck
  ```

### 2.2 oh-my-openagent(omo)插件内置

- **不 fork 其源码**(SUL-1.0 + 更新频繁),采用**发行物内置**:
  - 安装器预写 `hypercode.json`(plugin entries)+ 预置插件文件到 `~/.hypercode/plugin/`
  - 用户零配置获得全部子代理/钩子/MCP/技能
- **改名层**:用 omo 的 `AgentOverrideConfig`(配置层)覆盖子代理名/描述,**不碰其源码**(详见 `子代理改名方案.md`)
- **遥测**:强制 `OMO_CODEX_DISABLE_POSTHOG=1` 等开关,关闭上游遥测
- **更新流程**:升级 = 安装器重新下发新版本插件文件 + 保留用户的 `hypercode.json`(合并而非覆盖)
- **SUL-1.0 义务**:随发行物附 omo 的 LICENSE.md 全文 + 署名声明(放"关于"页,用户可见是法律要求)

### 2.3 Graft fork(`hypercode-codemap`)

- **fork + 改名**(MIT 允许):品牌名、CLI 命令、`graft/` 目录 → `hypercode-map/`
- **遥测**:`DO_NOT_TRACK=1` + 从源码构建(自动关闭 npm 版本检查)
- **LLM 层**:`GRAFT_BASE_URL` 指向 DeepSeek(OpenAI 兼容端点)
- **更新流程**:同 OpenCode 的 rebase 纪律;上游较小,rebase 成本低

### 2.4 Obsidian 插件三件套(不直接依赖)

- **决策**:不要求用户装 Obsidian(违背一键式),三插件**只做方案借鉴**,功能重实现进 Omega 内置 Viewer
- 借鉴清单:侧边栏对话嵌入、单篇/vault 上下文切换、批量 frontmatter、AI 标题、wiki-link、周报、Canvas 视图
- 若用户自愿装了 Obsidian:vault 是纯 markdown,天然兼容,直接打开即可(不做专用桥接插件)

### 2.5 awareness 机制(自研 HyperMemory)

- 借鉴:认知层 13 类知识卡、冲突检测、渐进披露、混合检索
- 自研:本地 SQLite + 语义检索(embedding 用国产模型),云端仅团队版同步
- 品牌:**HyperMemory**(用户永远看不到 "awareness" 字样)

---

## 3. 许可证义务执行清单(每次发版必查)

| 上游 | 必带文件 | 放置位置 |
|---|---|---|
| OpenCode | MIT LICENSE 全文 + 版权行 | 关于页 + 发行包 `licenses/` |
| omo | SUL-1.0 LICENSE.md 全文 + 署名/声明文件 | 关于页 + 发行包 `licenses/` |
| Graft | MIT LICENSE 全文 | 发行包 `licenses/` |
| 其余借鉴方案 | 仅机制借鉴,无分发义务;但记录于本档案 | — |

**品牌红线复查**:用户可见处不得出现 opencode / oh-my / omo / graft / obsidian / awareness 字样(除法律要求的 About 页致谢)。

---

## 4. 发行物与源码分离规则

| 物 | 内容 | 是否含来源痕迹 |
|---|---|---|
| 用户下载的安装器 | hypercode 二进制 + 内置配置 + licenses/ | 仅 About 页法律致谢,其余无痕迹 |
| 本档案 TECH-SOURCES.md | 全部来源细节 | **仅团队内部,永不进发行物** |
| 私有源码仓库 | fork + patch 全历史 | 私有,不公开 |
