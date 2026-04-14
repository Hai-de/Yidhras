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

## 2. Prompt Workflow Runtime

当前 prompt 处理主线已从“隐式 processor 串联”提升为一个线性的 **Prompt Workflow Runtime**。

当前默认内置 profile 为：

- `agent-decision-default`
- `context-summary-default`
- `memory-compaction-default`

当前 task-aware 入口已支持：

- `buildPromptBundle(context, { task_type })`
- `buildAiTaskPromptBundleFromInferenceContext(...)`
- `buildAiTaskRequestFromInferenceContext(...)`

其中：

- `agent_decision` -> `agent-decision-default`
- `context_summary` -> `context-summary-default`
- `memory_compaction` -> `memory-compaction-default`

当前 inference 主链仍以 `agent_decision` 为主，但 `context_summary / memory_compaction` 已不再只是预留 profile，而是可命中真实 workflow 入口。

当前默认 workflow steps 为：

1. `legacy_memory_projection`
2. `node_working_set_filter`
3. `summary_compaction`

其中不同任务会使用不同 step 组合：

- `agent_decision`
  - `legacy_memory_projection -> node_working_set_filter -> summary_compaction -> token_budget_trim -> placement_resolution -> bundle_finalize`
- `context_summary`
  - `legacy_memory_projection -> node_working_set_filter -> summary_compaction -> fragment_assembly -> bundle_finalize`
- `memory_compaction`
  - `legacy_memory_projection -> node_working_set_filter -> node_grouping -> summary_compaction -> fragment_assembly -> bundle_finalize`

说明：

- 当前 runtime 仍复用既有 `PromptProcessor` 作为第一轮 executor
- 当前 `PromptWorkflowProfile / StepSpec / State / Diagnostics / Registry` 已落地
- 当前阶段仍是线性 runtime，不支持 DAG、循环节点或用户自定义执行图
- `memory_context` 仍存在，但其角色已退为 compatibility surface / bridge
- `PromptBundle` 已携带 workflow metadata：
  - `workflow_task_type`
  - `workflow_profile_id`
  - `workflow_profile_version`
  - `workflow_step_keys`
  - `workflow_section_summary`
  - `workflow_placement_summary`
  - `processing_trace`

### 当前 placement 解析语义

当前 `placement_resolution` 已显式支持：

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

当前 diagnostics 已输出：

- placement summary
- workflow step traces
- selected step keys
- compatibility usage

### 当前 section draft 分层

当前 runtime 已引入：

- `grouped_nodes`
- `PromptSectionDraft`
- `fragment_assembly`
- `section_summary`

### 当前 task-aware 差异

当前 `section_drafts` 与 trimming 已开始按 task type 体现不同策略：

- `agent_decision`
  - 保留较完整的 system / role / world / memory / output contract 结构
  - `section_policy = standard`
  - `task_policy = standard`
- `context_summary`
  - recent evidence / memory summary 更优先
  - `section_policy = minimal`
  - `task_policy = evidence_first`
  - `output_contract` 在最小策略下会被移除
  - 若已存在 `context_snapshot` 或 memory sections，则会进一步压低/移除 `role_context` 与 `world_context`
- `memory_compaction`
  - memory_long_term / memory_summary / memory_short_term 更优先
  - `section_policy = minimal`
  - `task_policy = memory_focused`
  - world / role / output contract 会在最小策略下被移除
  - 若已存在 memory sections，则 `context_snapshot` 也会被移除

当前这些差异主要体现在：

- `buildSectionDraftsFromFragments(...)` 的 task-aware ordering / pruning
- `fragment_assembly` 之后的 `section_summary`
- `token_budget_trim` 的 slot priority 调整

当前 `section_summary` 新增了更适合调试与回归的字段：

- `sections_by_type`
- `section_policies`

同时，draft metadata 中的 `task_policy` 会写入：

- `task_type`
- `section_policy`
- `policy_name`
- `priority`
- `ranking_score`
- `score_components`
- `score_reasons`

同时，`section_summary` 现在还会输出 `section_scores`，把每个 section 的 `policy_name / ranking_score / score_components / score_reasons` 聚合成稳定读面。

当前语义为：

```text
ContextNode / working_set
  -> grouped_nodes
  -> PromptSectionDraft
  -> PromptFragment
  -> PromptBundle
```

### 当前 trimming 读面

当前 `token_budget_trimming` 已不再只输出最小裁剪结果，而会额外记录：

- `task_type`
- `kept_fragment_ids`
- `always_kept_fragment_ids`
- `kept_optional_fragment_ids`
- `slot_priority`
- `optional_fragment_scores`
- `section_budget`
- `trimmed_by_slot`
- `trimmed_sources`
- `section_summary`

其中 `section_budget` 当前已包含：

- `mode`
- `total_budget`
- `allocated_budget`
- `allocations`
- `kept_section_ids`
- `dropped_section_ids`

当前语义是：Prompt Workflow 已开始把 section ranking 接到 budget 分配上，section-level budget 已进入 diagnostics 主线；但它仍属于第一轮预算模型，而不是精确 tokenizer 级预算器或复杂 section rebalance 引擎。

这意味着当前 token budget 阶段已经具备 task-aware / section-aware 的基础解释能力，后续如果继续调优，不必再只能从最终 prompt 反推裁剪原因。

这意味着 prompt 流程不再只有 fragment 一层，而开始具备 node/section/fragment 分层。

### 当前 AI task 联动

当前 workflow metadata 已继续透传到：

- `PromptBundle.metadata`
- AI messages metadata
- `AiTaskRequest.metadata`
- `ModelGatewayRequest.metadata`
- `AiInvocationTrace`

因此 gateway path 现在也具备 workflow 级可观测性，而不只是最终 prompt 文本观测。

当前重点读面包括：

- `workflow_task_type`
- `workflow_profile_id / workflow_profile_version`
- `workflow_step_keys`
- `workflow_section_summary`
- `workflow_placement_summary`
- `processing_trace`

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

Current Death Note semantic loop also includes:

- notebook-side role-aware decision routing
  - `form_judgement_intent -> gather_target_intel -> choose_target -> judge_target`
  - when `countermeasure_pressure` or investigation feedback rises, notebook holder can switch to `raise_false_suspicion`
- investigator-side role-aware decision routing
  - `investigate_death_cluster -> share_case_intel -> request_joint_observation -> publish_case_update`
- finer intel / pressure dimensions in pack state
  - `target_name_confirmed`
  - `target_face_confirmed`
  - `target_schedule_known`
  - `evidence_chain_strength / case_theory_strength / countermeasure_pressure`
- execution feedback events such as `post_execution_pressure_feedback` and `investigation_pressure_escalated`, which feed back into the next round via scheduler follow-up and short-term memory.

## 5. Context trace observability

当前 `InferenceTrace.context_snapshot` 已增强为同时承载：

- `context_run`
- `context_module`
- `context_debug`
- `memory_context`
- `memory_selection`
- `prompt_workflow`
- `prompt_processing_trace`
- `memory_blocks`

并且当前 workflow diagnostics 已可通过：

- `context_run.diagnostics.orchestration.prompt_workflow`
- `PromptBundle.metadata`
- AI gateway request metadata

当前 task-aware workflow 的连续读面已覆盖：

- `PromptBundle.metadata.workflow_task_type / workflow_section_summary / workflow_placement_summary`
- `InferenceTrace.context_snapshot.prompt_workflow`
- `InferenceTrace.context_snapshot.prompt_processing_trace`

进行连续观察。
