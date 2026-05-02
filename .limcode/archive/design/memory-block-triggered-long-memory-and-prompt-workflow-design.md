# Memory Block 触发式长记忆与提示词工作流设计草案

> 状态说明（2026-04-10）：本文档为 **历史设计草案 / 已部分落地实现的设计资产**，不应直接视为当前代码现状说明。
>
> 当前实现与本文若干背景描述存在差异，阅读时请以 `docs/*`、`packages/contracts/*` 与服务端代码为准。当前已知差异至少包括：
>
> - `LongTermMemoryStore` 已不再只是 noop；服务端已存在 Prisma-backed compatibility store，将 `MemoryBlock` 映射回兼容 `MemoryEntry`
> - `PromptFragment` 已经具备一等字段：`anchor / placement_mode / depth / order`，不再只是基础 `slot / priority / content / source`
> - 当前 memory block diagnostics 已稳定落地的字段为：`evaluated / inserted / delayed / cooling / retained / inactive`
> - 文中多处提到“世界包开发者可声明 memory block 行为”，但当前 pack schema 尚未正式提供 memory block 的 pack-level 声明入口；现实现状仍以 kernel-side Prisma store 为主
>
> 因此，本文更适合用于理解当时的设计意图、边界取舍与演进方向，而不是作为当前实现的唯一说明。

## 1. 背景

当前项目已经具备一条基础可运行链路：

- `memory/*` 提供 `short_term / long_term / summaries` 抽象
- `context/*` 已经具备 `ContextNode / ContextRun / Policy / Overlay`
- `context/workflow/orchestrator.ts` 已经承担线性 prompt 编排
- `inference/processors/*` 已经包含：
  - `memory_injector`
  - `policy_filter`
  - `memory_summary`
  - `token_budget_trimmer`
- `PromptFragment` 已经是 prompt 组装的显式中间结构

但当前 Memory 子系统仍然存在明显缺口：

1. `LongTermMemoryStore` 还是 noop
2. `MemoryEntry` 更像“材料列表”，不是“可治理、可触发、可插入的记忆块”
3. prompt 注入仍以“直接把 memory_context 转 fragment”为主
4. 尚未形成正式的：
   - 长记忆块模型
   - 触发规则模型
   - 生命周期状态机
   - 相对插入/排序策略
   - 记忆级权限边界

用户希望 Memory 与提示词工作流深度结合，并且：

- 每条记忆应被当成**块**和**节点**对待
- 支持多种标签与处理方式
- 默认按**同一 agent 的历史输出**计算“距离最新回复的相对距离”
- 允许读取最近 `trace / intent / event`，但必须经过权限限制
- 删除语义允许**彻底删除**
- 默认触发策略为 **100% 无条件触发**，但允许世界包开发者覆盖

因此，需要一套正式设计，把 Memory 从“文本材料”升级为：

> **可持久化 Memory Block + 可配置 Trigger/Placement + 可追踪 Runtime State + 可 materialize 为 ContextNode + 可编排为 PromptFragment 的正式子系统。**

---

## 2. 设计目标

### 2.1 核心目标

1. 定义正式的 `MemoryBlock` 持久模型
2. 定义记忆触发规则、运行时状态、排序与插入策略
3. 将长记忆正式接入当前 `Context Module -> Orchestrator -> PromptFragment` 主线
4. 支持同一 agent 历史输出语境下的相对距离派生信息
5. 支持基于权限受限的最近 `trace / intent / event` 读取作为触发输入
6. 让世界包开发者可配置：
   - 是否触发
   - 怎样触发
   - 插入到哪里
   - 触发后保留/冷却/延迟策略
7. 保证可审计、可解释、可调试

### 2.2 非目标

本设计当前不追求：

- 向量数据库 / embedding 检索的完整引入
- 通用图数据库式记忆网络
- 任意 JS 脚本级逻辑表达式
- 插件市场/热插拔执行系统
- 前端可视化记忆编排器
- 一次性交付所有高级自动重写/自动摘要能力

---

## 3. 核心原则

### 3.1 Block / Node / Fragment 三层分离

必须严格区分：

1. **MemoryBlock**：持久存在的记忆资产
2. **MemoryNode**：本轮被激活并进入上下文系统的节点
3. **PromptFragment**：最终进入 prompt 的文本片段

