HyperCode v0.1.1 快速开始
====================

HyperCode —— 最强大的 AI 编程软件与工作助手
一个清晰的任务指令,连续工作数小时,直到全部做完。

一、安装(Windows)
  双击 setup.bat,按提示完成。无需管理员权限。

二、安装(macOS)
  终端执行: bash setup.sh

三、配置模型(首次使用必做)
  HyperCode 采用"自带 key"模式:你的 DeepSeek API key
  由全部子代理共享,一次配置全局生效。

  1. 打开配置目录:
     Windows: %APPDATA%\hypercode\
     macOS:   ~/.config/hypercode/
  2. 编辑 hypercode.json,把 deepseek 的 apiKey 填好:
     "apiKey": "sk-你的DeepSeek密钥"
  3. 保存后运行: hypercode

四、开始使用
  终端输入: hypercode
  - 写代码:"帮我给这个项目加一个登录功能"
  - 干活:"帮我做一份融资 PPT" / "润色这篇论文" / "审查这份合同"
  - 内置 228+ 领域技能(金融/法律/学术),关键词自动触发

五、常见问题
  Q: 提示找不到命令?
  A: 关闭当前终端重新打开(或重启电脑),PATH 才会生效。
  Q: 模型报错?
  A: 检查 hypercode.json 里 apiKey 是否正确、DeepSeek 账户余额是否充足。
  Q: 更多帮助?
  A: https://github.com/everest-an/hypercode

免责声明:本版本为早期预览版,功能可能变化。
