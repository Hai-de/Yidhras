# 插槽函数高级功能设计草案

> 状态: Phase 1–5 实现完成（2026-05-07）
> 关联: TODO.md — 插槽函数高级功能；`apps/server/src/template_engine/frontends/slot_function/`
> 前置: 模板引擎统一（已完成）、插槽定位系统（Phase 1-4 已完成）、插件拓展系统（阶段 1-3 已完成）
> 实现: Phase 1-4 → `.limcode/plans/slot-function-advanced-phase1-4.md` | Phase 5 → `.limcode/plans/slot-function-advanced-phase5.md`

## 问题陈述

TODO.md 中插槽函数有两个未完成的高级功能项：

### 功能 A：高级功能 — 允许执行图灵完备代码

> 允许执行任意代码，处理：深度/顺序/触发概率/群组权重/扫描深度/逻辑匹配/始终激活/条件激活/黏性（触发后保留次数）/触发后冷却时间/延迟触发/延迟递归/不可递归/防止进一步递归/无视上下文长度/关键字匹配/向量化触发

这些需求本质上分为三类：

| 类别 | 需求 | 本质 |
|------|------|------|
| **声明式行为控制** | 深度/顺序/触发概率/群组权重/始终激活/条件激活/不可递归/防止进一步递归/无视上下文长度 | 静态元数据，声明即生效 |
| **状态性触发规则** | 黏性（触发后保留次数）/触发后冷却时间/延迟触发/延迟递归 | 需要运行时状态追踪，但逻辑有限 |
| **动态匹配** | 关键字匹配/逻辑匹配/扫描深度/向量化触发 | 需要模式匹配或向量计算能力 |

当前模板引擎是**纯声明式的**：给定变量池和模板，产出确定性输出。上述需求打破了声明式边界——无论是状态追踪还是脚本执行，都需要引入可变的运行时行为。

### 功能 B：双重模块设置

> 一个是当前的 Prompt Tree V2，另一个是更复杂拥有插槽函数的核心

当前的推理管线（Prompt Tree V2 → PromptBundleV2）是静态组装的：插槽配置加载 → 位置解析 → 模板轨道渲染 → 片段组装 → 权限过滤 → token 裁剪 → 最终输出。这条管线不支持"某个插槽根据运行时条件决定是否注入内容"或"某个插件在渲染时修改上下文"。

## 设计选项分析

### 功能 A：图灵完备代码执行

#### 选项 A1：嵌入式脚本语言（Lua/JS/WASM）

**方案**：在插槽配置或世界包中嵌入脚本片段，由沙箱运行时执行。

| 优势 | 劣势 |
|------|------|
| 完全图灵完备，可表达任意逻辑 | 引入新运行时依赖（Lua VM / QuickJS / WASM runtime） |
| 世界包作者可直接编写复杂行为规则 | 沙箱安全是永久性攻击面——需要资源隔离、超时、权限控制 |
| 与当前模板引擎天然互斥——声明式和命令式根本不同 | 调试和可观测性差：脚本执行是非确定性的 |
| 插件可以提供脚本片段作为清洗/匹配策略 | 脚本版本管理、热更新、错误处理都是长期负担 |

**适合的需求**：逻辑匹配、复杂条件激活、向量化触发（如果需要自定义计算逻辑）

#### 选项 A2：声明式元数据 + 领域特定规则引擎

**方案**：将大部分需求建模为声明式元数据（YAML/JSON），由内置引擎解释执行。仅对"动态匹配"类需求引入可扩展接口。

```yaml
# 示例：插槽行为控制声明
slot_behaviors:
  memory_summary:
    always_active: true
    trigger_probability: 0.8
    max_depth: 3
    sticky:
      max_activations: 5
    cooldown:
      ticks: 10
    conditions:
      - type: keyword_match
        keywords: ["回忆", "想起", "记得"]
      - type: logic_match
        expression: "conversation.turn_count > 3"
    no_recursion: true
```

| 优势 | 劣势 |
|------|------|
| 可验证、可序列化、可回放 | 表达能力受限于引擎预定义的规则类型 |
| 不引入新运行时依赖 | 新规则类型需要引擎代码变更 |
| 与模板引擎和定位系统自然融合 | 复杂需求（如向量化触发）可能无法纯声明式表达 |
| 调试友好：元数据是确定性的 | — |

**适合的需求**：深度/顺序/触发概率/群组权重/始终激活/条件激活/黏性/冷却时间/延迟触发/不可递归

#### 选项 A3：混合方案 — 声明式元数据 + 插件接口扩展点

**方案**：核心行为用声明式元数据定义，"动态匹配"类需求通过插件接口扩展点（类似 DataCleaner 模式）委托给外部实现。

```
声明式元数据 (YAML)
    ├─ 静态属性: always_active, max_depth, no_recursion, ...
    ├─ 状态性规则: sticky, cooldown, delayed_trigger, ...
    └─ 条件匹配: keyword_match (内置), logic_match (内置简单表达式)
                  
插件接口扩展点
    ├─ SlotConditionEvaluator — 自定义条件评估（类似 DataCleaner 接口）
    └─ SlotContentTransformer — 自定义内容变换
```

| 优势 | 劣势 |
|------|------|
| 主路径声明式，简明可验证 | 需要设计两个新插件接口 |
| 复杂需求通过插件扩展，不耦合核心 | 插件注册/发现需要与现有 PluginRuntimeRegistry 协调 |
| 渐进式：先实现声明式核心，再开放插件接口 | 接口设计需要足够稳定以避免版本兼容问题 |
| 与已有 DataCleaner 模式直接对齐 | 声明式引擎 + 插件接口的交互增加实现复杂度 |

**推荐**：选项 A3。

### 功能 B：双重模块设置

#### 选项 B1：独立插槽函数核心并行运行

**方案**：新建一套"插槽函数核心"管线，与现有 Prompt Tree V2 并行。插槽函数核心拥有自己的渲染管线、状态管理和行为控制引擎。

| 优势 | 劣势 |
|------|------|
| 完全独立，不污染 Prompt Tree V2 | 双管线的维护成本——任何管线变更需要同步 |
| 可以激进设计新核心而不受兼容约束 | 需要定义两条管线的合并策略——最终输出如何组装 |
| — | 冗余：模板渲染、token 计算、权限过滤在两条管线中都存在 |

#### 选项 B2：扩展 Prompt Tree V2 — 在现有管线中注入行为控制层

