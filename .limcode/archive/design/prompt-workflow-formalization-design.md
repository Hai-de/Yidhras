# Prompt Workflow 正式化设计

## 0. 状态说明

本文档面向当前已经落地的 Context Module MVP、Memory Block Runtime、Prompt Bundle 与 AI Gateway 主线，目标不是重复描述现状，而是推进下一阶段的 **Prompt Workflow Formalization**。

当前代码已经具备可运行的提示词处理闭环，但仍主要停留在 **Orchestrator Lite + 固定 processor 链** 阶段。本文档旨在把这条链正式提升为：

> **可声明 workflow profile、可分阶段执行、可稳定解释 placement、可按 task/strategy/pack 分流的 Prompt Workflow 层。**

---

## 1. 背景与现状

当前已存在的稳定能力包括：

1. `ContextService.buildContextRun()` 已经构建 `ContextRun / ContextNode / diagnostics`
2. `memory_context` 已退化为 compatibility projection，但仍被现有 prompt processors 广泛消费
3. `context/workflow/orchestrator.ts` 已提供固定线性的 Orchestrator Lite，阶段为：
   - `memory_injection`
   - `policy_filter`
   - `summary_compaction`
   - `token_budget_trim`
4. `PromptFragment` 已支持：
   - `slot`
   - `anchor`
   - `placement_mode`
   - `depth`
   - `order`
   - `metadata`
5. `PromptBundle` 已稳定输出：
   - `system_prompt`
   - `role_prompt`
   - `world_prompt`
   - `context_prompt`
   - `output_contract_prompt`
   - `combined_prompt`
6. `gateway_backed` provider 与 `AiTaskService` 已可以消费 `PromptBundle`
7. Memory Block Runtime 已经能够：
   - 评估触发规则
   - materialize 为 `ContextNode`
   - 映射回 compatibility `memory_context`
   - 进入 fragment pipeline

这意味着：

- **提示词工作流已经存在**
- 但它仍然更像“固定代码路径”，而不是“正式工作流子系统”

---

## 2. 当前主要问题

### 2.1 Orchestrator 仍是硬编码线性阶段

当前阶段数组固定写死在 `context/workflow/orchestrator.ts` 中，导致：

- 无法按 task type 选择不同 workflow
- 无法按 inference strategy 切换 workflow
- 无法按 pack / world / actor profile 选择 workflow
- 无法正式插入新的 workflow step
- 无法清晰表达“某些阶段只在特定任务启用”

### 2.2 处理主对象仍偏 fragment，而不是 node-first

虽然上游已经有 `ContextRun / ContextNode`，但当前工作流的主要处理对象仍是 `PromptFragment[]`，导致：

- node-level policy 与 fragment-level transform 边界不够清晰
- summary / budget / placement 无法自然表达“先基于节点聚类，再转 fragment”
- 后续接入更复杂的 evidence grouping / section assembly 会变得别扭

### 2.3 `memory_context` 仍在工作流中心位置

虽然 `memory_context` 被文档定义为 compatibility surface，但当前：

- memory inject / summary / filter / trim 都直接读写 `memory_context`
- prompt_processing_trace 主要仍挂在 `memory_context.diagnostics`

这会延迟真正的 Prompt Workflow 正式化。

### 2.4 placement 字段已存在，但 placement 解析还不完整

当前 `PromptFragment` 已支持：

- `anchor`
- `placement_mode`
- `depth`
- `order`

但当前执行逻辑仍更接近“排序字段比较”，而不是真正的：

- `prepend`
- `append`
- `before_anchor`
- `after_anchor`

的相对锚点插入解析。

### 2.5 Prompt Assembly 仍偏“大 JSON context dump”

当前 `post_process` slot 中往往承载较大的 `context snapshot JSON`。这对于 MVP 很有效，但对于正式 Prompt Workflow 来说存在问题：

- token 利用率不稳定
- section 粒度粗
- 不利于不同任务类型复用不同上下文视图
- AI task prompt adapter 只能做较浅层次 section 裁切

### 2.6 Workflow 与 AI Task / Pack AI 的联动还不够深

当前 pack.ai 已经有：

- `prompt_preset`
- `system_append`
- `developer_append`
- `user_prefix`
- `include_sections`

