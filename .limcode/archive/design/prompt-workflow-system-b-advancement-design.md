# Prompt Workflow System B 推进设计（草稿）

## 状态说明

本文档是 TODO.md 阶段三（提示词构建 / Prompt Tree V2）的前置设计草稿。
目标不是设计新功能，而是把已设计但未接线的 **System B（Profile → Step 抽象）** 接入实际运行管线，
并在接线过程中清理 Context Builder 的兼容性别名。

当前正在与用户讨论修订中，尚未开始编码。

---

## 0. 项目约束

- **项目未上线**，无任何使用者，无生产数据
- 无向后兼容负担——不存在需要保持兼容的旧版 API、旧版 prompt 格式、或用户自定义配置
- 唯一的数据是开发/测试用的本地 SQLite
- 唯一的约束是**开发成本**和**自身测试通过**

这意味着：所有关于"平滑迁移"、"兼容期"、"废弃警告"的讨论都是无本之木。
选择策略的唯一判断标准是**哪种方式能达到正确的架构，时间不是重点**。

---

## 1. 背景：两个系统的差距

### System A (Lite) — 实际在跑

```
buildPromptTree() → runPromptWorkflowV2() → buildPromptBundleV2()
                         │
                         5 个硬编码 PromptTreeProcessor:
                           macro_expansion
                           → memory_injection
                           → policy_filter
                           → memory_summary
                           → token_budget_trim
                         + permission_filter (非 processor)
```

核心数据类型：`PromptTree`，processor 接口：`tree → tree`。

**存在两条调用路径**：

| 调用路径 | 位置 | 是否经过 workflow |
|---------|------|------------------|
| 推理执行 + 预览 | `inference/service.ts:234-239` 和 `435-440` | 是（`runPromptWorkflowV2`） |
| AI Task 构建 | `ai/task_prompt_builder.ts:74-75` | **否**——直接 `buildPromptTree()` → `buildPromptBundleV2()`，跳过所有 processor |

`task_prompt_builder.ts` 路径产生的是**未经宏展开、无记忆注入、无策略过滤、无 token 裁剪**的原始 prompt bundle。如果这条路径也被实际使用，就是一个 bug 等待被发现。

问题：
- 所有任务类型共用同一管道，无分支
- 无法按 task_type/strategy/pack 选择不同处理步骤
- 无结构化的中间状态（无 section drafts、无 placement resolution）
- 诊断/追踪不完整
- 两条调用路径行为不一致

### System B (Formal) — 已设计，完全未接线

| 组件 | 文件 | 接线状态 |
|------|------|---------|
| `PromptWorkflowProfile` (3 个内置) | `context/workflow/profiles.ts` | `selectPromptWorkflowProfile()` **零调用方** |
| `PromptWorkflowStepSpec` (8 种 kind) | `context/workflow/types.ts:40-47` | 仅在 profile 定义中引用 |
| `PromptWorkflowStepExecutor` 接口 | `context/workflow/registry.ts:8-16` | **零实现** |
| `PromptWorkflowStepRegistry` | `context/workflow/registry.ts:24-44` | 注册表为空 |
| `PromptWorkflowState` | `context/workflow/types.ts:151-166` | **零实例化** |
| `createInitialPromptWorkflowState()` | `context/workflow/types.ts:188-214` | **零调用方** |
| `PromptWorkflowDiagnostics` | `context/workflow/types.ts:139-149` | 仅用于类型导出 |
| `PromptSectionDraft` | `context/workflow/types.ts:89-103` | 仅类型定义 |
| `PromptWorkflowConfig` (runtime config) | `config/domains/prompt_workflow.ts` | 可加载但仅用于 profile 构造 |

两个系统之间没有任何桥接代码。System A 完全不感知 profile/state/registry 的存在。

---

## 2. 设计文档中划定的边界

`prompt-workflow-formalization-design.md` 第 149-156 行明确：

- 线性或分段线性执行（不支持任意 DAG）
- 有 profile，但不支持任意图
- 有 registry，但仅允许 server-side registered steps
- 非目标：通用 DAG 引擎、前端可视化 canvas、任意 pack 执行任意 JS 逻辑

核心目标（第 126-131 行）：
1. Orchestrator Lite → 正式 Prompt Workflow 层
2. 引入 workflow profile，按 task/strategy/pack 分流
3. 建立正式的 step contract
4. placement 从"排序字段"提升为"锚点解析 + 插入决策"
5. 降低 `memory_context` 的中心地位
6. ContextNode → Section → Fragment → Bundle → AiMessages 分层更清晰
7. 提升调试、回放、审计能力

---

## 3. 接线策略：完整切换

选择**完整切换**——一次性替换 `inference/service.ts` 和 `task_prompt_builder.ts` 的调用路径，实现所有必要的 executor，删除 System A 的 processor 代码。

理由（基于 §0 约束）：
- 无用户、无生产数据，回归只影响开发者
- 无向后兼容负担，不需要过渡期
- 总代码量更少——不需要适配器/桥接代码
- 架构从第一天保持一致
- 统一两条调用路径（inference service + task prompt builder）

前置条件：先用试点 executor 验证接口可用性，确认后再批量实现（详见 §6）。

---

## 4. 波及范围分析

### 4.1 直接修改的文件

| 文件 | 改动性质 | 改动量 |
|------|---------|--------|
| `inference/service.ts` | `executeRunInternal` 和 `previewInference` 中替换 `buildPromptTree → runPromptWorkflowV2 → buildPromptBundleV2` 调用链 | 中 |
| `ai/task_prompt_builder.ts` | `buildAiTaskRequestFromInferenceContextV2` 中替换直接调用 `buildPromptTree → buildPromptBundleV2`，改为走 workflow（修复绕过问题） | 小 |
| `context/workflow/runtime.ts` | `runPromptWorkflowV2` 可能被替换或重构为基于 profile/state/executor 的版本 | 中 |
| `context/workflow/registry.ts` | 注册所有 executor 实现 | 小 |
| `context/workflow/profiles.ts` | 接线 `selectPromptWorkflowProfile` 到调用方 | 小 |

### 4.2 需要新增的文件

| 文件 | 内容 |
|------|------|
| `context/workflow/executors/memory_projection.ts` | 将记忆源投影为 ContextNode 的 executor |
| `context/workflow/executors/node_working_set_filter.ts` | 过滤 working set 的 executor |
| `context/workflow/executors/node_grouping.ts` | 节点分组的 executor |
| `context/workflow/executors/summary_compaction.ts` | 摘要压缩的 executor |
| `context/workflow/executors/token_budget_trim.ts` | Token 预算裁剪的 executor |
| `context/workflow/executors/placement_resolution.ts` | 锚点解析与插入位置决策的 executor |
| `context/workflow/executors/fragment_assembly.ts` | 将 section drafts 组装为 fragments 的 executor |
| `context/workflow/executors/bundle_finalize.ts` | 最终组装 PromptBundle 的 executor |

### 4.3 可能需要重构的现有 processor

| Processor | System B 对应 | 改动 |
|-----------|-------------|------|
| `macro_expansion.ts` | 无直接对应——宏展开可能留在 tree 构建阶段而非作为独立 step | 逻辑可能移到 `buildPromptTree` 中 |
| `memory_injector.ts` | 逻辑分散到 `memory_projection` + `fragment_assembly` | 拆分 |
| `policy_filter.ts` | 逻辑合并到 `node_working_set_filter` | 重构 |
| `memory_summary.ts` | 逻辑合并到 `summary_compaction` | 重构 |
| `token_budget_trimmer.ts` | 对应 `token_budget_trim` executor | 改写接口 |

