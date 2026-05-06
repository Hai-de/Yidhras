# 插槽函数高级功能设计草案

> 状态: 草案（讨论中）
> 关联: TODO.md — 插槽函数高级功能；`apps/server/src/template_engine/frontends/slot_function/`
> 前置: 模板引擎统一（已完成）、插槽定位系统（Phase 1-4 已完成）、插件拓展系统（阶段 1-3 已完成）

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

  /** 触发概率 — 0.0~1.0，每次推断时随机决定是否激活 */
  trigger_probability?: number;

  /** 条件列表 — 所有条件为真时激活（AND 语义） */
  conditions?: SlotCondition[];

  /** 条件组合策略 — 'and'（默认）| 'or' */
  condition_combination?: 'and' | 'or';

  // ═══ 深度与递归控制 ═══

  /** 最大渲染深度 — 限制 slot-ref 嵌套层级 */
  max_depth?: number;

  /** 禁止递归 — 当前插槽内容中不允许 slot-ref 引用自身 */
  no_recursion?: boolean;

  /** 防止进一步递归 — 当前插槽被引用时不再触发 slot-ref 解析 */
  prevent_further_recursion?: boolean;

  // ═══ 顺序与群组 ═══

  /** 群组权重 — 同一群组内的插槽按权重决定渲染顺序或概率 */
  group_weight?: number;

  /** 群组标识 — 同一群组的插槽互斥或按权重分配 */
  group_id?: string;

  /** 排序优先级覆盖 — 覆盖 resolved_position 仅用于行为控制层 */
  render_order?: number;

  // ═══ 状态性触发规则 ═══

  /** 黏性 — 触发后保留指定次数的激活 */
  sticky?: {
    max_activations: number;
  };

  /** 冷却时间 — 触发后等待指定 tick 数才能再次触发 */
  cooldown?: {
    ticks: number;
  };

  /** 延迟触发 — 在推理开始后指定 tick 数才激活 */
  delayed_trigger?: {
    delay_ticks: number;
  };

  // ═══ 上下文控制 ═══

  /** 无视上下文长度 — 此插槽内容不参与 token budget trim */
  ignore_context_length?: boolean;

  // ═══ 动态匹配插件 ═══

  /** 自定义条件评估器插件接口 key（类似 data_cleaner.regex） */
  condition_evaluator?: string;

  /** 传递给条件评估器的选项 */
  condition_evaluator_options?: Record<string, unknown>;
}