但这些配置主要作用于 PromptBundle -> AiMessages 适配层，而非 workflow 执行层。

---

## 3. 设计目标

### 3.1 核心目标

1. 将现有 Orchestrator Lite 升级为正式 `Prompt Workflow` 层
2. 引入 **workflow profile**，允许按 task / strategy / pack 选择不同编排路径
3. 建立正式的 **workflow step contract**，让步骤可以被声明、注册、执行和观测
4. 把 placement 从“排序字段”提升为“锚点解析 + 插入决策”机制
5. 降低 `memory_context` 在工作流中的中心地位，使其回归 compatibility output
6. 在 `ContextNode -> Section -> PromptFragment -> PromptBundle -> AiMessages` 之间建立更清晰的分层
7. 提升调试、回放、审计能力，保证 prompt 形成路径可解释

### 3.2 非目标

本阶段**不**追求：

- 前端可视化 workflow canvas
- 通用 DAG / 循环图工作流引擎
- 任意 pack/插件执行任意 JS 逻辑
- 模型直接编辑工作流配置
- 一次性替换所有 legacy compatibility 面
- 多轮 agent-driven directive execution 的完整开放

---

## 4. 核心原则

### 4.1 Workflow 要显式，但不要过度平台化

目标是正式化 Agent Prompt Workflow，不是造一个通用工作流平台。首阶段仍坚持：

- 线性或分段线性执行
- 有 profile，但不支持任意图
- 有 registry，但仅允许 server-side registered steps

### 4.2 Source of Truth 前移到 ContextRun / WorkflowState

真正的上游输入应是：

- `ContextRun`
- `ContextNode[]`
- node-level diagnostics
- pack / task / policy metadata

而不是继续把 `memory_context` 当作主要中间层。

### 4.3 placement 要是“决策过程”，不是“附带排序字段”

`anchor / placement_mode / depth / order` 不应只是附在 fragment 上等排序器读取，而应在专门阶段中：

- 解析 anchor 目标
- 生成插入位置决策
- 记录 fallback 与冲突解决过程

### 4.4 Workflow 要 task-aware

不同 AI 任务天然需要不同上下文处理：

- `agent_decision`
- `intent_grounding_assist`
- `context_summary`
- `memory_compaction`

不能长期共用一条完全相同的 prompt 处理链。

### 4.5 compatibility 是输出层，不是控制层

`memory_context`、旧 processors、旧 trace 字段可以继续保留，但只能作为：

- compatibility projection
- fallback implementation
- migration bridge

不能继续定义新架构的核心边界。

---

## 5. 目标架构

建议将提示词处理主线抽象为：

```text
ContextRun / ContextNode
  -> PromptWorkflowState
  -> Workflow Steps
  -> Section Drafts
  -> Placement Resolution
  -> PromptFragments
  -> PromptBundle
  -> AiMessages / Provider Input
```

其中新增的关键中间层是：

1. `PromptWorkflowState`
2. `SectionDraft`
3. `PlacementResolutionResult`
4. `PromptWorkflowProfile`

---

## 6. 核心模型设计

## 6.1 PromptWorkflowProfile

```ts
interface PromptWorkflowProfile {
  id: string;
  version: string;
  description?: string;
  applies_to: {
    task_types?: string[];
    strategies?: string[];
    pack_ids?: string[];
  };
  defaults?: {
    token_budget?: number;
    section_policy?: 'minimal' | 'standard' | 'expanded';
    compatibility_mode?: 'full' | 'bridge_only' | 'off';
  };
  steps: PromptWorkflowStepSpec[];
}
```

### 说明

- `id` 用于稳定识别 workflow profile
- `version` 用于 trace / snapshot / replay
- `applies_to` 决定何时选用该 profile
- `defaults` 允许对预算与兼容行为给出默认值
- `steps` 是明确的执行路径

## 6.2 PromptWorkflowStepSpec

```ts
interface PromptWorkflowStepSpec {
  key: string;
  kind:
    | 'legacy_memory_projection'
    | 'node_working_set_filter'
    | 'node_grouping'
    | 'summary_compaction'
    | 'token_budget_trim'
    | 'placement_resolution'
    | 'fragment_assembly'
    | 'bundle_finalize'
    | 'ai_message_projection';
  enabled?: boolean;
  config?: Record<string, unknown>;
  requires?: string[];
  produces?: string[];
}
```

