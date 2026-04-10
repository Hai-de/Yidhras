# 系统架构 / System Architecture

## Kernel persistence boundaries

内核持久化当前分为两类：

- **kernel-side Prisma / SQLite**
  - `Agent`
  - `Post`
  - `Event`
  - `InferenceTrace`
  - `ActionIntent`
  - `DecisionJob`
  - `ContextOverlayEntry`
  - `MemoryBlock / MemoryBlockBehavior / MemoryBlockRuntimeState / MemoryBlockDeletionAudit`
- **pack-local runtime SQLite**
  - pack world entities
  - pack entity states
  - authority grants
  - mediator bindings
  - rule execution records

## Inference / Workflow 主线

当前主线为：

1. `buildInferenceContext()` 组装运行时上下文
2. `ContextService.buildContextRun()` 收口 context node / policy / diagnostics
3. `buildPromptBundle()` 调用 Context Orchestrator Lite 完成 fragment 编排
4. provider 输出 normalized decision / semantic intent
5. `Intent Grounder` 将开放语义映射为 capability、kernel action 或 narrativized fallback
6. `InferenceTrace / ActionIntent / DecisionJob` 写入 kernel Prisma

## Context Module

当前 inference runtime 包含 Context Module。相关代码位于：

- `apps/server/src/context/types.ts`
- `apps/server/src/context/service.ts`
- `apps/server/src/context/source_registry.ts`
- `apps/server/src/context/workflow/orchestrator.ts`

当前职责：

- 从 legacy memory selection 与 runtime state snapshots 收集统一 `ContextNode`
- materialize `ContextRun`
- 为既有 prompt 消费方暴露兼容 `memory_context`
- 将 context selection / orchestration evidence 持久化到 `InferenceTrace.context_snapshot`

### policy / overlay / memory block 相关实现

- node-level policy governance 由 `ContextService` 与 `Context Policy Engine` 处理
- fragment-level `policy_filter` 仅保留为 orchestrator-lite 内的兼容/兜底机制
- overlay 作为 kernel-side working-layer object 存在：
  - `apps/server/src/context/overlay/types.ts`
  - `apps/server/src/context/overlay/store.ts`
  - `apps/server/src/context/sources/overlay.ts`
- `ContextOverlayEntry` 持久化在 kernel Prisma 中，再 re-materialize 为 `ContextNode(source_kind='overlay', visibility.level='writable_overlay')`
- overlay 不作为 pack runtime source-of-truth
- Memory Block Runtime 也作为 kernel-side memory subsystem 存在：
  - `apps/server/src/memory/blocks/types.ts`
  - `apps/server/src/memory/blocks/store.ts`
  - `apps/server/src/memory/blocks/trigger_engine.ts`
  - `apps/server/src/memory/blocks/evaluation_context.ts`
  - `apps/server/src/memory/blocks/materializer.ts`
  - `apps/server/src/context/sources/memory_blocks.ts`
- `MemoryBlock` 通过：
  - store 读取候选块
  - trigger engine 评估 active/delayed/retained/cooling/inactive
  - runtime state 更新
  - materialize 为 `ContextNode`
  - 再经 orchestrator 进入 `PromptFragment`
- `recent trace / intent / event` 仅在权限裁剪后进入 memory block evaluation context
- 当前 diagnostics 已输出：
  - `policy_decisions`
  - `blocked_nodes`
  - `locked_nodes`
  - `visibility_denials`
  - `overlay_nodes_loaded`
  - `overlay_nodes_mutated`
  - `memory_blocks`
  - reserved directive arrays

### Long memory / prompt workflow

当前 long memory 不再只是 noop 约定：

- kernel Prisma 已持久化：
  - `MemoryBlock`
  - `MemoryBlockBehavior`
  - `MemoryBlockRuntimeState`
  - `MemoryBlockDeletionAudit`
- compatibility 层 `LongTermMemoryStore` 仍保留，但 Prisma 实现已从 `MemoryBlock` 映射回 `MemoryEntry`
- `PromptFragment` 当前已可携带：
  - `anchor`
  - `placement_mode`
  - `depth`
  - `order`
- Context Orchestrator Lite 的排序现已支持：
  - slot
  - anchor key
  - depth
  - order
  - priority

### 边界

