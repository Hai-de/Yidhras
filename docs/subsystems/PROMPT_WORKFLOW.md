# Prompt Workflow Runtime

Prompts don't write themselves. When the system needs to ask an AI model something — whether it's deciding what an actor does next, summarising recent events, or condensing long-term memory — it must assemble a structured prompt from many moving parts: world state, actor identity, recent events, output format requirements. The Prompt Workflow Runtime is the engine that turns those raw inputs into a final, complete prompt ready for the AI provider.

The runtime operates on a **multi-track, slot-driven pipeline**: three content tracks (template, node, snapshot) produce `PromptSectionDraft[]`, which flow into a post-merge pipeline of five executors that assemble, filter, trim, and render the final `PromptBundleV2`.

Key concepts:

- **PromptBundleV2** — the final output: a `slots` map of slot_id → rendered text, `combined_prompt`, `metadata`, and the source `PromptTree`. Passed directly to `InferenceProvider.run()`.
- **PromptTree** — the intermediate AST: `fragments_by_slot` maps slot_id → `PromptFragmentV2[]`, with a `slot_registry` carrying YAML slot configs from `prompt_slots.default.yaml`.
- **PromptSectionDraft** — an intermediate representation produced by content tracks. Carries `track`, `section_type`, `slot`, `content_blocks`, `priority`, and `removable`. All content is macro-expanded by the producing track.
- **PromptFragmentV2** — a container node within a slot, assembled from section drafts. Carries `priority`, `source`, `children: Array<PromptBlock | PromptFragmentV2>`, placement hints (`anchor`, `placement_mode`), permission flags (`permission_denied`), and structured denial records (`denial`).
- **PromptBlock** — the leaf content unit. Kinds: `text`, `macro_ref`, `conditional`, `loop`, `json`.
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
3. 选择 `PromptWorkflowProfile`，创建 `PromptWorkflowState`
4. 运行三条内容轨道（模板轨 / 节点轨 / 快照轨），产出 `PromptSectionDraft[]`
5. 运行汇合后 pipeline（placement → assembly → permission → budget_trim → finalize）
6. 渲染最终 `PromptBundleV2`
7. 将 workflow metadata 透传给 AI task / gateway / trace

## 3. 运行时主线

System B 多轨汇合架构：

```text
InferenceContext + PromptSlotRegistry
  → selectPromptWorkflowProfile() → PromptWorkflowProfile
  → createInitialPromptWorkflowState() → PromptWorkflowState
  ── 轨道阶段（runner 之外，由调用方编排）──
  → runTemplateTrack(slotRegistry, context)     → TrackResult<SectionDraft[]>
  → runNodeTrack(context_run.nodes, taskType)   → TrackResult<SectionDraft[]>
  → runSnapshotTrack(context, slotRegistry)     → TrackResult<SectionDraft[]>
  ── 汇合后 pipeline ──
  → placement_resolution → fragment_assembly → permission_filter
    → token_budget_trim → bundle_finalize
  → PromptBundleV2
  → InferenceProvider.run(context, bundle) → ProviderDecisionRaw
```

相关实现：

- `apps/server/src/context/workflow/orchestrator.ts` — `buildWorkflowPromptBundle()` 编排入口
- `apps/server/src/context/workflow/tracks/` — 三条内容轨道（template / node / snapshot）
- `apps/server/src/context/workflow/executors/` — 五个汇合后 executor
- `apps/server/src/context/workflow/pipeline_runner.ts` — 薄 runner，调度 executor 链
- `apps/server/src/context/workflow/profiles.ts` — `selectPromptWorkflowProfile()`，3 个内置 profile
- `apps/server/src/context/workflow/types.ts` — `PromptWorkflowState`, `PromptSectionDraft`, `StepSnapshotSummary` 等
- `apps/server/src/context/workflow/registry.ts` — `PromptWorkflowStepRegistry`
- `apps/server/src/inference/prompt_builder_v2.ts` — `buildPromptBundleV2()` 最终渲染
- `apps/server/src/inference/prompt_tree.ts` — `PromptTree`, `walkPromptBlocks()`, `renderSlotText()`
- `apps/server/src/inference/prompt_fragment_v2.ts` — `PromptFragmentV2`, `DenialRecord`, anchor/placement 类型
- `apps/server/src/inference/prompt_bundle_v2.ts` — `PromptBundleV2` interface
- `apps/server/src/inference/prompt_slot_config.ts` — `PromptSlotConfig`, `PromptFragmentSlot`
- `apps/server/src/ai/task_prompt_builder.ts` — 包装 `PromptBundleV2` 为 `AiTaskRequest`