**方案**：在现有 Prompt Tree V2 管线中引入一个"行为控制"执行器（executor），作为 `placement_resolution` 和 `fragment_assembly` 之后的管线步骤。

```
当前管线:  slot_registry → resolved_positions → tracks → placement_resolution → fragment_assembly → permission_filter → token_budget_trim → bundle_finalize
扩展管线:  slot_registry → resolved_positions → tracks → placement_resolution → fragment_assembly → BEHAVIOR_CONTROL → permission_filter → token_budget_trim → bundle_finalize
```

行为控制执行器读取声明式元数据，执行状态追踪和条件评估，修改 `PromptTree`（移除/禁用片段、注入新内容）。

| 优势 | 劣势 |
|------|------|
| 复用现有管线基础设施 | 架构耦合——行为控制需要深度理解 PromptTree 结构 |
| 单一输出，无需合并策略 | PromptTree 不是设计为可变性的——需要解锁写操作 |
| 与插槽定位系统自然对齐 | 管线步骤间耦合增加——行为控制可能依赖之前的步骤结果 |

#### 选项 B3：扩展 Prompt Tree V2 — 双模式配置切换

**方案**：保持单一管线，但引入"模式"概念。`PromptTree` 支持 `mode: 'static' | 'dynamic'`：
- `static` 模式 = 当前行为，纯声明式
- `dynamic` 模式 = 启用行为控制层 + 状态追踪 + 插件扩展点

世界包或插槽配置中声明模式。管线根据模式选择路径。

| 优势 | 劣势 |
|------|------|
| 向后兼容——默认 static 模式无行为变更 | 模式切换增加条件分支复杂度 |
| 单一管线，渐进增强 | 测试矩阵增大——两种模式的所有交叉组合 |
| 模式边界清晰 | — |

**推荐**：暂不决定。功能 B 需要在功能 A 的具体实现成型后再确定模块边界。当前建议先实现功能 A 的声明式核心（选项 A3 的基础层），观察实际复杂度增长后再决定是否引入模式切换（B3）或保持默认管线扩展（B2）。

## 设计草案：功能 A 选项 A3 的具体实现方案

### 核心概念：Slot Behavior Profile

每个插槽可以关联一个 `SlotBehaviorProfile`，声明其行为控制元数据：

```typescript
// ── apps/server/src/inference/slot_behavior.ts ──

export interface SlotBehaviorProfile {
  /** 关联的插槽 id */
  slot_id: string;

  // ═══ 激活控制 ═══

  /** 始终激活 — 跳过所有条件检查 */
  always_active?: boolean;

  /** 触发概率 — 0.0~1.0，使用确定性 FNV-1a 采样（与 memory_trigger 对齐） */
  trigger_probability?: number;

  /** 条件列表 — 所有条件为真时激活（AND 语义） */
  conditions?: SlotCondition[];

  /** 条件组合策略 — 'and'（默认）| 'or' */
  condition_combination?: 'and' | 'or';

  /** 评估失败策略 — 'activate'（默认，保守）| 'deactivate'（安全）| 'abort'（严格） */
  evaluator_failure_policy?: 'activate' | 'deactivate' | 'abort';

  // ═══ 深度与递归控制 ═══

  /** 最大渲染深度 — 限制 slot-ref 嵌套层级 */
  max_depth?: number;

  /** 禁止递归 — 当前插槽内容中不允许 slot-ref 引用自身 */
  no_recursion?: boolean;

  /** 防止进一步递归 — 当前插槽被引用时不再触发 slot-ref 解析 */
  prevent_further_recursion?: boolean;

  // ═══ 顺序与群组 ═══

  /**
   * 群组权重 — 同一群组内的插槽按权重决定激活概率。
   * 注意：与 always_active 互斥，同时声明为配置错误（见 C14 修正）。
   */
  group_weight?: number;

  /** 群组标识 — 同一群组的插槽互斥或按权重分配 */
  group_id?: string;

  /** 群组模式 — 'exclusive'（默认，互斥选择）| 'priority'（渲染优先级）| 'budget'（Token 分配） */
  group_mode?: 'exclusive' | 'priority' | 'budget';

  /** 排序优先级覆盖 — 覆盖 resolved_position 仅用于行为控制层 */
  render_order?: number;

  // ═══ 状态性触发规则（基于世界 tick，见 C9 修正） ═══

  /** 黏性 — 触发后保留指定次数的激活 */
  sticky?: {
    max_activations: number;
  };

  /** 冷却时间 — 触发后等待指定世界 tick 数才能再次触发 */
  cooldown?: {
    ticks: number;
  };

  /** 延迟触发 — 条件满足后等待指定世界 tick 数才激活 */
  delayed_trigger?: {
    delay_ticks: number;
  };

  // ═══ 上下文控制 ═══

  /**
   * 无视上下文长度 — 此插槽内容不参与 token budget trim。
   * 硬上限保护：所有 ignore_context_length 插槽的 token 总和不超过模型上下文窗口的 80%（见 C7 修正）。
   */
  ignore_context_length?: boolean;

  // ═══ 状态生命周期 ═══

  /** 状态生命周期范围 — 'conversation'（默认，对话结束重置）| 'inference'（推理调用结束重置）| 'persistent'（持久化） */
  state_scope?: 'conversation' | 'inference' | 'persistent';

  // ═══ 动态匹配插件 ═══

  /** 自定义条件评估器插件 key（per-pack 注册，见 C10 修正） */
  condition_evaluator?: string;

  /** 传递给条件评估器的选项 */
  condition_evaluator_options?: Record<string, unknown>;
}

export type SlotCondition =
  | { type: 'keyword_match'; keywords: string[]; match_mode?: 'any' | 'all' }
  | { type: 'logic_match'; expression: SlotLogicExpr }
  | { type: 'context_length'; operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq'; value: number }
  | { type: 'conversation_turn'; operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq'; value: number }
  | { type: 'custom'; evaluator_key: string; options?: Record<string, unknown> }

/**
 * logic_match 条件的 DSL 表达式类型。
 * 对齐 memory_trigger_sidecar/src/logic_dsl.rs 的 MemoryLogicExprDto，
 * 但限制为安全子集，确保与 #if 模板语法兼容。
 * Phase 1 路径解析支持点分路径 + 数组索引，通配符延后。
 * 安全约束：禁止访问原型链属性（__proto__, constructor 等）。
 */
export type SlotLogicExpr =
  | { eq: { path: string; value: string | number | boolean | null } }
  | { neq: { path: string; value: string | number | boolean | null } }
  | { gt: { path: string; value: number } }
  | { lt: { path: string; value: number } }
  | { gte: { path: string; value: number } }
  | { lte: { path: string; value: number } }
  | { contains: { path: string; value: string } }
  | { exists: { path: string } }
  | { and: SlotLogicExpr[] }
  | { or: SlotLogicExpr[] }
  | { not: SlotLogicExpr };
```