即：

```text
MemoryBlock -> activation/materialization -> MemoryNode -> prompt assembly -> PromptFragment
```

### 3.2 稳定身份与相对位置分离

- `memory_id` 必须稳定
- “距离最新回复 0/1/2...” 只应是**运行时派生字段**，不能作为持久主标识

### 3.3 触发规则与运行时状态分离

- `trigger_rule` 是静态配置
- `cooldown / retain / delayed_until` 是动态状态

### 3.4 世界包有触发治理权，系统有安全裁决权

- 世界包开发者可声明默认规则与行为
- 系统仍保留权限过滤、边界校验与调试记录职责

### 3.5 默认简单，能力渐进增强

默认行为应可非常简单：

- `100%` 无条件触发
- 固定 slot
- 简单深度/顺序排序

然后再逐步增强关键词、逻辑匹配、延迟、保留、冷却等能力。

---

## 4. 概念模型

### 4.1 MemoryBlock

`MemoryBlock` 是正式长记忆对象。

建议类型：

```ts
export type MemoryBlockKind =
  | 'fact'
  | 'reflection'
  | 'plan'
  | 'dossier'
  | 'rule'
  | 'hypothesis'
  | 'reminder'
  | 'summary';

export type MemoryBlockStatus = 'active' | 'deleted';

export interface MemoryBlockSourceRef {
  source_kind?: 'trace' | 'intent' | 'job' | 'post' | 'event' | 'manual' | 'overlay';
  source_id?: string;
  source_message_id?: string;
}

export interface MemoryBlock {
  id: string;
  owner_agent_id: string;
  pack_id: string | null;
  kind: MemoryBlockKind;
  status: MemoryBlockStatus;
  title: string | null;
  content_text: string;
  content_structured: Record<string, unknown> | null;
  tags: string[];
  keywords: string[];
  source_ref: MemoryBlockSourceRef | null;
  importance: number;
  salience: number;
  confidence: number | null;
  created_at_tick: string;
  updated_at_tick: string;
}
```

### 4.2 MemoryBehavior

`MemoryBehavior` 表达这条记忆如何被系统使用。

```ts
export interface MemoryBehavior {
  mutation: {
    allow_insert: boolean;
    allow_rewrite: boolean;
    allow_delete: boolean;
  };
  placement: MemoryPlacementRule;
  activation: MemoryActivationRule;
  retention: MemoryRetentionRule;
}
```

### 4.3 MemoryRuntimeState

动态状态，记录触发后的运行时结果。

```ts
export interface MemoryRuntimeState {
  memory_id: string;
  trigger_count: number;
  last_triggered_tick: string | null;
  last_inserted_tick: string | null;
  cooldown_until_tick: string | null;
  delayed_until_tick: string | null;
  retain_until_tick: string | null;
  currently_active: boolean;
  last_activation_score: number | null;
  recent_distance_from_latest_message: number | null;
}
```

### 4.4 MemoryNode

`MemoryNode` 是 `MemoryBlock` 在当前轮被激活后 materialize 出来的节点。

它不需要单独设计成完全独立体系，而应对齐现有 `ContextNode`：

```ts
interface MemoryNode extends ContextNode {
  source_kind: 'memory_block';
  source_ref: {
    memory_id: string;
    source_message_id?: string;
  };
  metadata: {
    memory_kind: string;
    activation_score?: number;
    triggered_by?: string[];
    placement_depth?: number;
    placement_order?: number;
    anchor?: Record<string, unknown> | null;
    recent_distance_from_latest_message?: number | null;
  };
}
```

---

## 5. 触发规则设计

## 5.1 基础原则

触发规则必须：

- 足够可配置
- 可被世界包声明
- 可被系统安全执行
- 可调试
- 不依赖任意脚本执行

因此建议采用**声明式 DSL**，而不是开放 JS。

### 5.2 MemoryActivationRule

```ts
export interface MemoryActivationRule {
  mode: 'always' | 'keyword' | 'logic' | 'hybrid';
  trigger_rate: number; // 默认 1
  min_score: number;    // 默认 0
  triggers: MemoryTrigger[];
}
```

### 5.3 默认规则

