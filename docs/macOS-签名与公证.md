# macOS 签名与公证

> 当前状态:**未签名**。mac 用户下载后双击会看到「"HyperCode"已损坏,无法打开。您应该将它移到废纸篓」。
> 这不是升级问题——是**根本打不开**。本文是把它修好需要做的全部事情。

## 为什么现在是坏的

CI 日志逐字为证(每个 mac 构建都有,两个架构各一次):

```
• skipped macOS application code signing  reason=, see https://electron.build/code-signing CSC_IDENTITY_AUTO_DISCOVERY=false
```

electron-builder 改写过 Info.plist、改过产品名、塞进了 extraResources,Electron 原本的 ad-hoc 签名早已失效且没有重新签。Apple Silicon 上**未签名的 arm64 Mach-O 无法执行**,加上 DMG 下载后带 `com.apple.quarantine`,于是 Gatekeeper 直接判定为「已损坏」。

流水线把这当成 `warn` 并 exit 0,所以构建一直是绿的。

## ⚠️ 最大的坑:光加 Secrets 不管用

`.github/workflows/build-desktop.yml` 的两个 mac 打包步骤硬编码了:

```yaml
CSC_IDENTITY_AUTO_DISCOVERY: "false"
```

它会让 `findIdentity()` 在**读取证书之前**就返回 null:

1. `app-builder-lib/out/util/flags.js` → `isAutoDiscoveryCodeSignIdentity()` 返回 `false`
2. `out/codeSign/macCodeSign.js` → `findIdentity()`:`identity = qualifier || process.env.CSC_NAME`,两者皆空 → 自动发现已关闭 → **直接 return null**。`CSC_LINK` 导入的临时 keychain 根本轮不到被查
3. `out/macPackager.js:304-305`:`if (!identity) return false` —— `codesign` 从未被调用
4. `notarizeIfProvided()` 在那行 `return` **之后**,所以 `HC_NOTARIZE=1` 设的 `hardenedRuntime` / `notarize` 一并失效

**结论:把证书加进 Secrets 但不删这两行,证书会被导入然后忽略,构建仍然无签名,而且仍然 exit 0。**

Windows 那处的同名变量要**保留**——它走 `win.signtoolOptions.sign` 自定义回调,与此无关。

## 需要什么

账号已经有了:**Beijing VGO Co;Ltd (5XNDF727Y6)** / `120298858@qq.com`。不用另外购买。

缺的是**证书文件本身**。注意 OCT-Agent 的打包命令用的是:

```
CSC_IDENTITY_AUTO_DISCOVERY=true CSC_NAME="Beijing VGO Co;Ltd (5XNDF727Y6)"
```

`AUTO_DISCOVERY=true` = 从**本机钥匙串**自动找。所以那张证书一直躺在打包用的那台 Mac 的钥匙串里,从来没有以文件形式存在过。

而 GitHub Actions 的 macOS runner **每次都是全新空机器**,钥匙串是空的——这就是为什么 CI 必须拿到 `.p12` 文件。

### 在那台 Mac 上导出(约两分钟)

```bash
# 1. 确认证书在:必须是 "Developer ID Application",不是 "Mac App Distribution"
#    (后者用于上架 App Store,不能用于自行分发)
security find-identity -v -p codesigning

# 2. 钥匙串访问 → 找到 "Developer ID Application: Beijing VGO Co;Ltd (5XNDF727Y6)"
#    → 右键导出 → 存为 .p12 → 设一个导出密码

# 3. 转成 base64
base64 -i ~/Desktop/hypercode-signing.p12 | pbcopy
```

### 写入 `everest-an/hypercode` 的 Secrets

Settings → Secrets and variables → Actions → New repository secret:

| Secret | 值 |
|---|---|
| `MAC_CERT_P12_BASE64` | 上一步 `pbcopy` 的内容 |
| `MAC_CERT_PASSWORD` | 导出时设的密码 |
| `APPLE_ID` | `120298858@qq.com` |
| `APPLE_APP_SPECIFIC_PASSWORD` | 已有的 app 专用密码 |
| `APPLE_TEAM_ID` | `5XNDF727Y6` |

> app 专用密码若泄漏:https://appleid.apple.com → App-Specific Passwords → 撤销重生。

## 写好之后要改的代码

1. **删掉** `build-desktop.yml` 中两个 mac 打包步骤的 `CSC_IDENTITY_AUTO_DISCOVERY: "false"`(Windows 那处保留)
2. 每个 mac 打包步骤后加**硬门禁**,因为当前流水线把「跳过签名」当 warn 且 exit 0:

```bash
codesign --verify --deep --strict --verbose=2 dist/mac-arm64/HyperCode.app
spctl --assess --type execute -vv dist/mac-arm64/HyperCode.app
```

3. x64 产物目前**完全没验证**:`build-desktop.yml` 只对 `dist/mac-arm64/...` 跑 `verify-package.ts`,而 x64 落在 `dist/mac`(无 `-x64` 后缀)。两处都要验。

`packages/desktop/resources/entitlements.plist` 已存在且正确——含 `com.apple.security.cs.disable-library-validation`,捆绑的 oh-my-openagent 里有第三方原生二进制,在 hardened runtime 下需要它。

## 关于自动升级(先别做)

macOS 自动升级**必须先有签名**(Squirrel.Mac 硬性要求),而且还有一个会静默伤害用户的坑:

两次分架构打包各写一次 `dist/latest-mac.yml`,**第二次覆盖第一次**,留下的是 x64-only。而 `electron-updater` 在清单里找不到 arm64 条目时会 fallback 到非 arm64 文件——结果是**所有 Apple Silicon 用户被静默降级到 Intel 版并永久留在那个分支**,无报错无日志。

所以顺序不能反:**先签名,再做自动升级**。先发清单只会把「静默无操作」变成「每 10 分钟下载 232 MB 然后装不上」。

做自动升级时需要:
- 两个 `.zip`(`electron-updater` 只认 zip,明确排除 dmg/pkg)
- 合并后的 `latest-mac.yml`,`files` 里必须**同时**有 arm64 和 x64 两条
- 两个 `.zip.blockmap`(否则每次全量下 232 MB)
- 断言清单里同时存在 arm64 和 x64 的 URL——这条才能挡住上面那个静默降级

`packages/desktop/scripts/finalize-latest-yml.ts` 里已有一份可复用的合并实现(上游 Tauri 时代留下的),目前没有被 `build-desktop.yml` 调用。

---

*来源:2026-08-25 对打包与更新链路的排查。所有机制结论均来自实读 `node_modules` 内的 electron-builder / electron-updater 源码与真实 CI 日志,非推测。*