### 条件评估器插件接口

类似 DataCleaner 模式，定义一个 per-pack 注册的接口（见 C10 修正）：

```typescript
// ── packages/contracts/src/slot_condition_evaluator.ts ──

export interface SlotConditionEvaluator {
  readonly key: string;
  readonly version: string;
  evaluate(context: SlotConditionContext): Promise<SlotConditionResult>;
}

export interface SlotConditionContext {
  slot_id: string;
  /** 当前推断的变量池（来自 PromptVariableContext） */
  variables: Record<string, unknown>;
  /** 对话历史元数据（turn_count 等） */
  conversation_meta: {
    turn_count: number;
    last_message_role?: string;
  };
  /** 当前 token 预算状态 */
  token_budget: {
    total: number;
    used: number;
    remaining: number;
  };
  /** 当前世界 tick（来自 PackRuntimeHandle.currentTick，用于延迟/冷却/状态机） */
  current_tick: number;
  /** 最近一条用户消息的文本内容（keyword_match 的主要文本来源） */
  last_user_message: string;
  /** 自定义选项 */
  options?: Record<string, unknown>;
}

export interface SlotConditionResult {
  /** 条件是否满足 */
  active: boolean;
  /** 评估原因（用于诊断） */
  reason?: string;
  /** 置信度 0.0~1.0（用于概率触发时覆盖 trigger_probability） */
  confidence?: number;
}
```

### 行为状态追踪

状态性规则（黏性、冷却时间、延迟触发）需要跨推理调用持久化状态。

对齐 memory_trigger_sidecar 的状态机（`Inactive → Delayed → Active → Retained → Cooling`），定义 5 状态模型：

```
Pending ──条件满足──→ Active
Pending ──条件满足+delay──→ Delayed ──delay_elapsed──→ Active
Active ──stickyremaining──→ Retained（跳过条件评估）
Retained ──sticky耗尽+cooldown──→ Cooling
Cooling ──冷却结束──→ Pending
Cooling 优先级最高：即使 sticky 仍有次数，冷却期也不激活
```

```typescript
// ── apps/server/src/inference/slot_behavior_state.ts ──

/** 插槽激活状态 — 对齐 memory_trigger_sidecar 的 MemoryActivationStatusDto */
export type SlotActivationStatus = 'Pending' | 'Delayed' | 'Active' | 'Retained' | 'Cooling';

export interface SlotBehaviorState {
  slot_id: string;
  /** 当前激活状态 */
  status: SlotActivationStatus;
  /** 黏性剩余次数（Retained 状态时递减） */
  sticky_remaining?: number;
  /** 冷却结束 tick（世界 tick，Cooling 状态时使用） */
  cooldown_until_tick?: number;
  /** 延迟触发开始 tick（世界 tick，Delayed 状态时使用） */
  delay_until_tick?: number;
  /** 递归深度计数 */
  recursion_depth?: number;
  /** 最后激活 tick */
  last_activated_tick?: number;
  /** 触发总次数（用于 trigger_probability 的确定性采样种子） */
  trigger_count: number;
}
```

**存储位置选项**：

| 方案 | 优势 | 劣势 |
|------|------|------|
| A) 内存 Map（`Map<string, SlotBehaviorState>`） | 最简单，读取快 | 进程重启丢失；多实例不共享 |
| B) Prisma 表 | 持久化，多实例共享 | 每次推断需要 DB 查询；增加迁移 |
| C) Conversation 元数据（存入 conversation entry） | 自然生命周期——对话结束状态清除 | 增加序列化复杂度 |
| D) 运行时状态层（`AppContext` 扩展） | 与现有架构对齐；可插拔存储后端 | 需要设计状态生命周期 |

**决策**：方案 D，初期用内存 Map 实现，接口设计允许后续替换为持久化后端。

状态生命周期管理（回应 O2）：
- `state_scope: 'conversation'`（默认）：对话结束清除状态，存入 `AppContext.behaviorStateStore`
- `state_scope: 'inference'`：每次推理调用结束后清除
- `state_scope: 'persistent'`：持久化到 pack-local 存储（Phase 2+ 实现）

`AppContext.behaviorStateStore` 类型：

```typescript
interface BehaviorStateStore {
  getState(slotId: string, packId: string): SlotBehaviorState | undefined;
  setState(slotId: string, packId: string, state: SlotBehaviorState): void;
  clearForConversation(packId: string, conversationId: string): void;
  clearForInference(packId: string, inferenceId: string): void;
}
```

### 管线集成：行为控制执行器

在现有推理管线的 `fragment_assembly` 和 `permission_filter` 之间插入行为控制步骤。

**插入策略（回应 C5）**：采用"组装后禁用"策略。所有插槽先参与内容组装（`fragment_assembly`），行为控制在组装后决定是否渲染。理由：`context_length` 等条件需要实际 token 计数；模板渲染是确定性纯函数操作，被禁用插槽的组装开销可忽略（< 1ms）。

**管线步骤注册（回应 C2）**：需扩展 `PromptWorkflowStepKind` 联合类型添加 `'behavior_control'`，在 `registry.ts` 中注册 `createBehaviorControlExecutor()`，在各 Profile 的 `steps` 数组中 `assembly` 与 `permission` 之间插入 `{ key: 'behavior', kind: 'behavior_control', enabled: true }`。

**PromptWorkflowState 变更（回应 C3）**：新增 `behavior_profiles?`、`behavior_states?`、`slot_behavior_diagnostics?` 三个可选字段。现有 executor 无需修改。

变更后的管线步骤序列：
```
当前:  slot_registry → resolved_positions → tracks → placement_resolution → fragment_assembly → permission_filter → token_budget_trim → bundle_finalize
扩展:  slot_registry → resolved_positions → tracks → placement_resolution → fragment_assembly → BEHAVIOR_CONTROL → permission_filter → token_budget_trim → bundle_finalize
```

