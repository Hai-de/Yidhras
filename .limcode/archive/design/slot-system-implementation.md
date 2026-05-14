# 插槽系统完整实现计划

> 关联设计:
> - `.limcode/design/slot-function-advanced-design.md`
> - `.limcode/design/slot-positioning-system-design.md`
> 关联系统: Memory Trigger Sidecar、模板引擎、Prompt Workflow、插件拓展系统
> 日期: 2026-05-07（Phase 1–5 计划）/ 2026-05-06（定位系统完成）

---

# Part A: 插槽定位系统 ✅ 已完成

> 完成日期: 2026-05-06
> 状态: Phase 1–4 全部完成

## A.1 总览

| Phase | 范围 | 状态 |
|-------|------|------|
| Phase 1 | 类型与解析器（零行为变更） | ✅ |
| Phase 2 | 消费方适配（行为变更） | ✅ |
| Phase 3 | 片段级锚点补全 | ✅ |
| Phase 4 | 动态注册 API + PromptFragmentSlot 开放 | ✅ |

## A.2 Phase 1 — 类型与解析器

新增 `PromptSlotConfig.position` 和 `anchor` 字段（均可选/nullable），新建核心解析器，为内置插槽 YAML 添加显式 `position`。**零运行时行为变更**。

### 类型定义

**`apps/server/src/inference/prompt_slot_config.ts`**:
- `SlotAnchor` — `{ ref: string; relation: 'after' | 'before' }`
- `ResolvedSlotPosition` — `{ slot_id, resolved_position, resolution_source, enabled }`
- `SlotPositionDiagnostics` — `{ warnings[], resolution_map[] }`
- `PromptSlotConfig` 新增 `position?: number | null` 和 `anchor?: SlotAnchor | null`

### 核心解析器

**`apps/server/src/ai/slot_position_resolver.ts`** — 纯函数 `resolveSlotPositions()`:
1. 分类插槽（显式 position vs anchor）
2. DFS 环路检测（三色标记法）
3. 缺失 ref 降级 + diagnostic
4. 迭代拓扑解析锚点（中点分配：`(lo + hi) / 2`）
5. 环路/未解析锚点降级
6. 碰撞检测 + 降序稳定排序（position 降序 → slot_id 字母序）

### Zod Schema

**`apps/server/src/ai/registry.ts`** — `promptSlotConfigSchema` 新增 `position` 和 `anchor` 字段。

### 默认 YAML

**`apps/server/src/ai/schemas/prompt_slots.default.yaml`** — 10 个内置插槽添加 `position`（100, 90, 80, 70, 60, 55, 52, 50, 40, 30）。

### 测试

**`tests/unit/slot_position_resolver.spec.ts`** — 27 个测试：纯数值排序、纯锚点排序、混合、禁用插槽锚点、环路检测、不存在 ref、碰撞处理、深度细分极限（线性探测）、向后兼容。

## A.3 Phase 2 — 消费方适配

将 Phase 1 的类型与解析器接入运行时。`buildPromptTree` 调用 `resolveSlotPositions()`，所有消费方按 `resolved_positions` 排序。

### 类型扩展

**`apps/server/src/inference/prompt_tree.ts`** — `PromptTree` 新增 `resolved_positions: ResolvedSlotPosition[]`

**`apps/server/src/inference/prompt_bundle_v2.ts`** — `PromptBundleV2` 新增 `slot_order: string[]`

**`apps/server/src/context/workflow/types.ts`**:
- `PromptWorkflowState` 新增 `resolved_positions?: ResolvedSlotPosition[]`
- `PromptWorkflowDiagnostics` 新增 `slot_position_diagnostics?: SlotPositionDiagnostics`
- `createInitialPromptWorkflowState` 传播 `tree.resolved_positions`

### 构建函数

**`apps/server/src/inference/prompt_builder_v2.ts`**:
- `buildPromptTree()` — 调用 `resolveSlotPositions(slotRegistry)`，按 `resolved_positions` 遍历；禁用插槽赋 `fragments_by_slot[id] = []`
- `buildPromptBundleV2()` — 按 `resolved_positions` 遍历，生成 `slot_order`，输出 `slots` + `combined_prompt` 按解析顺序

### 工作流流水线

**`apps/server/src/context/workflow/orchestrator.ts`** — tracks 执行前调用 `resolveSlotPositions()` 并赋值 `state.resolved_positions` 和 `state.diagnostics.slot_position_diagnostics`；传递 `resolved_positions` 给 `runTemplateTrack` 和 `runConversationHistoryTrack`

**`apps/server/src/context/workflow/executors/fragment_assembly.ts`** — `tree.resolved_positions` 从 `state.resolved_positions` 传播

### 轨道适配

**`apps/server/src/context/workflow/tracks/template_track.ts`**:
- 签名新增 `resolvedPositions: ResolvedSlotPosition[]`
- 遍历 `resolvedPositions` 替代 `Object.values(slotRegistry)`
- `placement.order` 使用 `resolved.resolved_position`

**`apps/server/src/context/workflow/tracks/conversation_history_track.ts`** — 签名新增 `resolvedPositions?: ResolvedSlotPosition[]`

### 消息组装

**`apps/server/src/conversation/assembler.ts`**:
- `extractNonConversationSlots` — 遍历优先使用 `slot_order`，回退 `Object.keys(registry)`
- `priority` 使用 `resolved_position`（优先），回退 `default_priority`
- 隐式角色回退：`format_config.slots` 未覆盖时使用 `PromptSlotConfig.message_role`

### 测试适配

| 文件 | 变更 |
|------|------|
| `tests/unit/template_track.spec.ts` | 新增 `resolveSlotPositions(registry).resolved_positions` 参数 |
| `tests/unit/prompt_bundle_v2.spec.ts` | 新增 `position` 字段；T4 验证禁用插槽在 tree 中保留 |
| `tests/unit/post_merge_executors.spec.ts` | `buildTree` 新增 `resolved_positions` |
| `tests/integration/slot_positioning.spec.ts` | 新建 — 3 个集成测试 |

## A.4 Phase 3 — 片段级锚点补全

补全 `placement_resolution.ts` 中 `before_anchor` / `after_anchor` 的真实锚定逻辑。

