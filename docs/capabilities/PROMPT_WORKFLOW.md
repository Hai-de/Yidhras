# Prompt Workflow Runtime

Prompts don't write themselves. When the system needs to ask an AI model something — whether it's deciding what an actor does next, summarising recent events, or condensing long-term memory — it must assemble a structured prompt from many moving parts: world state, actor identity, recent events, output format requirements. The Prompt Workflow Runtime is the engine that turns those raw inputs into a final, complete prompt ready for the AI provider.

The runtime operates on a **tree-based, slot-driven pipeline** — `buildPromptTree()` constructs a `PromptTree` AST from YAML-configured slots, tree-aware processors transform it, and `buildPromptBundleV2()` renders the final `PromptBundleV2`.

Key concepts:

- **PromptBundleV2** — the final output: a `slots` map of slot_id → rendered text, `combined_prompt`, `metadata`, and the source `PromptTree`. Passed directly to `InferenceProvider.run()`.
- **PromptTree** — the intermediate AST: `fragments_by_slot` maps slot_id → `PromptFragmentV2[]`, with a `slot_registry` carrying YAML slot configs from `prompt_slots.default.yaml`.
- **PromptFragmentV2** — a container node within a slot. Carries `priority`, `source`, `children: Array<PromptBlock | PromptFragmentV2>`, placement hints (`anchor`, `placement_mode`), and permission flags (`permission_denied`, `denied_reason`).
- **PromptBlock** — the leaf content unit. Kinds: `text`, `macro_ref`, `conditional`, `loop`, `json`. Rendered text is stored in `rendered` after macro expansion.
- **ContextNode / ContextRun** — the upstream data that feeds the workflow: individual pieces of context organised by the context module.

The V1 flat prompt system (`PromptBundle` with 6 fixed string fields, flat `PromptFragment[]`, legacy `PromptProcessor` bridge) has been fully removed. The system operates exclusively on the V2 tree-based pipeline.

本文档集中说明 Prompt Workflow Runtime 的结构、语义与边界，承接原先散落在 `docs/ARCH.md`、`docs/LOGIC.md` 与 `docs/API.md` 中的高耦合细节。

## 1. 文档定位

本文件回答：

- Prompt Workflow Runtime 是什么
- 它如何把 `ContextNode` 组织成最终 prompt / request
- task-aware profile 的语义
- 运行时会产出哪些诊断字段

本文件不负责：

- 公共 HTTP contract 的完整定义：看 `docs/API.md`
- 整个系统模块边界：看 `docs/ARCH.md`
- 世界规则与业务语义主线：看 `docs/LOGIC.md`
- Slot 配置细节：看 `./PROMPT_SLOT_CONFIGURATION.md`

## 2. 目标

Prompt Workflow Runtime 的目标，是把 prompt 构造路径收敛为一个可解释、可观察、可按 task type 切换的运行时。

它不只是简单拼接 prompt 文本，而是负责：

1. 接收 `InferenceContext`（含 `ContextRun`、`MemoryContextPack`、`world_prompts` 等）
2. 加载 `PromptSlotRegistry`（YAML 驱动的 slot 配置）
3. 构建 `PromptTree` AST
4. 运行 tree-aware processor 管线（宏展开 → 内存注入 → 策略过滤 → 内存摘要 → token 预算裁剪 → 权限过滤）
5. 渲染最终 `PromptBundleV2`
6. 将 workflow metadata 透传给 AI task / gateway / trace

## 3. 运行时主线

当前 V2 主线：

```text
InferenceContext + PromptSlotRegistry
  → buildPromptTree() → PromptTree (AST)
  → runPromptWorkflowV2():
      macro_expansion → memory_injection → policy_filter
      → memory_summary → token_budget_trim → permission_filter
  → buildPromptBundleV2() → PromptBundleV2
  → InferenceProvider.run(context, bundle) → ProviderDecisionRaw
```

相关实现：

- `apps/server/src/inference/prompt_builder_v2.ts` — `buildPromptTree()` / `buildPromptBundleV2()`
- `apps/server/src/inference/prompt_tree.ts` — `PromptTree`, `walkPromptBlocks()`, `renderSlotText()`
- `apps/server/src/inference/prompt_block.ts` — `PromptBlock` leaf types
- `apps/server/src/inference/prompt_fragment_v2.ts` — `PromptFragmentV2`, anchor/placement types
- `apps/server/src/inference/prompt_bundle_v2.ts` — `PromptBundleV2` interface
- `apps/server/src/inference/prompt_slot_config.ts` — `PromptSlotConfig`, `PromptFragmentSlot`
- `apps/server/src/context/workflow/runtime.ts` — `runPromptWorkflowV2()` processor pipeline
- `apps/server/src/context/workflow/profiles.ts` — built-in workflow profiles
- `apps/server/src/inference/processors/` — tree-aware processors
- `apps/server/src/ai/task_prompt_builder.ts` — `buildAiTaskRequestFromInferenceContextV2()`