### 说明

- `kind` 表示 step 类型，而不是具体实现类名
- `key` 是 trace / diagnostics 中的稳定标识
- `requires / produces` 用于调试与执行前校验
- 首阶段仍由服务端内置 step registry 解析 `kind`

## 6.3 PromptWorkflowState

```ts
interface PromptWorkflowState {
  context_run: ContextRun;
  actor_ref: InferenceActorRef;
  task_type: string;
  strategy: string;
  pack_id: string;

  selected_nodes: ContextNode[];
  working_set: ContextNode[];
  grouped_nodes: Record<string, ContextNode[]>;
  section_drafts: PromptSectionDraft[];
  fragments: PromptFragment[];
  prompt_bundle: PromptBundle | null;
  ai_messages?: AiMessage[];

  compatibility: {
    legacy_memory_context?: MemoryContextPack | null;
  };

  diagnostics: PromptWorkflowDiagnostics;
}
```

### 说明

- `selected_nodes` 是 ContextRun 原始选中结果
- `working_set` 是 workflow 当前可变工作集
- `grouped_nodes` / `section_drafts` 提供 node-first 到 fragment 的过渡层
- `fragments` 不再是 workflow 唯一主对象，而是后段产物
- `compatibility.legacy_memory_context` 仅用于 bridge

## 6.4 PromptSectionDraft

```ts
interface PromptSectionDraft {
  id: string;
  section_type:
    | 'system_instruction'
    | 'role_context'
    | 'world_context'
    | 'recent_evidence'
    | 'memory_short_term'
    | 'memory_long_term'
    | 'memory_summary'
    | 'output_contract'
    | 'context_snapshot';
  title?: string | null;
  slot: PromptFragmentSlot;
  source_node_ids: string[];
  content_blocks: Array<{
    kind: 'text' | 'json';
    text?: string;
    json?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }>;
  placement?: {
    anchor?: PromptFragmentAnchor | null;
    placement_mode?: PromptFragmentPlacementMode | null;
    depth?: number | null;
    order?: number | null;
  };
  metadata?: Record<string, unknown>;
}
```

### 为什么需要 SectionDraft

这是 Prompt Workflow 正式化的重要桥梁：

- 上游 node-level 工作流不必直接输出字符串 fragment
- section 可以承载 grouped evidence / summarized memory / structured snapshot
- PromptFragment 只负责最终 prompt-ready 文本形态

---

## 7. Workflow Step Contract

## 7.1 执行器接口

```ts
interface PromptWorkflowStepExecutor {
  kind: PromptWorkflowStepSpec['kind'];
  execute(input: {
    context: InferenceContext;
    profile: PromptWorkflowProfile;
    spec: PromptWorkflowStepSpec;
    state: PromptWorkflowState;
  }): Promise<PromptWorkflowState>;
}
```

## 7.2 Step 结果诊断

```ts
interface PromptWorkflowStepTrace {
  key: string;
  kind: string;
  status: 'completed' | 'skipped' | 'failed';
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  notes?: Record<string, unknown>;
}
```

### 说明

每个 step 至少要输出：

- 执行前状态摘要
- 执行后状态摘要
- 新增/移除/变换的对象统计
- fallback / skip 原因

这比当前仅记录 fragment diff 更适合正式 workflow。

---

## 8. 推荐内置 Step 设计

## 8.1 `legacy_memory_projection`

### 职责

- 从 `ContextRun` 派生 compatibility `memory_context`
- 只为仍依赖 legacy memory 的实现提供 bridge

### 规则

- profile 可选择 `full / bridge_only / off`
- `off` 时只在 trace 中保留“compat disabled”记录

## 8.2 `node_working_set_filter`

### 职责

- 基于 node-level policy、visibility、mutability、source type、task rules 构建 working set
- 替代 fragment 级 `policy_filter` 作为主要治理入口

### 输出

- `working_set`
- dropped node reasons
- blocked / hidden / fixed 节点统计

## 8.3 `node_grouping`

### 职责

按 workflow profile 将 working set 分组，例如：