### 4.4 间接影响的文件

| 文件 | 影响 |
|------|------|
| `inference/prompt_builder_v2.ts` | `buildPromptTree` 和 `buildPromptBundleV2` 可能需要在 workflow 的后期 step 中调用，而非在调用方直接调用 |
| `inference/prompt_processors.ts` | `PromptTreeProcessor` 接口在切换完成后可以废弃 |
| `inference/context_builder.ts` | alias_values 清理（独立于接线策略，无论选 A 还是 B 都要做） |
| `inference/context_config.ts` | alias_values 内建默认值清理 |
| `context/service.ts` | `memory_context` 兼容性输出——如果 System B 不再依赖它，可简化 |
| `app/services/context_assembler.ts` | `buildInferenceContextV2` 命名和包装逻辑 |
| `app/services/operator_contracts.ts` | 消费 `buildInferenceContextV2` 的返回类型 |
| `memory/recording/compaction_service.ts` | 直接调用 `buildInferenceContext` |
| `ai/registry.ts` | `getPromptSlotRegistry` 目前正常，可能不需要改动 |

### 4.5 受影响的测试

```
tests/integration/inference-workflow-core.spec.ts
tests/integration/gateway_backed_inference.spec.ts
tests/integration/workflow-locking.spec.ts
tests/integration/action-intent-locking.spec.ts
tests/integration/death-note-memory-loop.spec.ts
tests/e2e/smoke-startup.spec.ts
```

以及 processor 自身的单元测试（如果存在）。

---

## 5. 接线方向：多轨汇合

### 5.1 为什么不是单轨

System B 设计文档（`prompt-workflow-formalization-design.md`）设想了纯 "ContextRun.nodes → section_drafts → fragments → tree → bundle" 的流水线。但实际存在两类本质不同的内容来源：

| 来源 | 内容 | 特征 |
|------|------|------|
| YAML slot 模板 | `system_core`、`role_core`、`world_context` 等 | 静态骨架，始终存在，不来自 ContextRun |
| ContextRun 节点 | 记忆、证据、状态快照等动态数据 | 随推理上下文变化，受策略过滤 |

强行把 YAML 模板内容伪装成 ContextNode 只会扭曲数据模型。承认多轨可以让每条轨道独立演进。

### 5.2 轨道划分（初版）

```
轨道 A（模板轨）：YAML slots → buildTemplateFragments(slotRegistry, context)
                    → template section_drafts

轨道 B（节点轨）：ContextRun.nodes → [memory_projection] → selected_nodes
                  → [node_working_set_filter] → working_set
                  → [summary_compaction / node_grouping] → section_drafts

轨道 C（快照轨）：pack_state / variable_context → post_process snapshot
                  → snapshot section_drafts

                              ↓
                    [placement_resolution]  ← 决定所有 section_drafts 的最终排列
                              ↓
                    [fragment_assembly]  ← section_drafts → PromptFragments → PromptTree
                              ↓
                    [token_budget_trim]
                              ↓
                    [bundle_finalize]  ← PromptTree → PromptBundleV2
```

轨道数量不固定——未来多轮对话可能引入 `conversation_history` 轨道，工具调用可能引入 `tool_call_log` 轨道。核心约束是：**所有轨道在 `placement_resolution` 步骤汇合**，汇合后的 pipeline 是统一的。

### 5.3 各轨道在不同 task_type 下的行为

| task_type | 模板轨 | 节点轨 | 快照轨 |
|-----------|--------|--------|--------|
| `agent_decision` | 完整 | 完整（记忆注入 + 策略过滤 + 摘要压缩） | 完整 JSON |
| `context_summary` | 精简 | 完整但侧重摘要 | 精简 |
| `memory_compaction` | 最小 | 完整 + node_grouping | 精简 |
| `intent_grounding_assist` | 最小 | 无节点轨 | 无快照 |

---

## 6. Executor 接口验证方案

### 6.1 验证目标

在铺量实现所有 executor 之前，用一个试点 executor 回答以下问题：

1. **接口签名**：`execute({context, profile, spec, state}) → Promise<PromptWorkflowState>` 是否好用？
2. **状态变更模式**：executor 应该是 mutate-in-place 还是 immutable copy？
3. **Profile 集成**：`spec.config` 和 `profile.defaults` 的数据流是否正确？
4. **Registry 调度**：按 `kind` 查找 executor 的分发机制是否工作？
5. **诊断记录**：`PromptWorkflowDiagnostics` 的 step_traces 结构是否足够？
6. **错误处理**：executor 失败时 pipeline 的行为语义是什么？

### 6.2 试点 executor：`token_budget_trim`

选择理由：
- 逻辑自包含——输入是有 token 估算的 tree，输出是裁剪后的 tree
- 有 System A 等价实现（`token_budget_trimmer.ts`）可直接对比行为
- 只依赖 `state.tree`，不依赖 `section_drafts` / `working_set` 等尚未填充的字段
- 是汇合后的统一步骤，不受轨道划分影响

### 6.3 验证步骤

**步骤 1 — 实现 executor**

新建 `context/workflow/executors/token_budget_trim.ts`，实现 `PromptWorkflowStepExecutor` 接口：

```typescript
// kind = 'token_budget_trim'
// 从 state.tree 读取，裁剪后可移除的 fragment
// 从 profile.defaults.token_budget 读取预算上限
// 从 spec.config 读取可能的覆盖参数
// 裁剪结果通过 state.diagnostics 记录
```

**步骤 2 — 构建最小 pipeline runner**

修改 `context/workflow/runtime.ts`（或新建 `pipeline_runner.ts`），替换 `runPromptWorkflowV2`：

```typescript
// 输入: context, profile, state
// 1. 从 registry 按 profile.steps[].kind 查找 executor
// 2. 按顺序执行每个 executor
// 3. 每个 step 前后记录 diagnostics trace
// 4. 返回最终 state
```

**步骤 3 — 桥接旧数据到新 state**

在 pipeline runner 调用前，用现有 `buildPromptTree()` 填充 `state.tree`：

```typescript
const tree = buildPromptTree(context, registry.slots);  // 复用现有逻辑
const state = createInitialPromptWorkflowState({
  context_run, actor_ref, task_type, strategy, pack_id, profile, tree
});
// state.tree 已填充，state.section_drafts 为空（等待未来轨道实现）
```

**步骤 4 — 接线到 inference/service.ts**

在 `executeRunInternal` 中替换：

```typescript
// 旧:
const { tree: processed } = await runPromptWorkflowV2({ tree, context: inferenceContext });
const prompt = buildPromptBundleV2(processed, inferenceContext);

// 新:
const profile = selectPromptWorkflowProfile({ task_type: 'agent_decision', strategy, pack_id });
const state = createInitialPromptWorkflowState({ ..., profile, tree });
const { state: final } = await runPromptWorkflowPipeline({ context, profile, state });
const prompt = buildPromptBundleV2(final.tree!, inferenceContext);
```

**步骤 5 — 运行现有测试**

以 `tests/integration/inference-workflow-core.spec.ts` 为主要验证目标。如果通过，证明接口正确、行为等价。

**步骤 6 — 接口调整**

根据试点中暴露的问题，修正：
- `PromptWorkflowState` 字段是否需要增删
- `PromptWorkflowStepExecutor` 签名是否需要调整
- `PromptWorkflowDiagnostics` 的 trace 结构是否够用

**步骤 7 — 确定 executor 实现模式**

