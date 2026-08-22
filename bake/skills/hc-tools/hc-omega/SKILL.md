---
name: hc-omega
description: 知识图谱查看与维护。扫描 HyperCode 知识库(HyperCodeVault)中的笔记、任务、决策,生成交互式知识图谱(节点=文件,连线=链接/标签),在浏览器中打开查看。同时负责维护知识库:任务状态变化时更新 tasks.md,重要决策写入 decisions/。Use when the user mentions 知识图谱、图谱、知识库、看我的知识库、打开图谱、知识网络、Omega、obsidian、笔记地图、visualize my notes, or asks to see how their knowledge/notes connect.
version: 1.0.0
---

# hc-omega:知识图谱与知识库

**职责**:
1. **维护知识库**:把工作过程沉淀到 `~/HyperCodeVault/<项目名>/`(任务树、决策日志、架构笔记)
2. **生成图谱**:扫描知识库,生成交互式 HTML 图谱,浏览器打开

## 一、知识库维护(边干活边记)

目录结构:
```
~/HyperCodeVault/<项目名>/
├── tasks.md          任务树(进行中/完成/失败)
├── progress.md       当前进度
├── issues.md         遗留问题
├── decisions/        决策日志(每条一篇,带 frontmatter)
└── architecture/     架构笔记
```

- 每个任务/子任务结束时更新 tasks.md
- 每个重要决策写一篇 decisions/YYYY-MM-DD-标题.md,frontmatter 含 title、tags、date
- 笔记之间用 `[[笔记名]]` 互相链接,用 `#标签` 打标签(图谱的连线来源)

## 二、生成图谱

1. 用 Glob 扫描 `~/HyperCodeVault/` 下全部 `.md` 文件(以及当前项目 `.hypercode/` 下的笔记)
2. 对每个文件提取:
   - **节点**:frontmatter 的 `title`(缺省用文件名),`tags`,文件类型(任务/决策/架构/笔记)
   - **边**:`[[wikilink]]` 链接、markdown 链接、同标签共现(两个文件有相同 tag → 弱连线)
3. 用 `references/viewer-template.html` 模板:把节点/边数据填入模板中 `__GRAPH_DATA__` 占位符(JSON 数组)
4. 生成文件写到 `~/HyperCodeVault/graph.html`,用 `open` 命令在浏览器打开

**数据格式**:
```json
{
  "nodes": [{"id": "文件路径", "label": "标题", "type": "task|decision|architecture|note", "tags": ["标签1"]}],
  "edges": [{"source": "id", "target": "id", "kind": "link|tag"}]
}
```

## 三、硬规则
1. 图谱数据**只来自真实存在的文件**,不得编造节点。
2. 没有知识库文件时,明确告诉用户"知识库还是空的,先开始工作,我会边做边记录",不要生成空图谱充数。
3. 生成后浏览器自动打开;文件始终是自包含单 HTML,可分享、可离线打开。