- `system_fixed`
- `role_core`
- `world_state`
- `recent_evidence`
- `memory_short_term`
- `memory_long_term`
- `memory_summary_candidates`

### 价值

- 为 summary / budget / placement 提供更稳定的输入
- 降低直接在 fragment 上做复杂逻辑的耦合度

## 8.4 `summary_compaction`

### 职责

- 对特定 group 或 section draft 做压缩
- 当前优先用于短期 memory / recent evidence

### 约束

- hidden mandatory / visible fixed 节点不可被强行摘要
- placement locked 的节点只可旁路生成 summary，不可替换原节点

## 8.5 `token_budget_trim`

### 职责

- 在 section / fragment 级别进行预算裁剪
- 支持 profile 默认预算与 task override

### 进化方向

首阶段允许仍主要对 fragment 生效，但设计上要支持：

- node score
- group score
- section score
- fragment score

的多层预算决策。

## 8.6 `placement_resolution`

### 职责

- 解析 anchor / placement_mode / depth / order
- 生成稳定插入顺序与 fallback reason

这是 Prompt Workflow Formalization 的关键新增阶段。

## 8.7 `fragment_assembly`

### 职责

- 把 section draft 转成 prompt fragments
- 统一生成 fragment metadata
- 明确 source_node_ids / section origin

## 8.8 `bundle_finalize`

### 职责

- 输出最终 `PromptBundle`
- 记录 slot summary / assembly stats

## 8.9 `ai_message_projection`

### 职责

- 仅在需要时，将 `PromptBundle` 映射为 AI messages
- 允许 task-aware 的 section include/exclude

说明：

- 该步骤可在 inference provider 之前执行
- 也可由 `AiTaskService` 继续消费 `PromptBundle` 并自行适配
- 首阶段可先保留 adapter 位置不变，只把其语义纳入 workflow trace

---

## 9. Placement Resolution 正式化

这是当前最需要补齐的部分。

## 9.1 目标

让以下 placement 语义真正可执行：

- `prepend`
- `append`
- `before_anchor`
- `after_anchor`

以及 anchor 类型：

- `slot_start`
- `slot_end`
- `source`
- `tag`
- `fragment_id`

## 9.2 解析流程

建议专门引入：

```ts
interface PlacementResolutionInput {
  slot: PromptFragmentSlot;
  fragments: PromptFragment[];
}

interface PlacementDecision {
  fragment_id: string;
  resolved_slot: PromptFragmentSlot;
  anchor_key: string | null;
  placement_mode: PromptFragmentPlacementMode | null;
  resolved_index: number;
  fallback_reason?: string | null;
}
```

### 建议算法

#### Phase 1：按 slot 分区

先按 slot 划分 fragment 池。

#### Phase 2：收集 anchor targets

在每个 slot 内构建 anchor 索引：

- `slot_start:<slot>`
- `slot_end:<slot>`
- `source:<fragment.source>`
- `tag:<tag>`
- `fragment_id:<id>`

#### Phase 3：先放置无 anchor / append / prepend 的基础 fragment

形成 slot 内基础序列。

#### Phase 4：解析 `before_anchor / after_anchor`

对每个需要 anchor 的 fragment：

- 查找 anchor target
- 若 target 唯一，则插入相对位置
- 若 target 多个，按 profile 策略决定：
  - first_match
  - last_match
  - strongest_priority
- 若找不到，则降级为：
  - `prepend` 或 `append`
  - 并记录 fallback reason

#### Phase 5：同组内再按 `depth / order / priority / id` 稳定排序

排序规则建议：

1. anchor resolution group
2. `depth` 升序
3. `order` 升序
4. `priority` 降序
5. `fragment.id` 字典序

## 9.3 为什么不能只用 compare sort

因为 `before_anchor / after_anchor` 是相对插入语义，不是纯字段排序能完整表达的语义。

例如：

- A after source:X
- B before fragment:A

这类依赖关系需要一个“解析过程”，而不是单次 compare。

## 9.4 Diagnostics 要求

每个有 placement 的 fragment 都应记录：

- requested placement
- resolved target
- fallback 是否发生
- 最终 slot/index

---

## 10. Prompt Assembly 正式化