试点通过后，输出一份 executor 实现模板和规范，作为后续 7 个 executor 的骨架。

### 6.4 验证通过标准

- [x] 试点 executor 的单元测试通过（token 预算内不裁剪、超预算正确裁剪、边界值处理）
- [x] 现有集成测试 `inference-workflow-core.spec.ts` 行为不变
- [x] 试点 executor 正确记录 diagnostics trace
- [x] Profile 的 `defaults.token_budget` 正确传递到 executor
- [x] `spec.config` 可以覆盖 profile defaults（验证配置优先级）

### 6.5 试点期间不涉及的内容

- 不实现其他 7 个 executor
- 不修改 `buildPromptTree()` / `buildPromptBundleV2()` 的内部逻辑
- 不清理 alias_values
- 不修改 `task_prompt_builder.ts`
- 不引入 section_drafts 的实际填充逻辑

---

## 7. Section Draft 格式定义

### 7.1 修订后的类型

基于选项 B（section-draft 中间层），对现有 `PromptSectionDraft` 做了 6 处修订：

```typescript
interface PromptSectionDraft {
  id: string;
  slot: PromptFragmentSlot;                    // 不变 — 归属哪个 slot
  track: 'template' | 'node' | 'snapshot' | (string & {});  // NEW — 轨道来源
  priority: number;                             // NEW — slot 内排序
  section_type: PromptSectionDraftType | (string & {});     // CHANGED — 开放联合，允许新轨道扩展
  title?: string | null;
  content_blocks: PromptSectionContentBlock[];  // 不变 — text | json，宏已在轨道层展开
  placement?: {
    anchor?: PromptFragmentAnchor | null;
    placement_mode?: PromptFragmentPlacementMode | null;
    depth?: number | null;
    order?: number | null;
  };
  removable: boolean;                           // NEW — token 裁剪标记
  estimated_tokens?: number;                    // NEW — per-section token 估算
  source_node_ids?: string[];                   // CHANGED — 可选（模板轨无 ContextNode 来源）
  metadata?: Record<string, unknown>;
}
```

### 7.2 修订理由

| 修订 | 原因 |
|------|------|
| `priority` | 同 slot 内多个 section 需要排序，Fragment 有此字段但 Section 没有 |
| `track` | 多轨架构下需要区分 section 来源，方便调试和诊断 |
| `section_type` 开放 | 封闭枚举阻止新轨道添加类型。用 `(string & {})` 保持智能提示同时允许扩展 |
| `source_node_ids` 可选 | 模板轨 section 不来自 ContextNode，不能强制要求 node_id |
| `removable` | token 裁剪需要知道哪些 section 可安全移除 |
| `estimated_tokens` | 裁剪决策需要 per-section token 数据 |

`content_blocks` 保持 `text | json` 不变——宏展开和条件/循环展开在轨道层面完成，到达 section 时内容已确定。

### 7.3 各轨道映射

| 字段 | 模板轨 | 节点轨 | 快照轨 |
|------|--------|--------|--------|
| `track` | `'template'` | `'node'` | `'snapshot'` |
| `slot` | 从 YAML 继承 | `memory_short_term` / `memory_long_term` / `memory_summary` | `post_process` |
| `section_type` | `system_instruction` / `role_context` / `world_context` / `output_contract` | `memory_short_term` / `memory_long_term` / `memory_summary` / `recent_evidence` | `context_snapshot` |
| `source_node_ids` | undefined | ContextNode.id[] | undefined |
| `removable` | false（骨架） | true（可裁剪） | true（可裁剪） |
| `content_blocks` | 宏展开后的模板文本 | 节点内容文本 | JSON.stringify 快照 |

---

## 8. Pipeline Runner 设计

### 8.1 设计决策

**决策 1 — 薄 runner**：Runner 只做调度循环。Profile 选择、State 初始化、轨道执行都由调用方负责。

理由：多轨架构下轨道是独立可组合的内容来源，不应耦合进 runner。调用方编排轨道 → runner 执行汇合后 pipeline。

**决策 2 — fail-fast**：Executor 抛异常 → pipeline 立即终止，异常透传到调用方。

理由：汇合后步骤有强依赖（未 placement 的 sections 无法 assembly，未 assembly 的 tree 无法 finalize），单步失败后继续没有意义。

**决策 3 — 轨道在 runner 之外执行**：Profile.steps 只包含汇合后步骤。模板轨/节点轨/快照轨在 runner 调用前由调用方编排，产出的 `section_drafts` 写入 `state.section_drafts`。

理由：轨道是内容来源（"pre-pipeline"），不是 pipeline step。不同 task_type 可以选择执行不同的轨道组合，而不需要修改 profile。

### 8.2 Runner 实现

```typescript
// context/workflow/pipeline_runner.ts

export interface RunPipelineInput {
  context: InferenceContext;
  profile: PromptWorkflowProfile;
  state: PromptWorkflowState;        // section_drafts 已由轨道填充
  registry: PromptWorkflowStepRegistry;
}

export interface RunPipelineResult {
  state: PromptWorkflowState;
  bundle: PromptBundleV2;
}

export const runPipeline = async (
  input: RunPipelineInput
): Promise<RunPipelineResult> => {
  const { context, profile, state, registry } = input;
  const enabledSteps = profile.steps.filter(s => s.enabled !== false);

  for (const spec of enabledSteps) {
    const executor = registry.get(spec.kind);
    if (!executor) {
      throw new Error(
        `Unknown step kind "${spec.kind}" for step "${spec.key}"`
      );
    }

    const beforeSnapshot = snapshotStateForTrace(state, spec);
    try {
      await executor.execute({ context, profile, spec, state });
      pushStepTrace(state, spec, 'completed', beforeSnapshot);
    } catch (error) {
      pushStepTrace(state, spec, 'failed', beforeSnapshot, error);
      throw error;
    }
  }

  const bundle = buildPromptBundleV2(state.tree!, context);
  return { state, bundle };
};
```

### 8.3 调用方示例

```typescript
// inference/service.ts 中的新调用链：

const profile = selectPromptWorkflowProfile({
  task_type: 'agent_decision',
  strategy: inferenceContext.strategy,
  pack_id: inferenceContext.world_pack.id
});

let state = createInitialPromptWorkflowState({
  context_run: inferenceContext.context_run,
  actor_ref: inferenceContext.actor_ref,
  task_type: 'agent_decision',
  strategy: inferenceContext.strategy,
  pack_id: inferenceContext.world_pack.id,
  profile
});

// 轨道阶段（runner 之外，由调用方编排）
const slotRegistry = getPromptSlotRegistry();
state.section_drafts = [
  ...runTemplateTrack(slotRegistry, inferenceContext),
  ...runNodeTrack(inferenceContext.context_run, inferenceContext),
  ...runSnapshotTrack(inferenceContext),
];

// Pipeline 阶段
const registry = createConfiguredStepRegistry();
const { bundle } = await runPipeline({
  context: inferenceContext,
  profile,
  state,
  registry
});
```

### 8.4 Profile 步骤调整

Profile.steps 只包含汇合后步骤，不再包含轨道相关步骤：

```typescript
// agent-decision-default:
steps: [
  { key: 'placement',    kind: 'placement_resolution' },
  { key: 'assembly',     kind: 'fragment_assembly' },
  { key: 'budget_trim',  kind: 'token_budget_trim' },
  { key: 'finalize',     kind: 'bundle_finalize' },
]
```

原先定义在 profile 中的 `memory_projection`、`node_working_set_filter`、`node_grouping` 不再作为 pipeline step——它们是节点轨内部的实现细节，由节点轨函数自行编排。