```typescript
// ── apps/server/src/context/workflow/executors/behavior_control.ts ──

export async function executeBehaviorControl(
  input: { context: InferenceContext; profile: PromptWorkflowProfile; spec: PromptWorkflowStepSpec; state: PromptWorkflowState }
): Promise<PromptWorkflowState> {
  const behaviorProfiles = loadBehaviorProfiles(state);
  const behaviorStates = state.behavior_states ?? {};
  const tree = state.tree;

  if (!tree) return state;

  const diagnostics: SlotBehaviorDiagnostic = {
    profiles_evaluated: 0,
    slots_activated: [],
    slots_disabled: [],
    evaluation_errors: [],
  };

  for (const profile of behaviorProfiles) {
    try {
      const shouldActivate = await evaluateSlotActivation(
        profile,
        behaviorStates[profile.slot_id],
        state
      );

      if (!shouldActivate.active) {
        disableSlotContent(tree, profile.slot_id);
        diagnostics.slots_disabled.push(profile.slot_id);
        continue;
      }

      diagnostics.slots_activated.push(profile.slot_id);

      // 应用状态性规则（状态机转换，见 C8 修正）
      applyStateTransitions(behaviorStates, profile, shouldActivate);

      // 应用深度限制（延迟到模板引擎渲染时，见模板引擎扩展）
      if (profile.max_depth !== undefined || profile.no_recursion) {
        applyRecursionConstraints(tree, profile);
      }

      // 标记为无视上下文长度（含硬上限保护，见 C7 修正）
      if (profile.ignore_context_length) {
        markIgnoreContextLength(tree, profile.slot_id);
      }
    } catch (error) {
      diagnostics.evaluation_errors.push({ slot_id: profile.slot_id, error: String(error) });
      const policy = profile.evaluator_failure_policy ?? 'activate';
      if (policy === 'deactivate') {
        disableSlotContent(tree, profile.slot_id);
        diagnostics.slots_disabled.push(profile.slot_id);
      } else if (policy === 'abort') {
        throw new BehaviorControlAbortError(profile.slot_id, error);
      }
      // 'activate': 保持激活
    }
    diagnostics.profiles_evaluated++;
  }

  return {
    ...state,
    tree,
    behavior_states: behaviorStates,
    slot_behavior_diagnostics: diagnostics,
  };
}
```

### 内置条件类型实现

```typescript
// ── apps/server/src/inference/slot_condition_evaluators.ts ──

export function evaluateKeywordMatch(
  condition: KeywordMatchCondition,
  context: SlotConditionContext
): boolean {
	  // 从 ai_messages 取最后一条 user 角色的 content，空则 keyword_match 返回 false（见 C13 修正）
	  const text = context.last_user_message;
  if (!text) return false;

  if (condition.match_mode === 'all') {
    return condition.keywords.every(kw => text.includes(kw));
  }
  return condition.keywords.some(kw => text.includes(kw));
}

export function evaluateLogicMatch(
  condition: LogicMatchCondition,
  context: SlotConditionContext
): boolean {
	  // 使用与 memory_trigger_sidecar/logic_dsl.rs 对齐的路径解析和求值逻辑
	  // Phase 1 支持点分路径 + 数组索引，通配符延后到 Phase 2+（见 C12 修正）
  return evaluateSlotLogicExpr(condition.expression, {
    ...context.variables,
    conversation: context.conversation_meta,
    token_budget: context.token_budget,
    current_tick: context.current_tick,
  });
}

export function evaluateContextLength(
  condition: ContextLengthCondition,
  context: SlotConditionContext
): boolean {
  return compareValue(context.token_budget.remaining, condition.operator, condition.value);
}

export function evaluateConversationTurn(
  condition: ConversationTurnCondition,
  context: SlotConditionContext
): boolean {
  return compareValue(context.conversation_meta.turn_count, condition.operator, condition.value);
}
```

### 与现有系统的交互边界

| 系统 | 交互方式 | 影响 |
|------|---------|------|
| **Memory Trigger Sidecar** | 语义对齐不共用运行时——状态机命名（Pending/Delayed/Active/Retained/Cooling）对齐；条件评估（keyword_match/Logic DSL）语法对齐；采样算法（FNV-1a）对齐。各自独立运行，不互相调用（见 C4 修正）。 | 无运行时耦合，类型定义在 contracts 包中共享对齐 |
| **插槽定位系统** | 行为控制发生在定位之后；`disableSlotContent()` 与定位系统的"禁用保留位置"一致 | 无冲突——定位决定顺序，行为控制决定是否渲染 |
| **模板引擎** | `no_recursion` / `max_depth` 需要在渲染时传递给模板引擎 | 需要扩展 `RenderContext` 或 `SlotFunctionRenderScope` 传递约束 |
| **Token Budget Trim** | `ignore_context_length` 标记的片段在 trim 时优先级最高，但有 80% 硬上限保护（见 C7 修正） | 需要扩展 `token_budget_trim.ts` 识别此标记，硬上限超限时按优先级裁剪 |
| **插件系统** | 自定义条件评估器通过 per-pack `SlotConditionEvaluator` 接口注册（见 C10 修正） | 类似 DataCleaner 模式——per-pack 注册表 + 命名空间隔离 + 内置全局默认 |
| **对话历史** | `conversation_turn` 条件需要访问对话元数据；`last_user_message` 需要从 ai_messages 或 context_run 提取（见 C13 修正） | 行为控制执行器需要从 state 中提取对话元数据 |
| **世界 Tick** | `delayed_trigger`、`cooldown`、状态机转换使用 `PackRuntimeHandle.currentTick`（见 C9 修正） | 行为控制执行器需要从 AppContext 获取世界 tick |

### 模板引擎扩展需求

当前 `slot-ref` 块处理器在渲染时查询 slot 注册表。行为控制引入的新需求：

1. **递归约束**：`no_recursion` 和 `max_depth` 需要在渲染时传递给模板引擎
2. **条件激活**：行为控制执行器在渲染前已经决定哪些插槽激活——`slot-ref` 查询时看到的注册表已经更新

扩展 `SlotFunctionRenderScope`：

```typescript
interface SlotFunctionRenderScope extends RenderScope {
  slotRegistry?: SlotRegistry;
  // 新增：递归约束
  maxDepth?: number;
  noRecursionSlots?: Set<string>;    // 不允许自引用的插槽集合
  currentSlotStack?: string[];        // 当前 slot-ref 调用栈（用于递归检测）
}
```