### 锚点解析

**`apps/server/src/context/workflow/executors/placement_resolution.ts`**:

- `findAnchorTarget()` — 按 `anchor.kind` 查找目标：
  - `slot_start` → index 0
  - `slot_end` → index `working.length - 1`
  - `fragment_id` → 匹配 `PromptSectionDraft.id`（注释说明命名由来）
  - `source` → 匹配 `source_node_ids` 或 `metadata.source`
  - `tag` → 始终返回 -1（支架，降级 + `tag_not_implemented` diagnostic）
- `insertByOrder()` — 降级时按 `placement.order` 降序插入
- 算法：prepend → middle(sorted) → append 骨架，anchored draft 按 order 降序逐个解析并 splice 到目标位置

### 类型扩展

**`apps/server/src/context/workflow/types.ts`**:
- `AnchorDiagnostic` — `{ draft_id, slot_id, anchor_kind, anchor_value, code, message? }`
- `PromptWorkflowPlacementSummary.anchor_diagnostics?: AnchorDiagnostic[]`

### 测试

**`tests/unit/placement_resolution.spec.ts`** — 新建，8 个测试：slot_start、slot_end、fragment_id before/after、source 锚定、目标未找到降级、tag 支架降级、prepend+anchored+middle+append 混合。

### 已知限制

当前无 track 产出 `before_anchor`/`after_anchor` 的 section draft，锚点解析逻辑仅通过单元测试覆盖。

## A.5 Phase 4 — 动态注册 API

### PromptFragmentSlot 开放

**`apps/server/src/inference/prompt_slot_config.ts`** — `PromptFragmentSlot` 从闭合联合类型（10 字面量）改为 `string`

**`apps/server/src/memory/blocks/types.ts`** — `MemoryPlacementSlot` 同步从 `Extract<PromptFragmentSlot, ...>` 改为 `string`

### 运行时 API

**`apps/server/src/ai/registry.ts`**:

- `BUILTIN_SLOT_IDS` — 10 个内置插槽 ID 的 `Set`
- `registerDynamicSlot(config): boolean` — 运行时注册；内置 ID 拒绝；YAML 同名拒绝
- `unregisterDynamicSlot(slotId): boolean` — 注销动态插槽；内置/YAML 插槽不可注销
- `setSlotEnabled(slotId, enabled): boolean` — 启用/禁用任意插槽
- `listDynamicSlots(): ParsedPromptSlotConfig[]` — 仅动态插槽
- `PromptSlotRegistryCache` 扩展 `dynamic_slots: Map<string, ParsedPromptSlotConfig>`
- `getPromptSlotRegistry()` 合并 YAML + 动态插槽（YAML 优先）

### YAML 补全

**`apps/server/src/ai/schemas/prompt_slots.default.yaml`** — 新增 `memory_long_term`（position: 55）和 `memory_short_term`（position: 52），解决 node_track 产出无对应 slot registry 条目的遗漏问题。

### 测试

**`tests/unit/dynamic_slot_registry.spec.ts`** — 新建，12 个测试：注册、YAML 覆盖保护、内置保护、注销、注销被拒、注销不存在、启用切换动态/内置/setEnabled 拒绝不存在、resolveSlotPositions 集成、禁用保留位置、listDynamicSlots。

## A.6 定位系统文件变更清单

| 文件 | Phase | 说明 |
|------|-------|------|
| `apps/server/src/inference/prompt_slot_config.ts` | 1, 4 | 新增 SlotAnchor/ResolvedSlotPosition/SlotPositionDiagnostics；PromptSlotConfig 新增 position/anchor；PromptFragmentSlot → string |
| `apps/server/src/ai/slot_position_resolver.ts` | 1 | 新建 — resolveSlotPositions() 核心算法 |
| `apps/server/src/ai/registry.ts` | 1, 4 | promptSlotConfigSchema 扩展；新增 registerDynamicSlot/unregisterDynamicSlot/setSlotEnabled/listDynamicSlots/BUILTIN_SLOT_IDS；PromptSlotRegistryCache 扩展 dynamic_slots |
| `apps/server/src/ai/schemas/prompt_slots.default.yaml` | 1, 4 | 10 个内置插槽添加 position；新增 memory_long_term/memory_short_term |
| `apps/server/src/inference/prompt_tree.ts` | 2 | PromptTree 新增 resolved_positions |
| `apps/server/src/inference/prompt_bundle_v2.ts` | 2 | PromptBundleV2 新增 slot_order |
| `apps/server/src/inference/prompt_builder_v2.ts` | 2 | buildPromptTree 调用 resolveSlotPositions；buildPromptBundleV2 按 resolved_positions 遍历 |
| `apps/server/src/context/workflow/types.ts` | 2, 3 | PromptWorkflowState 新增 resolved_positions；PromptWorkflowDiagnostics 新增 slot_position_diagnostics；PromptWorkflowPlacementSummary 新增 anchor_diagnostics；新增 AnchorDiagnostic 类型 |
| `apps/server/src/context/workflow/orchestrator.ts` | 2 | tracks 前调用 resolveSlotPositions；传播 resolved_positions |
| `apps/server/src/context/workflow/executors/fragment_assembly.ts` | 2 | 传播 resolved_positions 到 PromptTree |
| `apps/server/src/context/workflow/executors/placement_resolution.ts` | 3 | 补全锚点查找逻辑（findAnchorTarget/insertByOrder） |
| `apps/server/src/context/workflow/tracks/template_track.ts` | 2 | 签名新增 resolvedPositions；按解析顺序遍历 |
| `apps/server/src/context/workflow/tracks/conversation_history_track.ts` | 2 | 签名新增 resolvedPositions |
| `apps/server/src/conversation/assembler.ts` | 2 | 使用 slot_order 遍历；resolved_position 优先级；隐式角色回退 |
| `apps/server/src/memory/blocks/types.ts` | 4 | MemoryPlacementSlot → string |
| `tests/unit/slot_position_resolver.spec.ts` | 1 | 新建 — 27 个测试 |
| `tests/unit/placement_resolution.spec.ts` | 3 | 新建 — 8 个测试 |
| `tests/unit/dynamic_slot_registry.spec.ts` | 4 | 新建 — 12 个测试 |
| `tests/integration/slot_positioning.spec.ts` | 2 | 新建 — 3 个集成测试 |
| `tests/unit/template_track.spec.ts` | 2 | 适配 — resolvedPositions 参数 |
| `tests/unit/prompt_bundle_v2.spec.ts` | 2 | 适配 — position 字段 + 禁用插槽断言 |
| `tests/unit/post_merge_executors.spec.ts` | 2, 3 | 适配 — resolved_positions + 锚点测试更新 |

