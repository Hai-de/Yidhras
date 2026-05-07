# 插槽函数高级功能 — Phase 1–4 实现计划

> 关联设计: `.limcode/design/slot-function-advanced-design.md`
> 关联系统: Memory Trigger Sidecar、插槽定位系统、模板引擎、Prompt Workflow
> 日期: 2026-05-07

## 总览

| Phase | 范围 | 目标 |
|-------|------|------|
| Phase 1 | 声明式核心（无状态） | 类型定义、配置加载、内置条件评估、管线骨架 |
| Phase 2 | 状态性触发规则 | 黏性/冷却/延迟触发、状态存储、AppContext 扩展 |
| Phase 3 | 递归控制 + 模板引擎集成 | no_recursion/max_depth、SlotFunctionRenderScope 扩展 |
| Phase 4 | Token Budget 集成 + 群组权重 | ignore_context_length、群组互斥/优先级 |

Phase 5+（插件接口扩展点、WASM 沙箱）不在本次范围。

## 关键约定

- 所有新建源文件在 `apps/server/src/` 下
- 服务端导入必须使用 `.js` 扩展名，分号必需
- 禁止 `any` 类型，除非有注释说明的不可避场景
- 类型定义含 Zod schema 的共享类型放在 `packages/contracts/src/`
- 测试目录：`tests/unit/`（并行）、`tests/integration/`（串行）

---

## Phase 1 — 声明式核心（无状态）

**目标**：SlotBehaviorProfile 类型定义、运行时分层配置加载、内置条件评估器（keyword_match/conversation_turn/context_length/logic_match）、管线集成骨架。此阶段不涉及任何运行时状态追踪——所有激活决策基于单次推理调用的快照数据。

### 1.1 新建 `config/domains/slot_behavior.ts` — 配置域

- Zod schema `SlotBehaviorConfigSchema`：`z.record(z.string(), slotBehaviorProfileSchema)`
- TypeScript 类型 `SlotBehaviorConfig = Record<string, SlotBehaviorProfile>`
- 默认值 `SLOT_BEHAVIOR_DEFAULTS = {}`（空对象，所有插槽默认无行为配置）
- Role：CAUTION 级（运行时生效，记录日志）

### 1.2 修改 `config/domains/index.ts` — 注册配置域

- `RuntimeConfigSchema` 新增 `slot_behaviors: SlotBehaviorConfigSchema`
- `BUILTIN_DEFAULTS` 新增 `slot_behaviors: SLOT_BEHAVIOR_DEFAULTS`

### 1.3 修改 `config/tiers.ts` — 安全分级

- `slot_behaviors` → `CAUTION`

### 1.4 新建 `inference/slot_behavior.ts` — 核心类型与配置加载

类型：

- `SlotBehaviorProfile`（完整接口，与设计文档对齐）
- `SlotCondition`（5 种条件联合类型）
- `SlotLogicExpr`（9 种表达式联合类型，Phase 1 点分路径 + 数组索引）
- 配置验证函数 `validateSlotBehaviorConfig()`

配置加载：

- `loadSlotBehaviorConfig(runtimeConfig)` — 从 `getRuntimeConfig()` 提取 `slot_behaviors` 域
- `getBehaviorProfile(slotId, packId)` — 按 slot_id 查找

### 1.5 新建 `inference/slot_condition_evaluators.ts` — 内置条件评估器

- `evaluateKeywordMatch(condition, context)` — 从 `context.last_user_message` 取文本，`match_mode: any`（默认）OR `all`
- `evaluateLogicMatch(condition, context)` — DSL 表达式求值器
  - `evaluateSlotLogicExpr(expr, variables)` — 递归遍历 `and/or/not`，叶子节点执行 `eq/neq/gt/lt/gte/lte/contains/exists`
  - `resolveDotPath(obj, path)` — 点分路径解析（`"a.b.c"`）+ 数组索引（`"a[0]"`）
  - 安全约束：拒绝 `__proto__`、`constructor`、`prototype` 路径段
  - 表达式 eval 超时 3s（`AbortController`）
- `evaluateContextLength(condition, context)` — token_budget.remaining vs 阈值
- `evaluateConversationTurn(condition, context)` — conversation_meta.turn_count vs 阈值

### 1.6 新建 `inference/slot_behavior_state.ts` — 状态类型定义

- `SlotActivationStatus` — 5 状态联合类型：`'Pending' | 'Delayed' | 'Active' | 'Retained' | 'Cooling'`
- `SlotBehaviorState` 接口
- `createInitialBehaviorState(slotId)` — 工厂函数
- 状态转换骨架（`transitionState` 函数，Phase 2 实现具体逻辑）

### 1.7 新建 `inference/slot_trigger_probability.ts` — FNV-1a 确定性采样

