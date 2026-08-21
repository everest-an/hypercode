# OMO 内置与升级兼容方案

> 目标:omo(oh-my-openagent)零安装内置、功能完美结合、升级永远兼容用户数据。
> 原则(用户要求):**重复功能不堆放**——omo 已提供的,不重复自研。

---

## 1. 产品逻辑:功能取舍表(去重决策)

| 能力 | omo 自带 | 原自研计划 | **决策** |
|---|---|---|---|
| 子代理编排 | ✅ 11 agents + 钩子体系 | PRD 调度器 | MVP 用 omo;自研调度器推迟,只做"并行度/成本护栏"增量 |
| 跨会话认知记忆 | ✅ memory 子系统(reflection/nudge/facts/dream/people/soul) | awareness 式 HyperMemory | **MVP 用 omo memory**——它本身就是 awareness 式认知记忆,重造=重复堆放。HyperMemory 仅当出现真实缺口(团队共享记忆)再上 |
| 代码智能 | ✅ codegraph MCP | Graft(fork) | **用 Graft,显式禁用 codegraph**(`enabled:false`)——双份索引/双份上下文注入是纯浪费;Graft 基准更优(+12 SWE-bench、-42% token) |
| 长时自主 | ✅ ulw-loop / start-work / continuation | PRD 规划器+验证环 | MVP 用 omo 循环;**"自动测试直到绿"是 omo 没有的真缺口**,V2 自研验证环 |
| 模型路由 | ✅ category + fallback_models | PRD hypercode-router | MVP 用 omo fallback;错峰调度+多供应商 = V2 增量 |
| 可视化 | ❌ 无 | Omega | 自研,无重叠 |

**结论**:MVP 不堆任何重复功能。用户"awareness 完美结合"的诉求 = omo memory 承载(同为认知记忆);Graft 与 codegraph 二选一,Graft 胜出。

## 2. 内置清单(安装器一次性写入,用户零操作)

| # | 写什么 | 写到哪里 | 时机 |
|---|---|---|---|
| 1 | 引擎配置(plugin 条目) | `<configDir>/hypercode.json` | 仅首次安装(已存在则跳过) |
| 2 | omo 受管块(品牌覆盖+功能开关) | `~/.omo/omo.jsonc` | 首次写入;升级仅替换受管块 |
| 3 | 插件文件 | 引擎插件目录 | `hypercode plugin install oh-my-openagent`(走 npmmirror) |
| 4 | provider 配置 | hypercode.json 内 | 登录网关时动态注入(用户永不接触 key) |

configDir 解析(与引擎 xdg-basedir 一致):Windows=`%APPDATA%\hypercode`;macOS=`~/Library/Preferences/hypercode`;Linux=`~/.config/hypercode`。

## 3. 升级兼容设计(硬要求,核心机制)

### 3.1 受管块标记(managed block)

`~/.omo/omo.jsonc` 中我们只拥有注释标记之间的键:

```jsonc
{
  // === HYPERCODE MANAGED BEGIN ===
  "agents": { "oracle": { "displayName": "Architect" }, "..." : {} },
  "codegraph": { "enabled": false },
  "telemetry": { "enabled": false },
  // === HYPERCODE MANAGED END ===
}
```

- **升级**:只替换 BEGIN..END 之间文本;块外用户自改(如 `"task": {...}`)原样保留。
- **用户删了标记**:升级时把受管块追加到文件末尾(JSONC 支持尾逗号),并重新生成标记。
- **幂等**:重复运行烘焙脚本无任何副作用。

### 3.2 永不触碰的数据

| 数据 | 升级时 |
|---|---|
| 用户会话/记忆(引擎存储) | 只读,绝不迁移/覆盖 |
| hypercode.json | 仅首装写入;升级只合并缺失的 plugin 条目 |
| omo.jsonc 块外内容 | 原样保留 |
| 插件文件 | 新版本原子替换,与配置解耦 |

### 3.3 插件升级流

```
更新器下载新插件包 → 校验哈希 → 原子替换插件目录 → 替换 omo 受管块 → 完成
(任何一步失败则整体回滚,用户配置零风险)
```

## 4. 功能开关一览(内置即生效)

| 开关 | 值 | 理由 |
|---|---|---|
| `agents.*.displayName` | HyperCode 品牌名 | 去指纹(见 L1 验证报告) |
| `codegraph.enabled` | **false** | Graft 替代,杜绝双份代码索引 |
| `telemetry.enabled` | **false** | 上游遥测全关(PostHog 等) |
| `memory.enabled` | true(默认) | MVP 认知记忆 |

## 5. 已知残留(记录在 TECH-SOURCES,列入 L2 候选)

| 残留 | 说明 | 处置 |
|---|---|---|
| `~/.omo` 目录名 | omo 硬编码,无重定位口子 | MVP 接受(点目录,普通用户看不到);L2 可 patch omo-config-core |
| 插件 ID `oh-my-openagent` | opencode 插件系统可见 | 同上,L2 引擎层改名 |

## 6. 落地文件

| 文件 | 用途 |
|---|---|
| `bake/templates/hypercode.json` | 引擎配置模板 |
| `bake/templates/omo-managed.jsonc` | 受管块模板(含品牌覆盖+开关) |
| `bake/bake.ps1` / `bake/bake.sh` | 烘焙脚本规范(Win/macOS;生产版=安装器二进制内置同逻辑) |
| `docs/omo-branding-template.jsonc` | 品牌映射单一事实源(受管块中的 agents 部分由此生成) |