## A.7 定位系统已知情况

1. Phase 3 锚点解析无 track 消费 — `before_anchor`/`after_anchor` 仅通过单元测试覆盖
2. `conversation_history_track` 接受 `resolvedPositions` 但未使用 — 对话历史记录按 turn_number 排序，不依赖位置
3. `tag` 锚点类型仅支架 — 待 `metadata.tag` 标准化后激活
4. 世界包插槽 schema 与加载集成延后 — 待首个需要动态插槽的世界包出现

---

# Part B: 插槽函数高级功能 Phase 1–4

> 关联设计: `.limcode/design/slot-function-advanced-design.md`
> 日期: 2026-05-07

## B.1 总览

| Phase | 范围 | 目标 |
|-------|------|------|
| Phase 1 | 声明式核心（无状态） | 类型定义、配置加载、内置条件评估、管线骨架 |
| Phase 2 | 状态性触发规则 | 黏性/冷却/延迟触发、状态存储、AppContext 扩展 |
| Phase 3 | 递归控制 + 模板引擎集成 | no_recursion/max_depth、SlotFunctionRenderScope 扩展 |
| Phase 4 | Token Budget 集成 + 群组权重 | ignore_context_length、群组互斥/优先级 |

Phase 5（插件接口扩展点）见 Part C。

## B.2 关键约定

- 所有新建源文件在 `apps/server/src/` 下
- 服务端导入必须使用 `.js` 扩展名，分号必需
- 禁止 `any` 类型，除非有注释说明的不可避场景
- 类型定义含 Zod schema 的共享类型放在 `packages/contracts/src/`
- 测试目录：`tests/unit/`（并行）、`tests/integration/`（串行）

## B.3 Phase 1 — 声明式核心（无状态）

**目标**：SlotBehaviorProfile 类型定义、运行时分层配置加载、内置条件评估器（keyword_match/conversation_turn/context_length/logic_match）、管线集成骨架。此阶段不涉及任何运行时状态追踪——所有激活决策基于单次推理调用的快照数据。

### B.3.1 新建 `config/domains/slot_behavior.ts` — 配置域

- Zod schema `SlotBehaviorConfigSchema`：`z.record(z.string(), slotBehaviorProfileSchema)`
- TypeScript 类型 `SlotBehaviorConfig = Record<string, SlotBehaviorProfile>`
- 默认值 `SLOT_BEHAVIOR_DEFAULTS = {}`（空对象，所有插槽默认无行为配置）
- Role：CAUTION 级（运行时生效，记录日志）

### B.3.2 修改 `config/domains/index.ts` — 注册配置域

- `RuntimeConfigSchema` 新增 `slot_behaviors: SlotBehaviorConfigSchema`
- `BUILTIN_DEFAULTS` 新增 `slot_behaviors: SLOT_BEHAVIOR_DEFAULTS`

### B.3.3 修改 `config/tiers.ts` — 安全分级

- `slot_behaviors` → `CAUTION`

### B.3.4 新建 `inference/slot_behavior.ts` — 核心类型与配置加载

类型：

- `SlotBehaviorProfile`（完整接口，与设计文档对齐）
- `SlotCondition`（5 种条件联合类型）
- `SlotLogicExpr`（9 种表达式联合类型，Phase 1 点分路径 + 数组索引）
- 配置验证函数 `validateSlotBehaviorConfig()`

配置加载：

- `loadSlotBehaviorConfig(runtimeConfig)` — 从 `getRuntimeConfig()` 提取 `slot_behaviors` 域
- `getBehaviorProfile(slotId, packId)` — 按 slot_id 查找

### B.3.5 新建 `inference/slot_condition_evaluators.ts` — 内置条件评估器

- `evaluateKeywordMatch(condition, context)` — 从 `context.last_user_message` 取文本，`match_mode: any`（默认）OR `all`
- `evaluateLogicMatch(condition, context)` — DSL 表达式求值器
  - `evaluateSlotLogicExpr(expr, variables)` — 递归遍历 `and/or/not`，叶子节点执行 `eq/neq/gt/lt/gte/lte/contains/exists`
  - `resolveDotPath(obj, path)` — 点分路径解析（`"a.b.c"`）+ 数组索引（`"a[0]"`）
  - 安全约束：拒绝 `__proto__`、`constructor`、`prototype` 路径段
  - 表达式 eval 超时 3s（`AbortController`）
- `evaluateContextLength(condition, context)` — token_budget.remaining vs 阈值
- `evaluateConversationTurn(condition, context)` — conversation_meta.turn_count vs 阈值

### B.3.6 新建 `inference/slot_behavior_state.ts` — 状态类型定义

- `SlotActivationStatus` — 5 状态联合类型：`'Pending' | 'Delayed' | 'Active' | 'Retained' | 'Cooling'`
- `SlotBehaviorState` 接口
- `createInitialBehaviorState(slotId)` — 工厂函数
- 状态转换骨架（`transitionState` 函数，Phase 2 实现具体逻辑）

### B.3.7 新建 `inference/slot_trigger_probability.ts` — FNV-1a 确定性采样

- `fnv1a64(input: string): bigint` — FNV-1a 64-bit 哈希实现
- `computeTriggerProbabilitySample(inferenceId, slotId, currentTick, triggerCount): number` — 映射到 [0, 1)
- `evaluateTriggerProbability(probability, ...): boolean` — 采样判定
- 交叉验证：与 Rust `sampling.rs` 快照对比

### B.3.8 新建 `context/workflow/executors/behavior_control.ts` — 执行器骨架