- `fnv1a64(input: string): bigint` — FNV-1a 64-bit 哈希实现
- `computeTriggerProbabilitySample(inferenceId, slotId, currentTick, triggerCount): number` — 映射到 [0, 1)
- `evaluateTriggerProbability(probability, ...): boolean` — 采样判定
- 交叉验证：与 Rust `sampling.rs` 快照对比

### 1.8 新建 `context/workflow/executors/behavior_control.ts` — 执行器骨架

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

### 1.9 修改 `config/domains/prompt_workflow.ts` — 扩展步骤类型

- `PromptWorkflowStepKind` 联合类型新增 `'behavior_control'`

### 1.10 修改 `context/workflow/profiles.ts` — 插入行为控制步骤

- 所有 5 个内置 Profile 的 `steps` 数组，在 `fragment_assembly` 与 `permission_filter` 之间插入：
  ```
  { key: 'behavior', kind: 'behavior_control', enabled: true }
  ```

### 1.11 修改 `context/workflow/types.ts` — 扩展状态类型

`PromptWorkflowState` 新增可选字段：

- `behavior_profiles?: SlotBehaviorProfile[]`
- `behavior_states?: Record<string, SlotBehaviorState>`
- `slot_behavior_diagnostics?: SlotBehaviorDiagnostic`

`SlotBehaviorDiagnostic` 接口（与设计文档对齐）：

- `profiles_evaluated: number`
- `slots_activated: string[]`
- `slots_disabled: string[]`
- `evaluation_errors: { slot_id: string; error: string }[]`

### 1.12 修改 `context/workflow/registry.ts` — 注册执行器

- 在 `createPromptWorkflowStepRegistry` 调用中新增 `createBehaviorControlExecutor()`

### 1.13 修改 `context/workflow/orchestrator.ts` — 注入行为配置

- `buildWorkflowPromptBundle` 中，state 初始化后注入 `behavior_profiles`
- 调用 `loadSlotBehaviorConfig(getRuntimeConfig())` 并过滤当前 pack 相关配置

### Phase 1 测试

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

---

## Phase 2 — 状态性触发规则

**目标**：实现黏性（sticky）、冷却时间（cooldown）、延迟触发（delayed_trigger）。需要运行时状态持久化（AppContext 扩展 + 内存 Map）。

### 2.1 新建 `app/behavior_state_store.ts` — 状态存储

- `BehaviorStateStore` 接口（`getState/setState/clearForConversation/clearForInference`）
- `createMemoryBehaviorStateStore(): BehaviorStateStore` — 内存 Map 实现
- 键结构：`{slotId}::{packId}`

### 2.2 修改 `app/context.ts` — AppContext 扩展

- `AppContext` 新增 `behaviorStateStore?: BehaviorStateStore`
- 在 app 初始化时注入 `createMemoryBehaviorStateStore()`

### 2.3 扩展 `inference/slot_behavior_state.ts` — 状态机实现

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

### 2.4 扩展 `context/workflow/executors/behavior_control.ts` — 状态规则

- `executeBehaviorControl` 在条件评估后调用 `applyStateTransitions`
- 延迟触发：条件满足后状态转入 `Delayed`，当前推理不激活
- 冷却检查：`Cooling` 状态下跳过条件评估，直接禁用
- 黏性递减：`Retained` 状态每次激活 `sticky_remaining--`
- 状态持久化：执行完成后 `state.behavior_states` 写回 `behaviorStateStore`

### Phase 2 测试

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

---

## Phase 3 — 递归控制 + 模板引擎集成

**目标**：实现 `no_recursion`、`max_depth`、`prevent_further_recursion`。扩展 `SlotFunctionRenderScope` 和 `slot-ref` 块处理器。

### 3.1 修改 `template_engine/frontends/slot_function/types.ts` — 扩展类型

`SlotRegistration` 新增可选字段：

- `no_recursion?: boolean`
- `max_depth?: number`
- `prevent_further_recursion?: boolean`

### 3.2 修改 `template_engine/frontends/slot_function/blocks.ts` — 扩展 RenderScope

`SlotFunctionRenderScope` 新增：

- `maxDepth?: number`
- `noRecursionSlots?: Set<string>`
- `currentSlotStack?: string[]`
- `preventFurtherRecursion?: boolean`

### 3.3 修改 `template_engine/frontends/slot_function/blocks.ts` — 递归检测

`slotRefBlockHandler` 扩展：