递归检测逻辑（在 `slot-ref` 块处理器中）：

```typescript
// 扩展 slotRefBlockHandler
if (scope.noRecursionSlots?.has(slotName)) {
  // 记录诊断信息，返回空字符串
  context.diagnostics.errors.push({
    code: 'RECURSION_BLOCKED',
    message: `Slot '${slotName}' has no_recursion constraint`,
    path: slotName
  });
  return '';
}

if (scope.currentSlotStack?.includes(slotName)) {
  // 递归检测——当前调用栈已包含此插槽
  context.diagnostics.errors.push({
    code: 'RECURSION_DETECTED',
    message: `Recursive slot-ref detected: '${slotName}'`,
    path: slotName
  });
  return '';
}
```

### YAML 配置示例

```yaml
# ── data/configw/default.yaml 中的插槽行为配置 ──
slot_behaviors:
  system_core:
    always_active: true
    no_recursion: true
    ignore_context_length: true
    # 注意：always_active + conditions 为配置错误（见 C6 修正）
    # 注意：always_active + group_id 为配置错误（见 C14 修正）

  memory_summary:
    trigger_probability: 0.8
    conditions:
      - type: conversation_turn
        operator: gt
        value: 3
    sticky:
      max_activations: 5
    cooldown:
      ticks: 10
    max_depth: 2
    state_scope: conversation  # 对话结束重置状态（见 O2 决策）

  world_context:
    always_active: true
    conditions:
      - type: keyword_match
        keywords: ["世界", "设定", "背景"]
        match_mode: any
    condition_combination: or

  role_core:
    always_active: true
    # 不声明 group_id，避免与 always_active 冲突

  post_process:
    conditions:
      - type: logic_match
        expression:
          and:
            - gt: { path: "token_budget.remaining", value: 2000 }
            - not:
                eq: { path: "conversation.is_first_message", value: true }
    delayed_trigger:
      delay_ticks: 0
```

### 实现阶段建议

#### Phase 1：声明式核心（无状态）

**目标**：实现 `SlotBehaviorProfile` 类型定义、YAML 配置加载、内置条件评估（keyword_match、conversation_turn、context_length）、管线集成骨架。

**变更范围**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `inference/slot_behavior.ts` | 新建 | `SlotBehaviorProfile` 类型定义 + YAML 配置加载 |
| `inference/slot_condition_evaluators.ts` | 新建 | 内置条件评估器实现（含 `evaluateSlotLogicExpr` 路径解析） |
| `inference/slot_behavior_state.ts` | 新建 | 行为状态类型定义（`SlotActivationStatus` 5 状态机）+ 状态转换逻辑 |
| `context/workflow/executors/behavior_control.ts` | 新建 | 行为控制执行器骨架 |
| `context/workflow/types.ts` | 修改 | `PromptWorkflowState` 增加 `behavior_profiles`、`behavior_states`、`slot_behavior_diagnostics` |
| `context/workflow/registry.ts` | 修改 | 注册 `createBehaviorControlExecutor()` |
| `config/domains/slot_behavior.ts` | 新建 | Zod schema + TypeScript 类型 + 默认值，接入运行时分层配置 |
| `config/domains/prompt_workflow.ts` | 修改 | 扩展 `PromptWorkflowStepKind` 联合类型添加 `'behavior_control'` |
| `context/workflow/profiles.ts` | 修改 | 各 Profile 步骤序列中 `assembly` 与 `permission` 之间插入 `behavior_control` |
| `config/domains/index.ts` | 修改 | 注册 `slot_behavior` 域到 `RuntimeConfigSchema` 和 `BUILTIN_DEFAULTS` |
| `config/tiers.ts` | 修改 | `slot_behavior` 归类为 `CAUTION` 级（运行时生效，记录日志） |

**不涉及**：模板引擎变更（Phase 1 无递归约束需求）、token budget trim 变更（Phase 1 无 `ignore_context_length` 需求）、插件接口扩展（Phase 1 仅内置条件评估器）。

#### Phase 2：状态性触发规则

**目标**：实现黏性、冷却时间、延迟触发。需要行为状态存储（`AppContext` 扩展 + 内存 Map）。

**变更范围**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `inference/slot_behavior_state.ts` | 扩展 | 实现状态追踪逻辑 |
| `app/context.ts` | 修改 | 增加 `behaviorStateStore` |
| `context/workflow/executors/behavior_control.ts` | 扩展 | 黏性/冷却/延迟触发逻辑 |
| 单元测试 + 集成测试 | 新建 | 状态性规则测试覆盖 |

#### Phase 3：递归控制 + 模板引擎集成

**目标**：实现 `no_recursion`、`max_depth`、`prevent_further_recursion`。扩展 `SlotFunctionRenderScope` 和 `slot-ref` 块处理器。

**变更范围**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `template_engine/frontends/slot_function/blocks.ts` | 修改 | 递归检测逻辑 |
| `template_engine/frontends/slot_function/types.ts` | 修改 | 扩展 `SlotFunctionRenderScope` |
| `template_engine/core/renderer.ts` | 修改 | 传递深度约束到子渲染 |
| 测试 | 新建 | 递归场景测试 |

#### Phase 4：Token Budget 集成 + 群组权重

**目标**：`ignore_context_length` 在 `token_budget_trim.ts` 中生效；群组权重实现。

**变更范围**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `context/workflow/executors/token_budget_trim.ts` | 修改 | 识别 `ignore_context_length` 标记 |
| `inference/slot_behavior.ts` | 扩展 | 群组权重逻辑 |
| 测试 | 新建 | Token budget + 群组权重测试 |

#### Phase 5：插件接口扩展点

**目标**：开放 `SlotConditionEvaluator` 和 `SlotContentTransformer` 两个接口，允许插件注册自定义条件评估器和内容变换器。类似 DataCleaner 模式——全局注册表 + 插件贡献。