- `createBehaviorControlExecutor(): PromptWorkflowStepExecutor`
- `executeBehaviorControl({ context, profile, spec, state })`：
  1. 从 `state` 加载 behavior_profiles
  2. 无配置 → 直接返回 `state`（无行为控制介入）
  3. 遍历 profiles，执行条件评估
  4. 不激活 → `disableSlotContent(tree, slot_id)`
  5. 异常处理：`evaluator_failure_policy`（默认 `activate`）
  6. 返回 `{ ...state, behavior_states, slot_behavior_diagnostics }`

Phase 1 暂不执行状态转换（sticky/cooldown/delayed_trigger），仅执行激活/禁用决策。

辅助函数：

- `extractLastUserMessage(state)` — 从 `state.ai_messages` 取最后一条 `role === 'user'` 的 content
- `extractConversationMeta(state)` — 从 `state` 提取 turn_count
- `extractTokenBudget(state)` — 从 `state.tree` 估算 token 使用量
- `disableSlotContent(tree, slotId)` — 设置 `tree.fragments_by_slot[slotId]` 所有 fragment 为 `permission_denied`
- `buildSlotConditionContext(state, slotId, currentTick)` — 组装 `SlotConditionContext`

### B.3.9 修改 `config/domains/prompt_workflow.ts` — 扩展步骤类型

- `PromptWorkflowStepKind` 联合类型新增 `'behavior_control'`

### B.3.10 修改 `context/workflow/profiles.ts` — 插入行为控制步骤

- 所有 5 个内置 Profile 的 `steps` 数组，在 `fragment_assembly` 与 `permission_filter` 之间插入：
  ```
  { key: 'behavior', kind: 'behavior_control', enabled: true }
  ```

### B.3.11 修改 `context/workflow/types.ts` — 扩展状态类型

`PromptWorkflowState` 新增可选字段：

- `behavior_profiles?: SlotBehaviorProfile[]`
- `behavior_states?: Record<string, SlotBehaviorState>`
- `slot_behavior_diagnostics?: SlotBehaviorDiagnostic`

`SlotBehaviorDiagnostic` 接口（与设计文档对齐）：

- `profiles_evaluated: number`
- `slots_activated: string[]`
- `slots_disabled: string[]`
- `evaluation_errors: { slot_id: string; error: string }[]`

### B.3.12 修改 `context/workflow/registry.ts` — 注册执行器

- 在 `createPromptWorkflowStepRegistry` 调用中新增 `createBehaviorControlExecutor()`

### B.3.13 修改 `context/workflow/orchestrator.ts` — 注入行为配置

- `buildWorkflowPromptBundle` 中，state 初始化后注入 `behavior_profiles`
- 调用 `loadSlotBehaviorConfig(getRuntimeConfig())` 并过滤当前 pack 相关配置

### B.3.14 Phase 1 测试

**`tests/unit/slot_condition_evaluators.spec.ts`**:

- keyword_match：any/all 模式、空文本、无匹配、部分匹配
- logic_match：eq/neq/gt/lt/gte/lte/contains/exists、and/or/not 组合、深度嵌套、点分路径解析、数组索引、原型链安全拒绝、超时
- context_length：gt/lt/gte/lte/eq vs token_budget.remaining
- conversation_turn：gt/lt/gte/lte/eq vs turn_count

**`tests/unit/slot_trigger_probability.spec.ts`**:

- fnv1a64 已知向量验证
- 采样值映射到 [0,1) 区间
- 确定性可重现（相同种子 → 相同结果）
- 不同 slot_id 独立采样
- boundary: probability=0（永不激活）、probability=1（始终激活）

**`tests/unit/slot_behavior_config.spec.ts`**:

- YAML 配置加载与验证
- always_active + conditions 组合拒绝
- always_active + group_id 组合拒绝

**`tests/integration/behavior_control_executor.spec.ts`**:

- behavior_control 执行器插入管线
- always_active 插槽始终激活
- keyword_match 条件激活/禁用
- conversation_turn 条件激活/禁用
- context_length 条件激活/禁用
- 无 behavior_profiles 时跳过执行器
- evaluator_failure_policy（activate/deactivate/abort）
- 诊断信息完整性

## B.4 Phase 2 — 状态性触发规则

**目标**：实现黏性（sticky）、冷却时间（cooldown）、延迟触发（delayed_trigger）。需要运行时状态持久化（AppContext 扩展 + 内存 Map）。

### B.4.1 新建 `app/behavior_state_store.ts` — 状态存储

- `BehaviorStateStore` 接口（`getState/setState/clearForConversation/clearForInference`）
- `createMemoryBehaviorStateStore(): BehaviorStateStore` — 内存 Map 实现
- 键结构：`{slotId}::{packId}`

### B.4.2 修改 `app/context.ts` — AppContext 扩展

- `AppContext` 新增 `behaviorStateStore?: BehaviorStateStore`
- 在 app 初始化时注入 `createMemoryBehaviorStateStore()`

### B.4.3 扩展 `inference/slot_behavior_state.ts` — 状态机实现

- `applyStateTransitions(behaviorStates, profile, activationResult)` — 完整 5 状态机：
  ```
  Pending → [条件满足 + delay] → Delayed → [delay_elapsed] → Active
  Pending → [条件满足 无delay] → Active
  Active → [sticky_remaining > 0] → Retained
  Retained → [sticky耗尽 + cooldown] → Cooling
  Cooling → [冷却结束] → Pending
  Cooling 优先级最高：即使 sticky 仍有次数，冷却期也不激活
  ```
- 状态转换使用世界 tick（`PackRuntimeHandle.currentTick`）
- 转换函数接收 `currentTick` 参数

### B.4.4 扩展 `context/workflow/executors/behavior_control.ts` — 状态规则

- `executeBehaviorControl` 在条件评估后调用 `applyStateTransitions`
- 延迟触发：条件满足后状态转入 `Delayed`，当前推理不激活
- 冷却检查：`Cooling` 状态下跳过条件评估，直接禁用
- 黏性递减：`Retained` 状态每次激活 `sticky_remaining--`
- 状态持久化：执行完成后 `state.behavior_states` 写回 `behaviorStateStore`

### B.4.5 Phase 2 测试

**`tests/unit/slot_behavior_state_machine.spec.ts`**:

- Pending → Active（条件满足，无 delay）
- Pending → Delayed → Active（条件满足 + delay_ticks）
- Active → Retained（sticky_remaining > 0）
- Retained → Pending（sticky耗尽，无 cooldown）
- Retained → Cooling → Pending（sticky耗尽 + cooldown）
- Active → Cooling（有 cooldown，无 sticky）
- Cooling 优先级最高（即使条件满足也不激活）
- state_scope 生命周期（conversation/inference/persistent）

**`tests/integration/behavior_control_stateful.spec.ts`**:

- 跨推理调用的 sticky 状态保持
- 跨推理调用的 cooldown 计数
- delayed_trigger 延迟触发时序
- 对话结束状态清除（state_scope: conversation）
- 推理结束状态清除（state_scope: inference）

## B.5 Phase 3 — 递归控制 + 模板引擎集成

**目标**：实现 `no_recursion`、`max_depth`、`prevent_further_recursion`。扩展 `SlotFunctionRenderScope` 和 `slot-ref` 块处理器。

### B.5.1 修改 `template_engine/frontends/slot_function/types.ts` — 扩展类型

`SlotRegistration` 新增可选字段：

- `no_recursion?: boolean`
- `max_depth?: number`
- `prevent_further_recursion?: boolean`

### B.5.2 修改 `template_engine/frontends/slot_function/blocks.ts` — 扩展 RenderScope

`SlotFunctionRenderScope` 新增：

- `maxDepth?: number`
- `noRecursionSlots?: Set<string>`
- `currentSlotStack?: string[]`
- `preventFurtherRecursion?: boolean`

### B.5.3 修改 `template_engine/frontends/slot_function/blocks.ts` — 递归检测

`slotRefBlockHandler` 扩展：

1. `no_recursion` 检查：如果被引用插槽在 `noRecursionSlots` 中 → 记录诊断 `RECURSION_BLOCKED`，返回 `''`
2. 递归检测：如果 `currentSlotStack.includes(slotName)` → 记录诊断 `RECURSION_DETECTED`，返回 `''`
3. `maxDepth` 检查：`scope.depth >= scope.maxDepth` → 返回 `''`
4. `prevent_further_recursion`：如果当前插槽在调用栈中且设置了此标志 → 不再触发 slot-ref 解析，返回 body 内容

### B.5.4 修改 `template_engine/core/renderer.ts` — 传递深度约束

- 子渲染调用时 `depth + 1` 传入
- `currentSlotStack` 在进入/退出 `slot-ref` 时 push/pop

### B.5.5 扩展 `context/workflow/executors/behavior_control.ts` — 递归约束注入

- `executeBehaviorControl` 中，如果插槽有 `max_depth` / `no_recursion` / `prevent_further_recursion`：
  - 标记到 `tree.fragments_by_slot[slot_id]` 的 fragment 元数据上
  - 模板引擎渲染时从元数据读取约束

### B.5.6 Phase 3 测试

**`tests/unit/slot_function_recursion.spec.ts`**:

- no_recursion：声明禁止自引用的插槽被 slot-ref 引用时返回空
- 递归检测：A → B → A 形成环时阻断
- max_depth：超过最大深度返回空
- prevent_further_recursion：设置后不再解析子 slot-ref
- 正常深度内 slot-ref 正常渲染

**`tests/integration/behavior_control_recursion.spec.ts`**:

- 行为配置中的 no_recursion 传递到模板引擎
- behavior_control executor 注入递归约束到 fragment 元数据
- 诊断信息记录（RECURSION_BLOCKED / RECURSION_DETECTED）

## B.6 Phase 4 — Token Budget 集成 + 群组权重

**目标**：`ignore_context_length` 在 token_budget_trim 中生效；实现群组互斥选择。

### B.6.1 新建 `inference/slot_group_resolver.ts` — 群组解析

- `resolveSlotGroups(profiles): Map<string, SlotBehaviorProfile[]>`
- `resolveExclusiveGroup(groupProfiles, rng): string` — 按权重概率互斥选择一个
- `resolvePriorityOrder(groupProfiles)` — 按权重降序排列
- `resolveBudgetAllocation(groupProfiles, totalBudget)` — 按权重分配 token

### B.6.2 扩展 `context/workflow/executors/behavior_control.ts` — 群组逻辑

- 在条件评估前先解析群组
- `group_mode: 'exclusive'`（Phase 4 默认）：群组内按权重概率选择一个激活，其余禁用
- 诊断中记录群组选择结果
- `always_active + group_id` → 配置错误（Phase 1 的 `validateSlotBehaviorConfig` 已拒绝）

### B.6.3 修改 `context/workflow/executors/token_budget_trim.ts` — ignore_context_length

- 识别 fragment 的 `ignore_context_length` 标记
- 标记为 `ignore_context_length` 的 fragment 在 trim 时优先级最高（不受常规裁剪）
- 硬上限保护：所有 `ignore_context_length` 插槽的 token 总和不超过模型上下文窗口 80%
- 超限时按优先级从低到高裁剪，发出 error 级诊断

### B.6.4 扩展 `context/workflow/executors/behavior_control.ts` — ignore_context_length 标记

- `executeBehaviorControl` 中，如果 `profile.ignore_context_length` 为 true：
  - 调用 `markIgnoreContextLength(tree, slot_id)` 在 fragment 元数据上设置标记
- 硬上限检查：`enforceIgnoreContextLengthHardLimit(tree, modelContextWindow)` — 统计所有标记 fragment 的 token，超 80% 时按优先级裁剪

### B.6.5 Phase 4 测试

**`tests/unit/slot_group_resolver.spec.ts`**:

- 互斥选择：按权重概率选中
- 权重为 0 的插槽永远不会被选中
- 空群组返回空
- 单插槽群组始终选中

**`tests/integration/token_budget_ignore_context_length.spec.ts`**:

- ignore_context_length 标记的 fragment 不被常规裁剪
- 硬上限保护：超 80% 时低优先级被裁剪
- 多插槽 ignore_context_length 累加超限处理
- 诊断信息包含硬上限超限警告

**`tests/integration/behavior_control_group.spec.ts`**:

- 群组互斥选择
- always_active + group_id 配置拒绝
- 群组选择诊断信息

## B.7 Part B 实现顺序

```
Phase 1: B.3.1 → B.3.2 → B.3.3 → B.3.4 → B.3.5 → B.3.6 → B.3.7 → B.3.9 → B.3.11 → B.3.8 → B.3.10 → B.3.12 → B.3.13 → 测试
                 ↓ (配置域就绪)
        B.3.4 (类型与配置加载)
                 ↓
        B.3.5 + B.3.6 + B.3.7 (条件评估 + 状态类型 + 采样)
                 ↓ (类型可用)
        B.3.9 + B.3.11 (扩展 PromptWorkflowStepKind + PromptWorkflowState)
                 ↓
        B.3.8 (behavior_control 执行器，依赖上述所有类型)
                 ↓
        B.3.10 + B.3.12 + B.3.13 (profiles + registry + orchestrator 集成)
                 ↓
        Phase 1 测试全部通过

Phase 2: B.4.1 → B.4.2 → B.4.3 → B.4.4 → 测试
         (依赖 Phase 1 完成：状态类型和执行器骨架就位)

Phase 3: B.5.1 → B.5.2 → B.5.5 → B.5.3 → B.5.4 → 测试
         (依赖 Phase 1 完成：behavior_control 管线就位)

Phase 4: B.6.1 → B.6.2 → B.6.4 → B.6.3 → 测试
         (依赖 Phase 1 完成：behavior_control 管线就位)
```

Phase 1 是串行依赖链，必须先完成。Phase 2/3/4 之间相互独立，可并行推进。

## B.8 不在此次范围（Phase 1–4）

- Phase 5：插件接口扩展点（`SlotConditionEvaluator` / `SlotContentTransformer`）— 见 Part C
- Phase 6+：Rust sidecar + wasmtime WASM 沙箱
- 功能 B：双重模块设置（决策推迟至 Phase 1–3 完成后评估）
- 向量化触发（依赖独立的基础设施设计）
- 通配符路径解析（延后到 Phase 2+）
- `logic_match` 模板引擎 `#if` 复用（延后评估）

---

# Part C: 插槽函数高级功能 Phase 5 — 插件接口扩展点

> 关联设计: `.limcode/design/slot-function-advanced-design.md`
> 关联实现: Part B Phase 1–4、插件拓展系统、DataCleaner 注册表
> 日期: 2026-05-07

## C.1 总览

Phase 5 开放两个插件接口：`SlotConditionEvaluator`（门控型）和 `SlotContentTransformer`（变换型），允许世界包插件注册自定义条件评估器和内容变换器。

**架构决策**：

| 决策 | 选择 |
|------|------|
| 内置评估器去留 | 重构为系统包插件（DataCleaner 风格：manifest.yaml + server.ts + activate） |
| 注册表架构 | 严格 per-pack（`Map<packId, Map<key, evaluator>>`，命名空间隔离） |
| content_transform 管线位置 | 独立管线步骤，`behavior_control` → `content_transform` → `permission_filter` |

## C.2 变更范围

### C.2.1 `packages/contracts/src/slot_condition_evaluator.ts` — 共享合约（新建）

定义 Zod schema + TypeScript 类型：

```typescript
// 能力声明（插件 manifest 的 provides 字段）
slotConditionEvaluatorCapabilitySchema → { key: "slot_condition.<name>", version: "1.0.0" }

// 门控型 — 条件评估器
slotConditionContextSchema → { slot_id, variables, conversation_meta, token_budget,
  current_tick, last_user_message, options? }
slotConditionResultSchema → { active: boolean, reason?: string, confidence?: number }

// 变换型 — 内容变换器
slotTransformContextSchema → { ...slotConditionContextSchema,
  original_content: string, activation_decision: slotConditionResultSchema }
slotTransformResultSchema → { transformed: string, metadata?: Record<string, unknown> }
```

所有返回类型 JSON 可序列化 — 为 Phase 6+ WASM 沙箱预留兼容性。

### C.2.2 `packages/contracts/src/index.ts` — 重新导出（修改）

新增 `slot_condition_evaluator.ts` 的导出。

### C.2.3 `plugins/extensions/slot_condition_registry.ts` — 条件评估器注册表（新建）

**接口**：

```typescript
interface SlotConditionEvaluator {
  readonly key: string;       // 格式: "slot_condition.<name>"
  readonly version: string;
  evaluate(context: SlotConditionContext): Promise<SlotConditionResult>;
}
```

**注册表类 `SlotConditionRegistry`**：
- 内部存储：`Map<string, Map<string, SlotConditionEvaluator>>`（`packId → (key → evaluator)`）
- `register(packId, evaluator)` — 同 pack 内 key 冲突抛错；不同 pack 允许同名
- `get(packId, key)` — 按 pack + key 查找
- `list(packId)` — 列出指定 pack 的所有评估器
- `evaluate(packId, key, context)` — 快捷调用
- 内置全局默认：`registerBuiltin(packId, evaluator)` — 标记为 builtin，pack 级可覆盖

**模块级单例**：`export const slotConditionRegistry = new SlotConditionRegistry()`

### C.2.4 `plugins/extensions/slot_content_transformer.ts` — 内容变换器注册表（新建）

**接口**：

```typescript
interface SlotContentTransformer {
  readonly key: string;       // 格式: "slot_transform.<name>"
  readonly version: string;
  transform(content: string, context: SlotTransformContext): Promise<SlotTransformResult>;
}
```

**注册表类 `SlotContentTransformRegistry`**：
- 与 `SlotConditionRegistry` 相同的 per-pack 架构
- `register(packId, transformer)`、`get(packId, key)`、`list(packId)`、`transform(packId, key, content, context)`
- 模块级单例：`export const slotContentTransformRegistry = new SlotContentTransformRegistry()`

### C.2.5 `plugins/runtime.ts` — ServerPluginHostApi 扩展（修改）

`ServerPluginHostApi` 新增两个方法：

```typescript
registerSlotConditionEvaluator(evaluator: SlotConditionEvaluator, capabilityKey?: string): void;
registerSlotContentTransformer(transformer: SlotContentTransformer, capabilityKey?: string): void;
```

