# HyperCode Mac App Store 沙盒风险清单

> 上架 Mac App Store（MAS）前的已知风险点。基于代码静态分析 + electron-builder 配置校验得出，**最终需真机 macOS + 沙盒环境实测确认**。

## 模拟验证已确认 ✅

| 项 | 结果 |
|---|---|
| electron-builder config 加载 + `mas` 配置块 | ✅ 正确 |
| `mas.target` 与 `mac.target`(dmg 直装) 互不影响 | ✅ |
| `entitlements.mas.plist` 无 MAS 拒绝项 | ✅ 干净 |
| 含必需 entitlements(app-sandbox/allow-jit/network/files) | ✅ |
| desktop 包 typecheck | ✅ 通过 |

## 风险清单（按严重度排序）

### 🔴 风险 1：engine 配置/缓存路径在沙盒下可能失效

**位置**：`packages/desktop/src/main/engine-paths.ts` + `packages/core/src/global.ts`

**现状**：
- engine（core 层）通过 `xdg-basedir` 解析路径 → macOS 上等价于 `os.homedir()/.config/hypercode` 和 `os.homedir()/.cache/hypercode`
- desktop 主进程的 `engine-paths.ts` 用 `os.homedir()` 手动拼接同一路径（**刻意保持一致**，注释明确说明这是为了让 desktop 写入的文件被 engine 读到）

**沙盒下会发生什么**：
- macOS App Sandbox 会**拦截对 `os.homedir()` 真实路径的写入**，重定向到容器 `~/Library/Containers/<bundle-id>/Data/`
- `os.homedir()` 函数仍返回 `/Users/xxx`，但**实际写盘被重定向**，导致"读写的路径"和"实际落盘路径"不一致
- 结果：desktop 写入的配置/缓存，engine 读不到（或反过来），表现为**启动时配置丢失、缓存冷加载、每次都要重新联网装依赖**

**为什么不是简单地"改成 app.getPath"**：
- 如果 desktop 改成 `app.getPath('userData')`（沙盒容器内），但 engine 的 xdg-basedir 仍解析到 `os.homedir()/.config`（沙盒重定向到容器），两者**可能又不一致**
- 关键未知量：**engine 在沙盒下 `os.homedir()` 和 xdg-basedir 到底落到哪**——这必须真机实测，无法静态确定

**修法候选（需真机验证后选）**：
1. 在 MAS 启动时显式设置 `XDG_CONFIG_HOME` / `XDG_CACHE_HOME` 环境变量指向沙盒容器路径，让 engine 的 xdg-basedir 和 desktop 都落到同一处
2. 或 desktop 主进程在 MAS 下用 `app.getPath('userData')` 并同步注入环境变量

### 🟡 风险 2：原生模块（mac_window.node）在沙盒下的兼容性

**位置**：`packages/desktop/native/`（可选构建产物，Rust/Swift 编译的 `mac_window.node`）

**现状**：当前仓库无编译产物（`native/` 目录 gitignore + existsSync 判断）。electron-builder 配置里若存在则打包。

**沙盒风险**：
- 原生代码（Rust）可能使用沙盒禁止的 API（如 `exec`、绝对路径、共享内存）
- 沙盒下动态库加载（`dlopen`）受限，可能加载失败
- 需在真实沙盒环境验证 `mac_window.node` 能否加载

### 🟡 风险 3：helper 进程 entitlements 继承

**位置**：`electron-builder.config.ts` 的 `mas.entitlementsInherit`

**现状**：已配置 `entitlementsInherit` 指向 mas entitlements（含 app-sandbox + allow-jit）。

**风险**：Electron 的 renderer/GPU/network helper 进程在 MAS 下需要正确继承 entitlements，否则 helper 崩溃。electron-builder 通常能正确处理，但需真机验证。

### 🟢 风险 4：主进程文件访问的沙盒合规

**现状**：大部分主进程代码用 `app.getPath()`（沙盒安全），仅 `engine-paths.ts` 用了 `os.homedir()`（见风险 1）。

**结论**：除风险 1 外，主进程文件访问基本合规。

## 真机验证步骤（上架前必做）

1. 在 macOS 机器上跑 `bun run package:mas`（需 Apple Distribution 证书）
2. 安装产出的 `.pkg`
3. 验证：
   - [ ] 启动不崩溃
   - [ ] 配置能保存（改一个设置，重启后还在）
   - [ ] 缓存正常（第二次启动不重新联网装依赖）
   - [ ] 原生模块（mac_window.node，若有）能加载
   - [ ] 网络请求正常（调 DeepSeek API）
4. 用 `codesign -d --entitlements` 检查签名 entitlements 正确
5. 用 Transporter 上传 App Store Connect 验证过审

## 诚实声明

本清单基于**代码静态分析**（Windows 环境无法真机构建 MAS）。风险 1 是最可能翻车、也最需要真机定位的点——它的根因是 desktop 和 engine 各自解析路径，沙盒重定向让"一致性"变得不确定。**上架前必须真机实测这四点。**