---

## 9. 汇合后 Executor 设计

### 9.1 placement_resolution

**输入**：`state.section_drafts`（所有轨道产出的扁平列表）

**输出**：排序后的 `state.section_drafts`

**算法**：
1. 按 slot 分组
2. 每个 slot 内：
   - `prepend` → 放在 slot 最前
   - `append` → 放在 slot 最后
   - `before_anchor` / `after_anchor` → 查找 anchor 目标 section，插入对应位置
   - 无 placement 声明 → 按 `priority` 降序填入中间
3. Anchor 无法解析时（目标 section 不存在）：**fallback 到 priority 排序，同时记录警告到 `state.diagnostics`**
4. 更新每个 section 的最终位置到 metadata

### 9.2 fragment_assembly

**输入**：排序后的 `state.section_drafts`

**输出**：`state.tree`（PromptTree，含 `fragments_by_slot` 和 `slot_registry`）

**策略**：严格扁平——一个 section → 一个 `PromptFragmentV2`，不产生嵌套。

```
section → PromptFragmentV2 {
  slot_id: section.slot,
  priority: section.priority,
  children: section.content_blocks.map(block → PromptBlock),
  removable: section.removable,
  estimated_tokens: section.estimated_tokens,
  ...
}
→ group by slot → tree.fragments_by_slot
→ tree.slot_registry 从 slot 配置填充
```

后期如需嵌套，section 加 `parent_section_id` 字段即可扩展，不改变当前接口。

### 9.3 token_budget_trim

试点 executor。将 System A `token_budget_trimmer.ts` 的逻辑移植到 `PromptWorkflowStepExecutor` 接口。从 `state.tree` 读取，裁剪后可移除的 fragment，从 `profile.defaults.token_budget` 获取预算上限。

### 9.4 bundle_finalize

包装 `buildPromptBundleV2(state.tree, context)` → 写入 `state.tree` 的最终渲染结果。输入/输出都是 `PromptWorkflowState`。

---

## 10. Context Builder 兼容性别名分析

### 10.1 alias_values 的双轨机制

`PromptVariableLayer` 同时承载两套变量访问路径：

| 层级 | 路径格式 | 解析方式 | 示例 |
|------|---------|---------|------|
| `values` | `namespace.path` | `lookupPromptVariable` → namespaced 解析 | `actor.display_name` |
| `alias_values` | 扁平 key | `flattenPromptVariableContextToVisibleVariables` → 全局扁平合并 | `actor_name` |

### 10.2 alias_values 的三个生成来源

1. **YAML 配置** (`context_config.ts:16-106`) — 通过 `{{ }}` 模板引用 `runtimeObjects`，可被用户覆盖
2. **硬编码 fallback** (`context_builder.ts:659-699`) — 当 YAML 配置为空时走的手写分支
3. **其他运行时调用** (`active_pack_runtime_facade.ts:120-150`, `template_renderer.ts:21`)

### 10.3 需要清理的内容

1. 硬编码 fallback (`context_builder.ts:659-699`) — 与 YAML 配置功能重复
2. 内建默认 alias 映射 (`context_config.ts:26-104`) — 命名无规范
3. 多源重复 — 同一个 key（如 `actor_name`）在多个来源中重复定义
4. 命名不一致 — `actor_name` vs `request_agent_id` 无统一风格

### 10.4 清理原则

- 保留 `alias_values` 机制（供用户/包作者声明快捷方式）
- 删除硬编码的默认 alias 映射
- alias 定义权移交给 YAML 配置或 world pack 配置
- 语法方案待定

---

## 11. 调用路径统一与命名别名清理

### 11.1 两条路径统一

当前两条独立的 prompt 构建路径，System B 下统一为同一入口：

```
路径 A (inference/service.ts) ─┐
路径 B (ai/task_prompt_builder.ts) ─┘
                                    ↓
               tracks → runPipeline() → bundle
                                    ↓
                    路径 A: provider.run(bundle)
                    路径 B: AiTaskRequest { prompt_bundle_v2: bundle }
```

`task_prompt_builder.ts` 的 `buildAiTaskRequestFromInferenceContextV2` 不再自己构建 prompt——改为接收已构建好的 `PromptBundleV2`，只负责包装为 `AiTaskRequest`。

### 11.2 命名别名清理

| 位置 | 问题 | 处理 |
|------|------|------|
| `context_assembler.ts:18` | `buildInferenceContextV2` — "V2" 与 Prompt V2 无关 | 重命名为 `buildExtendedInferenceContext` |
| `task_prompt_builder.ts:55` | `buildAiTaskRequestFromInferenceContext` 空壳委托给 V2 | 删除空壳，只保留一个函数 |
| `context_builder.ts:659-699` | 硬编码 `alias_values` fallback | 删除，依赖 YAML 配置的内建默认值 |

alias_values 机制本身保留，用户可通过 YAML 配置声明自定义 alias。硬编码的 fallback 和默认映射删除。

---

## 12. 工程决策分析

以下每个问题都从**抉择、代价、建议**三个维度讨论。标记 `✅` 为已定决策，`⚠️` 为倾向但待确认，`❓` 为开放问题。

---

### 12.1 权限过滤的统一

**现状**：两套独立的权限过滤机制——

| 机制 | 位置 | 判定标准 | 写入方式 |
|------|------|---------|---------|
| `policy_filter` processor | 管道第 3 步 | `visibility_blocked === true` 或 `policy_gate === 'deny'` | 覆盖 `denied_reason` |
| `applyPermissionFilter` | 管道之后独立执行 | ACL `read`/`visible` 权限列表 + feature flag 门控 | 追加 `denied_reason`（分号连接） |

两者都写 `fragment.permission_denied` 和 `fragment.denied_reason`，执行顺序不同导致最终 `denied_reason` 语义不同。`applyPermissionFilter` 还有 feature flag 门控（`prompt_slot_permissions` 关闭时完全跳过）。

**抉择**：

- **A. 合并为单一管道步骤**：将 ACL 检查逻辑移入一个独立 executor `permission_filter`，替代 `policy_filter`。管道步骤顺序变为 `placement_resolution → fragment_assembly → permission_filter → token_budget_trim → bundle_finalize`。
- **B. 保留两个过滤器，统一写入语义**：`policy_filter` 处理内容策略（visibility/policy_gate），`permission_filter` 处理 ACL 权限。两者各自写入结构化的 `denial: { source, reason }[]`，最终合并逻辑在 `bundle_finalize` 中。
- **C. `node_working_set_filter` 内嵌策略过滤，ACL 过滤保留为独立步骤**：策略过滤在节点轨内部（节点是否可见是节点选择问题），ACL 过滤在汇合后（因为它需要完整 Fragment + SlotConfig）。

**代价评估**：

| 选项 | 优势 | 风险 |
|------|------|------|
| A | 最简洁，一个步骤一个职责，`denied_reason` 只有一个写入者 | 两个判定标准的抽象层不同（内容策略 vs ACL），强行合并逻辑会更复杂 |
| B | 职责分离清晰，两个过滤器各自完整 | 两个步骤之间的交互需要额外的合并逻辑，`denied_reason` 需要结构化 |
| C | 策略过滤降级为节点选择的内部细节，符合"选择什么节点"的语义 | 轨道内部的过滤决策无法被 pipeline diagnostics 追踪 |