1. `no_recursion` 检查：如果被引用插槽在 `noRecursionSlots` 中 → 记录诊断 `RECURSION_BLOCKED`，返回 `''`
2. 递归检测：如果 `currentSlotStack.includes(slotName)` → 记录诊断 `RECURSION_DETECTED`，返回 `''`
3. `maxDepth` 检查：`scope.depth >= scope.maxDepth` → 返回 `''`
4. `prevent_further_recursion`：如果当前插槽在调用栈中且设置了此标志 → 不再触发 slot-ref 解析，返回 body 内容

### 3.4 修改 `template_engine/core/renderer.ts` — 传递深度约束

- 子渲染调用时 `depth + 1` 传入
- `currentSlotStack` 在进入/退出 `slot-ref` 时 push/pop

### 3.5 扩展 `context/workflow/executors/behavior_control.ts` — 递归约束注入

- `executeBehaviorControl` 中，如果插槽有 `max_depth` / `no_recursion` / `prevent_further_recursion`：
  - 标记到 `tree.fragments_by_slot[slot_id]` 的 fragment 元数据上
  - 模板引擎渲染时从元数据读取约束

### Phase 3 测试

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

---

## Phase 4 — Token Budget 集成 + 群组权重

**目标**：`ignore_context_length` 在 token_budget_trim 中生效；实现群组互斥选择。

### 4.1 新建 `inference/slot_group_resolver.ts` — 群组解析

- `resolveSlotGroups(profiles): Map<string, SlotBehaviorProfile[]>`
- `resolveExclusiveGroup(groupProfiles, rng): string` — 按权重概率互斥选择一个
- `resolvePriorityOrder(groupProfiles)` — 按权重降序排列
- `resolveBudgetAllocation(groupProfiles, totalBudget)` — 按权重分配 token

### 4.2 扩展 `context/workflow/executors/behavior_control.ts` — 群组逻辑

- 在条件评估前先解析群组
- `group_mode: 'exclusive'`（Phase 4 默认）：群组内按权重概率选择一个激活，其余禁用
- 诊断中记录群组选择结果
- `always_active + group_id` → 配置错误（Phase 1 的 `validateSlotBehaviorConfig` 已拒绝）

### 4.3 修改 `context/workflow/executors/token_budget_trim.ts` — ignore_context_length

- 识别 fragment 的 `ignore_context_length` 标记
- 标记为 `ignore_context_length` 的 fragment 在 trim 时优先级最高（不受常规裁剪）
- 硬上限保护：所有 `ignore_context_length` 插槽的 token 总和不超过模型上下文窗口 80%
- 超限时按优先级从低到高裁剪，发出 error 级诊断

### 4.4 扩展 `context/workflow/executors/behavior_control.ts` — ignore_context_length 标记

- `executeBehaviorControl` 中，如果 `profile.ignore_context_length` 为 true：
  - 调用 `markIgnoreContextLength(tree, slot_id)` 在 fragment 元数据上设置标记
- 硬上限检查：`enforceIgnoreContextLengthHardLimit(tree, modelContextWindow)` — 统计所有标记 fragment 的 token，超 80% 时按优先级裁剪

### Phase 4 测试

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

---

## 实现顺序

```
Phase 1: 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7 → 1.9 → 1.11 → 1.8 → 1.10 → 1.12 → 1.13 → 测试
                 ↓ (配置域就绪)
        1.4 (类型与配置加载)
                 ↓
        1.5 + 1.6 + 1.7 (条件评估 + 状态类型 + 采样)
                 ↓ (类型可用)
        1.9 + 1.11 (扩展 PromptWorkflowStepKind + PromptWorkflowState)
                 ↓
        1.8 (behavior_control 执行器，依赖上述所有类型)
                 ↓
        1.10 + 1.12 + 1.13 (profiles + registry + orchestrator 集成)
                 ↓
        Phase 1 测试全部通过

Phase 2: 2.1 → 2.2 → 2.3 → 2.4 → 测试
         (依赖 Phase 1 完成：状态类型和执行器骨架就位)

Phase 3: 3.1 → 3.2 → 3.5 → 3.3 → 3.4 → 测试
         (依赖 Phase 1 完成：behavior_control 管线就位)

Phase 4: 4.1 → 4.2 → 4.4 → 4.3 → 测试
         (依赖 Phase 1 完成：behavior_control 管线就位)
```

Phase 1 是串行依赖链，必须先完成。Phase 2/3/4 之间相互独立，可并行推进。

## 不在此次范围

- Phase 5：插件接口扩展点（`SlotConditionEvaluator` / `SlotContentTransformer`）
- Phase 6+：Rust sidecar + wasmtime WASM 沙箱
- 功能 B：双重模块设置（决策推迟至 Phase 1–3 完成后评估）
- 向量化触发（依赖独立的基础设施设计）
- 通配符路径解析（延后到 Phase 2+）
- `logic_match` 模板引擎 `#if` 复用（延后评估）