## 4. Profile 与 task-aware 入口

当前内置 profile（数据结构层面，V2 管线内部有独立处理器序列）：

- `agent-decision-default`
- `context-summary-default`
- `memory-compaction-default`

当前 task-aware 入口：

- `buildPromptBundleV2(tree, context)` — 渲染 PromptTree 为 PromptBundleV2
- `buildAiTaskRequestFromInferenceContextV2(context, options)` — 构建完整 AiTaskRequest
- `buildAiTaskRequestFromInferenceContext(context, options)` — 同上（直接委托 V2）

当前映射关系：

- `agent_decision` → `agent-decision-default`
- `context_summary` → `context-summary-default`
- `memory_compaction` → `memory-compaction-default`

## 5. 默认 processor 管线

V2 管线（`runPromptWorkflowV2`）按以下顺序执行 tree-aware processors：

1. **macro_expansion** — 展开 `PromptBlock` 中的 `{{ }}` 宏变量和 `#if` / `#each` 控制块
2. **memory_injection** — 将 `context.memory_context` (short_term / long_term / summaries) 注入对应 slot
3. **policy_filter** — 检查被阻塞的 node ID 和可见性策略，对被拒绝的 fragment 设置 `permission_denied = true`
4. **memory_summary** — 当 short-term memory fragment ≥ 4 时，取优先级最高的 3 个生成摘要，注入 `memory_summary` slot
5. **token_budget_trim** — 按优先级从低到高裁剪可移除的 fragment，设置 `permission_denied = true`
6. **permission_filter** (`applyPermissionFilter`) — 最终权限检查，清理 permission_denied 的 fragment

每个 processor 实现 `PromptTreeProcessor` 接口：
```ts
interface PromptTreeProcessor {
  name: string;
  process(input: PromptTreeProcessorInput): Promise<PromptTree>;
}
```

## 6. 变量上下文与宏系统

Prompt Workflow Runtime 正式引入：

- `PromptVariableContext`
- `PromptVariableLayer`
- `variable_context_summary`
- `workflow_variable_summary`
- `workflow_macro_summary`

### 6.1 正式变量命名空间

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

### 6.2 alias fallback 的兼容定位

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

### 6.3 当前支持的受控宏语法

#### 基础插值

```txt
{{ actor.display_name }}
{{ pack.metadata.name }}
```

#### 默认值

```txt
{{ actor.profile.title | default("unknown") }}
```

#### 条件块

```txt
{{#if actor.has_bound_artifact}}
当前主体持有关键媒介。
{{/if}}
```

#### 列表展开

```txt
{{#each runtime.owned_artifacts as artifact}}
- {{ artifact.id }}
{{/each}}
```

### 6.4 当前不支持的能力

本阶段有意不支持：

- 任意 JS 表达式
- `eval` / script execution
- 用户自定义函数执行
- 通用模板平台化扩展

Prompt Workflow 在这里的目标是"受控模板运行时"，不是"任意脚本模板引擎"。

### 6.5 使用建议

对于 Prompt Workflow profile、world prompts、perception templates，推荐按以下方式书写：

1. **优先带 namespace**
2. **缺省值用 `default(...)`，不要依赖缺失占位符**
3. **条件内容放进 `#if` block，而不是外层拼接字符串**
4. **列表内容用 `#each` block，而不是预先拼接大字符串**
5. **不要让 pack 模板依赖 plugin 变量的隐式注入**

## 7. Placement 语义

`PromptFragmentV2` 支持以下 placement 字段：

- `anchor` — `PromptFragmentAnchor`（kind: `slot_start` | `slot_end` | `source` | `tag` | `fragment_id`）
- `placement_mode` — `'prepend'` | `'append'` | `'before_anchor'` | `'after_anchor'`
- `depth` / `order` — 排序辅助

这使 fragment 能在 slot 内按 anchor 进行精确定位，而不只是按 priority 平铺。

## 8. Budget trimming 与权限标记

`token_budget_trimmer.ts` 直接操作 `PromptTree`：

- 当估算 token 数超过预算时，按 slot 优先级从低到高遍历
- 对 `removable = true` 的 fragment 设置 `permission_denied = true` 和 `denied_reason = 'trimmed_by_token_budget'`
- `walkPromptBlocks()` 自动跳过 `permission_denied` 的 fragment，裁剪后的树直接渲染即可

`policy_filter.ts` 同样通过 `permission_denied` 标记被策略阻塞的 fragment：
- `denied_reason = 'context_policy_engine'` — 被 Context Policy Engine 阻塞
- `denied_reason = 'visibility_or_policy_gate'` — 可见性策略或 policy gate 阻断