**建议**：⚠️ 选 C。策略过滤（`policy_gate`/`visibility_blocked`）本质是"哪些节点应进入 working_set"，属于节点选择而非片段过滤。ACL 权限属于"最终渲染时谁能看到什么"，需要 Fragment 已经组装完成。决策点：(1) `permission_filter` executor 继承 feature flag 门控；(2) `denied_reason` 改为 `denial: { source: string; reason: string }[]`，取代当前的分号拼接字符串。

---

### 12.2 宏展开时序与轨道职责

**现状**：System A 中 `macro_expansion` 是管道第一步，`memory_injector` 在其后注入的内容**不经宏展开**。当前实际上不是 bug——memory 注入的片段是纯文本（记忆条目内容），不含 `{{ }}` 宏引用。

**设计将宏展开移至模板轨内部**，但这引出一个架构问题：各轨道的产出应该包含什么？

**抉择**：

- **A. 轨道产出保证已展开**：宏展开是模板轨内部责任。节点轨和快照轨的产出不包含宏引用——它们的 `content_blocks` 全部是 `kind: 'text'` 且文本已确定。如果未来某轨道需要宏引用，该轨道自行负责展开。
- **B. 汇合后二次展开**：所有轨道产出可以包含宏引用，在 `placement_resolution` 之后、`fragment_assembly` 之前增加一个 `macro_expansion` 管道步骤。

**代价评估**：

| 选项 | 优势 | 风险 |
|------|------|------|
| A | 轨道职责边界清晰——"产出即可用"；管道步骤更少；避免宏展开顺序依赖 | 每个轨道都要处理自己的语法展开，违反 DRY；如果宏语义变化，每个轨道要同步 |
| B | 宏展开逻辑集中在一处，所有轨道无需关心宏；未来新增轨道零成本 | 需要定义什么上下文可用于宏展开（节点轨产出的 section 中 `{{actor_name}}` 引用什么变量？）；二次展开可能引入不必要的性能开销 |

**建议**：⚠️ 选 A。当前节点轨和快照轨的产出不包含宏引用，B 的"二次展开"步骤在没有消费者时是死代码。轨道产出保证文本已确定是最简单的约定。如果未来某个轨道需要宏展开，它内部调用模板渲染器即可——模板渲染器是共享的，不存在 DRY 违反（各轨道不重复实现宏语法，而是调用同一个 `renderNarrativeTemplate`）。

决策点：模板轨的 `runTemplateTrack` 调用 `renderNarrativeTemplate` 产出已展开的 `content_blocks`，此行为写入函数契约。

---

### 12.3 Section type 与 Slot 的映射

**现状**：`PromptFragmentSlot`（9 值）和 `PromptSectionDraftType`（9 值）不对齐：

- `recent_evidence` 有 section_type 但无对应 slot
- `system_policy`、`post_process` 有 slot 但无 section_type
- `memory_*` 三者 slot 和 section_type 名称相同但语义不同

**抉择**：

- **A. section_draft 用 `slot` 字段直接声明归属**：一个 section_draft 通过 `slot` 字段知道属于哪个 slot，`section_type` 仅为元数据（用于诊断和过滤），不驱动路由。一个 slot 可以包含多个不同 `section_type` 的 section。
- **B. 严格映射表**：定义全局 `SECTION_TYPE_TO_SLOT: Record<PromptSectionDraftType, PromptFragmentSlot>`，每个 section_type 唯一对应一个 slot。不存在映射的 section_type 或 slot 需要补充类型定义。

**代价评估**：

| 选项 | 优势 | 风险 |
|------|------|------|
| A | 灵活；`section_type` 可以扩展而不影响 slot 枚举；`recent_evidence` 自然归属 `memory_short_term` slot | 需要在 profile 或配置中约定哪些 section_type 走哪些 slot，否则 `fragment_assembly` 行为不确定 |
| B | 映射关系在类型层面可验证；`fragment_assembly` 实现简单 | 修改 slot 或 section_type 枚举时必须同步更新映射表；当前的不对齐说明两套枚举的设计意图本来就不同 |

**建议**：⚠️ 选 A。映射表是脆弱的——slot 是布局概念（"内容在 prompt 中的位置"），section_type 是内容概念（"这是什么类型的内容"）。它们的关系是多对一的：`recent_evidence` 和 `memory_short_term` 都进入 `memory_short_term` slot，但它们的渲染优先级、可移除性、token 权重不同。`slot` 字段已存在于 `PromptSectionDraft` 上，`section_type` 仅作为元数据用于诊断和 `section_policy` 消费。

补充缺失：`PromptSectionDraftType` 需要增加 `'system_policy'` 和 `'context_snapshot'`，`output_contract` 可复用现有 `system_instruction` section_type 或新增 `'output_contract'`。具体在实现 `fragment_assembly` 时决定。

---

### 12.4 section_policy 的消费者

**现状**：`section_policy`（`minimal | standard | expanded | include_only`）在三个地方定义（`PromptWorkflowSectionPolicy` 类型、`PromptWorkflowStepSpec.config`、profile `defaults`），但零运行时消费者。

**抉择**：

- **A. 立即实现消费者**：`node_working_set_filter` 或一个新 executor 根据 `section_policy` 值过滤/展开 section_drafts。
- **B. 标记为预留，当前不实现**：类型保留，消费者延后。System B 推进范围内 `section_policy` 不影响行为。
- **C. 废弃并移除**：从类型、配置、profile 默认值中删除 `section_policy`。

**代价评估**：

| 选项 | 优势 | 风险 |
|------|------|------|
| A | 类型不是死代码；`section_policy` 能控制 prompt 详略 | 增加实现量；消费者设计需要明确语义（`minimal` 对哪些 section_type 意味着什么？） |
| B | 不阻塞当前推进；类型存在提供扩展点 | 死代码——零消费者持续增加认知负担；未来实现时可能发现类型定义不匹配实际需求 |
| C | 消除认知负担；YAGNI | 未来重新引入需要设计合适的类型 |

**决定**：✅ 选 C（废弃并移除）。`section_policy` 类型、Zod schema、YAML 默认值、profile 字段已于 2026-05-03 从代码中全量删除。理由：语义从未明确定义（`minimal` 对 `memory_short_term` 意味着什么？），六层铺设零消费，YAGNI 在此完全适用。

---

### 12.5 轨道函数的诊断与错误处理

**现状**：轨道函数（`runTemplateTrack`、`runNodeTrack`、`runSnapshotTrack`）在 pipeline runner 之外执行，不受 `PromptWorkflowDiagnostics.step_traces` 追踪。

**抉择**：

- **A. 轨道函数写入 `state.diagnostics` 摘要**：每个轨道函数返回产出摘要（section 数量、slot 分布、关键决策），调用方写入 `state.diagnostics` 的一个新字段（如 `track_traces`），与 `step_traces` 平级。
- **B. 轨道函数内部创建 `TrackDiagnostics` 结构**：由轨道函数自行填充诊断，最终合并到 `state.diagnostics`。
- **C. 轨道函数不记录诊断，只在 runner 的 step_trace 中记录轨道产出摘要**：runner 在每个轨道函数调用后记录一条 pseudo step_trace。

**代价评估**：

| 选项 | 优势 | 风险 |
|------|------|------|
| A | 轨道诊断与 pipeline 诊断统一在一个 `state.diagnostics` 结构中 | 需要给 `PromptWorkflowDiagnostics` 增加字段，类型变更 |
| B | 轨道函数自治，各自管理诊断 | 诊断结构分散，调试时需要聚合多个来源 |
| C | 不改 `PromptWorkflowDiagnostics` 结构；轨道对诊断机制不感知 | 轨道内部的决策点（策略过滤、摘要压缩阈值）不可追踪 |