export type SlotCondition =
  | { type: 'keyword_match'; keywords: string[]; match_mode?: 'any' | 'all' }
  | { type: 'logic_match'; expression: string }
  | { type: 'context_length'; operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq'; value: number }
  | { type: 'conversation_turn'; operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq'; value: number }
  | { type: 'custom'; evaluator_key: string; options?: Record<string, unknown> };
```

### 条件评估器插件接口

类似 DataCleaner 模式，定义一个全局注册的接口：

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

状态性规则（黏性、冷却时间、延迟触发）需要跨推理调用持久化状态：

```typescript
// ── apps/server/src/inference/slot_behavior_state.ts ──

export interface SlotBehaviorState {
  slot_id: string;
  /** 黏性剩余次数 */
  sticky_remaining?: number;
  /** 冷却开始 tick */
  cooldown_until_tick?: number;
  /** 延迟触发开始 tick */
  delay_until_tick?: number;
  /** 递归深度计数 */
  recursion_depth?: number;
}
```

**存储位置选项**：

| 方案 | 优势 | 劣势 |
|------|------|------|
| A) 内存 Map（`Map<string, SlotBehaviorState>`） | 最简单，读取快 | 进程重启丢失；多实例不共享 |
| B) Prisma 表 | 持久化，多实例共享 | 每次推断需要 DB 查询；增加迁移 |
| C) Conversation 元数据（存入 conversation entry） | 自然生命周期——对话结束状态清除 | 增加序列化复杂度 |
| D) 运行时状态层（`AppContext` 扩展） | 与现有架构对齐；可插拔存储后端 | 需要设计状态生命周期 |

**推荐**：方案 D，初期用内存 Map 实现，接口设计允许后续替换为持久化后端。

### 管线集成：行为控制执行器

在现有推理管线的 `fragment_assembly` 和 `permission_filter` 之间插入行为控制步骤：

```typescript
// ── apps/server/src/app/services/inference_workflow/executors/behavior_control.ts ──

export async function executeBehaviorControl(
  state: PromptWorkflowState
): Promise<PromptWorkflowState> {
  const behaviorProfiles = loadBehaviorProfiles(state.slot_registry);
  const behaviorStates = state.behavior_states ?? {};
  const tree = state.tree;

  if (!tree) return state;

  for (const profile of behaviorProfiles) {
    const shouldActivate = await evaluateSlotActivation(
      profile,
      behaviorStates[profile.slot_id],
      state
    );

    if (!shouldActivate) {
      // 禁用插槽内容但保留位置（与定位系统一致）
      disableSlotContent(tree, profile.slot_id);
      continue;
    }

    // 应用状态性规则
    if (profile.sticky) {
      applyStickyRule(behaviorStates, profile);
    }
    if (profile.cooldown) {
      applyCooldownRule(behaviorStates, profile);
    }

    // 应用深度限制
    if (profile.max_depth !== undefined || profile.no_recursion) {
      applyRecursionConstraints(tree, profile);
    }

    // 标记为无视上下文长度
    if (profile.ignore_context_length) {
      markIgnoreContextLength(tree, profile.slot_id);
    }
  }

  // 更新状态
  return {
    ...state,
    tree,
    behavior_states: behaviorStates,
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
  const text = extractRelevantText(context.variables);
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
  // 简单布尔表达式求值器
  // 支持：变量引用、比较运算符、布尔运算符
  // 安全：无副作用，无网络访问，超时保护
  return evaluateSimpleExpression(condition.expression, context.variables);
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
| **插槽定位系统** | 行为控制发生在定位之后；`disableSlotContent()` 与定位系统的"禁用保留位置"一致 | 无冲突——定位决定顺序，行为控制决定是否渲染内容 |
| **模板引擎** | `no_recursion` / `max_depth` 需要在渲染时传递给模板引擎 | 需要扩展 `RenderContext` 或 `SlotFunctionRenderScope` 传递约束 |
| **Token Budget Trim** | `ignore_context_length` 标记的片段在 trim 时优先级最高，不被裁剪 | 需要扩展 `token_budget_trim.ts` 识别此标记 |
| **插件系统** | 自定义条件评估器通过 `SlotConditionEvaluator` 接口注册 | 类似 DataCleaner 模式——全局注册表 + 插件贡献 |
| **对话历史** | `conversation_turn` 条件需要访问对话元数据 | 行为控制执行器需要从 `state` 中提取对话元数据 |

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

  world_context:
    always_active: true
    conditions:
      - type: keyword_match
        keywords: ["世界", "设定", "背景"]
        match_mode: any
    condition_combination: or

  role_core:
    always_active: true
    group_id: core_identity
    group_weight: 100

  post_process:
    always_active: true
    conditions:
      - type: context_length
        operator: gt
        value: 2000
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
| `inference/slot_condition_evaluators.ts` | 新建 | 内置条件评估器实现 |
| `inference/slot_behavior_state.ts` | 新建 | 行为状态类型定义（Phase 1 无状态逻辑，仅接口） |
| `app/services/inference_workflow/executors/behavior_control.ts` | 新建 | 行为控制执行器骨架 |
| `context/workflow/types.ts` | 修改 | `PromptWorkflowState` 增加 `behavior_profiles` 和 `behavior_states` |
| `context/workflow/orchestrator.ts` | 修改 | 在管线中加入 `behavior_control` 步骤 |
| `ai/registry.ts` | 修改 | 加载插槽行为配置 |

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

**目标**：开放 `SlotConditionEvaluator` 接口，允许插件注册自定义条件评估器。类似 DataCleaner 模式。

**变更范围**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/contracts/src/slot_condition_evaluator.ts` | 新建 | Zod schema + TypeScript 接口 |
| `plugins/extensions/slot_condition_registry.ts` | 新建 | 全局注册表 |
| `plugins/runtime.ts` | 修改 | `ServerPluginHostApi` 增加 `registerSlotConditionEvaluator` |
| `builtin/system_pack/plugins/` | 新增 | 内置条件评估器插件 |

### 功能 B：双重模块 — 决策推迟

功能 B 的决策需要基于功能 A 的实际实现复杂度：

- 如果功能 A 的声明式核心 + 行为控制执行器能平滑集成到 Prompt Tree V2 管线中（选项 B2），不需要引入双重模块
- 如果行为控制逻辑膨胀到需要独立的状态管理和渲染管线，则考虑 B3（模式切换）

**建议**：Phase 1-3 完成后评估——如果 `behavior_control.ts` 超过 300 行或需要独立的状态机，启动功能 B 的正式设计。

## 开放问题

### O1: logic_match 表达式的安全边界

`logic_match` 条件类型需要一个表达式求值器。选项：

| 方案 | 安全性 | 表达力 |
|------|--------|--------|
| A) 简易 DSL（仅支持 `variable op value` 比较） | 最高 | 最低 |
| B) JSONLogic（声明式逻辑组合） | 高 | 中等 |
| C) 嵌入 JS 沙箱（QuickJS） | 最低（需沙箱隔离） | 最高 |
| D) 模板引擎条件复用（复用 `#if` 语法） | 高 | 中等（依赖变量池） |

**推荐**：Phase 1 用方案 A（简易 DSL），Phase 5 考虑方案 B（JSONLogic）或方案 D（模板引擎复用）。方案 C 不在本设计范围内——如果需要图灵完备脚本执行，应作为独立沙箱运行时设计。

### O2: 行为状态的生命周期管理

黏性和冷却时间状态何时重置？

| 方案 | 行为 |
|------|------|
| A) 对话结束重置 | 每个新对话重新开始计数 |
| B) 推理会话结束重置 | 每次推理调用重新开始（无状态） |
| C) 可配置 | `SlotBehaviorProfile` 中声明 `state_scope: 'conversation' | 'inference' | 'persistent'` |

**推荐**：方案 C（可配置），默认 `conversation`。

### O3: `trigger_probability` 的随机种子

如果 `trigger_probability: 0.8`，每次推理时随机决定是否激活。问题：

- 是否需要确定性重现？如果需要，随机种子应从 `inference_id` 派生
- 不同插槽的概率触发是否应该相关？如果两个插槽都设 `trigger_probability: 0.5`，是独立随机还是同一随机源？

**推荐**：独立随机，种子从 `inference_id` + `slot_id` 派生（确定性可重现）。

### O4: `ignore_context_length` 与 `always_active` 的交集

如果一个插槽同时声明 `always_active: true` 和 `ignore_context_length: true`，它在 token budget trim 中永远不被裁剪。这是否可能导致 token 预算溢出？

**推荐**：保留此行为——这是世界包作者的意图。但在诊断信息中标记 `warning: 'slot_ignores_budget'`，便于运维排查。

### O5: 群组权重的精确语义

`group_weight` + `group_id` 的交互模式：

| 方案 | 语义 |
|------|------|
| A) 互斥选择 | 同一群组内按权重概率选择一个插槽激活 |
| B) 渲染优先级 | 同一群组内按权重决定渲染顺序 |
| C) Token 分配 | 同一群组内按权重分配 token 预算 |