默认行为：

```ts
{
  mode: 'always',
  trigger_rate: 1,
  min_score: 0,
  triggers: []
}
```

含义：

- 无条件触发
- 100% 命中
- 不需要额外判断

这符合用户要求的默认行为。

### 5.4 Trigger 类型

```ts
export type MemoryTrigger =
  | MemoryKeywordTrigger
  | MemoryLogicTrigger
  | MemoryRecentSourceTrigger;
```

#### 5.4.1 关键词触发

```ts
export interface MemoryKeywordTrigger {
  type: 'keyword';
  match: 'any' | 'all';
  keywords: string[];
  case_sensitive?: boolean;
  fields?: Array<'content_text' | 'content_structured' | 'recent_trace_reasoning' | 'recent_event_text'>;
  score?: number;
}
```

#### 5.4.2 逻辑触发

```ts
export interface MemoryLogicTrigger {
  type: 'logic';
  expr: MemoryLogicExpr;
  score?: number;
}
```

#### 5.4.3 最近来源触发

用于读取权限允许范围内的最近 `trace / intent / event`：

```ts
export interface MemoryRecentSourceTrigger {
  type: 'recent_source';
  source: 'trace' | 'intent' | 'event';
  match: {
    field: string;
    op: 'eq' | 'in' | 'contains' | 'exists' | 'gt' | 'lt';
    value?: unknown;
    values?: unknown[];
  };
  score?: number;
}
```

---

## 6. 逻辑表达式 DSL

为了避免脚本注入，建议逻辑匹配使用安全的 JSON DSL。

```ts
export type MemoryLogicExpr =
  | { op: 'and'; items: MemoryLogicExpr[] }
  | { op: 'or'; items: MemoryLogicExpr[] }
  | { op: 'not'; item: MemoryLogicExpr }
  | { op: 'eq'; path: string; value: unknown }
  | { op: 'in'; path: string; values: unknown[] }
  | { op: 'gt'; path: string; value: number }
  | { op: 'lt'; path: string; value: number }
  | { op: 'contains'; path: string; value: string }
  | { op: 'exists'; path: string };
```

### 6.1 可访问路径范围

推荐允许逻辑表达式读取以下受限路径：

- `pack_state.actor_state.*`
- `pack_state.world_state.*`
- `pack_state.latest_event.*`
- `recent.trace[*].*`（仅在权限允许下 materialize）
- `recent.intent[*].*`
- `recent.event[*].*`
- `context.attributes.*`
- `agent_snapshot.*`

### 6.2 权限原则

即使逻辑层允许读取 `recent.trace / intent / event`，也必须先经过：

- `Access Policy`
- `Context Policy Engine`
- world/identity 对应的读取许可

未被授权的数据：

- 不应进入 DSL 评估上下文
- 不应在 trace 中以原文泄漏
- 只能表现为 `not available` 或缺字段

---

## 7. 提示词插入与排序策略

## 7.1 MemoryPlacementRule

```ts
export type MemoryPlacementSlot =
  | 'system_policy'
  | 'role_core'
  | 'world_context'
  | 'memory_short_term'
  | 'memory_long_term'
  | 'memory_summary'
  | 'post_process';

export interface MemoryPlacementAnchor {
  kind: 'slot_start' | 'slot_end' | 'source' | 'tag' | 'fragment_id';
  value: string;
}

export interface MemoryPlacementRule {
  slot: MemoryPlacementSlot;
  anchor: MemoryPlacementAnchor | null;
  mode: 'prepend' | 'append' | 'before_anchor' | 'after_anchor';
  depth: number; // 数字大者靠后
  order: number; // 同一 depth 内排序
}
```

## 7.2 排序语义

在同一 slot 下，推荐排序规则：

1. anchor group
2. `depth` 升序
3. `order` 升序
4. `activation_score` 降序
5. `updated_at_tick` 降序
6. `memory_id` 字典序作为最终稳定 tiebreaker

### 说明

用户提出：

- 深度数字大比数字小的靠后
- 同一个深度要有先后顺序

该规则与上述设计一致。

## 7.3 与现有 PromptFragment 的关系

当前 `PromptFragment` 只有：

- `slot`
- `priority`
- `content`
- `source`

