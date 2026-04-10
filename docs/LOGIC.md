# 核心执行逻辑 / Logic

## 1. 推理与执行主线

当前 inference / workflow / world enforcement 主线可概括为：

1. `buildInferenceContext()` 组装 actor / identity / pack_state / policy / memory / context_run
2. inference provider 产出 decision 或 intermediate semantic intent
3. `Intent Grounder` 将开放语义映射为：
   - capability execution
   - translated kernel intent
   - narrativized fallback
4. `ActionIntentDraft` 持久化为 `ActionIntent`
5. `ActionDispatcher` / `InvocationDispatcher` / `EnforcementEngine` 落地客观执行
6. `InferenceTrace.context_snapshot` / workflow / audit / projections 提供可观测证据

## 2. Context Orchestrator Lite

当前 prompt 处理主线已从“隐式 processor 串联”收口为一个线性的 **Context Orchestrator Lite**。

当前编排阶段固定为：

1. `memory_injection`
2. `policy_filter`
3. `summary_compaction`
4. `token_budget_trim`

说明：

- 当前 orchestrator-lite 仍内部复用既有 processors
- 当前真正的 policy 治理已前移到 `ContextService` / `ContextRun` / working-set
- `policy_filter` 当前只保留 compatibility fallback 语义
- 当前阶段顺序仍固定，不支持节点图、分支 DAG 或用户可编排 workflow engine
- `PromptProcessor` 接口仍保留，但其角色已变为 compatibility surface
- `prompt_builder.ts` 当前负责：
  - 基础 fragment seed
  - 调用 orchestrator-lite
  - 最终 prompt assembly

### 当前 fragment 排序语义

当前 `PromptFragment` 已支持扩展 placement 语义：

- `slot`
- `anchor`
- `placement_mode`
- `depth`
- `order`
- `priority`

当前 orchestrator / prompt builder 排序顺序为：

1. slot
2. anchor key
3. depth
4. order
5. priority
6. fragment id

这使 memory block 不再只能依赖 priority，而能以更稳定的方式影响 prompt 相对位置。

## 3. Memory Block Runtime

当前 Memory Block 已形成最小运行时闭环：

1. `MemoryBlock` 持久化在 kernel Prisma
2. `LongMemoryBlockStore` 读取候选块
3. `evaluation_context` 组装：
   - 当前 actor
   - pack state
   - recent trace / intent / event（经权限裁剪）
4. `trigger_engine` 评估：
   - `always`
   - `keyword`
   - `logic`
   - `recent_source`
5. runtime state 更新：
   - trigger count
   - active
   - retain/cooldown/delay
   - `recent_distance_from_latest_message`
6. active / retained block materialize 为 `ContextNode`
7. `memory_injector` 将其映射为 prompt fragments

### 当前逻辑 DSL

已支持：

- `and`
- `or`
- `not`
- `eq`
- `in`
- `gt`
- `lt`
- `contains`
- `exists`

### 当前 recent-source 读取边界

- 默认按**同一 agent 的历史输出**筛 recent traces/intents/events
- recent source 进入 trigger 前必须经过 field-level access policy 裁剪
- 当前 memory resource action：
  - `read_recent_trace`
  - `read_recent_intent`
  - `read_recent_event`

### 当前 memory block diagnostics

`ContextRun.diagnostics.memory_blocks` 已输出：

- `evaluated`
- `inserted`
- `delayed`
- `cooling`
- `retained`
- `inactive`

这些字段也已进入 `InferenceTrace.context_snapshot`。

## 4. Projection / Visibility

当前 pack runtime projection 已覆盖：

- entity overview projection
- pack narrative timeline projection

可读取的主要证据包括：

- entities
- entity states
- authority grants
- mediator bindings
- rule execution records
- event timeline

当前 kernel projection 已覆盖：

- operator overview projection
- global projection index extraction

### API-level projection surface

当前读接口已经出现 canonical pack/entity endpoint：

- `/api/packs/:packId/overview`
- `/api/packs/:packId/projections/timeline`
- `/api/entities/:id/overview`

当前阶段可归纳为：

- canonical pack/entity projection surface 已形成
- `/api/narrative/timeline` 已退出代码库
- `/api/agent/:id/overview` 已退出代码库

Current Death Note visibility guarantee:

- narrativized failure is visible in workflow/audit evidence
- related `history` events are visible in pack timeline
- entity overview / agent overview can observe those events through existing read-model surfaces
- follow-up actors can be scheduled from emitted event metadata

## 5. Context trace observability

当前 `InferenceTrace.context_snapshot` 已增强为同时承载：

- `context_run`
- `context_module`
- `context_debug`
- `memory_context`
- `memory_selection`
- `prompt_processing_trace`
- `memory_blocks`

并且 agent overview / workflow snapshots 已能读取最近 trace 中的 memory block diagnostics。
