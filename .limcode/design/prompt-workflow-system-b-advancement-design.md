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
选择策略的唯一判断标准是**哪种方式能以最小的总工作量达到正确的架构**。

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

## 3. 接线策略对比

### 3.1 策略 A：渐进式替换

**做法**：System A 继续运行，逐步将 processor 改写为 executor。
通过适配器桥接 `PromptTreeProcessor` 和 `PromptWorkflowStepExecutor` 两种接口。
System A 和 System B 的代码在过渡期共存，新步骤先以 executor 形式加入，旧 processor 逐步退役。

**优势**：
- 每步改动的风险小，可单独 review 和测试
- 可以在每一步验证新接口的合理性，及时调整设计
- 不会出现"全部改完发现跑不通"的情况

**劣势**：
- 需要写适配器/桥接代码（`tree → state → tree` 的转换层），最终会被丢弃
- 过渡期存在两套接口、两套数据类型，增加认知负担
- 中间状态可能不伦不类——半个 pipeline 用 executor、半个用 processor
- 历史上有大量"临时桥接变成永久债务"的先例
- 每个增量步骤都需要额外的设计工作来维持两套系统的兼容

### 3.2 策略 B：完整切换

**做法**：一次性替换 `inference/service.ts` 和 `task_prompt_builder.ts` 的调用路径，
实现所有必要的 executor，删除或废弃 System A 的 processor 代码。

**优势**：
- 干净——没有桥接代码、没有过渡态、没有双轨
- 总代码量更少（不需要适配器）
- 架构从第一天就保持一致
- 迫使所有设计决策被一次性解决（不能推到"后面再改"）
- 可以趁此机会统一两条调用路径（inference service + task prompt builder）

**劣势**：
- 单次改动量大，可能引入多个回归
- 如果 System B 设计有误，发现时已有大量代码基于它
- 所有 executor 必须实现完毕才能验证端到端
- 调试时不容易隔离问题到单个步骤

### 3.3 评估：在无用户/无数据的约束下

完整切换的劣势在这个项目中被大幅削弱：
- "回归风险"——没有用户、没有生产数据，回归只影响开发者自己
- "发现设计错误太晚"——可以通过先写一个 executor 验证接口合理性，再批量实现其余部分来规避
- "调试困难"——executor 是隔离的纯函数，每个 executor 可以单独单测

渐进式替换的优势同样被削弱：
- "每步风险小"——在无用户的项目中，单次大改的风险并不比多次小改高
- "可以逐步验证"——完全可以通过写 prototype executor + 单元测试来验证，不需要上线过渡版本

**结论**：完整切换是这个项目的合理选择。但有一个重要的前置条件——先用一个 executor 的完整实现验证 `PromptWorkflowStepExecutor` 接口和 `PromptWorkflowState` 数据结构是否好用，确认后再铺量。

### 3.4 策略 C：并行运行

通过 feature flag 在两套系统间切换。在无用户的项目中这是纯粹的额外工作量，不推荐。

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

## 12. 决策记录与下一步

### 已确认（全部）

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

### 实施顺序

1. executor 接口验证（试点 `token_budget_trim`）
2. 接口修正 + 实现模式定稿
3. 实现汇合后统一 executor（`placement_resolution`、`fragment_assembly`、`bundle_finalize`）
4. 实现模板轨（复用现有 `buildPromptTree` 逻辑）
5. 实现节点轨（ContextNode → section_draft 映射、`memory_context` 降级）
6. 清理 alias、统一调用路径、删除 System A 废弃代码
