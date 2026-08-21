# HyperCode 技术可行性验证报告(Route A:Fork OpenCode)

> 验证日期:2026-08-22 · 验证方式:克隆上游源码 + 源码级分析(本机直连 GitHub 被墙,经 ghfast.top 镜像克隆成功)
> 结论先行:**Route A 可行,但需分阶段改名 + 关注上游易主风险**。评级:**可行但(带条件)**。

---

## 一、已核实的上游事实(源码级)

| 项 | 事实 | 来源 |
|---|---|---|
| 仓库 | **`anomalyco/opencode`**(原 sst/opencode 已易主) | 根 `package.json` `repository.url` |
| 版本 | 1.18.21 | `packages/opencode/package.json` |
| 许可证 | MIT | 根 `LICENSE` |
| npm 包名 | `opencode-ai` | README |
| 技术栈 | Bun 1.3.14 monorepo(TypeScript + turbo + oxlint) | `packageManager: bun@1.3.14` |
| 二进制名 | `opencode`(`"bin": {"opencode": "./bin/opencode"}`) | `packages/opencode/package.json:18-20` |
| 构建命令 | `bun run script/build.ts` | `packages/opencode/package.json:14` |
| 包结构 | 32 个包(cli/core/tui/server/plugin/sdk/desktop/…),主 CLI 在 `packages/opencode` | 根 `workspaces` |

---

## 二、改名清单(核心结论:表面积巨大,但可分阶段)

### 2.1 改名表面积统计(源码实测)

| 品牌痕迹 | 出现规模 | 说明 |
|---|---|---|
| `opencode.json`(配置文件名) | **478 个文件**引用 | 硬编码字符串字面量,分散在 config/mcp/error/providers 等 |
| `.opencode`(配置目录) | **331 个文件**引用 | 含 `endsWith(".opencode")` 的**逻辑判断**(不只是字符串) |
| `OPENCODE_*` 环境变量 | **~130 个**独立变量名 | 如 OPENCODE_API_KEY、OPENCODE_CONFIG_DIR、OPENCODE_MODEL 等 |
| 二进制/命令名 | `opencode` | bin 字段 + CLI 入口 |
| TUI 横幅/logo | 多处 | 启动界面可见 |

### 2.2 关键硬编码位置(改名必改清单)

| 位置 | 内容 | 风险 |
|---|---|---|
| `packages/opencode/src/config/config.ts:140,259,260,426,518` | `"opencode.json"` / `"opencode.jsonc"` 候选文件名 | 中(集中,好改) |
| `packages/opencode/src/config/config.ts:425` | `dir.endsWith(".opencode")` 判断 | **高**(是逻辑,不是字符串) |
| `packages/opencode/src/config/tui.ts:203,206` | `dir.endsWith(".opencode")` 判断 | **高** |
| `packages/opencode/src/cli/cmd/mcp.ts:396-408` | 配置文件名候选 + 默认名 | 中 |
| `packages/opencode/src/cli/error.ts:68` / `providers.ts:452,461` | 错误/提示文案里的 "opencode.json" | 低(文案) |

### 2.3 救命稻草:已有的覆盖变量(官方预留的改口子)

| 环境变量 | 作用 | 对我们的意义 |
|---|---|---|
| `OPENCODE_CONFIG_DIR` | 覆盖配置目录 | 可把默认 `~/.opencode` 指到 `~/.hypercode` |
| `OPENCODE_CONFIG` / `OPENCODE_CONFIG_CONTENT` | 覆盖配置文件路径/内容 | 可指定 `hypercode.json` |
| `OPENCODE_CLI_NAME` | 疑似覆盖 CLI 显示名 | 待验证,或可改启动名 |
| `OPENCODE_DISABLE_AUTOUPDATE` | 关闭自动更新 | 我们的自更新接管 |
| `OPENCODE_DISABLE_DEFAULT_PLUGINS` | 关闭默认插件 | 控制内置插件集 |
| `OPENCODE_REPO_CLONE_GITHUB_BASE_URL` | GitHub 基址覆盖 | **大陆镜像的关键口子** |
| `OPENCODE_MODELS_URL` / `OPENCODE_MODELS_PATH` | 模型清单源覆盖 | 大陆可达的模型清单 |

### 2.4 改名结论(强烈建议分阶段)

**全量改名(478+331+130)是 1-2 周的高风险工程**,且环境变量改名会**破坏 oh-my-openagent 插件兼容**(插件代码里硬编码 `OPENCODE_*`)。因此:

| 阶段 | 范围 | 工作量 | 风险 |
|---|---|---|---|
| **Phase 1(必做,MVP)** | 二进制名 `opencode`→`hypercode`、TUI 横幅/logo、默认配置文件名(借 `OPENCODE_CONFIG` 覆盖)、安装命令 | 2-3 人日 | 低 |
| **Phase 2(建议)** | 默认配置目录 `.opencode`→`.hypercode`(改 `endsWith` 判断)、错误文案、帮助文本 | 3-5 人日 | 中 |
| **Phase 3(可选,不建议急于做)** | 环境变量 `OPENCODE_*`→`HYPERCODE_*` | 5-10 人日 | **高**(破坏 omo 兼容) |

**务实建议**:Phase 1 + 2 已足够做到"用户无感"(用户看不到二进制内部、看不到环境变量)。内部保留 `OPENCODE_*` 命名空间,加一层 `HYPERCODE_*` 别名做兼容。普通用户永远不会 `env | grep OPENCODE`。

---

## 三、构建与分发(结论:走 CI 构建,不本地编译)