## 9. Diagnostics 与观测面

当前 workflow diagnostics 稳定输出：

- `profile_id` / `profile_version`
- `selected_step_keys`
- `step_traces`
- `section_summary`（可选）
- `section_budget`（可选）
- `placement_summary`（可选）

同时，以下读面会携带 workflow 信息：

- `PromptBundleV2.metadata.workflow_task_type`
- `PromptBundleV2.metadata.workflow_profile_id`
- `PromptBundleV2.metadata.workflow_step_keys`
- `PromptBundleV2.metadata.workflow_section_summary`
- `PromptBundleV2.metadata.workflow_placement_summary`
- AI gateway request metadata

这保证了 workflow 的可见性不仅停留在 prompt 文本层，也进入了 trace / replay / observability 层。

### 9.1 变量与宏诊断字段

除了 profile / placement / section 诊断之外，当前还会输出变量与宏相关摘要，例如：

- `PromptBundleV2.metadata.workflow_variable_summary`
- `PromptBundleV2.metadata.workflow_macro_summary`
- `context_run.diagnostics.orchestration.variable_resolution`

这些字段主要用于回答：

- 本次 prompt 渲染用了哪些 namespace
- 是否发生 alias fallback
- 哪些路径缺失
- 哪些 block 执行了 / 没执行
- 模板输出长度大致如何变化

### 9.2 使用者如何排查模板问题

当模板没有按预期展开时，建议按下面顺序排查：

1. 先看 `workflow_variable_summary.namespaces` — 确认目标 namespace 是否真的进入本次上下文
2. 再看 `workflow_macro_summary.traces` — 确认路径是 namespaced 命中，还是 alias fallback 命中
3. 再看 `workflow_macro_summary.missing_paths` — 确认是不是字段名写错，或当前上下文里不存在该字段
4. 若使用 `#if` / `#each` — 看 `workflow_macro_summary.blocks`，确认 block 是否执行、迭代次数是否为 0
5. 若仍异常 — 检查模板是否仍在使用旧裸 key，建议改成 namespaced 写法

## 10. 与 Context / Memory 的关系

Prompt Workflow Runtime 上游依赖 `ContextRun / ContextNode`，但它本身不等于 Context Module。

可粗略理解为：

- Context Module 负责"把什么信息放进 working set"
- Prompt Workflow 负责"把 working set 如何组织成 prompt / request"

`memory_context` 通过 `memory_injector` processor 直接注入 PromptTree 的 `memory_short_term`、`memory_long_term`、`memory_summary` slot。`memory_summary` processor 在 short-term fragment 较多时自动生成摘要。

## 11. 当前边界

当前明确成立的边界：

- 这是**树形 processor 管线**，不是通用 DAG workflow engine
- 不支持用户自定义执行图、循环节点或任意图编排
- 更复杂的 workflow 行为仍应通过受控的 server-side extension 演进
- Prompt Workflow 保持以下宿主边界：
  - workflow state / persistence 留在 Node/TS host
  - workflow 读取世界态时应继续通过 host-mediated 能力（如 `PackHostApi` / context assembly / lookup port）
  - workflow 不应直接持有 `WorldEnginePort`、`WorldEngineSidecarClient`、prepared token 或 raw JSON-RPC transport
  - Rust sidecar 的 objective execution diagnostics 与 step observability 当前主要用于执行记录、回归归因与宿主诊断，不作为 Prompt Workflow 直接消费的 runtime contract

## 12. Agent 自主行为权限校验

自 Operator-Subject 统一权限模型引入后，Agent 自主产生的 ActionIntent **不再自动视为 root**：

- `invocation_dispatcher` 在构建 `InvocationRequest` 时会调用 `resolveSubjectForAgentAction()` 解析控制 Operator
- 若 Agent 有 type='user' 的 `IdentityNodeBinding`（即有人类 Operator 控制）→ 以该 Operator 的 identity 作为 subject 校验 capability
- 若 Agent 无控制 Operator（纯 NPC）→ 以 agent 自身为 subject
- Capability 校验失败时，ActionIntent 状态变为 `dropped`，记录 `drop_reason='CAPABILITY_DENIED'`
- 同一 tick 内同一 agent 的 subject 解析结果被缓存，避免重复数据库查询

相关模块：`src/domain/invocation/invocation_dispatcher.ts`、`src/operator/guard/subject_resolver.ts`

---

## 13. 相关文档

- 架构边界：`../ARCH.md`
- 业务语义：`../LOGIC.md`
- API 读面：`../API.md`
- Slot 配置指南：`./PROMPT_SLOT_CONFIGURATION.md`
- 相关设计资产：`.limcode/archive/historical/design/prompt-workflow-formalization-design.md`