建议扩展 metadata 语义，而不强制立刻破坏现有结构：

```ts
fragment.metadata = {
  memory_id,
  memory_kind,
  activation_score,
  anchor,
  depth,
  order,
  placement_mode,
  recent_distance_from_latest_message
}
```

中期建议再把 `anchor / depth / order` 从 metadata 上移为一等字段。

---

## 8. 保留 / 冷却 / 延迟

## 8.1 RetentionRule

```ts
export interface MemoryRetentionRule {
  retain_rounds_after_trigger: number;    // 默认 0
  cooldown_rounds_after_insert: number;   // 默认 0
  delay_rounds_before_insert: number;     // 默认 0
}
```

## 8.2 状态机

建议采用以下状态机：

```text
inactive
  -> matched
  -> delayed
  -> active
  -> retained
  -> cooling
  -> inactive
```

### 状态语义

- `inactive`：当前未命中，未激活
- `matched`：本轮命中规则
- `delayed`：已命中，但需等待若干轮后插入
- `active`：本轮可 materialize 并进入 prompt
- `retained`：触发后继续保留若干轮
- `cooling`：插入后冷却，暂时不再重复触发

## 8.3 派生判断

给定当前 tick / round：

- 若 `cooldown_until_tick > now`，则不可再触发
- 若 `delayed_until_tick > now`，则处于 delayed
- 若 `retain_until_tick > now`，则即使本轮未重新匹配也可继续 active

---

## 9. “距离最新回复”设计

## 9.1 需求解释

用户希望支持：

- 从 AI 最新回复算起
- 目标消息为 0、1、2... 的相对距离标记
- 默认语义为**同一 agent 的历史输出**

## 9.2 正式建议

不要将此作为持久核心字段，而应定义为：

```ts
recent_distance_from_latest_message: number | null
```

### 计算方式

给定：

- 当前 agent = `owner_agent_id`
- 最近 N 条该 agent 历史输出（trace / output / post / memory source message）

则：

- 最新消息距离 = 0
- 上一条 = 1
- 再上一条 = 2

### 用途

它可以被：

- trigger 逻辑读取
- placement metadata 记录
- debug trace 展示
- token budget 时作为排序因子之一

但不应用作主键、唯一索引或长期稳定标记。

---

## 10. 删除语义

用户明确要求允许**彻底删除**。

因此本设计支持硬删除。

### 10.1 记忆删除操作

```ts
export interface DeleteMemoryBlockInput {
  memory_id: string;
  deleted_by: 'system' | 'agent' | 'model';
  reason?: string | null;
}
```

### 10.2 删除行为

执行彻底删除时，应同时移除：

- `MemoryBlock`
- `MemoryBehavior`
- `MemoryRuntimeState`
- 相关索引记录

### 10.3 trace 要求

虽然底层允许彻底删，但建议保留**最小审计事件**：

```ts
{
  operation: 'memory_deleted',
  memory_id,
  actor_id,
  deleted_by,
  tick
}
```

这不是保留记忆内容，而是保留系统操作证据。

---

## 11. 权限模型

## 11.1 读取最近 trace / intent / event 的权限边界

触发器允许读取最近 `trace / intent / event`，但必须受以下限制：

1. 世界包开发者只能声明“需要哪些来源”
2. 实际评估上下文由系统裁剪
3. 未授权来源不得进入触发评估

### 11.2 新增建议权限维度

建议扩展 memory 级能力：

- `memory.read_block`
- `memory.create_block`
- `memory.rewrite_block`
- `memory.delete_block`
- `memory.read_recent_trace`
- `memory.read_recent_intent`
- `memory.read_recent_event`

### 11.3 系统默认策略

对当前阶段的最小策略建议：

- 同一 agent 自有记忆默认可读
- 同一 agent 的最近 trace / intent / event 默认可作为 trigger 输入
- 跨 agent / 跨 identity 数据需显式授权

这与用户“整个世界消息流应交给世界包开发者安排权限获取”的要求一致。

---

## 12. 与现有架构的集成方式

## 12.1 不建议替换 Context Module，建议作为新 source adapter 接入

推荐新增：

