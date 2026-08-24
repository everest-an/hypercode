# HyperCode 发布检查清单

> 每次对外发布前,逐项核对。任一 ❌ 不得发布。
> 背景与每条的来由见 `AUDIT-2026-08-23-品牌与发布链路修复.md`。

## 0. 发布流程(顺序不能换)

```
1. 编辑 /VERSION                    版本号唯一来源
2. 手动触发 build-desktop,填 version
     → win-x64.exe / mac-arm64.dmg / mac-x64.dmg
     → 自动开 draft release(资产缺失或体积异常会直接失败)
3. 走完下面的清单
4. 发布 draft
5. 部署官网                          链接指向 latest,发布后才通
```

需要 `RELEASE_TOKEN` secret(对 `AwareLiquid/HyperCode` 有 `contents:write`)。`GITHUB_TOKEN` 只能操作当前仓库。

## A. 品牌(用户可见面零 opencode)

- [ ] `grep -rn -i opencode packages/opencode/src/session/prompt/` 零命中 —— 系统提示词决定模型怎么自称
- [ ] `hypercode models | grep -cE '^opencode(-|/)'` 等于 0(注意有 `opencode` 和 `opencode-go` 两个上游网关)
- [ ] `hypercode debug skill` 输出里无 `customize-opencode`
- [ ] 崩溃屏、Help 菜单、限额提示、MCP 授权页均指向我们自己
- [ ] 模型清单不从 opencode.ai 拉取
- [ ] 首次启动生成的用户配置里无 `opencode.ai`

## B. 隔离(不得影响用户其他工具)

- [ ] 安装目录专属 `hypercode-desktop`(原始 package.json name 必须为 `hypercode-desktop`;仅靠 `extraMetadata.name` 不够,v0.1.5 仍装进了上游的 `@opencode-aidesktop`)
- [ ] 不写 `~/.omo/omo.jsonc`
- [ ] **同机共存 OpenCode**:安装 / 运行 / 卸载全程对它零影响
- [ ] 卸载只清理自己的目录与 shell rc 标记
- [ ] **安装前后 diff 用户 PATH**:
      `[Environment]::GetEnvironmentVariable('Path','User')`
      断言无截断、无重复、无系统条目混入(曾因 `setx` 截断毁掉半个 PATH)

## C. 功能冒烟(必须在干净虚拟机上做)

- [ ] 桌面版启动 → GUI 出现 → 无白屏崩溃
- [ ] **断言渲染出的正文，不要只看 main.log**。`server ready` 不是证据 —— v0.1.8 打印了它，
      同时每个渲染进程请求都是 401,界面停在 "Could not reach Local Server"。
      日志里唯一的线索在 `renderer.log`(`[global-sdk] event stream failed`)。
      ```
      "%LOCALAPPDATA%\Programs\hypercode-desktop\HyperCode.exe" --remote-debugging-port=9222
      cd packages/desktop && bun ./scripts/smoke-ui.ts     # exit 0 才算过
      ```
      该脚本已在三个方向验过:没有 app→失败、修好的 build→通过、真实的 v0.1.8→报出
      "Could not reach Local Server"。**这条通过之前,不要相信任何其它绿灯**
- [ ] **图标不是白的** —— 看任务栏和开始菜单的小图标,不要只看文件属性。
      结构合法的 ICO 也可能每一帧都是空的
- [ ] 应用名是 **HyperCode** 而非 "HyperCode Dev"(验证 channel 确实编译进去了)
- [ ] **界面粘贴 DeepSeek key → 能真的发起一次对话**(这条链路曾四处同时断)
- [ ] 故意粘贴错误 key → 向导**报失败**,而不是"验证通过"
- [ ] 技能列表能数到 **229** 个
- [ ] 一句话触发金融 / 法律 / 学术技能
- [ ] **首次启动无多分钟静默等待**(插件缓存已预填,不该现装)
- [ ] 重复运行安装两次,用户手改的配置未被覆盖
- [ ] 点击 `hypercode://` 链接能唤起并正确路由(冷启动也要试)
- [ ] Vault 面板:打开 / 文件树 / 预览可用

## D. 下载与合规

- [ ] 资产在公开仓库 `AwareLiquid/HyperCode`
- [ ] **匿名**下载 HTTP 200(登录状态会掩盖 draft/权限问题)
- [ ] 下载到的 exe/dmg 体积正常且魔数正确(`MZ` / zlib),不是 404 页面
- [ ] 只提供桌面版,不提供需要跑命令的终端包
- [ ] THIRD-PARTY-NOTICES 随包分发,且覆盖全部 229 个技能的来源

## E. 版本

- [ ] `/VERSION`、Release tag、安装器内嵌版本三者一致
- [ ] 旧版 Release 已清理或转 draft
- [ ] 若启用自动更新:版本号必须能 semver 递增(曾因内嵌 `1.18.21` 而 tag 是 `0.1.x`,
      配合 `allowDowngrade` 会造成无限重装循环)

## F. 自动化门禁(能自动跑的就别靠人)

- [ ] `bun turbo typecheck` 30/30
- [ ] `cd packages/desktop && bun test` 全绿 —— 含撞车事故的回归守卫
- [ ] `cd packages/opencode && bun test` 与基线比对**失败名单**(不是数量,套件本身 flaky)
- [ ] 229 个 SKILL.md 全部通过严格 YAML 解析
- [ ] 图标校验按**解码后的像素**断言,不看文件大小或 header

---

## 教训(为什么加这些条)

1. **结构合法 ≠ 内容正确**:空白图标通过了 `file`、header、大小三重检查
2. **测试全绿 ≠ 功能可用**:deep link 有 19 条断言全绿,锁的是改名前的 scheme
3. **两端各自正确 ≠ 能接上**:安装器写的目录引擎不读,这类问题只有把读写两端放在一起求值才会暴露
4. **品牌改名会碰到协议值**:v0.1.8 把 sidecar 的 Basic auth 用户名从 `opencode` 改成 `hypercode`,
   但服务端仍以 `opencode` 启动,引擎按严格相等比较 → 全部 401,应用完全打不开。
   凡是"两端必须逐字节相同"的值(用户名、scheme、包名、缓存目录名),
   都必须是**一个常量被两端 import**,而不是两处各写一遍的字面量 —— 字面量正是改名扫描会命中的东西。
   守卫见 `packages/desktop/src/main/server-credentials.test.ts`
5. **自检不能与被检者共谋**:健康检查硬编码了 `opencode:`,于是它是唯一还和服务端一致的调用方,
   把一个完全不可用的版本报成了启动成功。检查必须和真实用户路径**共用同一份凭据/配置**,否则它只会证明自己
