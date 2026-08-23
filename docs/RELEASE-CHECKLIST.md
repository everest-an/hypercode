# HyperCode 发布检查清单

> 每次对外发布前,逐项核对。任一 ❌ 不得发布。

## A. 品牌(用户可见面零 opencode)

- [ ] CLI/TUI/App/Desktop 四处 grep 审计:引号文案、JSX 文本、URL 全部零残留
- [ ] 二进制名/安装目录/开始菜单名 = HyperCode
- [ ] 崩溃屏/反馈链接指向我们的仓库
- [ ] 模型清单不从 opencode.ai 拉取

## B. 隔离(不得影响用户其他工具)

- [ ] 安装目录专属 `hypercode-desktop`(extraMetadata.name 保留)
- [ ] 不写 `~/.omo/omo.jsonc`(共享 omo 配置)
- [ ] 卸载只清理自己的目录(干净虚拟机实测)
- [ ] 与 OpenCode 同机共存测试:安装/运行/卸载 HyperCode 全程 OpenCode 零影响

## C. 功能冒烟

- [ ] 桌面版:启动 → GUI 出现 → 无白屏/崩溃
- [ ] 供应商配置:界面内粘贴 DeepSeek key → 验证通过
- [ ] 跑一个真实任务:创建文件/改代码成功
- [ ] 技能触发:一句话触发金融/法律/学术技能
- [ ] Vault 面板:打开/文件树/预览可用

## D. 下载与合规

- [ ] 资产在公开仓库 AwareLiquid/HyperCode(非私有仓库)
- [ ] 匿名下载 HTTP 200
- [ ] THIRD-PARTY-NOTICES 随包分发
- [ ] 版本号在官网/Release/应用内一致

## E. 版本

- [ ] Release 版本号与 CI 构建版本一致
- [ ] 旧版 Release 已清理(仅保留最新)