**变更范围**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/contracts/src/slot_condition_evaluator.ts` | 新建 | Zod schema + TypeScript 接口（门控型 + 变换型） |
| `plugins/extensions/slot_condition_registry.ts` | 新建 | 全局注册表（含 `registerEvaluator` 和 `registerTransformer`） |
| `plugins/extensions/slot_content_transformer.ts` | 新建 | 内容变换器注册表 |
| `plugins/runtime.ts` | 修改 | `ServerPluginHostApi` 增加 `registerSlotConditionEvaluator` 和 `registerSlotContentTransformer` |
| `builtin/system_pack/plugins/` | 新增 | 内置条件评估器插件（keyword_match, logic_match, conversation_turn, context_length） |
| `context/workflow/executors/behavior_control.ts` | 扩展 | 在激活决策后调用 `SlotContentTransformer` |

**接口设计关键约束**：
- `SlotConditionEvaluator.evaluate()` 和 `SlotContentTransformer.transform()` 的返回类型必须是 JSON 可序列化的——为 Phase 6+ WASM 沙箱预留兼容性
- `SlotContentTransformer` 在管线中的位置：`behavior_control`（激活决策）→ `content_transform`（内容变换）→ `permission_filter`（权限过滤）

#### Phase 6+：Rust sidecar + wasmtime WASM 沙箱（架构预留，不实施）

**前置条件**：Phase 1-5 已完成；有明确的世界包作者需要提交任意脚本的需求。

**变更范围**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/contracts/src/sandbox.ts` | 新建 | `SandboxExecutionRequest` / `SandboxLimits` / `SandboxExecutionResult` Zod schema |
| `rust/world_engine_sidecar/src/commands/sandbox.rs` | 新建 | wasmtime 执行引擎，fuel 限制，内存限制，超时 |
| `rust/world_engine_sidecar/src/ipc/mod.rs` | 修改 | 新增 `sandbox_execute` IPC 命令 |
| `apps/server/src/plugins/extensions/sandbox_runtime.ts` | 新建 | TS 侧沙箱调用封装，将 WASM 模块加载请求发送到 sidecar |
| `inference/slot_condition_evaluators.ts` | 扩展 | `custom` 条件类型支持调用沙箱执行 |
| 世界包 schema | 修改 | 允许声明 WASM 模块资源 |

**不在此阶段实现**——仅在 Phase 5 接口设计时确保返回类型兼容 JSON 序列化。

### 插件接口兜底分析

当前 `SlotConditionEvaluator` 签名是**门控型**：输入上下文，输出 `active: boolean`。这能兜底的场景和不能兜底的边界：

| 能兜底 | 不能兜底 |
|--------|----------|
| 任意条件判断（关键字→向量相似度→自定义规则） | 插槽内容变换（condition evaluator 不能改内容） |
| 概率触发、冷却、延迟（通过状态参数传入） | 多插槽协调（evaluator 只回答单个插槽的激活问题） |
| 外部数据源查询（evaluator 内部调用 API） | 管线行为修改（evaluator 不能改变渲染管线本身） |

核心缺口是**内容变换**——如果未来需要"根据运行时条件动态修改插槽内容"（不只是激活/禁用），当前签名不够。Phase 5 预留 `SlotContentTransformer` 接口：

```typescript
// 门控型 — 当前设计，Phase 1-4
interface SlotConditionEvaluator {
  readonly key: string
  readonly version: string
  evaluate(context: SlotConditionContext): Promise<SlotConditionResult>
}

// 变换型 — Phase 5+ 视需求开放
interface SlotContentTransformer {
  readonly key: string
  readonly version: string
  transform(content: string, context: SlotTransformContext): Promise<SlotTransformResult>
}

interface SlotTransformContext extends SlotConditionContext {
  /** 当前插槽渲染后的原始内容 */
  original_content: string
  /** 行为控制执行后的激活/禁用决策 */
  activation_decision: SlotConditionResult
}

interface SlotTransformResult {
  /** 变换后的内容 */
  transformed: string
  /** 诊断信息 */
  metadata?: Record<string, unknown>
}
```

两个接口独立注册，一个决定"要不要"，一个决定"变成什么"。这与 DataCleaner 的 `clean(input) → cleaned` 模式直接对齐，学习成本最低。`SlotContentTransformer` 在管线中的位置在 `behavior_control` 之后、`permission_filter` 之前——内容变换发生在激活决策之后、权限过滤之前。

**注册作用域（回应 C10）**：per-pack 注册 + 命名空间隔离。同一 pack 内 key 冲突 → throw 错误；不同 pack 允许同名 key。内置评估器（keyword_match 等）作为全局默认，pack 级可覆盖。

### 沙箱运行时演进路径

当世界包作者需要提交任意脚本（而非仅仅是声明式元数据或 TS 插件接口），需要沙箱运行时。四种运行时方案对比：

| 方案 | 隔离性 | 性能 | 集成复杂度 | 攻击面 |
|------|--------|------|-----------|--------|
| **Rust + wasmtime（WASM）** | 进程级+内存安全 | 高 | 中（IPC 复用现有 sidecar 通道） | 最小 |
| Node.js + QuickJS | VM 沙箱 | 中 | 低（进程内） | JS 原型链逃逸历史多 |
| Lua VM（wasmoon/rust_lua） | VM 级 | 中 | 中 | 成熟但 Lua 5.x 沙箱有已知逃逸 |
| 独立子进程 spawn | OS 级 | 低（进程启动开销） | 高 | 最小但延迟大 |

**选择 Rust + wasmtime（WASM）的原因**：

1. 项目已有 Rust sidecar（`apps/server/rust/world_engine_sidecar/`），IPC 通信基础设施就位——脚本执行可以作为 sidecar 的一个新命令，复用现有通道，不引入新进程管理
2. WASM 天然沙箱——线性内存隔离、无宿主 I/O 默认权限、执行超时可在宿主端强制终止
3. Rust + wastime 组合消除 C/Rust 层面的内存安全问题，QuickJS/Lua 的 C 实现做不到
4. wasmtime 支持 fuel 机制（指令计数限制）和内存上限，天然防御 DoS

演进路径分三个阶段：

```
Phase 1-4: 纯声明式（无沙箱需求）
    │
    │ 所有行为通过 YAML 元数据 + 内置条件评估器表达
    │ 插件是项目自己的 TS 代码，信任边界 = 插件作者
    │
Phase 5:  TS 插件接口（SlotConditionEvaluator + SlotContentTransformer）
    │  同 DataCleaner 模式，跑在主进程
    │  信任边界 = 插件作者（项目内部或经过审核的世界包）
    │  不涉及用户提交的任意脚本
    │
Phase 6+: Rust sidecar + wasmtime WASM 沙箱
       世界包作者提交 WASM 模块
       通过现有 sidecar IPC 通道执行
       资源限制：fuel（指令计数）、内存上限、超时
       适用于向量化触发、复杂逻辑匹配等需要安全执行任意代码的场景
```

