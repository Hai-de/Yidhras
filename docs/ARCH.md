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
3. `buildPromptBundle()` 调用 Prompt Workflow Runtime 完成 fragment / section / placement 编排
4. provider 输出 normalized decision / semantic intent
5. `Intent Grounder` 将开放语义映射为 capability、kernel action 或 narrativized fallback
6. `InferenceTrace / ActionIntent / DecisionJob` 写入 kernel Prisma

### Death Note pack 语义闭环

当前 `world-death-note` 已不再只是“拿到笔记 / 形成杀意”的静态样板，而是具备最小可重复语义循环：

- notebook side：
  - `claim_notebook`
  - `understand_notebook_power`
  - `form_judgement_intent`
  - `gather_target_intel`
  - `choose_target`
  - `judge_target`
  - 在案件压力升高时切换到 `raise_false_suspicion`
- investigator side：
  - `investigate_death_cluster`
  - `share_case_intel`
  - `request_joint_observation`
  - `publish_case_update`
- execution 后会通过 objective events 发出 `post_execution_pressure_feedback / investigation_pressure_escalated / case_update_published`，再由 scheduler follow-up 驱动下一轮 actor 再思考。

## Context Module

当前 inference runtime 包含 Context Module。相关代码位于：

- `apps/server/src/context/types.ts`
- `apps/server/src/context/service.ts`
- `apps/server/src/context/source_registry.ts`
- `apps/server/src/context/workflow/orchestrator.ts`
- `apps/server/src/context/workflow/runtime.ts`
- `apps/server/src/context/workflow/types.ts`
- `apps/server/src/context/workflow/profiles.ts`
- `apps/server/src/context/workflow/placement_resolution.ts`
- `apps/server/src/context/workflow/section_drafts.ts`

当前职责：

- 从 legacy memory selection 与 runtime state snapshots 收集统一 `ContextNode`
- materialize `ContextRun`
- 为既有 prompt 消费方暴露兼容 `memory_context`
- 将 context selection / orchestration evidence 持久化到 `InferenceTrace.context_snapshot`

### policy / overlay / memory block 相关实现

- node-level policy governance 由 `ContextService` 与 `Context Policy Engine` 处理
- fragment-level `policy_filter` 仅保留为 runtime 内的兼容/兜底机制
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
  - 再经 Prompt Workflow Runtime 进入 `PromptFragment`
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

### Prompt Workflow Runtime

当前 Prompt Workflow 已不再只是固定 processor 数组，而是具备正式 runtime 外壳。

当前已落地的核心组件包括：

- `PromptWorkflowProfile`
- `PromptWorkflowStepSpec`
- `PromptWorkflowState`
- `PromptWorkflowDiagnostics`
- step registry / executors
- placement resolution
- section drafts

当前内置 profiles：

- `agent-decision-default`
- `context-summary-default`
- `memory-compaction-default`

当前 runtime 已具备 task-aware 入口：

- `buildPromptBundle(context, { task_type })`
- `buildAiTaskPromptBundleFromInferenceContext(...)`
- `buildAiTaskRequestFromInferenceContext(...)`

其中：

- `agent_decision` 仍对应当前 inference 主链默认 profile
- `context_summary` 会命中 `context-summary-default`
- `memory_compaction` 会命中 `memory-compaction-default`

这意味着 Prompt Workflow 已不再只是“agent decision 专用 prompt pipeline”，而是一个可按 task type 切换 profile 的正式 runtime。

### 当前 runtime 分层

当前主线已演进为：

```text
ContextRun / ContextNode
  -> PromptWorkflowState
  -> grouped_nodes
  -> PromptSectionDraft
  -> PromptFragment
  -> PromptBundle
  -> AiMessages / ModelGatewayRequest
```

当前已稳定落地的 runtime 行为：

- profile-driven step 选择
- `placement_resolution`
- `node_grouping`
- `fragment_assembly`
- workflow metadata 透传

### task-aware section-driven 差异

当前 runtime 已开始在 `section_drafts` 与 trimming 层体现任务差异：

- `agent_decision`
  - 保持较完整的 system / role / world / memory / output contract 结构
  - 对应 `standard` task policy
- `context_summary`
  - 倾向 recent evidence / memory summary 优先
  - 对应 `evidence_first` task policy
  - `minimal` section policy 下会移除 `output_contract`
  - 当已经存在 `context_snapshot` 或 memory sections 时，会进一步压低/移除 `role_context` 与 `world_context`