## 10.1 从“context dump”走向“section-driven assembly”

当前 `context_prompt` 常承载较大的 JSON。正式化后建议：

- `context_snapshot` 只作为一种 section draft
- 默认不再强制整份 dump 全量进入 prompt
- profile 可配置：
  - minimal evidence
  - structured evidence
  - full snapshot fallback

## 10.2 PromptBundle 不必立刻破坏现有合同

当前 `PromptBundle` 公共结构仍保持：

- `system_prompt`
- `role_prompt`
- `world_prompt`
- `context_prompt`
- `output_contract_prompt`
- `combined_prompt`

但内部来源应变成：

- sections 组合
- placement 结果
- assembly policy

## 10.3 新增建议 metadata

```ts
prompt_bundle.metadata = {
  prompt_version,
  workflow_profile_id,
  workflow_profile_version,
  workflow_step_keys,
  section_summary,
  placement_summary,
  compatibility_mode,
  processing_trace
}
```

这样可保持对外 contract 稳定，同时增强 observability。

---

## 11. Workflow Profile 选择规则

## 11.1 选择维度

建议支持按以下优先级选择 profile：

1. explicit task override
2. task type + strategy
3. task type + pack id
4. task type default
5. global default profile

## 11.2 初始建议 profile

### Profile A：`agent-decision-default`

适用：
- `task_type = agent_decision`
- `strategy = mock | rule_based | model_routed`

特点：
- 完整 context
- memory short/long/summary
- output contract 强保留
- placement resolution 开启

### Profile B：`context-summary-default`

适用：
- `task_type = context_summary`

特点：
- recent evidence 优先
- memory_summary 倾向先做 compaction
- 不需要完整 output_contract

### Profile C：`memory-compaction-default`

适用：
- `task_type = memory_compaction`

特点：
- working_set 聚焦 memory 节点
- 强化 grouping/summarization
- 可弱化 world/role sections

---

## 12. 与现有实现的映射

## 12.1 `runContextOrchestrator()` 的演进

当前函数可演进为：

```ts
runPromptWorkflow(context, {
  task_type,
  profile_id?
})
```

内部仍可先复用现有 processors，但对外暴露正式 workflow 语义。

## 12.2 现有 processors 的定位

### `memory_injector`
短期作为：
- `legacy_memory_projection + fragment_assembly` 之间的兼容实现

中期应拆为：
- `section draft builder`
- `fragment assembler`

### `policy_filter`
短期作为：
- `node_working_set_filter` 的 fragment fallback

中期应弱化为：
- compatibility safety net

### `memory_summary`
短期可继续作为：
- summary compaction step executor

中期应支持：
- section / group 粒度 compaction

### `token_budget_trimmer`
短期可继续作为：
- fragment budget trimmer

中期应支持：
- multi-layer score evaluation

## 12.3 `memory_context` 的定位

建议明确迁移目标：

- **现在**：workflow 仍可读取，但应减少新增依赖
- **中期**：只从 workflow state 派生输出
- **长期**：仅作为 legacy compatibility API / trace surface

---

## 13. 观测与 trace 设计

## 13.1 PromptWorkflowDiagnostics

```ts
interface PromptWorkflowDiagnostics {
  profile_id: string;
  profile_version: string;
  selected_step_keys: string[];
  step_traces: PromptWorkflowStepTrace[];
  node_counts?: Record<string, number>;
  working_set_counts?: Record<string, number>;
  section_summary?: Record<string, unknown>;
  placement_summary?: {
    total_fragments: number;
    resolved_with_anchor: number;
    fallback_count: number;
  };
  compatibility?: {
    legacy_memory_context_used: boolean;
    legacy_processors_used: string[];
  };
}
```

## 13.2 Trace 落点

建议写入：

- `context_run.diagnostics.orchestration`
- `PromptBundle.metadata.processing_trace`
- `InferenceTrace.context_snapshot.prompt_processing_trace`

当前无需新增新表。

## 13.3 新增观测重点

除了现有 fragment diff，还应新增：

- workflow profile id/version
- step-level input/output summary
- section draft summary
- placement decision summary
- compatibility bridge usage summary

---

## 14. 兼容迁移策略

## 14.1 原则