Phase 6 的架构预留（不在 Phase 1-5 实施范围内）：

```typescript
// ── packages/contracts/src/sandbox.ts（Phase 6+ 预留接口，不实施） ──

export interface SandboxExecutionRequest {
  /** WASM 模块标识（从世界包资源加载） */
  module_id: string
  /** 入口函数名 */
  entrypoint: string
  /** 调用参数（JSON 可序列化） */
  args: Record<string, unknown>
  /** 资源限制 */
  limits: SandboxLimits
}

export interface SandboxLimits {
  /** 最大指令数（wasmtime fuel） */
  max_fuel: number
  /** 最大内存（字节） */
  max_memory_bytes: number
  /** 执行超时（毫秒） */
  timeout_ms: number
}

export interface SandboxExecutionResult {
  /** 执行结果（JSON 可序列化） */
  output: unknown
  /** 消耗的 fuel */
  fuel_consumed: number
  /** 是否超时 */
  timed_out: boolean
}
```

sidecar 命令扩展：

```
现有 sidecar 命令:  step | query | rule | ...
Phase 6 新增:      sandbox_execute(module_id, entrypoint, args, limits) → SandboxExecutionResult
```

这个架构预留不需要在 Phase 1-5 中实现任何代码，但确保：
- `SlotConditionEvaluator` 和 `SlotContentTransformer` 的 `evaluate/transform` 返回类型设计需要兼容 WASM 调用的结果格式（JSON 可序列化）
- sidecar IPC 协议在 Phase 6 前不需要变更，新增 `sandbox_execute` 命令是向后兼容的

### 功能 B：双重模块 — 决策推迟

功能 B 的决策需要基于功能 A 的实际实现复杂度：

- 如果功能 A 的声明式核心 + 行为控制执行器能平滑集成到 Prompt Tree V2 管线中（选项 B2），不需要引入双重模块
- 如果行为控制逻辑膨胀到需要独立的状态管理和渲染管线，则考虑 B3（模式切换）

**建议**：Phase 1-3 完成后评估——如果 `behavior_control.ts` 超过 300 行或需要独立的状态机，启动功能 B 的正式设计。

## 开放问题

### O1: logic_match 表达式的安全边界 ✅

`logic_match` 条件类型需要一个表达式求值器。选项：

| 方案 | 安全性 | 表达力 |
|------|--------|--------|
| A) 简易 DSL（仅支持 `variable op value` 比较） | 最高 | 最低 |
| B) JSONLogic（声明式逻辑组合） | 高 | 中等 |
| C) 嵌入 JS 沙箱（QuickJS） | 最低（需沙箱隔离） | 最高 |
| D) 模板引擎条件复用（复用 `#if` 语法） | 高 | 中等（依赖变量池） |

**决策**：Phase 1 采用结构化 DSL（见 C12 修正的 `SlotLogicExpr` 类型），语法与 memory_trigger_sidecar 的 `logic_dsl.rs` 对齐——支持 `eq/neq/gt/lt/gte/lte/contains/exists/and/or/not` + 点分路径 + 通配符 + 数组索引。安全约束：禁止原型链属性访问、无副作用、3 秒超时。Phase 4 考虑方案 D（模板引擎复用 `#if` 语法和 VariableResolver），确保 DSL 路径表达式与 `#if` 变量引用语法兼容。Phase 5+ 图灵完备脚本执行走 Rust + wasmtime WASM 沙箱路径。

### O2: 行为状态的生命周期管理 ✅

黏性和冷却时间状态何时重置？

| 方案 | 行为 |
|------|------|
| A) 对话结束重置 | 每个新对话重新开始计数 |
| B) 推理会话结束重置 | 每次推理调用重新开始（无状态） |
| C) 可配置 | `SlotBehaviorProfile` 中声明 `state_scope: 'conversation' \| 'inference' \| 'persistent'` |

**决策**：方案 C（可配置），默认 `conversation`。已在 `SlotBehaviorProfile` 中添加 `state_scope` 字段。`AppContext.behaviorStateStore` 提供 `clearForConversation()` 和 `clearForInference()` 方法按作用域清除。

### O3: `trigger_probability` 的随机种子 ✅

如果 `trigger_probability: 0.8`，每次推理时随机决定是否激活。问题：

- 是否需要确定性重现？如果需要，随机种子应从 `inference_id` 派生
- 不同插槽的概率触发是否应该相关？如果两个插槽都设 `trigger_probability: 0.5`，是独立随机还是同一随机源？

**决策**：独立随机，种子从 `inference_id` + `slot_id` + `current_tick` 派生，使用 FNV-1a 哈希（与 memory_trigger_sidecar 的 `build_trigger_rate_gate_seed` 和 `compute_trigger_rate_sample` 算法对齐）。确定性可重现，不同插槽独立采样。

```typescript
// 对齐 memory_trigger_sidecar/src/sampling.rs 的确定性采样逻辑
function computeTriggerProbabilitySample(inferenceId: string, slotId: string, currentTick: number, triggerCount: number): number {
  const seed = `slot_behavior_rate_gate::${slotId}::${currentTick}::${triggerCount}`;
  const hash = fnv1a64(seed);
  // 将哈希值映射到 [0, 1) 区间
  return (hash >>> 0) / 4294967296;
}

function evaluateTriggerProbability(probability: number, inferenceId: string, slotId: string, currentTick: number, triggerCount: number): boolean {
  if (probability >= 1.0) return true;
  if (probability <= 0.0) return false;
  const sample = computeTriggerProbabilitySample(inferenceId, slotId, currentTick, triggerCount);
  return sample < probability;
}
```


**FNV-1a 实现**：TypeScript 侧自实现 `fnv1a64`（FNV-1a 64-bit 哈希），与 Rust sidecar 的 `sampling.rs` 输出做快照交叉验证以确保一致性。`fnv1a64` 返回 `bigint`，通过 `Number(hash & 0xFFFFFFFFn) / 4294967296` 映射到 `[0, 1)`。
### O4: `ignore_context_length` 与 `always_active` 的交集 ✅

如果一个插槽同时声明 `always_active: true` 和 `ignore_context_length: true`，它在 token budget trim 中永远不被裁剪。这是否可能导致 token 预算溢出？