## 4. Profile 与 task-aware 入口

当前内置 3 个 profile，每个 profile 声明了适用的 task_type / strategy / pack_id、默认参数（`token_budget`、`safety_margin_tokens`）、启用的轨道（`tracks`）、以及汇合后步骤序列：

- `agent-decision-default` — `task_types: ['agent_decision']`，三轨全启，默认 budget 2200 / margin 80
- `context-summary-default` — `task_types: ['context_summary']`，三轨全启，默认 budget 1600 / margin 60
- `memory-compaction-default` — `task_types: ['memory_compaction']`，三轨全启，默认 budget 1800 / margin 60

Profile 选择逻辑（`selectPromptWorkflowProfile`）按 specificity 排序：`task_types` 匹配权重 4 > `strategies` 匹配权重 2 > `pack_ids` 匹配权重 1。

### 4.1 轨道配置

每个 profile 的 `tracks` 字段控制哪些内容轨道启用：

```typescript
tracks?: {
  template?: boolean;  // YAML slot 模板 → section_drafts
  node?: boolean;      // ContextNode → section_drafts（含策略过滤/摘要压缩/节点分组）
  snapshot?: boolean;  // pack_state / variable_context → section_drafts
}
```

默认全部启用。轻量路径（如 `intent_grounding_assist`）可关闭 node/snapshot 轨道，只用模板轨生成骨架 prompt。

### 4.2 当前 task-aware 入口

- `buildWorkflowPromptBundle({ context, taskType })` — 编排入口，封装 profile 选择 → state 初始化 → 轨道 → pipeline → bundle
- `buildPromptBundleV2(tree, context)` — 渲染 PromptTree 为 PromptBundleV2（由 `bundle_finalize` executor 调用）
- `buildAiTaskRequestFromInferenceContext(context, options)` — 包装 `PromptBundleV2` 为 `AiTaskRequest`（要求调用方传入 `prompt_bundle`）

当前映射关系：

- `agent_decision` → `agent-decision-default`
- `context_summary` → `context-summary-default`
- `memory_compaction` → `memory-compaction-default`
- `intent_grounding_assist` → 无专属 profile，按 specificity 匹配 fallback 到 `agent-decision-default`

## 5. 内容轨道

三条轨道在 pipeline runner 之外执行，产出的 `section_drafts` 在 `placement_resolution` 步骤汇合。

### 5.1 模板轨（`runTemplateTrack`）

遍历 `PromptSlotRegistry`，为有模板的 slot 生成 section draft：

- 宏展开在轨道内部完成（调用 `renderNarrativeTemplate`），产出时 `content_blocks` 文本已确定
- 只为有 `default_template` 或 `template_context` 的 slot 生成 section；`memory_*` 等无模板 slot 由节点轨/快照轨独占
- `output_contract` 无模板时生成动态 fallback
- 模板轨产出的 section 标记 `removable: false`（骨架内容不可裁剪）

### 5.2 节点轨（`runNodeTrack`）

消费 `ContextRun.nodes`，内部按固定顺序执行四步：

1. **node_working_set_filter** — 过滤不可见节点（`visibility.blocked`、`policy_gate === 'deny'`、`read_access === 'hidden'`）
2. **memory_projection** — 将 node 映射为 `PromptSectionDraft`，按 `node_type` 推断 `section_type` 和 `slot`
3. **summary_compaction** — `agent_decision` 下，`memory_short_term` section 超过 6 个时，保留 priority 最高的 3 个，其余压缩为一条摘要写入 `memory_summary` slot
4. **node_grouping** — `memory_compaction` 下，同 `node_type` 的 section 合并为一条，减少冗余

### 5.3 快照轨（`runSnapshotTrack`）

将 `pack_state` / `variable_context` 等运行时状态序列化为 JSON section，写入 `post_process` slot。仅当 `post_process` slot 启用时执行。

## 6. 汇合后 pipeline

汇合后 pipeline 由 `runPipeline()` 执行，按 profile.steps 顺序调度 executor。Runner 是薄层——只做调度和诊断记录，不耦合轨道逻辑。

### 6.1 placement_resolution

将扁平 `section_drafts` 按 slot 分组，根据 `placement_mode` 排序：