实现模式与 `registerDataCleaner` 一致：
1. `hasCapability` 守卫检查 `capabilityKey`
2. 通过守卫 → 委托给 `slotConditionRegistry.register(packId, evaluator)` / `slotContentTransformRegistry.register(packId, transformer)`
3. `packId` 从当前激活上下文获取（`getActivePackId()` 或通过 `ServerPluginHostApi` 内部闭包传递）

**关键变更**：`createServerPluginHostApi` 需要接收 `packId` 参数。当前实现中 `registerDataCleaner` 使用全局单例注册表，不需要 pack 上下文。Phase 5 的 per-pack 注册表需要 pack 标识。

**`createServerPluginHostApi` 签名变更**：

```typescript
// 当前
function createServerPluginHostApi(runtime, capabilities?): ServerPluginHostApi

// Phase 5
function createServerPluginHostApi(runtime, packId: string, capabilities?): ServerPluginHostApi
```

影响范围：`runtime.ts` 中 `createRuntimeForManifest` 调用 `createServerPluginHostApi` 时已有 `packId` 可用（来自 `manifest` 或调用上下文），改动量小。

### C.2.6 `builtin/system_pack/plugins/slot-condition-builtin/` — 内置评估器插件（新增）

将 Part B Phase 1 的 4 个纯函数评估器重构为系统包插件：

**目录结构**：

```
builtin/system_pack/plugins/slot-condition-builtin/
├── plugin.manifest.yaml
└── server.ts
```

**`plugin.manifest.yaml`**：

```yaml
id: "slot-condition-builtin"
name: "Slot Condition Built-in Evaluators"
version: "1.0.0"
kind: "slot_condition"
system: true
load:
  priority: 100
provides:
  - key: "slot_condition.keyword_match"
    version: "1.0.0"
  - key: "slot_condition.logic_match"
    version: "1.0.0"
  - key: "slot_condition.conversation_turn"
    version: "1.0.0"
  - key: "slot_condition.context_length"
    version: "1.0.0"
```

**`server.ts`**：

```typescript
export async function activate(host: ServerPluginHostApi): Promise<void> {
  host.registerSlotConditionEvaluator({
    key: 'slot_condition.keyword_match',
    version: '1.0.0',
    evaluate: async (ctx) => evaluateKeywordMatch(ctx)
  });

  host.registerSlotConditionEvaluator({
    key: 'slot_condition.logic_match',
    version: '1.0.0',
    evaluate: async (ctx) => evaluateLogicMatch(ctx)
  });

  host.registerSlotConditionEvaluator({
    key: 'slot_condition.conversation_turn',
    version: '1.0.0',
    evaluate: async (ctx) => evaluateConversationTurn(ctx)
  });

  host.registerSlotConditionEvaluator({
    key: 'slot_condition.context_length',
    version: '1.0.0',
    evaluate: async (ctx) => evaluateContextLength(ctx)
  });
}
```

评估逻辑从 `inference/slot_condition_evaluators.ts` 导入复用，不重复实现。

### C.2.7 `builtin/system_pack/plugins/order.yaml` — 加载顺序（修改）

在现有 `order` 列表末尾追加 `"slot-condition-builtin"`。

### C.2.8 `plugins/system_pack_init.ts` — 自动初始化（修改）

系统包插件目录扫描会自动发现新插件。如果当前 `initSystemPackPlugins` 只扫描已知目录，需要确保 `slot-condition-builtin/` 被纳入扫描范围。

### C.2.9 `inference/slot_condition_evaluators.ts` — 内置评估器保留（修改）

保留 `evaluateBuiltinCondition`、`evaluateKeywordMatch`、`evaluateLogicMatch`、`evaluateContextLength`、`evaluateConversationTurn` 函数实现。它们作为：
- 插件 `server.ts` 的底层实现（插件是薄封装层）
- 无插件运行时的回退（Part B Phase 1 的 `custom` 条件类型兜底）

新增 `custom` 条件类型支持调用插件注册表：

```typescript
// custom 条件类型 — Phase 5 支持插件评估器
case 'custom': {
  const evaluator = slotConditionRegistry.get(packId, condition.evaluator_key);
  if (!evaluator) {
    return { active: false, reason: `custom evaluator '${condition.evaluator_key}' not found` };
  }
  // 调用插件评估器（带 3s 超时）
  const result = await withTimeout(evaluator.evaluate(ctx), 3000);
  return result;
}
```

`evaluateBuiltinCondition` 需要改为 `async`，或新增 `evaluateCustomCondition` 函数。

### C.2.10 `context/workflow/executors/content_transform.ts` — 内容变换执行器（新建）

新的独立管线步骤 executor：

```typescript
export const createContentTransformExecutor = (): PromptWorkflowStepExecutor => ({
  kind: 'content_transform',
  async execute({ context, state, spec }) {
    // 加载 content transformers（从 registry 或 behavior_profiles）
    // 遍历激活的插槽，调用 transformer.transform()
    // 更新 tree.fragments_by_slot[slotId] 中 fragment 的内容
    // 记录 trace
  }
});
```

**管线位置**：`behavior_control`（激活决策）→ `content_transform`（内容变换）→ `permission_filter`（权限过滤）

### C.2.11 管线步骤注册（修改 4 个文件）

| 文件 | 变更 |
|------|------|
| `context/workflow/types.ts` | `PromptWorkflowStepKind` 新增 `'content_transform'` |
| `context/workflow/profiles.ts` | 所有 5 个 Profile 在 `behavior_control` 与 `permission_filter` 之间插入 `{ key: 'transform', kind: 'content_transform' }` |
| `context/workflow/registry.ts` | `createPromptWorkflowStepRegistry` 新增 `createContentTransformExecutor()` |
| `context/workflow/orchestrator.ts` | 同 registry.ts |

### C.2.12 `context/workflow/executors/behavior_control.ts` — custom 条件支持（修改）

- `evaluateSlotActivation` 中对 `custom` 类型条件的处理从"Phase 1 默认激活"改为"调用插件注册表查找评估器"
- 需要从 `state` 获取 `pack_id` 以查询 per-pack 注册表
- 3s 超时 + `evaluator_failure_policy` 处理