**建议**：⚠️ 选 A。增加 `track_traces: TrackTrace[]` 到 `PromptWorkflowDiagnostics`，结构为 `{ track: 'template' | 'node' | 'snapshot', input_summary: Record<string, unknown>, output_summary: Record<string, unknown>, decisions: Record<string, unknown>[] }`。轨道函数返回 `TrackResult<T>`（含 `result: T`、`trace: TrackTrace`），调用方合并到 state。

决策点：轨道函数的错误处理策略与 pipeline 一致——**fail-fast**。轨道函数抛异常 → 调用方捕获后终止整个推理（与 pipeline runner 的 fail-fast 策略一致）。轨道产出部分降级（如节点轨过滤失败但返回空 working_set）由轨道函数内部处理，降级决策记录在 `decisions` 中。

---

### 12.6 State 变更模型：mutate-in-place vs 不可变快照

**现状**：§8.2 的 runner 实现使用 `void` 返回签名的 executor（mutate-in-place），但 `step_traces` 需要 `beforeSnapshot`。

**抉择**：

- **A. Mutate-in-place + 轻量摘要**：executor 直接修改 `state`，step trace 只记录摘要信息（`section_count_by_slot`、`total_estimated_tokens`、`denied_fragment_count`），不深拷贝完整 state。
- **B. 不可变 state + 结构化共享**：每个 executor 返回新的 `PromptWorkflowState`（用 spread + 局部替换实现结构化共享），step trace 可以安全引用 before state。
- **C. Mutate-in-place + selective deep-copy**：executor 直接修改 `state`，在关键步骤前选择性深拷贝需要的子结构（如 `section_drafts`）。

**代价评估**：

| 选项 | 优势 | 风险 |
|------|------|------|
| A | 性能最优；实现最简单 | step trace 不是完整快照，无法回放完整 state；摘要字段需要预先设计 |
| B | 可追溯；step trace 可引用完整 before state，支持回放和 diff | `ContextRun.nodes` 每次拷贝代价高；需要所有子类型支持结构化共享（当前 `PromptWorkflowState` 不支持） |
| C | 平衡——只拷贝关键子结构 | 需要判断哪些子结构是"关键的"，判断可能随实现演进过时 |

**建议**：⚠️ 选 A。理由：(1) 当前项目不上线，`ContextRun.nodes` 的深拷贝没有生产场景的必要性；(2) step trace 的核心用途是调试——摘要信息足以定位问题；(3) 如果未来需要完整回放，可在开发环境增加一个全量快照模式，通过 config 切换。

具体实现：`PromptWorkflowStepTrace.before` 和 `after` 改为 `StepSnapshotSummary` 类型，包含 `{ section_count_by_slot: Record<string, number>; total_estimated_tokens: number; denied_fragment_count: number; working_set_node_count: number }`。不再存储 `Record<string, unknown>`。

---

### 12.7 ai_message_projection 步骤类型

**现状**：`PromptWorkflowStepKind` 包含 `'ai_message_projection'`，但无任何 profile 使用它，设计文档不讨论它。

**抉择**：

- **A. 保留为未来扩展，加注释**：在类型定义上注释 `// @planned future: not used in any built-in profile`
- **B. 从类型中移除**：YAGNI。如果未来需要，添加一个字符串字面量到联合类型是零成本的。

**代价评估**：

| 选项 | 优势 | 风险 |
|------|------|------|
| A | 提醒维护者此类型有计划用途 | 死代码增加认知负担；注释可能过时 |
| B | 类型干净；联合类型是开放的不影响未来 | 如果有人依赖此字符串常量，删除会破坏引用 |

**建议**：✅ 选 B。`PromptWorkflowStepKind` 是联合类型（`| (string & {})`），已有开放扩展。`'ai_message_projection'` 不是枚举值，删除它不阻止任何人使用该字符串。当前零消费者，零 profile 引用，保留它只有成本没有收益。

---

### 12.8 轻量路径机制

**现状**：`task_prompt_builder.ts` 的绕过路径反映了真实需求——不是所有调用方都需要完整的多轨汇合 pipeline。System B 当前设计所有请求走完整 pipeline。

**抉择**：

- **A. Profile 配置跳过轨道**：profile 声明哪些轨道启用（如 `tracks: { template: true, node: false, snapshot: false }`），未被启用的轨道不执行，产出空 section_drafts。pipeline runner 正常执行汇合后步骤。
- **B. 轻量 profile**：定义专门的轻量 profile（如 `agent-decision-lite`），只含 `placement_resolution` 和 `bundle_finalize` 步骤，跳过 `token_budget_trim` 和 `section_policy` 等步骤。轨道函数仍执行，但 section 数量最少。
- **C. 保持所有请求走完整 pipeline**：绕过路径被视为 bug 修复，轻量需求通过 profile 的 `defaults.token_budget` 等参数调节，不跳过轨道或步骤。

**代价评估**：

| 选项 | 优势 | 风险 |
|------|------|------|
| A | 灵活；不同调用方可按需跳过 | 引入轨道跳过逻辑，增加 profile 复杂度和测试组合数 |
| B | 复用 pipeline runner，不引入跳过逻辑 | 轻量 profile 仍然执行完整 pipeline 的框架代码，性能有冗余 |
| C | 最简实现；pipeline 行为一致可预测 | 即使是最轻量的 `intent_grounding_assist` 也要走完整轨道→汇合→渲染，即使模板轨只需骨架模板 |

**决定**：✅ 选 A，纳入本次 System B 推进范围（Phase 5）。`PromptWorkflowProfile` 增加 `tracks?: { template?: boolean; node?: boolean; snapshot?: boolean }`，调用方根据 profile.tracks 决定执行哪些轨道。三个内置 profile 默认所有轨道启用。详见推进计划 Phase 5。

---

### 12.9 PromptTree.metadata 的填充时机

**现状**：`buildPromptTree()` 硬编码 `profile_id: null`。

**抉择**：

- **A. Pipeline runner 在创建初始 state 时不填 `tree.metadata`，由 `bundle_finalize` 步骤在最终渲染前写入 `profile.id` 和 `profile.version`**
- **B. Pipeline runner 在创建初始 state 时将 `profile.id` 和 `profile.version` 写入 `tree.metadata`**
- **C. 不在 `tree.metadata` 上存 profile 信息，改为只在 `bundle.metadata` 上存**

**代价评估**：

| 选项 | 优势 | 风险 |
|------|------|------|
| A | `tree` 在 pipeline 过程中可以被任意步骤观察，metadata 在最终步骤补全 | 如果某个 executor 需要读取 `tree.metadata.profile_id`（如根据 profile 调整行为），它拿到的是 null |
| B | profile 信息从 pipeline 开始就可用 | `tree` 不再是 executor 不可变输入——executor 可能错误地依赖 metadata |
| C | 职责清晰——profile 信息属于 bundle 层（传输层），不属于内部数据结构 | 调试时 `tree` 上无 profile 信息，需要翻到 `bundle.metadata` |

**建议**：✅ 选 B。`profile.id` 和 `profile.version` 是 pipeline 的输入参数，不是 executor 的产出。它们应在 `createInitialPromptWorkflowState` 中从 profile 写入 `tree.metadata`，而非延迟到 `bundle_finalize`。这保证了任何需要 profile 信息的 executor 可以从 `state.profile` 或 `state.tree.metadata` 读取（两者一致）。

---

### 12.10 模板轨的 slot 归属与空 slot 处理