**决策**：保留此行为（这是世界包作者的意图），但：
1. 在诊断信息中标记 `warning: 'slot_ignores_budget'`
2. 设置硬上限保护：所有 `ignore_context_length` 插槽的 token 总和不超过模型上下文窗口的 80%（见 C7 修正）
3. 超过硬上限时按优先级从低到高裁剪，并发出 error 级诊断

### O5: 群组权重的精确语义 ✅

`group_weight` + `group_id` 的交互模式：

| 方案 | 语义 |
|------|------|
| A) 互斥选择 | 同一群组内按权重概率选择一个插槽激活 |
| B) 渲染优先级 | 同一群组内按权重决定渲染顺序 |
| C) Token 分配 | 同一群组内按权重分配 token 预算 |

**决策**：方案 A（互斥选择）为默认，`group_mode` 字段控制——`'exclusive'`（A）、`'priority'`（B）、`'budget'`（C）。Phase 1 仅实现 A。

补充规则（回应 C14）：`always_active + group_id` 组合为配置错误，加载时拒绝。

### O6: 功能 A 是否需要优先讨论向量化触发 ✅

向量化触发（`vectorized trigger`）需要向量嵌入和相似度计算能力，这是完全不同的基础设施（向量数据库、嵌入模型调用）。选项：

| 方案 | 复杂度 |
|------|--------|
| A) 推迟到独立设计 | 最低 |
| B) 作为 `SlotConditionEvaluator` 插件实现 | 中等（需要向量基础设施先就位） |
| C) 调用 AI gateway 获取嵌入 | 中等（延迟高） |

**决策**：方案 A——向量化触发依赖的基础设施（向量存储、嵌入模型）尚未在项目中实现，应作为独立能力设计后再接入 `SlotConditionEvaluator` 接口。如果需要自定义匹配逻辑，Phase 5 的 TS 插件接口可以临时兜底；需要安全执行任意代码时走 Phase 6+ WASM 沙箱路径。

## 与现有设计的关系

| 现有设计 | 交互 |
|---------|------|
| 模板引擎统一 | 行为控制不影响模板引擎核心——仅扩展 `SlotFunctionRenderScope` 和 `slot-ref` 块处理器 |
| 插槽定位系统 | 行为控制发生在定位之后——定位决定顺序，行为控制决定是否渲染 |
| 插件拓展系统 | `SlotConditionEvaluator` / `SlotContentTransformer` 接口遵循 DataCleaner 模式——全局注册表 + 插件贡献 |
| DataCleaner | 类似的插件接口模式，但不共享注册表（不同 capability key 前缀：`slot_condition.*` vs `data_cleaner.*`） |
| 推理工作流 | 行为控制作为新 executor 插入管线，不修改现有步骤的签名 |
| Rust sidecar | Phase 6+ 沙箱执行复用现有 sidecar IPC 通道，新增 `sandbox_execute` 命令——Phase 1-5 无需变更 |

## 审查记录

> 审查日期: 2026-05-07 | 状态: 已通过，全部修正已并入文档正文

17 个问题（C1–C17）在怀疑性审查中被发现并已修正。以下为要点索引，具体修正内容已反映在文档各对应章节中。

| # | 问题 | 决策 |
|---|------|------|
| C1 | 文件路径错误（执行器目录为 `context/workflow/executors/`） | 全部路径已更正 |
| C2 | 管线步骤注册机制缺失（`PromptWorkflowStepKind` 需扩展） | 新增 `'behavior_control'`，所有 Profile 在 `assembly` 与 `permission` 之间插入 |
| C3 | `PromptWorkflowState` 变更未分析 | 新增 3 个可选字段：`behavior_profiles`、`behavior_states`、`slot_behavior_diagnostics` |
| C4 | 与 memory_trigger_sidecar 功能重叠 | 独立实现但语义对齐（状态机命名、DSL 语法、采样算法），不共享运行时 |
| C5 | 执行器插入位置矛盾 | 组装后禁用（assemble-then-disable），理由：`context_length` 需实际 token 计数 |
| C6 | `always_active` + `conditions` 交互未定义 | 配置加载时拒绝该组合 |
| C7 | 多插槽 `ignore_context_length` 可能溢出 | 硬上限 80% 模型上下文窗口，超限按优先级裁剪 |
| C8 | `sticky` + `cooldown` 状态机不完整 | 定义 5 状态机（Pending→Delayed→Active→Retained→Cooling），Cooling 优先级最高 |
| C9 | tick 定义模糊 | 使用世界 tick（`PackRuntimeHandle.currentTick`） |
| C10 | 插件注册作用域未明确 | per-pack 注册 + 命名空间隔离（`{packId}::{key}`），同 pack 内冲突抛错 |
| C11 | 异步评估延迟风险 | 3s 超时，`evaluator_failure_policy`（activate/deactivate/abort），条件并行评估 |
| C12 | `logic_match` DSL 未定义 | 对齐 `logic_dsl.rs`：eq/neq/gt/lt/gte/lte/contains/exists/and/or/not，Phase 1 点分路径+数组索引，通配符延后 |
| C13 | `keyword_match` 文本来源模糊 | 从 `ai_messages` 取最后一条 user 角色的 content 作为 `last_user_message`，空则 `keyword_match` 直接返回 false |
| C14 | 群组互斥 + `always_active` 冲突 | 配置拒绝 `always_active + group_id` 组合 |
| C15 | 无错误恢复机制 | try-catch per slot，前序状态保留，`abort` 模式下中断管线 |
| C16 | Sidecar IPC 版本管理缺失 | `world.sandbox.execute`，新增方法不递增协议版本 |
| C17 | 性能模型缺失 | 目标：总耗时 < 5ms（9 插槽），单条件 < 0.5ms，异步 3s 超时 |

**关键架构决策汇总**：

- **与 memory_trigger 的关系**：独立运行时，语义对齐。评估域不同（记忆触发 vs 插槽渲染），生命周期不同（kernel Prisma vs AppContext），执行位置不同（Rust sidecar vs TS 管线步骤）
- **管线插入位置**：`fragment_assembly` → **behavior_control** → `permission_filter` → `token_budget_trim`
- **状态机**：Pending → Delayed → Active → Retained → Cooling，Cooling 最高优先级
- **插件注册**：per-pack + 命名空间隔离，内置评估器为全局默认
- **沙箱路径**：Phase 6+ 走 Rust + wasmtime WASM，Phase 1-5 不涉及