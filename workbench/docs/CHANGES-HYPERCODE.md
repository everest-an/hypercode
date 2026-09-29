# HyperCode 工作台：相对上游 OpenMuse 的改动台账

本目录以 git subtree --squash 方式并入 hypercode 主仓（源分支 brand/hypercode，末枚 7bbe0f8）。
squash 会压掉逐枚说明，故在此机械导出；SHA 指向 openmuse fork 仓的 brand/hypercode 分支。

| 提交 | 说明 |
|---|---|
| `b687ee3` | brand: OpenMuse → HyperCode（代码与产品面），保留上游署名与历史记录 |
| `e7c0e70` | brand: OpenMuse → HyperCode（代码与产品面 69 件，纯替换） |
| `456d453` | feat(threads): 新增 HYPERCODE_THREADS=local 全本机模式，不接任何云服务 |
| `00d316a` | fix(cli): 默认引擎路径、API_PORT 变量名、--auto 与 web 的 EXPO_PUBLIC_API_URL |
| `d42e12d` | fix(brand): 改名器漏了无扩展名文件 ⇒ Files 那一格全 422 |
| `da4a90f` | fix(ui): 会话过期不再装作"已连接"，直接退回登录屏并写明原因 |
| `8364511` | fix(brand): 改名器补 .py 白名单，files.py 的 .openmuse- 临时前缀不再漏网 |
| `0759f86` | fix(ui): 四行状态不再说谎 + 提示压得住弹层 |
| `3a1518c` | fix(ui): sample 模式不再把自己叫 "Connect Google" |
| `6bb407b` | fix(worker): fake-IP 的取件码不再被当成目的地来判断 |
| `9bab05d` | fix(agent): 工具调用与它的输出必须成对相邻，孤儿调用补记"未记录" |
| `ddb9e1a` | fix(ui): 挂载探询的 401 不再冒充 "Access key is incorrect" |
| `bc38146` | fix(cli): 大脑由 .env 的 AGENT_BACKEND 决定，不再硬写 agui |
| `288063d` | fix(agent): 一个回合按 reasoning→文本→全部调用→全部输出 分组，取代上一版的逐对相邻 |
| `e05dd36` | feat(demo): 演示入口从 copilotkit.ai 换成 awareness.market |
| `9810d8f` | fix(worker): Chromium 起不来时把原因说出来，不再只留一句"重建镜像" |
| `7bbe0f8` | feat(demo): 演示入口换成 awareness.market 供需广场，并拆掉两处替别人报品牌的写死文案 |