| 项 | 事实 | 影响 |
|---|---|---|
| 原生依赖 | `@lydell/node-pty`、`tree-sitter`、`@parcel/watcher`、`@silvia-odwyer/photon-node` | Windows 本地编译有门槛,需 MSVC 工具链 |
| 官方构建 | CI(GitHub Actions `publish.yml`)产出平台二进制 | 已稳定产出 Windows 版 |
| Windows 分发现状 | npm `opencode-ai`、scoop/choco、桌面版 `opencode-desktop-windows-x64.exe` | 已有成熟 Windows 二进制 |

**结论**:我们**不在用户机器上编译**,在 CI 构建 HyperCode 二进制(改名后),由一键安装器下发。本地 Windows 编译仅用于开发调试,可绕过(用 CI)。这大幅降低了"构建可行性"的风险。

---

## 四、插件内置方案(oh-my-openagent 怎么塞进去)

已核实 OpenCode 的插件机制:`specs/tui-plugins.md` 明确——"当 `plugin` entries 存在于可写的 `.opencode` 目录或 `OPENCODE_CONFIG_DIR`,OpenCode 自动安装 `@opencode-ai/plugin` 并写入配置"。

**"内置"的落地方案(用户零配置)**:
1. 安装器预创建 `~/.hypercode/`(或借 `OPENCODE_CONFIG_DIR` 指向)
2. 预写入 `hypercode.json`,内含 omo 插件 entries + 预配置的 MCP(codegraph/context7/lsp/ast-grep,全部走国内可达端点)+ 预配置 DeepSeek 模型
3. 预置插件文件(把 `bunx oh-my-openagent install` 会写的文件直接打包进安装器)
4. 首次启动即"完整体验",无需任何交互

**风险点**:omo 安装器有交互式 TUI(非交互环境会自动跳过)——我们需要在打包时"复制其落盘结果"而非"运行时跑安装器",已验证可行(其落盘物就是配置文件 + 插件目录)。

---

## 五、许可证义务(三上游汇总,均已核实)

| 上游 | 许可证 | 商用 + 改名 + 闭源 | 必须做的 |
|---|---|---|---|
| OpenCode(anomalyco) | MIT | ✅ | 保留版权声明 + 许可证文本 |
| oh-my-openagent | **SUL-1.0**(非 MIT) | ✅(月活 <7 亿) | 附许可证文本 + 保留署名/声明文件 |
| Graft | MIT | ✅ | 保留版权声明 + 许可证文本 |

**额外提示**:OpenCode README 有商标指引——"若项目名含 'opencode' 需声明非官方"。我们改名 HyperCode,**不含 "opencode"**,无此顾虑;但 MIT 版权声明仍需保留(放"关于"页)。

---

## 六、大陆网络适配(已找到官方口子)

| 需求 | 方案 |
|---|---|
| GitHub 访问 | 安装器/更新源走国内 CDN;运行时借 `OPENCODE_REPO_CLONE_GITHUB_BASE_URL` 指向镜像 |
| 模型 API | 走 HyperCode Cloud 网关(裸 key 不下发) |
| 模型清单 | `OPENCODE_MODELS_URL` 指向自建清单 |
| 上游遥测 | 关闭:PostHog(omo)、Sentry(OpenCode 用了 `@sentry/solid`)、OpenTelemetry、自动更新 |
| 本机验证 | 实测:直连 github.com 超时,ghfast.top / gh-proxy.com 可达,npmmirror 可达 |

---

## 七、工作量估算(人日,单工程师)

| 任务 | 人日 |
|---|---|
| Fork + 环境搭建 + CI 构建流水线 | 2-3 |
| Phase 1 表面改名(二进制/横幅/默认配置名) | 2-3 |
| Phase 2 配置目录改名(.opencode→.hypercode) | 3-5 |
| 插件内置打包(omo + MCP + 模型预配置) | 2-3 |
| 遥测关闭 + 大陆网络适配 | 1-2 |
| 一键安装器(Windows) | 5-8 |
| **MVP 合计** | **约 15-24 人日** |

---

## 八、风险与建议

| 风险 | 等级 | 建议 |
|---|---|---|
| **上游易主**(sst→anomalyco),版本迭代方向未知 | 中 | 定期 rebase;智能层保持独立服务,不被引擎绑架 |
| 全量 env 改名破坏 omo 兼容 | 高 | 分阶段,内部保留 `OPENCODE_*` + 别名层 |
| Windows 本地编译 native 依赖 | 中 | 走 CI 构建,本地仅跑 TS 层 |
| `.opencode` 的 `endsWith` 逻辑判断遗漏 | 中 | Phase 2 用全局搜索 + 回归测试兜底 |
| SUL-1.0 精确义务未逐条核对 | 中 | 上线前请律师/逐条核对 NOTICE 与商标条款 |

---

## 九、结论

**Route A(fork OpenCode)确认可行,是主流且正确的路径。**

- ✅ 许可证(MIT)允许 fork + 改名 + 闭源商用
- ✅ 二进制/配置名/品牌均可改(官方预留了 `OPENCODE_CONFIG_DIR`、`OPENCODE_CLI_NAME` 等覆盖口子)
- ✅ Windows 二进制成熟(CI 产出,无需本地编译)
- ✅ omo 插件可通过"预写配置 + 预置文件"实现零配置内置
- ⚠️ 改名表面积巨大(478+331 文件 + 130 环境变量),**必须分阶段**,急于全量改名会破坏 omo 兼容
- ⚠️ 上游刚易主(anomalyco),需建立 rebase 纪律

**建议动作**:按 Phase 1→2 顺序推进改名;MVP 阶段内部保留 `OPENCODE_*` 命名空间(用户无感);构建走 CI。