**现状**：§5.3 的轨道映射表未指定 `output_contract` slot 的轨道归属。当前 `buildPromptTree` 为 `output_contract` 生成动态内容（当 slot 没有 `default_template` 时的 fallback）。`memory_short_term`、`memory_long_term`、`memory_summary` slot 在当前 System A 中由 `memory_injector` 完全替换，模板轨是否为这些 slot 生成 section_draft 未定义。

**抉择**：

- **A. 模板轨只为有 `default_template` 或 `template_context` 的 slot 生成 section_draft**：`memory_*` slot 和 `output_contract`（无模板时）不生成模板 section，由各自轨道独占。
- **B. 模板轨为所有 enabled slot 生成 section_draft**：即使 slot 没有 `default_template`，也生成一个空 section（占位），其他轨道的 section 可以通过 anchor 插入此占位前后。

**代价评估**：

| 选项 | 优势 | 风险 |
|------|------|------|
| A | 简单；模板轨职责明确——"有模板才产出" | 某些 slot 可能没有轨道产出（如 `memory_summary` 在 compaction 场景下为空），导致 `fragment_assembly` 产出的 tree 中该 slot 无任何 fragment |
| B | 每个 slot 都有至少一个 section，`fragment_assembly` 总有内容 | 空占位 section 是无意义的数据；anchor 机制在 System A 中根本未实现 |

**建议**：✅ 选 A。`fragment_assembly` 的职责是从 section_drafts 构建 fragment array——如果某 slot 无 section_drafts，该 slot 的 fragment array 为空，`buildPromptBundleV2` 已有跳过空 slot 的逻辑（`renderSlotText` 跳过全 denied slot，空 fragment array 等效）。模板轨只为有模板的 slot 产出，这是最自然的约定。

`output_contract` 无 `default_template` 时由 `buildDynamicSlotFragments` 生成动态内容——在 System B 中，这逻辑应移到快照轨或模板轨的动态分支中。具体归属在实现模板轨时决定。

---

### 12.11 节点轨内部编排的可配置性

**现状**：§5.2 和 §5.3 将 `memory_projection → node_working_set_filter → summary_compaction` 列为节点轨内部步骤。§8.4 将节点轨步骤从 profile 中移除（profile 只含汇合后步骤）。但节点轨内部步骤的编排方式未定义——是 `runNodeTrack` 函数内部硬编码顺序，还是有子 registry/子 profile？

**抉择**：

- **A. 硬编码顺序**：`runNodeTrack` 内部按固定顺序调用子步骤函数（投影、过滤、压缩、分组）。
- **B. 子 profile**：节点轨有自己的步骤列表（如 `node_track: { steps: [...] }`），通过子 registry 查找和执行。
- **C. 硬编码但可跳过**：`runNodeTrack` 内部有序列化步骤，但每步有 feature flag 或 config 控制（如 compaction 阈值）。

**代价评估**：

| 选项 | 优势 | 风险 |
|------|------|------|
| A | 最简单；节点轨步骤目前固定不变，不需要配置 | 未来如需改变节点轨步骤（如不同 task_type 的记忆处理策略不同），需修改 `runNodeTrack` 代码 |
| B | 与 pipeline runner 模式一致；节点轨步骤可配置 | 过度设计——节点轨步骤是同一抽象层的内部实现细节，不应暴露给外部配置；增加嵌套 registry 的复杂度 |
| C | 平衡——步骤固定但行为参数可配置 | 参数配置仍需在 profile 或 config 中声明，增加 profile 复杂度 |

**建议**：⚠️ 选 A。节点轨步骤是单次推理中节点选择的内部流程，不是可插拔的扩展点。如果未来不同 task_type 需要不同的节点处理策略，应该在 `runNodeTrack` 内部根据 `task_type` 分支，而不是引入子 profile 配置。这与"profile 只含汇合后步骤"的设计决策一致——轨道内部实现是封装的。

---

### 12.12 试点验证的覆盖范围

**现状**：§6 选择 `token_budget_trim` 作为试点 executor，在初始阶段 `state.section_drafts` 为空，`token_budget_trim` 直接操作 `state.tree`。但完整 System B 下 `token_budget_trim` 操作的是 `fragment_assembly` 产出的 tree，数据来源不同。

**具体风险**：pilot 验证了接口签名（`execute({context, profile, spec, state}) → Promise<void>`）、profile 传递、registry 调度。但以下数据契约未在 pilot 中验证：

1. `state.tree` 中 fragment 的 `estimated_tokens` 和 `removable` 字段——pilot 阶段由 `buildPromptTree` 产出，完整 System B 下由 `fragment_assembly` 从 section_draft 转换而来。
2. Fragment 的 `permission_denied` 字段——pilot 阶段由 `applyPermissionFilter` 设置，完整 System B 下由 `permission_filter` executor 设置。
3. Slot 内 fragment 的排序——pilot 阶段由 `buildPromptTree` 的插入顺序决定，完整 System B 下由 `placement_resolution` 决定。

**抉择**：

- **A. 承认试点只验证接口签名，在实现 `fragment_assembly` 后增加一轮集成验证**：pilot 通过后正常推进，但在 `fragment_assembly` 实现后，用相同的测试用例（`inference-workflow-core.spec.ts`）重新验证 `token_budget_trim` 的行为。
- **B. 扩大试点范围，同步实现 `fragment_assembly`**：pilot 阶段同时实现 `fragment_assembly`（最简版本——从 section_draft 映射到 fragment），让 `token_budget_trim` 在接近真实数据上验证。
- **C. 在 pilot 中用 adapter 模拟 `fragment_assembly` 产出**：编写一个最简 adapter 将 `buildPromptTree` 的产出转换为 `section_drafts`，再由 `fragment_assembly` 转回 fragment，让 `token_budget_trim` 在两层转换后的数据上验证。

**代价评估**：

| 选项 | 优势 | 风险 |
|------|------|------|
| A | 不增加 pilot 范围；焦点在验证 executor 接口 | pilot 验证的行为与最终行为有差异，可能遗漏数据契约问题 |
| B | 验证最关键的数据契约——section_draft → fragment 转换 | 增加 pilot 工作量；`fragment_assembly` 依赖 `section_drafts` 有内容，需要模板轨先跑通 |
| C | 在 pilot 范围内验证数据契约，不依赖轨道实现 | adapter 代码是一次性的，pilot 通过后删除；增加 pilot 复杂度 |

**建议**：⚠️ 选 A，但附条件：在实施步骤 3（实现汇合后 executor）中，`fragment_assembly` 实现后**必须**运行 `inference-workflow-core.spec.ts` 完整回归测试，并额外验证 `token_budget_trim` 在 `fragment_assembly` 产出的 tree 上行为正确。pilot 阶段的验证报告明确记录此差异和后续验证计划。

---

### 12.13 PromptWorkflowStepTrace 的结构化

**现状**：`PromptWorkflowStepTrace.before` 和 `after` 类型为 `Record<string, unknown>`——完全无结构，每个 executor 可以写入任意字段。

**抉择**：

- **A. 定义 `StepSnapshotSummary` 类型**：`before/after` 改为结构化类型，包含 `{ section_count_by_slot, total_estimated_tokens, denied_fragment_count, working_set_node_count }`。
- **B. 保持 `Record<string, unknown>`，但定义各 executor 的写入契约**：在文档中规定每个 executor 必须写入哪些字段，类型仍然宽松。
- **C. 混合方案**：`before/after` 改为 `StepSnapshotSummary`（结构化摘要），executor 额外的诊断信息写入 `notes: Record<string, unknown>`（无结构，用于扩展）。

