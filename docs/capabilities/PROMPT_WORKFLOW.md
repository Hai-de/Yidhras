# Prompt Workflow Runtime

Prompts don't write themselves. When the system needs to ask an AI model something — whether it's deciding what an actor does next, summarising recent events, or condensing long-term memory — it must assemble a structured prompt from many moving parts: world state, actor identity, recent events, output format requirements. The Prompt Workflow Runtime is the engine that turns those raw inputs into a final, complete prompt ready for the AI provider.

Before this runtime existed, prompt construction was implicit: code scattered across modules silently concatenated strings with no clear pipeline, no task-specific profiles, and no observability when things went wrong. The runtime replaced that with a **linear, task-aware pipeline** — each step is named, traceable, and switchable by task type. It is deliberately not a general DAG engine; it trades flexibility for predictability and debuggability.

Key concepts:

- **PromptBundle** — the final output: a complete set of messages plus metadata, ready to send to the AI provider
- **PromptSectionDraft** — an intermediate grouping: related context nodes bundled under a section label (e.g. "world_context", "memory_summary") before final assembly
- **PromptFragment** — a discrete content unit within a section, carrying its own placement hint and priority
- **ContextNode / ContextRun** — the upstream data that feeds the workflow: individual pieces of context (an actor's state, a world event, a memory block) organised by the context module

本文档集中说明 Prompt Workflow Runtime 的结构、语义与边界，承接原先散落在 `docs/ARCH.md`、`docs/LOGIC.md` 与 `docs/API.md` 中的高耦合细节。

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
- Rust world engine objective execution 细节：看 `docs/ARCH.md` 与 `.limcode/archive/plans/rust-world-engine-phase1-a-completion-sequencing-and-validation.plan.md`

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


## 7. 变量上下文与宏系统

Prompt Workflow Runtime 现在不再只依赖单一 `visible_variables` 平铺对象，而是正式引入：

- `PromptVariableContext`
- `PromptVariableLayer`
- `variable_context_summary`
- `workflow_variable_summary`
- `workflow_macro_summary`

### 7.1 正式变量命名空间

当前运行时正式支持以下命名空间：

- `system.*`
- `app.*`
- `pack.*`
- `runtime.*`
- `actor.*`
- `request.*`
- `plugin.<pluginId>.*`

推荐新模板优先使用带 namespace 的写法，例如：

```txt
{{ pack.metadata.name }}
{{ actor.display_name }}
{{ runtime.current_tick }}
{{ request.strategy }}
```

### 7.2 alias fallback 的兼容定位

当前仍保留未带 namespace 的兼容写法，例如：

```txt
{{ actor_name }}
{{ world_name }}
```

但这些已被降级为 compatibility alias surface，而不是 source-of-truth。

当前 alias fallback 顺序为：

```text
request > actor > runtime > pack > app > system
```

说明：

- 命中带 namespace 的路径时，不会再走 alias fallback
- `plugin.*` 不参与默认 alias fallback
- 新模板和新文档不再推荐继续扩写裸 key

### 7.3 当前支持的受控宏语法

#### 基础插值

```txt
{{ actor.display_name }}
{{ pack.metadata.name }}
```

#### 默认值

```txt
{{ actor.profile.title | default("unknown") }}
```

适用场景：

- 可选字段不存在
- 字段可能为 `null`
- 字段为空字符串时希望提供保底文案

#### 条件块

```txt
{{#if actor.has_bound_artifact}}
当前主体持有关键媒介。
{{/if}}
```

适用场景：

- 根据主体状态决定是否插入某段 prompt
- 根据 pack/runtime 条件控制说明段落

#### 列表展开

```txt
{{#each runtime.owned_artifacts as artifact}}
- {{ artifact.id }}
{{/each}}
```

适用场景：

- 展开 artifact / evidence / candidate 列表
- 按行生成上下文摘要

### 7.4 当前不支持的能力

本阶段有意不支持：

- 任意 JS 表达式
- `eval` / script execution
- 用户自定义函数执行
- 通用模板平台化扩展

Prompt Workflow 在这里的目标是“受控模板运行时”，不是“任意脚本模板引擎”。

### 7.5 使用建议

对于 Prompt Workflow profile、world prompts、perception templates，推荐按以下方式书写：

1. **优先带 namespace**
2. **缺省值用 `default(...)`，不要依赖缺失占位符**
3. **条件内容放进 `#if` block，而不是外层拼接字符串**
4. **列表内容用 `#each` block，而不是预先拼接大字符串**
5. **不要让 pack 模板依赖 plugin 变量的隐式注入**

错误示例：

```txt
{{ pack.metadata.name }}
{{ actor_name }}
```

更推荐：

```txt
{{ pack.metadata.name }}
{{ actor.display_name }}
```

## 8. Placement 解析

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

## 9. Budget trimming 与可解释性

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

## 10. Diagnostics 与观测面

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

### 10.1 变量与宏诊断字段

除了 profile / placement / section 诊断之外，当前还会输出变量与宏相关摘要，例如：

- `PromptBundle.metadata.workflow_variable_summary`
- `PromptBundle.metadata.workflow_macro_summary`
- `PromptProcessingTrace.prompt_workflow.variable_summary`
- `PromptProcessingTrace.prompt_workflow.macro_summary`
- `context_run.diagnostics.orchestration.variable_resolution`

这些字段主要用于回答：

- 本次 prompt 渲染用了哪些 namespace
- 是否发生 alias fallback
- 哪些路径缺失
- 哪些 block 执行了 / 没执行
- 模板输出长度大致如何变化

### 10.2 使用者如何排查模板问题

当模板没有按预期展开时，建议按下面顺序排查：

1. 先看 `workflow_variable_summary.namespaces`
   - 确认目标 namespace 是否真的进入本次上下文
2. 再看 `workflow_macro_summary.traces`
   - 确认路径是 namespaced 命中，还是 alias fallback 命中
3. 再看 `workflow_macro_summary.missing_paths`
   - 确认是不是字段名写错，或当前上下文里不存在该字段
4. 若使用 `#if` / `#each`
   - 看 `workflow_macro_summary.blocks`
   - 确认 block 是否执行、迭代次数是否为 0
5. 若仍异常
   - 检查模板是否仍在使用旧裸 key，建议改成 namespaced 写法

## 11. 与 Context / Memory 的关系

Prompt Workflow Runtime 上游依赖 `ContextRun / ContextNode`，但它本身不等于 Context Module。

可粗略理解为：

- Context Module 负责“把什么信息放进 working set”
- Prompt Workflow 负责“把 working set 如何组织成 prompt / request”

当前仍保留：

- `memory_context`
- legacy `PromptProcessor`
- legacy trace 字段

但这些已收敛为 compatibility projection / bridge，而不是新的 source-of-truth。

## 12. 当前边界

当前明确成立的边界：

- 这是**线性 runtime**，不是通用 DAG workflow engine
- 不支持用户自定义执行图、循环节点或任意图编排
- `memory_context` 仍保留，但属于 compatibility surface
- 更复杂的 workflow 行为仍应通过受控的 server-side extension 演进
- workflow / prompt orchestration 不是 Rust world engine Phase 1 的迁移目标
- 即使 `objective_enforcement` 已迁入 Rust sidecar，且 Phase 1B 已完成 Host snapshot hydrate、Rust session/query 与 prepare/commit/abort 闭环，Prompt Workflow 仍保持以下宿主边界：
  - workflow state / persistence 留在 Node/TS host
  - workflow 读取世界态时应继续通过 host-mediated 能力（如 `PackHostApi` / context assembly / lookup port）
  - workflow 不应直接持有 `WorldEnginePort`、`WorldEngineSidecarClient`、prepared token 或 raw JSON-RPC transport
  - Rust sidecar 的 objective execution diagnostics 与 step observability 当前主要用于执行记录、回归归因与宿主诊断，不作为 Prompt Workflow 直接消费的 runtime contract

## 13. 相关文档

- 架构边界：`../ARCH.md`
- 业务语义：`../LOGIC.md`
- API 读面：`../API.md`
- 相关设计资产：`.limcode/archive/historical/design/prompt-workflow-formalization-design.md`
