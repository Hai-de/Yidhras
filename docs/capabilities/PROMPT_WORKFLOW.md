# Prompt Workflow Runtime

本文档集中说明 Yidhras 的 Prompt Workflow Runtime，承接原先散落在 `docs/ARCH.md`、`docs/LOGIC.md` 与 `docs/API.md` 中的高耦合细节。

## 1. 文档定位

本文件回答：

- Prompt Workflow Runtime 是什么
- 它如何把 `ContextNode` 组织成最终 prompt / request
- task-aware profile、section draft、placement、budget trimming 的语义是什么
- 运行时会产出哪些诊断字段

本文件不负责：

- 公共 HTTP contract 的完整定义：看 `docs/API.md`
- 整个系统模块边界：看 `docs/ARCH.md`
- 世界规则与业务语义主线：看 `docs/LOGIC.md`

## 2. 目标

Prompt Workflow Runtime 的目标，是把原本“隐式 processor 串联”的 prompt 构造路径，收敛为一个更正式、可解释、可观察、可按 task type 切换的运行时。

它不只是简单拼接 prompt 文本，而是负责：

1. 接收 `ContextRun / ContextNode`
2. 按 profile 与 step 选择处理链
3. 组织 grouped nodes / section drafts / fragments
4. 进行 placement 与 token budget trimming
5. 产出最终 `PromptBundle`
6. 将 workflow metadata 透传给 AI task / gateway / trace

## 3. 运行时主线

当前主线可概括为：

```text
ContextRun / ContextNode
  -> PromptWorkflowState
  -> grouped_nodes
  -> PromptSectionDraft
  -> PromptFragment
  -> PromptBundle
  -> AiMessages / ModelGatewayRequest
```

相关实现主要位于：

- `apps/server/src/context/workflow/orchestrator.ts`
- `apps/server/src/context/workflow/runtime.ts`
- `apps/server/src/context/workflow/types.ts`
- `apps/server/src/context/workflow/profiles.ts`
- `apps/server/src/context/workflow/placement_resolution.ts`
- `apps/server/src/context/workflow/section_drafts.ts`
- `apps/server/src/ai/task_prompt_builder.ts`

## 4. Profile 与 task-aware 入口

当前内置 profile：

- `agent-decision-default`
- `context-summary-default`
- `memory-compaction-default`

当前 task-aware 入口：

- `buildPromptBundle(context, { task_type })`
- `buildAiTaskPromptBundleFromInferenceContext(...)`
- `buildAiTaskRequestFromInferenceContext(...)`

当前映射关系：

- `agent_decision` -> `agent-decision-default`
- `context_summary` -> `context-summary-default`
- `memory_compaction` -> `memory-compaction-default`

这意味着 Prompt Workflow 已不再只是 agent decision 专用流水线，而是一个可按任务类型切换 profile 的正式 runtime。

## 5. 默认 workflow steps

当前默认主线以以下步骤为骨架：

1. `legacy_memory_projection`
2. `node_working_set_filter`
3. `summary_compaction`
4. 任务相关的后续步骤（如 `token_budget_trim`、`node_grouping`、`fragment_assembly`、`placement_resolution`、`bundle_finalize`）

不同任务的典型组合：

### 5.1 agent_decision

```text
legacy_memory_projection
-> node_working_set_filter
-> summary_compaction
-> token_budget_trim
-> placement_resolution
-> bundle_finalize
```

### 5.2 context_summary

```text
legacy_memory_projection
-> node_working_set_filter
-> summary_compaction
-> fragment_assembly
-> bundle_finalize
```

### 5.3 memory_compaction

```text
legacy_memory_projection
-> node_working_set_filter
-> node_grouping
-> summary_compaction
-> fragment_assembly
-> bundle_finalize
```

## 6. Section draft 与 task-aware 差异

Prompt Workflow 当前不再只有 fragment 一层，而是显式引入：

- `grouped_nodes`
- `PromptSectionDraft`
- `fragment_assembly`
- `section_summary`

### 6.1 agent_decision

特点：

- 保留较完整的 system / role / world / memory / output contract 结构
- `section_policy = standard`
- `task_policy = standard`

### 6.2 context_summary

特点：

- recent evidence / memory summary 优先
- `section_policy = minimal`
- `task_policy = evidence_first`
- 最小策略下会移除 `output_contract`
- 已存在 `context_snapshot` 或 memory sections 时，会进一步压低 `role_context` 与 `world_context`

### 6.3 memory_compaction

特点：

- memory_long_term / memory_summary / memory_short_term 更优先
- `section_policy = minimal`
- `task_policy = memory_focused`
- 最小策略下会移除 `output_contract / role_context / world_context`
- 已存在 memory sections 时，会进一步移除 `context_snapshot`

## 7. Placement 解析

当前 `placement_resolution` 支持：

- `prepend`
- `append`
- `before_anchor`
- `after_anchor`

当前支持的 anchor：

- `slot_start`
- `slot_end`
- `source`
- `tag`
- `fragment_id`

这使 runtime 不再只能按固定顺序串联 fragments，而能在受控范围内进行 slot / anchor 级排布。

## 8. Budget trimming 与可解释性

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

其中 `section_budget` 当前包含：

- `mode`
- `total_budget`
- `allocated_budget`
- `allocations`
- `kept_section_ids`
- `dropped_section_ids`

语义上，这代表 section ranking 已进入 budget 分配主线；但它仍属于第一轮预算模型，而不是精确 tokenizer 级预算器或复杂 section rebalance 引擎。

## 9. Diagnostics 与观测面

当前 workflow diagnostics 已稳定输出：

- `profile_id / profile_version`
- `task_type`
- `selected_step_keys`
- `step_traces`
- `placement_summary`
- `section_summary`
- `compatibility`

同时，以下读面会携带 workflow 信息：

- `PromptBundle.metadata.workflow_task_type`
- `PromptBundle.metadata.workflow_profile_id`
- `PromptBundle.metadata.workflow_step_keys`
- `PromptBundle.metadata.workflow_section_summary`
- `PromptBundle.metadata.workflow_placement_summary`
- `InferenceTrace.context_snapshot.prompt_workflow`
- `InferenceTrace.context_snapshot.prompt_processing_trace`
- AI gateway request metadata

这保证了 workflow 的可见性不仅停留在 prompt 文本层，也进入了 trace / replay / observability 层。

## 10. 与 Context / Memory 的关系

Prompt Workflow Runtime 上游依赖 `ContextRun / ContextNode`，但它本身不等于 Context Module。

可粗略理解为：

- Context Module 负责“把什么信息放进 working set”
- Prompt Workflow 负责“把 working set 如何组织成 prompt / request”

当前仍保留：

- `memory_context`
- legacy `PromptProcessor`
- legacy trace 字段

但这些已收敛为 compatibility projection / bridge，而不是新的 source-of-truth。

## 11. 当前边界

当前明确成立的边界：

- 这是**线性 runtime**，不是通用 DAG workflow engine
- 不支持用户自定义执行图、循环节点或任意图编排
- `memory_context` 仍保留，但属于 compatibility surface
- 更复杂的 workflow 行为仍应通过受控的 server-side extension 演进

## 12. 相关文档

- 架构边界：`../ARCH.md`
- 业务语义：`../LOGIC.md`
- API 读面：`../API.md`
- 相关设计资产：`.limcode/design/prompt-workflow-formalization-design.md`