- `memory_compaction`
  - 倾向 memory_long_term / memory_summary / memory_short_term 优先
  - 对应 `memory_focused` task policy
  - `minimal` section policy 下会移除 `output_contract / role_context / world_context`
  - 当已经存在 memory sections 时，会进一步移除 `context_snapshot`

当前这些差异主要落在：

- `buildSectionDraftsFromFragments(...)` 的 task-aware ordering / pruning
- `token_budget_trim` 的 task-aware slot priority
- `section_summary` diagnostics 中的 `task_type / section_policy / grouped_node_keys / sections_by_type / section_policies`

同时，当前 `PromptSectionDraft.metadata.task_policy` 已会记录：

- `task_type`
- `section_policy`
- `policy_name`
- `priority`
- `ranking_score`
- `score_components`
- `score_reasons`

并且 `section_summary.section_scores` 已会把这些 ranking 结果聚合为稳定读面，便于 persisted trace / replay / smoke e2e 直接读取。

这样后续 trace / bundle metadata 不仅能看到“结果是什么”，也能看到“为何采用该 section 策略”。

### placement / diagnostics

当前 placement 已支持：

- `prepend`
- `append`
- `before_anchor`
- `after_anchor`

以及 anchor：

- `slot_start`
- `slot_end`
- `source`
- `tag`
- `fragment_id`

当前 workflow diagnostics 已稳定输出：

- `profile_id / profile_version`
- `task_type`
- `selected_step_keys`
- `step_traces`
- `placement_summary`
- `section_summary`
- `compatibility`

其中 `token_budget_trimming` 现已扩展为更可解释的读面，除 `budget / used / trimmed_fragment_ids` 外，还包括：

- `task_type`
- `kept_fragment_ids`
- `always_kept_fragment_ids`
- `kept_optional_fragment_ids`
- `slot_priority`
- `optional_fragment_scores`
- `trimmed_by_slot`
- `trimmed_sources`
- `section_summary`

同时，当前 `token_budget_trimming` 已开始暴露 `section_budget`：

- `mode`
- `total_budget`
- `allocated_budget`
- `allocations`
- `kept_section_ids`
- `dropped_section_ids`

当前这一层表示 **section-level token budget 的第一轮接线**：

- runtime 已能基于 `section_scores` 生成 section budget allocation
- trimming 已会把 section keep/drop 结果写回 diagnostics
- 但它仍不是精确 tokenizer 级预算器，也还不是最终复杂的多轮 section rebalancer

当前以下读面都已暴露 task-aware workflow 信息：

- `PromptBundle.metadata.workflow_task_type / workflow_profile_id / workflow_step_keys`
- `PromptBundle.metadata.workflow_section_summary / workflow_placement_summary`
- `InferenceTrace.context_snapshot.prompt_workflow`
- `InferenceTrace.context_snapshot.prompt_processing_trace`

其中 `PromptProcessingTrace` 现已包含结构化 `prompt_workflow` 快照，优先作为 runtime → trace → bundle / snapshot 的统一工作流读面，而不是继续主要依赖 legacy trace 字段回推。

### Compatibility 边界

当前仍保留：

- `memory_context`
- legacy `PromptProcessor`
- legacy prompt trace 字段

但它们当前的角色已收敛为：

- compatibility projection
- fallback execution bridge
- trace bridge

而不是新的 source-of-truth。

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
- Prompt Workflow Runtime 已统一处理：
  - slot order
  - placement anchor
  - depth / order
  - fallback reason

### 边界

- 当前实现仍为线性 runtime，不是通用 DAG workflow engine
- overlay 不绕过 source-of-truth，也不替代 pack runtime state
- `ContextDirective` 目前仅保留 schema / trace reservation，执行仍关闭
- 当前 Memory Block 仍未引入 embedding / semantic retrieval / graph memory
- `memory_context` 仍保留，但已明确属于 compatibility projection

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
- 当前 workflow metadata 也会进入：
  - AI messages metadata
  - `AiTaskRequest.metadata`
  - `ModelGatewayRequest.metadata`
- `AiInvocationTrace`
- world pack 不能直接写 raw provider payload
- world pack 不能注入任意可执行 parser/composer 代码
- 更复杂的行为应通过 server-side registered extension 实现

当前 AI task / gateway 观测面已可直接看到：

- `workflow_task_type`
- `workflow_profile_id / workflow_profile_version`
- `workflow_step_keys`
- `workflow_section_summary`
- `workflow_placement_summary`
- `processing_trace`

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

Operator 高级视图（Authority Inspector / Rule Execution Timeline / Perception Diff）的前端页面、交互、布局、状态管理与可视化属于前端实现范围；后端仅负责相应 evidence / contract / projection 能力。