- `prepend` → slot 最前
- `append` → slot 最后
- `before_anchor` / `after_anchor` → 查找 anchor 目标，插入对应位置
- 无 placement 声明 → 按 `priority` 降序填入中间
- Anchor 无法解析时 fallback 到 priority 排序，记录警告到 `diagnostics.placement_summary`

### 6.2 fragment_assembly

将排序后的 `section_drafts` 转换为 `PromptFragmentV2[]`，按 slot 分组写入 `state.tree`。映射策略：严格扁平——一个 section → 一个 fragment，不产生嵌套。

### 6.3 permission_filter

ACL 权限检查（feature flag 门控：`features.experimental.prompt_slot_permissions`）。检查 read/visibility 权限，对未授权 fragment 设置 `permission_denied = true` 并记录 `denial`。

### 6.4 token_budget_trim

从 `profile.defaults.token_budget` 获取预算上限，按 slot priority 从低到高遍历，裁剪 `removable = true` 的 fragment（设置 `permission_denied = true`）。配置优先级：`spec.config` > `profile.defaults` > 内置默认（2200 / margin 80）。

### 6.5 bundle_finalize

调用 `buildPromptBundleV2(state.tree, context)` 渲染最终 `PromptBundleV2`，回填 workflow metadata（`workflow_task_type`、`workflow_profile_id` 等）到 `tree.metadata`。

### 6.6 Executor 接口

```typescript
interface PromptWorkflowStepExecutor {
  kind: PromptWorkflowStepKind;
  execute(input: {
    context: InferenceContext;
    profile: PromptWorkflowProfile;
    spec: PromptWorkflowStepSpec;
    state: PromptWorkflowState;
  }): Promise<PromptWorkflowState>;
}
```

Executor 直接修改 `state`（mutate-in-place），无需返回新对象。每个 executor 负责写入自己的 `step_trace` 到 `state.diagnostics.step_traces`。

## 7. 变量上下文与宏系统

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

### 7.2 扁平别名（shorthand alias）

模板支持不带 namespace 的简写 key，与 namespaced 路径指向相同数据：

```txt
{{ actor_name }}          ← 等价于 {{ actor.display_name }}
{{ world_name }}          ← 等价于 {{ pack.metadata.name }}
```

这些简写别名通过两条路径提供：

1. **模板轨 `extraContext`**：`runTemplateTrack` 在调用 `renderNarrativeTemplate` 时直接传入常用扁平 key（`actor_name`、`actor_role`、`actor_agent_id` 等），作为 localScope 参与宏解析
2. **YAML 配置 `alias_values`**：`inference_context.yaml` 中每层可声明 `alias_values` 映射，经 `flattenPromptVariableContextToVisibleVariables` 展平后供快照轨和诊断消费

扁平 key 的 localScope 匹配优先级低于 namespaced 路径。`{{ actor.display_name }}` 和 `{{ actor_name }}` 同时存在时，前者优先命中。

`plugin.*` namespace 不参与默认别名映射，需显式使用 `{{ plugin.<id>.<path> }}` 访问。

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

## 8. Placement 语义

`PromptFragmentV2` 支持以下 placement 字段：

- `anchor` — `PromptFragmentAnchor`（kind: `slot_start` | `slot_end` | `source` | `tag` | `fragment_id`）
- `placement_mode` — `'prepend'` | `'append'` | `'before_anchor'` | `'after_anchor'`
- `depth` / `order` — 排序辅助

这使 fragment 能在 slot 内按 anchor 进行精确定位，而不只是按 priority 平铺。

## 9. Budget trimming 与权限标记

`token_budget_trim` executor 直接操作 `PromptTree`：

- 当估算 token 数超过预算时，按 slot 优先级从低到高遍历
- 对 `removable = true` 的 fragment 设置 `permission_denied = true` 并追加 `denial` 记录：`{ source: 'token_budget_trim', reason: 'trimmed_by_token_budget' }`
- `walkPromptBlocks()` 自动跳过 `permission_denied` 的 fragment，裁剪后的树直接渲染即可

`permission_filter` executor 通过 `applyPermissionFilter` 标记 ACL 拒绝的 fragment，追加 `denial` 记录：
- `{ source: 'permission_read', reason: '...' }` — read 权限检查未通过
- `{ source: 'permission_visibility', reason: '...' }` — visibility 检查未通过

`denial` 字段为 `DenialRecord[]`，多个拒绝来源可共存（如 read + visibility 同时拒绝）。节点轨内部的策略过滤（`visibility.blocked` / `policy_gate`）在 track 层面处理，不产生 fragment 级别的 denial 记录。

