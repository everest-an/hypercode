# HyperCode 估值速查服务

自动化获客的免费工具:输入 A股代码 → 实时行情 + AI 估值快照(DCF 简版 + Comps 对比)。
每个估值结果都是 HyperCode 能力的活广告 → CTA 引导下载 HyperCode。

## 功能

- `GET /api/valuation?ticker=600519` → JSON(行情 + DCF + Comps)
- `GET /valuation?ticker=600519` → HTML 页面(SEO 可索引)
- 24h 缓存(同一 ticker 同日不重复调用 AI)
- 免责声明自动注入("AI 生成,非投资建议")

## 快速开始

```bash
pip install -r requirements.txt
export DEEPSEEK_API_KEY=sk-xxx   # 必填
uvicorn valuation_server:app --host 0.0.0.0 --port 8787
```

## 环境变量

| 变量 | 必填 | 默认 |
|---|---|---|
| DEEPSEEK_API_KEY | ✅ | — |
| DEEPSEEK_MODEL | | deepseek-v4-flash |

## 数据源

- 实时行情:腾讯行情 API `qt.gtimg.cn`(免费,无需 key)
- 历史 K 线:腾讯 `web.ifzq.gtimg.cn`(免费)
- AI 生成:DeepSeek API(flash 模型,成本 ~¥0.01-0.03/次)

## 部署(建议)

部署到 Vultr 服务器(45.76.18.203)子域 `valuation.awareliquid.ai`:

1. 服务器装 Python + 依赖
2. 环境变量放 systemd/环境文件(⚠️ 不提交到 Git)
3. Caddy 加子域反代(参考现有 /root/M1/deploy/Caddyfile)
4. 定时任务:交易日批量生成 300 家 A股快照 → SEO 长尾

## 合规

- 每个输出含免责声明(非投资建议)
- 估值基于实时行情 + AI 假设,不用财报级数据时明确标注"假设值"
- API key 只在服务器环境变量,绝不进代码/Git

## 与获客方案的关系

- 方案:`D:\Antigravity\获客-自动化1000金融分析师.md` + `获客-自动化实现规格.md`
- 定位:漏斗的"免费工具钩子"——用一次就想要完整版(HyperCode 55 个金融技能)
