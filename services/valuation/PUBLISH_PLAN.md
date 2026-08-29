# 晨报发布管道接入点(当前:生成到文件)

> 状态:晨报 cron 已跑通(生成到 /opt/valuation/morning_notes/)。
> 本文件列出发布到各平台的接入方式与待用户提供的信息。

## 当前状态

- ✅ cron 周一至周五 7:30 生成晨报 → `/opt/valuation/morning_notes/morning_YYYY-MM-DD.md`
- ✅ 内容含估值速查 CTA(获客钩子)
- ⏳ 发布到平台:待接入

## 发布渠道接入方案

### 1. 微信公众号(推荐,订阅制沉淀)
- 需:公众号 AppID + AppSecret(测试号即可开始)
- 接口:`POST /cgi-bin/token`(换取 access_token)→ `POST /cgi-bin/media/upload`(传图片)→ `POST /cgi-bin/message/custom/send`
- 频率:每天 1 篇图文(晨报)
- 准备:用户提供公众号凭据

### 2. 雪球(金融人群浓度最高)
- 雪球 API 发帖需要登录 cookie(较复杂,有风控)
- 替代:雪球"今日话题"投稿,或人工发布(晨报内容自动生成,人工 30 秒发布)
- 准备:用户雪球账号

### 3. 知乎(SEO + 长尾)
- 知乎专栏发布需要 cookie/登录态,自动化有风控
- 替代:知乎"想法"短内容,或人工发布
- 准备:用户知乎账号

### 4. 即刻/V2EX(开发者社区)
- 需要账号,人工发布

## 发布工具脚本(待凭据后实现)

```python
# publish_morning.py — 未来实现
# 读取 /opt/valuation/morning_notes/ 最新晨报 → 调用微信/雪球 API 发布
```

## 最低成本启动方案(无 API 凭据也能开始)

1. **邮件订阅**:晨报 + 估值速查 → 每周一发给订阅者(需 Resend/邮件服务 + 收集订阅)
2. **静态页面**:晨报每日追加到 `awareliquid.ai/morning-notes/`(SEO 收录,天然积累)
   - 这个不用任何平台账号,Caddy 已能服务静态文件 → **可以现在做**

## 立即建议

先做"晨报静态页面"(零依赖):把晨报发布到 awareliquid.ai/morning-notes/,让搜索引擎每天收录新内容。等用户提供微信/雪球凭据后,再接入平台自动化。