**推荐**：方案 A（互斥选择）为默认，让 `group_mode` 字段控制——`'exclusive'`（A）、`'priority'`（B）、`'budget'`（C）。Phase 1 仅实现 A。

### O6: 功能 A 是否需要优先讨论向量化触发

向量化触发（`vectorized trigger`）需要向量嵌入和相似度计算能力，这是完全不同的基础设施（向量数据库、嵌入模型调用）。选项：

| 方案 | 复杂度 |
|------|--------|
| A) 推迟到独立设计 | 最低 |
| B) 作为 `SlotConditionEvaluator` 插件实现 | 中等（需要向量基础设施先就位） |
| C) 调用 AI gateway 获取嵌入 | 中等（延迟高） |

**推荐**：方案 A——向量化触发依赖的基础设施（向量存储、嵌入模型）尚未在项目中实现，应作为独立能力设计后再接入 `SlotConditionEvaluator` 接口。

## 与现有设计的关系

| 现有设计 | 交互 |
|---------|------|
| 模板引擎统一 | 行为控制不影响模板引擎核心——仅扩展 `SlotFunctionRenderScope` 和 `slot-ref` 块处理器 |
| 插槽定位系统 | 行为控制发生在定位之后——定位决定顺序，行为控制决定是否渲染 |
| 插件拓展系统 | `SlotConditionEvaluator` 接口遵循 DataCleaner 模式——全局注册表 + 插件贡献 |
| DataCleaner | 类似的插件接口模式，但不共享注册表（不同 capability key 前缀：`slot_condition.*` vs `data_cleaner.*`） |
| 推理工作流 | 行为控制作为新 executor 插入管线，不修改现有步骤的签名 |