**代价评估**：

| 选项 | 优势 | 风险 |
|------|------|------|
| A | 类型安全；可自动化对比 before/after | 不同步骤关注的摘要不同（`placement_resolution` 关注 anchor 解析，`token_budget_trim` 关注 token 数），单一类型可能不够灵活 |
| B | 灵活；不限制 executor | 无法自动化验证诊断数据；不同 executor 写不同字段，调试时需要翻代码 |
| C | 核心摘要有类型保证，扩展信息留弹性 | `notes` 可能膨胀为第二个无结构 dumping ground |

**建议**：✅ 选 C。`StepSnapshotSummary` 定义核心可对比字段（`section_count_by_slot`、`total_estimated_tokens`、`denied_fragment_count`、`working_set_node_count`），这些字段在所有汇合后步骤中都有意义。executor 的步骤特定诊断（如 `placement_resolution` 的 anchor 解析结果、`token_budget_trim` 的预算分配详情）写入 `notes`。

---

### 12.14 当前设计对 TODO 需求的预留

以下需求来自项目规划但不在 System B 推进范围内，此节记录以确保当前设计不阻塞未来扩展：

- **SectionDraft.metadata 扩展点**：当前 `metadata: Record<string, unknown>` 可承载触发概率、冷却时间、条件激活等元数据，未来 executor 可消费这些字段
- **多轮对话轨道**：需要跨请求持久化和增量构建，超出当前单次推理的 state 模型。当前设计的轨道概念可容纳此扩展，但 state 生命周期需要重新设计
- **Slot 定位系统**：当前只有 fragment 层面的 anchor/placement，没有 slot 之间的位置关系。`PromptFragmentPlacementMode` 可作为 slot 定位的基础类型扩展
- **宏/函数嵌套与作用域**：当前设计将宏展开限制为单次扁平替换。如需嵌套/作用域，需要独立的宏系统设计，与当前 pipeline 解耦

---

## 13. 决策记录与下一步

### 已确认

- [x] 完整切换策略（无用户、无数据，不需要兼容期）
- [x] 多轨汇合架构（模板轨 + 节点轨 + 快照轨，在 placement_resolution 汇合）
- [x] `token_budget_trim` 作为试点 executor
- [x] section-draft 中间层（选项 B）——所有轨道产出 `PromptSectionDraft[]`，`fragment_assembly` 统一转换
- [x] `PromptSectionDraft` 格式修订（6 处改动：priority、track、section_type 开放、source_node_ids 可选、removable、estimated_tokens）
- [x] Pipeline runner 设计（薄 runner、fail-fast、轨道在 runner 外执行、profile 只含汇合后步骤）
- [x] 汇合后 executor 设计（placement_resolution: anchor fallback + 警告、fragment_assembly: 严格扁平）
- [x] 模板轨设计（宏展开移入模板轨内部，section 产出时文本已确定）
- [x] 节点轨设计（直接消费 `context_run.nodes`，单一 `runNodeTrack` 函数，内部处理注入/过滤/摘要）
- [x] 调用路径统一 + 命名别名清理
- [x] 权限过滤统一：策略过滤归入节点轨，ACL 过滤保留为独立 executor `permission_filter`（§12.1 选 C）
- [x] 宏展开轨道职责：各轨道产出保证已展开文本，宏展开是模板轨内部责任（§12.2 选 A）
- [x] Section type 与 Slot 映射：`section_type` 为元数据，`slot` 字段驱动路由（§12.3 选 A）
- [x] `ai_message_projection` 步骤类型：从联合类型中移除（§12.7 选 B）
- [x] `PromptTree.metadata` 填充：在 `createInitialPromptWorkflowState` 中从 profile 写入（§12.9 选 B）
- [x] 模板轨 slot 归属：只为有 `default_template` 或 `template_context` 的 slot 生成 section_draft（§12.10 选 A）
- [x] 节点轨内部编排：硬编码顺序，不引入子 registry（§12.11 选 A）
- [x] Step trace 结构化：`before/after` 改为 `StepSnapshotSummary` + `notes`（§12.13 选 C）
- [x] State 变更模型：mutate-in-place + 轻量摘要（§12.6 选 A）
- [x] `section_policy` 废弃并全量删除（§12.4 选 C，2026-05-03 执行）：类型、Zod schema、YAML 默认值、profile 字段、测试引用全部移除
- [x] 轻量路径机制：纳入本次推进范围，`PromptWorkflowProfile` 增加 `tracks` 配置，Phase 5 实现（§12.8 选 A）
- [x] Phase 1 试点验证完成（2026-05-03）：`token_budget_trim` executor + pipeline runner + service.ts 接线，7 单元测试 + 6 集成测试通过
- [x] Phase 2 汇合后 pipeline 完成（2026-05-03）：4 个 executor（placement_resolution, fragment_assembly, permission_filter, bundle_finalize）+ profile 更新 + 类型修订，10 单元测试 + 6 集成测试通过
- [x] 试点验证覆盖范围：`fragment_assembly` 实现后已运行集成回归测试，行为正确（§12.12 条件满足）
- [x] `PromptSectionDraftType` 补充：已在 Phase 2 增加 `'system_policy'`，`'context_snapshot'` 已存在（§12.3）
- [x] Phase 3 模板轨完成（2026-05-03）：`runTemplateTrack` + `TrackResult` 类型，7 单元测试通过
- [x] Phase 4 节点轨完成（2026-05-03）：`runNodeTrack`（过滤/投影/压缩/分组），12 单元测试通过
- [x] Phase 5 路径统一 + 轻量路径完成（2026-05-03）：三轨接线、`buildPromptTree` 移除、`profile.tracks`、快照轨、alias 清理、`buildExtendedInferenceContext` 重命名，2 单元测试通过
- [x] Phase 6 清理完成（2026-05-03）：删除 5 个 System A processor + `runPromptWorkflowV2` + `PromptTreeProcessor` + `ai_message_projection`

### 待确认

（全部已确认并执行，无待确认项。）

### 实施结果

System B 全部 6 个 Phase 已完成（2026-05-03）。后续收尾（2026-05-03）：

- [x] `denied_reason` 结构化：`string` → `denial: DenialRecord[]`（`prompt_fragment_v2.ts`，波及 5 个文件）
- [x] `PromptWorkflowDiagnostics.track_traces` 字段（已在 Phase 5 实现，设计文档 checklist 漏标记）
- [x] 三轨接线 + 调用路径统一：`buildWorkflowPromptBundle()` 共享编排函数，`gateway_backed.ts` 和 `compaction_service.ts` 接入 System B 管道，`task_prompt_builder.ts` 移除 `buildPromptTree` 回退
- [x] 过期注释、`PROTECTED_SECTION_TYPES`、`PromptProcessingTrace` 残存引用清理
- [x] 文档同步：`PROMPT_WORKFLOW.md` 和 `PROMPT_SLOT_CONFIGURATION.md` 更新至 System B 架构
- [x] `runtime_config.spec.ts` 补齐 `death_note.*` 模板文件

测试：590 单元测试 + 6 集成测试通过。

### 实施顺序

1. executor 接口验证（试点 `token_budget_trim`）
2. 接口修正 + 实现模式定稿
3. 实现汇合后统一 executor（`placement_resolution`、`fragment_assembly`、`bundle_finalize`）
4. 实现模板轨（复用现有 `buildPromptTree` 逻辑）
5. 实现节点轨（ContextNode → section_draft 映射、`memory_context` 降级）
6. 清理 alias、统一调用路径、删除 System A 废弃代码