- `memory/blocks/types.ts`
- `memory/blocks/store.ts`
- `memory/blocks/runtime_state.ts`
- `memory/blocks/trigger_engine.ts`
- `memory/blocks/materializer.ts`
- `context/sources/memory_blocks.ts`

### 12.2 新链路

```text
LongTermMemoryStore
  -> candidate memory blocks
  -> trigger engine
  -> runtime state update
  -> materialize to ContextNode
  -> Context Policy Engine
  -> Orchestrator
  -> PromptFragment
```

## 12.3 推荐集成点

### A. `memory/service.ts`

当前它直接：

- build short term
- query long term
- noop summarize

建议扩展为：

- 短期材料读取
- 长记忆候选块读取
- 激活评估
- materialize 为 memory long-term nodes

### B. `context/source_registry.ts`

新增一个 adapter：

- `memory-block-runtime`

让长记忆不只是 `MemoryEntry[]`，而是正式 `ContextNode[]` 来源之一。

### C. `inference/processors/memory_injector.ts`

不要继续承担“记忆规则求值”的职责。

它的职责应收敛为：

- 把已经被激活的 memory node 转 fragment
- 携带排序/触发 metadata

### D. `context/workflow/orchestrator.ts`

排序逻辑需增强：

- 不只按 `slot + priority`
- 应支持 memory placement metadata

### E. `inference/sinks/prisma.ts`

建议扩展 trace snapshot 字段：

- `memory_block_evaluations`
- `memory_blocks_triggered`
- `memory_blocks_delayed`
- `memory_blocks_cooled_down`
- `memory_blocks_inserted`
- `memory_blocks_deleted`

---

## 13. 推荐新增类型草案

### 13.1 存储接口

```ts
export interface LongMemoryBlockStore {
  listCandidateBlocks(input: {
    owner_agent_id: string;
    pack_id?: string | null;
    limit: number;
  }): Promise<Array<{ block: MemoryBlock; behavior: MemoryBehavior; state: MemoryRuntimeState | null }>>;

  upsertBlock(input: {
    block: MemoryBlock;
    behavior: MemoryBehavior;
  }): Promise<void>;

  updateRuntimeState(state: MemoryRuntimeState): Promise<void>;

  hardDeleteBlock(memory_id: string): Promise<void>;
}
```

### 13.2 评估结果

```ts
export interface MemoryActivationEvaluation {
  memory_id: string;
  status: 'inactive' | 'delayed' | 'active' | 'retained' | 'cooling';
  activation_score: number;
  matched_triggers: string[];
  reason: string | null;
  recent_distance_from_latest_message: number | null;
}
```

### 13.3 Prompt materialization 元数据

```ts
export interface MemoryPromptMetadata {
  memory_id: string;
  memory_kind: string;
  activation_score: number;
  anchor: MemoryPlacementAnchor | null;
  depth: number;
  order: number;
  recent_distance_from_latest_message: number | null;
  triggered_by: string[];
}
```

---

## 14. Trace / Debug 设计

每轮应至少记录：

1. 候选记忆块 ids
2. 每条记忆块的评估结果：
   - active / delayed / cooling / retained / inactive
3. 命中的 trigger 类型与得分
4. 本轮插入到哪个 slot
5. 使用了哪个 anchor / depth / order
6. 哪些块因权限不足无法评估
7. 哪些块因 token budget 被裁剪
8. 哪些块被彻底删除

建议 snapshot 结构：

```ts
context_run.diagnostics.memory_blocks = {
  evaluated: [...],
  inserted: [...],
  delayed: [...],
  cooling: [...],
  retained: [...],
  deleted: [...],
  permission_filtered: [...]
}
```

---

## 15. MVP 范围建议

为了控制复杂度，建议第一阶段只做：

### Phase 1

1. `MemoryBlock + MemoryBehavior + MemoryRuntimeState` 最小持久结构
2. 默认 `always + trigger_rate=1`
3. `keyword` trigger
4. `logic` trigger
5. `slot + depth + order`
6. `retain / cooldown / delay`
7. 同一 agent 历史输出的 `recent_distance_from_latest_message`
8. 可读取最近 `trace / intent / event`，但受权限限制
9. 硬删除接口
10. trace/debug 字段

### Phase 2

再补：

- 自动 rewrite
- 自动 summarize into new block
- 复杂 anchor 操作
- 语义匹配 / embedding 检索
- richer memory relation graph