- `memory_context` 仍保留，但属于 compatibility projection
- 当前实现为线性流程，不是通用 DAG workflow engine
- overlay 不绕过 source-of-truth，也不替代 pack runtime state
- `ContextDirective` 目前仅保留 schema / trace reservation，执行仍关闭
- 当前 Memory Block 仍未引入 embedding / semantic retrieval / graph memory

## Unified AI task / gateway

服务端已形成内部 AI 执行层：

- `apps/server/src/ai/task_service.ts`
- `apps/server/src/ai/route_resolver.ts`
- `apps/server/src/ai/gateway.ts`
- `apps/server/src/ai/providers/mock.ts`
- `apps/server/src/ai/providers/openai.ts`

当前分层：

- `AiTaskService`
- `RouteResolver`
- `ModelGateway`
- provider adapters

当前约束：

- kernel-side canonical AI contract 由服务端内部类型维护
- world pack 只能通过声明式 `pack.ai` 覆盖：
  - prompt organization
  - output schema
  - parse/decoder behavior
  - route hints
- world pack 不能直接写 raw provider payload
- world pack 不能注入任意可执行 parser/composer 代码
- 更复杂的行为应通过 server-side registered extension 实现

当前默认 registry 提供 OpenAI provider / model / route，`ModelGateway` 默认注册 `mock` 与 `openai` adapters。缺少 `OPENAI_API_KEY` 时不会影响 `mock / rule_based` 主线启动。

## AI invocation observability

kernel-side Prisma 包含 `AiInvocationRecord`，记录：

- provider / model / route
- fallback / attempted models
- usage / safety / latency
- request / response audit payload（按 audit level 控制）
- 与 `InferenceTrace.source_inference_id` 的关联

## Projection 层

当前后端已具备：

- entity overview projection
- pack narrative timeline projection
- operator overview projection
- global projection index

### Pack Projection Contract

在当前单 active-pack 运行模式下：

- `/api/packs/:packId/overview`
- `/api/packs/:packId/projections/timeline`

都要求：

- 请求的 `packId` 必须与当前 active pack 一致
- 若不一致，返回 `409 / PACK_ROUTE_ACTIVE_PACK_MISMATCH`

语义 grounding 的可见性目前通过以下读面暴露：

- workflow / audit metadata 中的 `semantic_intent` 与 `intent_grounding`
- narrativized fallback 产生的 `history` event 在 pack timeline 中可见
- entity / agent overview 可见聚合后的相关证据

### Access-Policy Subsystem Contract

- `/api/access-policy/*`
  - access / projection policy 的独立子系统接口
  - 不属于 unified governance canonical API
  - 负责 projection access / write policy 的显式管理与评估

### Operator 高级视图后端合同

后端已具备 Authority Inspector / Rule Execution Timeline / Perception Diff 所需的基础证据面：

- `authority_context`
- `perception_context`
- `mediator_bindings`
- `recent_rule_executions`
- pack narrative timeline 中的 `rule_execution` / `event` bridge 数据

scheduler / event 协作路径会消费以下 event bridge metadata：

- `followup_actor_ids`
- `impact_data.semantic_intent.target_ref` 中的语义目标提示

AI 调用观测的只读接口为：

- `GET /api/inference/ai-invocations`
- `GET /api/inference/ai-invocations/:id`

这些接口将 `AiInvocationRecord` 暴露为只读观测面，不改变公开 inference 执行契约。

另有：

- `apps/server/src/app/services/operator_contracts.ts`

用于整理前端 handoff 所依赖的后端合同。

### Context Orchestrator Lite backend

当前 prompt pipeline 通过线性的 Context Orchestrator Lite 执行。固定阶段为：

1. `memory_injection`
2. `policy_filter`
3. `summary_compaction`
4. `token_budget_trim`

当前含义：

- legacy `PromptProcessor` 实现仍然存在
- 编排顺序不再只隐含在 prompt builder 内
- prompt assembly 在显式 context orchestration 之后执行
- node-level working-set policy 会先于 fragment pipeline 决定
- `policy_filter` 不再是主要 policy authority

当前不在范围内：

- general DAG prompt workflow engine
- front-end node editor / visual workflow canvas
- plugin execution runtime
- model-driven directive execution
- direct model-side overlay writing

Operator 高级视图（Authority Inspector / Rule Execution Timeline / Perception Diff）的前端页面、交互、布局、状态管理与可视化属于前端实现范围；后端仅负责相应 evidence / contract / projection 能力。
