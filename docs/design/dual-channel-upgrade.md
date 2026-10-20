# 双通道升级:应用本体 + 软件层(插件)

状态: 已实现(M0–M4)
目标版本: 0.1.21+
作者: Sisyphus
日期: 2026-10-19

## 1. 两条通道

### 通道 A:应用本体(已有)

- `packages/desktop/src/main/updater.ts` → `electron-updater`
- 源:GitHub `AwareLiquid/HyperCode` 的 `latest.yml`
- 状态机、IPC(`updater-*`)、preload(`window.api.updater`)、设置页与 toast 均已存在

### 通道 B:软件层插件(本次新增)

运行时**不在用户机器上执行 npm/arborist**。插件以**预构建 zip payload** 形式随 Release 发布,应用下载、校验 SHA-256、解压、原子切换。

原因:

- 用户机器不保证有 npm
- 运行时安装完整依赖树(~200MB / 2 分钟)体验差且不可复现
- 预构建 payload 可在 CI 中先跑通/裁剪/校验,更安全

## 2. 兼容性

`plugins` 的兼容性由**应用内受测白名单 + Release manifest 的应用版本区间**共同决定:

```ts
PLUGIN_COMPAT = {
  package: "oh-my-openagent",
  min: "4.19.4",
  maxExclusive: "6.0.0",
  tested: ["4.19.4", "5.1.34"],
}
```

`packages/desktop/src/main/plugin-compat.ts` 提供版本解析/比较、`isCompatible`、`isAppCompatible`、`resolveCandidate`。

Release manifest 示例:

```json
{
  "schema": 1,
  "plugin": "oh-my-openagent",
  "version": "5.1.34",
  "compatibleApp": { "min": "0.1.21", "maxExclusive": "0.2.0" },
  "assets": {
    "win32-x64": { "file": "plugin-payload-win32-x64-5.1.34.zip", "sha256": "...", "url": "..." },
    "darwin-arm64": { "...": "..." },
    "darwin-x64": { "...": "..." }
  }
}
```

应用仅在以下条件全部满足时提示可升级:

1. manifest 的 `compatibleApp` 覆盖当前 app 版本
2. 插件版本在 `tested` 白名单且落在 `[min, maxExclusive)` 内
3. 当前安装版本 != manifest 版本

## 3. 状态与事务

### 权威状态

`<cache>/packages/.hypercode-plugin-state.json`

```json
{
  "activeVersion": "5.1.34",
  "source": "npm",
  "previousVersion": "4.19.4",
  "specs": ["oh-my-openagent@latest", "oh-my-openagent"],
  "installedAt": "...",
  "pendingValidation": true
}
```

`seedBundledPlugin` 现在优先读取该状态:

- 状态为 `npm` 且两个 spec 树都完整 → 跳过内置 seeding
- 任一 spec 缺失 → 清除状态并回退内置 seeding(保证一致性)

### 双 spec 事务

引擎有两个加载器(`oh-my-openagent` 与 `oh-my-openagent@latest`),必须同时切换。安装流程:

1. 下载 zip → 校验 SHA-256
2. 解压到 `<cache>/packages/.staging/<version>-<ts>`
3. 校验 `modules/oh-my-openagent/package.json` 版本
4. 写 journal `.hypercode-plugin-txn.json`
5. 对每个 spec:备份旧目录 → 原子 rename 新目录
6. 任一步失败 → 按 journal 逆序恢复
7. 写状态(`pendingValidation: true`),删除 journal

启动时 `recoverPluginTransaction` 处理上次崩溃留下的半完成事务。

## 4. 代码清单

### 主进程

- `plugin-compat.ts` — 版本/兼容判定
- `plugin-state.ts` — 状态文件读写/校验
- `plugin-installer.ts` — 下载、校验、解压、双 spec 事务、回滚、`revertPlugin`
- `plugin-updater.ts` — 状态机 controller(检查/安装/恢复)
- `bundled-plugin.ts` — seeding 尊重用户覆盖状态
- `ipc.ts` — `plugin-updater-subscribe|-unsubscribe|-check|-install|-revert`
- `index.ts` — 启动恢复事务、创建 controller、sidecar 启动后标记 validated

### preload / app

- `preload/index.ts` + `types.ts` — `window.api.pluginUpdater.{subscribe,check,install,revert}`
- `app/src/plugin-updater.ts` — 状态类型
- `app/src/components/plugin-updater-action.ts` — UI action 映射
- `settings-general.tsx` / `settings-v2/general.tsx` — 设置页新增「编排插件」行
- `i18n/en.ts` / `zh.ts` + 全部 locale parity 补齐

### 构建 / CI

- `scripts/bundle-plugin.ts` — 固定 `DEFAULT_PACKAGE_VERSION = "5.1.34"`,支持 `HYPERCODE_PLUGIN_VERSION`
- `scripts/package-plugin.ts` — 把 payload 打成平台 zip + fragment(platform/file/sha256/version)
- `scripts/verify-package.ts` — 断言打包内插件版本
- `.github/workflows/build-desktop.yml`
  - 顶层 `HYPERCODE_PLUGIN_VERSION: "5.1.34"`
  - 三个平台构建后生成 plugin zip
  - `draft-release` 合并 fragment → `plugin-manifest.json`
  - Release 同时上传 3 个平台 zip + manifest

## 5. 0.1.21 软件层

- `oh-my-openagent` 锁定 `5.1.34`(npm latest,已实测安装/裁剪/解压)
- `verify-package.ts` 在打包阶段断言版本
- 发布后 `plugin-manifest.json` 提供 5.1.34 的独立升级

> 仍建议发布前在真实引擎上跑一次启动 smoke,确认 5.1.34 的插件 API 与 0.1.21 引擎完全兼容;不兼容时回退到最高已验证版本。

## 6. 验证

已通过:

- `bun test`(desktop):202 pass / 0 fail
- `bun run test:unit`(app):765 pass / 0 fail
- `bun typecheck`(monorepo):30/30 successful
- `bundle-plugin.ts` 真实安装:`resolved oh-my-openagent@5.1.34`,裁剪 110.2→91.3 MB
- `package-plugin.ts` → `extractZip` 闭环:解压后 manifest 版本 5.1.34
- `verify-package.ts`:匹配 5.1.34 通过;不匹配 9.9.9 失败
- YAML 解析通过(jobs: build-win / build-mac / draft-release)

## 7. App Store(MAS)约束

MAS 版**不能**启用通道 B 的运行时插件升级:

- App Review Guideline 2.5.2:禁止下载并执行改变应用功能的代码
- `electron-updater` 在 MAS 不可用,必须走 App Store 更新
- 需要 App Sandbox + Apple Developer ID/Team ID

建议:

- **独立分发 DMG**:保留双通道(当前实现)
- **MAS 版**:通过 `CHANNEL`/feature flag 禁用 `pluginUpdater` 与 `electron-updater`,插件只随应用版本走