## C.3 与原设计文档的差异

| 项目 | 原设计 | 本计划 |
|------|--------|--------|
| 内置评估器 | 作为插件新建 | 保留现有函数实现，插件为薄封装 |
| `packages/contracts/src/slot_content_transformer.ts` | 独立文件 | 合并到 `slot_condition_evaluator.ts`（门控型 + 变换型在同一文件） |
| `plugins/extensions/slot_content_transformer.ts` | 独立注册表文件 | 独立文件，与 condition registry 对称 |
| 注册表全局 key | 未明确格式 | `slot_condition.<name>` / `slot_transform.<name>` — 与 DataCleaner 的 `data_cleaner.<name>` 格式对齐 |

## C.4 Part C 实现顺序

```
1. packages/contracts/src/slot_condition_evaluator.ts  ← 共享 Zod schema（无依赖）
                        ↓
2. plugins/extensions/slot_condition_registry.ts        ← 条件评估器注册表
3. plugins/extensions/slot_content_transformer.ts       ← 内容变换器注册表
                        ↓
4. plugins/runtime.ts                                   ← ServerPluginHostApi 扩展
   (需修改 createServerPluginHostApi 注入 packId)
                        ↓
5. builtin/system_pack/plugins/slot-condition-builtin/   ← 内置评估器插件
6. builtin/system_pack/plugins/order.yaml                ← 加载顺序
                        ↓
7. inference/slot_condition_evaluators.ts               ← custom 条件接入注册表
                        ↓
8. context/workflow/types.ts                            ← PromptWorkflowStepKind 新增 'content_transform'
9. context/workflow/executors/content_transform.ts      ← 内容变换执行器
10. context/workflow/profiles.ts                         ← 插入 content_transform 步骤
11. context/workflow/registry.ts                         ← 注册执行器
12. context/workflow/orchestrator.ts                     ← 注册执行器
                        ↓
13. context/workflow/executors/behavior_control.ts       ← custom 条件查询插件注册表
                        ↓
测试
```

步骤 1-3 可并行；步骤 5-6 可并行；步骤 8-12 可并行；步骤 13 依赖步骤 4。

## C.5 Phase 5 测试范围

### 单元测试

**`tests/unit/slot_condition_registry.spec.ts`**：
- per-pack 注册与隔离（同 key 不同 pack 不冲突）
- 同 pack 同 key 冲突抛错
- get/list/evaluate 基本操作
- 内置默认 + pack 级覆盖

**`tests/unit/slot_content_transform_registry.spec.ts`**：
- 同 condition registry 的 per-pack 隔离测试
- transform 调用链

**`tests/unit/slot_condition_evaluators.spec.ts`（扩展）**：
- custom 条件类型查询注册表
- 插件未找到 → 返回 false
- 插件超时（3s）
- 插件抛异常 → evaluator_failure_policy 处理

### 集成测试

**`tests/integration/slot_condition_plugin.spec.ts`**：
- 系统包插件自动注册（启动时 discover → enable）
- 内置评估器插件 evaluate 调用
- 世界包插件注册自定义评估器
- per-pack 命名空间隔离验证

**`tests/integration/content_transform_pipeline.spec.ts`**：
- content_transform 执行器在管线中正确执行
- transformer 修改 fragment 内容
- 变换后内容流经 permission_filter
- 无 transformer 时跳过步骤

## C.6 不在此次范围

- Phase 6+：Rust sidecar + wasmtime WASM 沙箱
- 功能性 B：双重模块设置（决策仍推迟）
- `group_mode: 'priority' | 'budget'`（Part B Phase 4 仅实现 exclusive）
- 通配符路径解析（仍在 Phase 2+）

---

# 附录 A: 完整测试统计

| 文件 | 测试数 | 来源 |
|------|--------|------|
| `slot_position_resolver.spec.ts` | 27 | Part A Phase 1 |
| `placement_resolution.spec.ts` | 8 | Part A Phase 3 |
| `dynamic_slot_registry.spec.ts` | 12 | Part A Phase 4 |
| `slot_positioning.spec.ts` (integration) | 3 | Part A Phase 2 |
| `slot_condition_evaluators.spec.ts` | ~20 | Part B Phase 1 |
| `slot_trigger_probability.spec.ts` | ~8 | Part B Phase 1 |
| `slot_behavior_config.spec.ts` | ~6 | Part B Phase 1 |
| `behavior_control_executor.spec.ts` (integration) | ~10 | Part B Phase 1 |
| `slot_behavior_state_machine.spec.ts` | ~10 | Part B Phase 2 |
| `behavior_control_stateful.spec.ts` (integration) | ~6 | Part B Phase 2 |
| `slot_function_recursion.spec.ts` | ~6 | Part B Phase 3 |
| `behavior_control_recursion.spec.ts` (integration) | ~5 | Part B Phase 3 |
| `slot_group_resolver.spec.ts` | ~6 | Part B Phase 4 |
| `token_budget_ignore_context_length.spec.ts` (integration) | ~6 | Part B Phase 4 |
| `behavior_control_group.spec.ts` (integration) | ~5 | Part B Phase 4 |
| `slot_condition_registry.spec.ts` | ~8 | Part C |
| `slot_content_transform_registry.spec.ts` | ~6 | Part C |
| `slot_condition_plugin.spec.ts` (integration) | ~6 | Part C |
| `content_transform_pipeline.spec.ts` (integration) | ~5 | Part C |
| 适配的现有测试 | 21 | Part A |
| **总计** | **~184** | |

# 附录 B: 全局已知情况

1. Part A Phase 3 锚点解析无 track 消费 — `before_anchor`/`after_anchor` 仅通过单元测试覆盖
2. Part A `conversation_history_track` 接受 `resolvedPositions` 但未使用 — 对话历史记录按 turn_number 排序
3. `tag` 锚点类型仅支架 — 待 `metadata.tag` 标准化后激活
4. 世界包插槽 schema 与加载集成延后 — 待首个需要动态插槽的世界包出现
5. Part B/C 全部为计划态，尚未开始实现
6. Part C Phase 6+（Rust sidecar + WASM 沙箱）不在本文档范围