## 10. Diagnostics 与观测面

当前 workflow diagnostics 稳定输出：

- `profile_id` / `profile_version`
- `selected_step_keys`
- `step_traces` — 每个 pipeline step 的 `StepSnapshotSummary`
- `track_traces` — 三条内容轨道的 `TrackTrace`（`input_summary` / `output_summary` / `decisions`）
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

### 10.1 变量与宏诊断字段

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

### 10.2 使用者如何排查模板问题

当模板没有按预期展开时，建议按下面顺序排查：

1. 先看 `workflow_variable_summary.namespaces` — 确认目标 namespace 是否真的进入本次上下文
2. 再看 `workflow_macro_summary.traces` — 确认路径是 namespaced 命中，还是 alias fallback 命中
3. 再看 `workflow_macro_summary.missing_paths` — 确认是不是字段名写错，或当前上下文里不存在该字段
4. 若使用 `#if` / `#each` — 看 `workflow_macro_summary.blocks`，确认 block 是否执行、迭代次数是否为 0
5. 若仍异常 — 检查模板是否仍在使用旧裸 key，建议改成 namespaced 写法

## 11. 与 Context / Memory 的关系

Prompt Workflow Runtime 上游依赖 `ContextRun / ContextNode`，但它本身不等于 Context Module。

可粗略理解为：

- Context Module 负责"把什么信息放进 working set"
- Prompt Workflow 负责"把 working set 如何组织成 prompt / request"

`memory_context` 的内容通过节点轨（`runNodeTrack`）转换为 section drafts。节点轨内部执行 memory_projection 将 `ContextNode` 映射到 `memory_short_term` / `memory_long_term` / `memory_summary` slot，并在 short-term section 较多时通过 summary_compaction 自动生成摘要。

## 12. 架构边界

当前 pipeline 是线性顺序执行——executor 按 profile.steps 声明的顺序依次调用，不支持分支、条件跳过（除 `enabled: false`）、循环或 DAG 编排。这不是临时限制，而是刻意的简单性：pipeline 的职责是汇合后处理，轨道层面已完成了内容选择和差异化。

### 12.1 扩展点

插件可通过 `ServerPluginHostApi.registerPromptWorkflowStep(executor)` 注册自定义 executor。自定义 executor 遵循 `PromptWorkflowStepExecutor` 接口，与内置 executor 在同一 registry 中调度。插件不能：

- 定义新的 step kind 而不注册对应 executor
- 在 pack 层面注入任意可执行逻辑（executor 必须在 server-side TypeScript 中实现）
- 修改 pipeline 的线性执行顺序（顺序由 profile 声明，不在插件控制范围内）

### 12.2 宿主边界

Prompt Workflow 保持以下宿主边界：

- workflow state / persistence 留在 Node/TS host
- 读取世界态时通过 host-mediated 能力（`PackHostApi` / context assembly / lookup port），不直接持有 `WorldEnginePort`、`WorldEngineSidecarClient`、prepared token 或 raw JSON-RPC transport
- Rust sidecar 的 execution diagnostics 与 step observability 用于执行记录、回归归因与宿主诊断，不作为 Prompt Workflow 直接消费的 runtime contract

## 13. Agent 自主行为权限校验

自 Operator-Subject 统一权限模型引入后，Agent 自主产生的 ActionIntent **不再自动视为 root**：

- `invocation_dispatcher` 在构建 `InvocationRequest` 时会调用 `resolveSubjectForAgentAction()` 解析控制 Operator
- 若 Agent 有 type='user' 的 `IdentityNodeBinding`（即有人类 Operator 控制）→ 以该 Operator 的 identity 作为 subject 校验 capability
- 若 Agent 无控制 Operator（纯 NPC）→ 以 agent 自身为 subject
- Capability 校验失败时，ActionIntent 状态变为 `dropped`，记录 `drop_reason='CAPABILITY_DENIED'`
- 同一 tick 内同一 agent 的 subject 解析结果被缓存，避免重复数据库查询

相关模块：`src/domain/invocation/invocation_dispatcher.ts`、`src/operator/guard/subject_resolver.ts`

---

## 14. 相关文档

- 架构边界：`../ARCH.md`
- 业务语义：`../LOGIC.md`
- API 读面：`../API.md`
- Slot 配置指南：`./PROMPT_SLOT_CONFIGURATION.md`
- 相关设计资产：`.limcode/archive/historical/design/prompt-workflow-formalization-design.md`