---

## 16. 示例

### 16.1 默认永远触发的反思记忆

```json
{
  "block": {
    "id": "mem-reflection-001",
    "owner_agent_id": "agent-001",
    "pack_id": "world-death-note",
    "kind": "reflection",
    "status": "active",
    "title": "关于L的持续怀疑",
    "content_text": "L 的行动模式说明他已开始沿异常死亡模式反向推理我。",
    "content_structured": null,
    "tags": ["investigation", "risk"],
    "keywords": ["L", "调查", "异常死亡"],
    "source_ref": null,
    "importance": 0.9,
    "salience": 0.8,
    "confidence": 0.82,
    "created_at_tick": "100",
    "updated_at_tick": "100"
  },
  "behavior": {
    "mutation": {
      "allow_insert": true,
      "allow_rewrite": true,
      "allow_delete": true
    },
    "placement": {
      "slot": "memory_long_term",
      "anchor": null,
      "mode": "append",
      "depth": 20,
      "order": 1
    },
    "activation": {
      "mode": "always",
      "trigger_rate": 1,
      "min_score": 0,
      "triggers": []
    },
    "retention": {
      "retain_rounds_after_trigger": 0,
      "cooldown_rounds_after_insert": 0,
      "delay_rounds_before_insert": 0
    }
  }
}
```

### 16.2 只有调查升温时才触发的 dossier 记忆

```json
{
  "activation": {
    "mode": "logic",
    "trigger_rate": 1,
    "min_score": 1,
    "triggers": [
      {
        "type": "logic",
        "expr": {
          "op": "and",
          "items": [
            { "op": "gt", "path": "pack_state.world_state.investigation_heat", "value": 1 },
            { "op": "eq", "path": "pack_state.actor_state.murderous_intent", "value": true }
          ]
        },
        "score": 1
      }
    ]
  }
}
```

### 16.3 基于最近事件触发

```json
{
  "activation": {
    "mode": "hybrid",
    "trigger_rate": 1,
    "min_score": 1,
    "triggers": [
      {
        "type": "recent_source",
        "source": "event",
        "match": {
          "field": "semantic_type",
          "op": "eq",
          "value": "suspicious_death_occurred"
        },
        "score": 1
      }
    ]
  }
}
```

---

## 17. 风险与约束

### 风险 1：字段全塞进 metadata

必须避免所有 placement/trigger/retention 逻辑长期滞留在 `metadata`，否则系统会退化为弱类型配置堆。

### 风险 2：过早引入概率性触发

虽然支持 `trigger_rate`，但 MVP 不应依赖随机行为作为主要机制，否则调试与回放会变复杂。

### 风险 3：把最近来源读取权限做成隐式默认开放

必须显式通过 policy / access control 决定是否能把最近 `trace / intent / event` 暴露给记忆触发器。

### 风险 4：让 memory_injector 承担过多职责

触发判断、延迟、冷却不应写在 processor 里，而应在 Memory 子系统或 Context source 层完成。

---

## 18. 最终建议

本设计建议把长记忆正式提升为：

> **Memory Block Runtime 子系统**

并通过以下方式与当前 Yidhras 主线集成：

```text
Long Memory Store
  -> Trigger Engine
  -> Runtime State
  -> Context Source Adapter
  -> ContextNode
  -> Context Policy Engine
  -> Prompt Orchestrator
  -> PromptFragment
  -> Final Prompt
```

它既满足：

- 记忆作为块与节点的正式治理
- 世界包开发者可调整触发策略
- 同一 agent 历史输出距离语义
- 受权限限制的 recent trace/intent/event 读取
- 彻底删除语义
- 与现有 Context Module / Orchestrator 架构兼容

又不会破坏当前项目已经建立的中间层结构。

---

## 19. 下一步建议

若进入下一阶段，建议继续产出一份 implementation-facing 设计补充，明确：

1. Prisma / storage schema 草案
2. `memory/types.ts` 的升级方案
3. `context/source_registry.ts` 如何接入 memory block adapter
4. `PromptFragment` 是否扩字段还是先走 metadata
5. trigger engine 的最小执行器实现边界
6. trace snapshot 具体字段落点
