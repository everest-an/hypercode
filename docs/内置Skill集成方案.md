# 内置 Skill 集成方案(金融投研 + 学术科研)

> 目标:用户用中文/英文提到相关需求时,skill 自动触发(无感),无需安装任何东西。
> 许可证:三个主力源全部 Apache-2.0 ✅(可再分发,须附 LICENSE/NOTICE)。

---

## 1. 选型结论(去重原则)

| 域 | 采用源 | 理由 | 弃用 |
|---|---|---|---|
| **学术科研** | **nature-skills**(Apache-2.0,36.5k★) | 19 个技能,**中英文触发词已内置**;明确支持 OpenCode;科研全链路(读论文/润色/审稿/回审稿/PPT/科研图/文献/专利) | — |
| **金融投研** | **anthropics/financial-services**(Apache-2.0,34.5k★) | 技能本体(comps/DCF/LBO/pitch-deck/earnings/IC memo 等,触发词自动激活);file-based 无构建 | agentii(技能是其衍生 + **数据层付费 API**,跳过;FinRobot/CorpFinAI 是代码框架非技能,不堆) |

**关键边界**:只集成**技能(methodology)**,不集成**付费数据连接器**(FactSet/LSEG/agentii 的 MCP 需商业订阅)。技能里的数据获取步骤设计为"用户可填自己的数据源或手动喂数据"。

## 2. 技能清单

### 2.1 学术科研域(nature-skills,19 个,按需精选)

| 技能 | 触发词示例(已内置中英) |
|---|---|
| nature-reader | "全文 Markdown" "原文对照" "图文对应" |
| nature-polishing | "润色" "Nature style" "论文英文" |
| nature-writing | "写摘要" "写引言" "论文写作" |
| nature-reviewer | "预投稿评审" "审稿人视角评估" |
| nature-response | "返修邮件" "审稿意见回复" "rebuttal" |
| nature-paper2ppt | "论文汇报" "paper to slides" |
| nature-figure | "投稿级图片" "论文示意图" "scientific figure" |
| nature-citation / ref-verifier / academic-search | "查文献" "校验文献" "严格他引" |
| nature-paper-to-patent | "论文转专利" "技术交底书" |
| nature-statistics / data / experiment-log | "统计审查" "Data Availability" "实验日志" |
| nature-proposal-writer | "开题报告" "研究方案" |

### 2.2 金融投研域(anthropics/financial-services,按需精选)

| 技能 | 触发词(需补中文) |
|---|---|
| comps-analysis / dcf-model / lbo-model / 3-statement | "估值" "可比公司" "DCF" "LBO" "三张表" |
| pitch-deck / deck QC | "融资 PPT" "pitch deck" "路演" |
| earnings-analysis / preview / initiating-coverage | "财报分析" "首次覆盖" "业绩点评" |
| ic-memo / merger-model / unit-economics | "投委会" "并购模型" "单客经济" |
| competitive-analysis / sector-overview | "竞争格局" "行业研究" |
| pptx-author / xlsx-author | "生成 PPT/Excel"(与 Omega 配合) |

## 3. 无感触发机制(零开发,omo 自带)

```
用户输入(中/英)
   ↓
omo keyword-detector 匹配 SKILL.md 的 triggers/description
   ↓
命中 → 技能内容注入当前代理上下文(渐进披露:SKILL.md 精读,references/ 按需)
   ↓
未命中 → 正常流程,零开销
```

- 触发词格式:每个 SKILL.md 的 frontmatter 里 `Triggers:` 列表(中英双语,金融域需补中文触发词)
- 用户可显式调用:`/nature-reader` 等 slash 命令(可选,不影响无感路径)

## 4. 集成形态(零安装)

| 项 | 设计 |
|---|---|
| 打包位置 | `bake/skills/`(随安装器下发)→ 安装到 `~/.hypercode/skills/`(或引擎技能目录,实测确认) |
| 升级兼容 | 技能目录整体替换(与用户数据零交集),沿用受管块思想:技能区=系统区,用户自建技能放独立目录不覆盖 |
| 更新策略 | 随 HyperCode 版本升级下发新版技能;每技能记录来源 commit(TECH-SOURCES) |
| 许可证义务 | 随发行物附三份 Apache-2.0 LICENSE/NOTICE;About 页致谢 |

## 5. 落地顺序

| 步骤 | 内容 |
|---|---|
| 1 | 克隆 nature-skills + financial-services,只取 `skills/` 相关目录 |
| 2 | 金融技能补中文触发词(学术域已内置) |
| 3 | 剥离付费数据源依赖(数据获取步骤改为通用指引/用户自备数据) |
| 4 | 打包进 `bake/skills/`,更新 bake 脚本 |
| 5 | 实测:中文触发("帮我做估值" → DCF 技能自动激活) |
| 6 | TECH-SOURCES 记录来源 commit + 更新流程 |