迁移必须是渐进式，而不是一次性硬切。

## 14.2 三阶段策略

### 阶段 1：Formal Wrapper

- 引入 workflow profile / step spec / workflow state
- 现有 processors 继续复用
- `memory_context` 仍保留
- trace 开始写 profile 信息

### 阶段 2：Node-first Deepening

- 引入 `node_grouping / section_drafts`
- placement resolution 正式化
- `memory_summary` 与 `budget_trim` 更多基于 section/working_set

### 阶段 3：Compatibility Demotion

- `memory_context` 不再作为 workflow 主输入
- fragment fallback processor 降级
- 新实现以 workflow state 为唯一中间层

---

## 15. 风险与控制

### 风险 1：把 Prompt Workflow 做成过重平台

控制：
- 只做 server-side registered linear workflow
- 不做 DAG / 可视化 / 用户编排

### 风险 2：迁移过程中破坏现有 inference 主线

控制：
- `PromptBundle` 外部 contract 保持不变
- `gateway_backed` / `mock` / `rule_based` 不改消费边界
- `memory_context` 保留 bridge 模式

### 风险 3：placement 复杂度快速上升

控制：
- 首阶段只支持 slot 内相对锚点解析
- 不做跨 slot anchor
- anchor 冲突时明确 fallback 规则

### 风险 4：trace 结构膨胀

控制：
- trace 中优先存 summary / ids / counts
- 避免重复持久化完整 node 文本

### 风险 5：task-aware profile 引入过早分叉

控制：
- 初始只提供少量 built-in profiles
- profile selector 先做 deterministic 匹配

---

## 16. 推荐实施顺序

### Phase 1：Workflow Profile 与 Step Contract

1. 定义 `PromptWorkflowProfile / StepSpec / WorkflowState`
2. 把现有 orchestrator-lite 包装到正式 runtime 中
3. 让 trace 输出 profile 信息

### Phase 2：Placement Resolution

1. 新增 `placement_resolution` step
2. 实现 anchor target 索引与 before/after anchor 解析
3. 补 placement decision diagnostics

### Phase 3：Section Draft 层

1. 引入 `PromptSectionDraft`
2. 从 memory / evidence / snapshot 生成 section drafts
3. 将 fragment assembly 与 section 构建解耦

### Phase 4：Task-aware Workflow Profiles

1. 让 `agent_decision / context_summary / memory_compaction` 选择不同 profile
2. 让 AI task prompt adapter 读取 workflow metadata
3. 让 pack.ai 可影响 workflow profile defaults

### Phase 5：Compatibility Demotion

1. 降低 `memory_context` 在 workflow 的中心地位
2. fragment-level `policy_filter` 降为 fallback
3. 清理 legacy-only 路径的新增依赖

---

## 17. 验收标准

完成 Prompt Workflow 正式化首阶段后，应满足：

1. 服务端存在正式 `PromptWorkflowProfile` 与 `PromptWorkflowState` 抽象
2. workflow 执行不再只是固定数组，而是 profile 驱动
3. `placement_resolution` 成为显式阶段，并真正执行 before/after anchor 语义
4. `PromptBundle` 外部 contract 不破坏，但 metadata 中可看到 workflow profile / placement / section 诊断
5. `memory_context` 虽继续存在，但在架构上被明确降级为 compatibility output
6. `AiTaskService` / gateway 路径能读到 workflow metadata，并保持现有任务不回归
7. 单元与集成测试可覆盖：
   - profile selection
   - step execution
   - placement resolution
   - compatibility bridge
   - prompt bundle / ai message projection

---

## 18. 结论

当前项目的提示词处理链路已经具备：

- Context Module
- Orchestrator Lite
- PromptFragment
- PromptBundle
- AI Gateway
- Memory Block Runtime integration

因此，下一步不应再把目标描述为“从零实现提示词工作流”，而应明确为：

> **将现有 Orchestrator Lite 正式提升为 Prompt Workflow 子系统。**

这一步的关键不是再补一个 processor，而是补齐以下四件事：

1. workflow profile
2. step contract
3. placement resolution
4. compatibility demotion

这样做之后，系统才能从“可运行的 prompt pipeline”走向“正式、可扩展、可观测的 Prompt Workflow”。
