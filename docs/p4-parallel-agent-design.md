# P4 Design: 单任务内并行 Agent(Task Fan-out)

> 目标:让主 agent 把一个复杂任务拆成 N 个独立子任务,**并行**派发给多个子 agent 执行,完成后汇总结果回主会话。用户感知 = "一个大任务几分钟完成" 而非 "串行半小时"。

## 现状(已确认的代码事实)

### 已有基建(无需重造)
| 能力 | 位置 | 说明 |
|---|---|---|
| 子 agent 派发 | `packages/opencode/src/tool/task.ts` | `task` 工具:创建子会话(parentID)、选子 agent、权限继承(`deriveSubagentSessionPermission`)、深度限制(`subagent_depth`) |
| 后台并行 | 同上 `background=true` | 子任务异步执行,主 agent 可继续 |
| 结果注入 | `task.ts` `inject()` / `renderOutput()` | 子任务完成后把 `<task>` 结果注入回父会话 |
| 后台任务管理 | `packages/opencode/src/background/job.ts` | Effect Fiber 并发管理后台任务生命周期 |
| 子会话关系 | `core/session` `parentID`(已索引) | 父子会话持久化 |
| UI 子任务概念 | `schema/v1/session.ts` `SubtaskPart` | 消息层已有 subtask 类型 |

### 当前缺口
1. **无"一次派发 N 个并行子任务"的高层工具** —— 现有 `task` 单次只派发 1 个子 agent。要并行,主 agent 需连续调多次 `task(background=true)`,编排逻辑靠模型自己,不可靠且易漏汇总。
2. **无"等待所有子任务完成并汇总"的原语** —— 主 agent 靠 `background.wait` 逐个等,没有 barrier。
3. **无 UI 透出** —— SubtaskPart 存在但未用于展示"正在并行跑 N 个子任务"。

## 设计方案

### 核心新增:一个 `task_parallel`(或扩展 `task`)工具

**输入**:
```
tasks: [{ description, prompt, subagent_type }...]  // 2-5 个子任务
```

**执行流程**:
1. 主 agent 调 `task_parallel`,传入 N 个子任务定义
2. 工具内部:为每个子任务创建子会话(parentID = 当前会话),全部以 background 模式启动(复用 `BackgroundJob`)
3. 用 `Effect.all` / `FiberSet` 并发等待所有子任务完成(barrier)
4. 汇总所有结果,渲染成一段结构化文本(每个子任务的状态 + 结果摘要)注入回父会话
5. 主 agent 拿到汇总,做最终整合/收尾

### 与现有 task 的关系
- **复用** `task.ts` 的子会话创建、权限继承、模型选择逻辑(抽成共享 helper)
- `task_parallel` 是 `task` 的"多任务并行版",单任务场景仍用 `task`

### 关键决策点(需上游 review 时确认)
1. **并发度上限**:默认 4,防 DeepSeek 限流 + 防资源爆炸
2. **失败处理**:某个子任务失败,是整体失败还是继续其他?(建议:继续,汇总里标记失败)
3. **上下文隔离**:每个子任务独立 system prompt("你是子任务执行者,只做 X,完成后简洁回报")
4. **自动拆 vs 显式传**:v1 由主 agent 显式传 tasks 列表(不自动拆,避免幻觉);后续可加"自动拆"启发式

### 文件改动预估
| 文件 | 改动 |
|---|---|
| `packages/opencode/src/tool/task.ts` | 抽共享 helper(创建子会话/权限/模型) |
| `packages/opencode/src/tool/task-parallel.ts`(新建) | 并行派发 + barrier 等待 + 汇总 |
| `packages/opencode/src/tool/task-parallel.txt` | 工具描述(给模型的说明) |
| `packages/app/...` | UI 透出(可选,后续) |
| 测试 | task-parallel 单测 |

## 风险与权衡
- **收益**:并行 N 个子任务,墙钟时间 ≈ 最长子任务(而非总和),3-4 个子任务可提速 2-3 倍
- **风险**:① 并发请求放大(DeepSeek 限流) ② 子任务幻觉 ③ 改核心执行器需充分测试
- **兼容**:`task_parallel` 是新增工具,不动现有 task/runner,零破坏

## 与 P3 的关系
P3(small model 轻回合)已发 PR #46928。P4 可与 P3 叠加:并行子任务 + 轻回合 fast 模型 = 长任务双重加速。

## 实施顺序(等 P3 PR 反馈后)
1. 抽 task.ts 共享 helper(无行为变化,先合)
2. 新建 task_parallel 工具 + barrier 汇总
3. 单测
4. UI 透出(可选)
5. 发 upstream PR
