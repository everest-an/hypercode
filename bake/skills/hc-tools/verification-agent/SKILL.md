---
name: verification-agent
description: >-
  Adversarial post-completion review of non-trivial code changes before they are
  reported as done. Spawns a skeptical sub-agent that actively hunts for
  "looks-passing-but-broken" cases: tests that pass but assert nothing, code that
  runs but mishandles edge cases, silent failures, unhandled errors, and claims
  that overstate what was actually implemented. Use before reporting completion
  on any multi-file or logic-heavy task, especially when the agent is about to say
  "done" or "all tests pass". Triggers: 完成前复查、对抗式审查、验证成果、
  verify my work、review before done、sanity check、别急着交差、检查是否真的做对了.
---

# Verification Agent — 完成前的对抗式复查

从 Claude Code 泄露源码借鉴的核心机制:**在报告"完成"之前,spawn 一个对抗式子代理,
专门挑刺**。它不验证"代码能不能跑"(正常测试已覆盖),而是验证"看起来完成的东西是否真的对"。

## 何时触发

在以下任一情况,先跑本 skill 再报告完成:

1. 任务涉及 ≥2 个文件,或核心逻辑非平凡
2. 你正准备说"完成" / "done" / "所有测试通过"
3. 改动涉及:错误处理、边界条件、并发、I/O、状态管理、数据转换
4. 用户要求的验收标准比较模糊

## 复查流程

### 1. 自我先问(不用子代理,快速过滤)
- [ ] 是否有测试"通过"但实际没断言任何东西?
- [ ] 是否有 catch 块吞掉了错误(catch(e){})?
- [ ] 是否有硬编码值/临时 hack 被当成最终实现留下?
- [ ] 是否所有 TODO/FIXME/console.log 已清理?

### 2. 对抗式子代理(非平凡改动必做)

用 Task/Agent 工具 spawn 一个只读的复查子代理,提示词如下:

```
你是对抗式代码审查员。刚才完成了一个改动,你的任务是**专找问题**,不找优点。

审查范围:{文件列表 + 改动目的}

请重点检查:
1. 错误处理:哪些路径会静默失败?catch 块是否吞掉了真实错误?
2. 边界条件:空输入、超长输入、null/undefined、并发竞争、溢出
3. 测试质量:有没有测试"通过"但没断言?有没有测试只测了 happy path?
4. 过度声明:实现是否真的做到了声称的功能?有没有只实现了一半?
5. 死代码/残留:临时 hack、调试输出、TODO 是否清理干净?

对每个发现,给出:位置、严重程度(高/中/低)、为什么这是问题、怎么修。
如果你找不到问题,明确说"我找不到实质问题",不要凑数。
只读模式,不要修改任何文件。
```

### 3. 根据复查结果处理
- **高严重度问题** → 先修复,再重新报告,不声称完成
- **中严重度** → 修复或在最终报告中明确标注"已知限制"
- **低/无问题** → 可以报告完成,但仍要如实说明复查范围

## 铁律

1. **绝不**在对抗式复查通过前说"所有测试通过"或"已完成"——泄露源码里 Anthropic 内部
   build 有明确护栏:"Never claim 'all tests pass' when output shows failures"。
2. 复查不是走过场:如果子代理凑数/敷衍,重新 spawn 一次。
3. 复查结果要如实报告给用户,包括"没找到问题"(这本身就是有价值的结论)。
