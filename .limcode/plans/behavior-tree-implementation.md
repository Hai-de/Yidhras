# 行为树 InferenceProvider 实现计划

> 基于: `.limcode/design/behavior-tree-design.md`
> 原则: 接口定义先行，测试先行。每个阶段先写测试（定义契约），再写实现（满足契约）。

---

## 阶段一：类型与接口定义（零实现，纯契约）

此阶段不包含任何实现逻辑。仅定义类型、接口、Zod schema。所有后续阶段依赖此阶段的输出。

### 1.1 新建：行为树内部类型定义

**文件**: `apps/server/src/inference/providers/behavior_tree/types.ts`

定义内容：

```typescript
// 节点求值返回状态
type BTStatus = 'success' | 'failure' | 'running';

// 组合节点类型
type BTCompositeType = 'selector' | 'sequence';

// 装饰器类型
type BTDecoratorType = 'inverter' | 'cooldown' | 'probability';

// 叶子节点类型
type BTLeafType = 'condition' | 'action' | 'llm_decision';

// 条件运算符
type BTConditionOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in';

// 条件键（上下文解析的入口）
type BTConditionKey =
  | 'state'
  | 'has_artifact'
  | 'not_has_artifact'
  | 'event_semantic_type'
  | 'world_state'
  | 'ticks_since_event';

// 单个条件表达式
interface BTConditionExpr {
  // 条件键 + 运算符 + 值。结构由 Zod schema 精确约束
  [key: string]: unknown;
}

// 复合条件
interface BTCompoundCondition {
  all?: BTConditionExpr[];
  any?: BTConditionExpr[];
}

// 装饰器定义（列表元素）
interface BTDecoratorDef {
  type: BTDecoratorType;
  cooldown_ticks?: number;   // cooldown 专用
  weight?: number;            // probability 专用
}

// 动作定义
interface BTActionDef {
  semantic_intent?: string;
  kernel?: string;
  proposed_method?: string;
  target_ref?: { entity_id: string; kind: string };
  reasoning?: string;
  desired_effect?: string;
  payload?: Record<string, unknown>;
}

// LLM 决策叶子定义
interface BTLLMDecisionDef {
  prompt_template: string;
  provider: string;
  model: string;
}

// 树节点定义（递归）
interface BTNodeDef {
  type?: BTCompositeType | BTLeafType;  // 组合节点或叶子类型；decorated 节点无顶层 type
  // 组合节点字段
  children?: BTNodeDef[];
  // 装饰器字段
  decorators?: BTDecoratorDef[];
  child?: BTNodeDef;
  // 条件字段
  condition?: BTCompoundCondition | BTConditionExpr;
  // 动作字段
  action?: BTActionDef;
  // LLM 叶子字段
  prompt_template?: string;
  provider?: string;
  model?: string;
  // $ref 引用
  $ref?: string;
}

// 求值上下文
interface BTEvalContext {
  inferenceContext: InferenceContext;
  blackboard: Record<string, unknown>;
}

// 决策追踪 — 单节点遍历记录
interface BTNodeTrace {
  nodePath: string;
  nodeType: string;
  status: BTStatus | 'skipped';
  durationMs: number;
  discardedDecision?: ProviderDecisionRaw | null;  // Sequence 中间 action 的废弃结果
}

// 决策追踪 — 完整遍历记录
interface BTDecisionTrace {
  agentId: string;
  treeName: string;
  simTick: bigint;
  nodeTraces: BTNodeTrace[];
  finalDecision: ProviderDecisionRaw | null;
}

// Cooldown 状态
interface BTCooldownState {
  lastSuccessTick: bigint;
}

// TreeRegistry 加载的树定义
interface BTTreeDefinition {
  name: string;
  root: BTNodeDef;
  sourcePackId: string;
}
```

### 1.2 新建：行为树 YAML Zod Schema

**文件**: `apps/server/src/inference/providers/behavior_tree/schema.ts`

定义内容（使用 Zod）：

- `btConditionExprSchema` — 条件表达式校验（运算符白名单、类型检查）
- `btCompoundConditionSchema` — `all`/`any` 嵌套结构
- `btDecoratorDefSchema` — 单个装饰器（discriminated union on `type`）
- `btActionDefSchema` — 动作叶子
- `btLLMDecisionDefSchema` — LLM 叶子
- `btNodeDefSchema` — 树节点（递归，lazy 引用）
- `btTreeDefSchema` — 完整树定义（`type` + `children` 等）
- `btTreeMapSchema` — `pack.yaml` 中 `behavior_trees` 键的顶层 schema（`z.record(z.string(), btNodeDefSchema)`）
- `actorInferenceSchema` — actor 级 inference 配置（discriminated union on `provider`）

关键校验逻辑（在 schema 中或配套的 refine/superRefine 中）：

1. Selector/Sequence 的 `children` 非空数组
2. 叶子节点（condition/action/llm_decision）不允许有 `children`
3. `decorators` 列表中同一 `type` 不重复（警告级，不阻止加载）
4. `$ref` 值的格式校验（首版仅允许 `name/path` 格式，禁止 `::` 跨包前缀）

### 1.3 修改：`InferenceStrategy` 联合类型

**文件**: `apps/server/src/inference/types.ts`

修改行 13：

```typescript
// 改前
export type InferenceStrategy = 'mock' | 'rule_based' | 'model_routed';
// 改后
export type InferenceStrategy = 'mock' | 'rule_based' | 'model_routed' | 'behavior_tree';
```

### 1.4 修改：`InferenceProvider` 接口

**文件**: `apps/server/src/inference/provider.ts`

新增 `requiresPrompt` 字段：

```typescript
export interface InferenceProvider {
  readonly name: string;
  readonly strategies: InferenceStrategy[];
  readonly requiresPrompt: boolean;  // 新增
  run(context: InferenceContext, prompt: PromptBundleV2): Promise<ProviderDecisionRaw>;
}
```

同步修改三个现有 provider 实现（mock.ts、rule_based.ts、LLM providers），添加 `requiresPrompt` 字段。LLM providers 设为 `true`，mock 和 rule_based 设为 `false`。

### 1.5 修改：`InferencePackStateSnapshot` 新增 `recent_events`

**文件**: `apps/server/src/inference/types.ts`

在 `InferencePackStateSnapshot` 接口中新增字段：

```typescript
export interface InferencePackStateSnapshot {
  // ... 现有字段保持不变 ...
  recent_events: InferencePackLatestEventSnapshot[];  // 新增：最近 N tick 的事件列表，按 tick 倒序
}
```

### 1.6 修改：`entityDefinitionSchema` 新增 `inference` 字段

**文件**: `apps/server/src/packs/schema/constitution_schema.ts`

在 `entityDefinitionSchema`（行 277-289）中新增可选 `inference` 字段，使用 discriminated union：

```typescript
const actorInferenceSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('behavior_tree'),
    behavior_tree: z.string()
  }),
  z.object({
    provider: z.literal('openai_compatible'),
    model: z.string()
  }),
  z.object({
    provider: z.literal('anthropic'),
    model: z.string()
  })
]);

// 在 entityDefinitionSchema 中新增
inference: actorInferenceSchema.optional()
```

注意：`entityDefinitionSchema` 当前使用 `.strict()`，新增字段后需确认 strict 模式下可选字段的行为——可选字段在 strict 下应该是允许的（strict 只拒绝未定义的字段，不拒绝可选字段）。

### 阶段一验证

- [ ] `pnpm typecheck` 通过（新类型定义无编译错误）
- [ ] 现有测试全部通过（接口变更后 mock/rule_based/LLM provider 编译通过）
- [ ] `pnpm lint` 通过

---

## 阶段二：上下文解析器（测试 → 实现）

### 2.1 测试先行

**文件**: `apps/server/tests/unit/behavior_tree_context_resolver.spec.ts`

测试用例（按 §3.3.1 解析表逐行覆盖）：

| # | 测试场景 | 预期 |
|---|---------|------|
| 1 | `state: key, eq: value` — 值匹配 | Success |
| 2 | `state: key, eq: value` — 值不匹配 | Failure |
| 3 | `state: key, eq: value` — key 不存在 | Failure（缺失 = 不满足） |
| 4 | `state: key, gte: 0.5` — 数值大于等于阈值 | Success |
| 5 | `state: key, lt: 0.5` — 数值小于阈值 | Success |
| 6 | `state: key, gte: 0.5` — 字符串值做数值比较 | Failure（类型不匹配，不抛异常） |
| 7 | `has_artifact: id` — 持有 | Success |
| 8 | `has_artifact: id` — 未持有 | Failure |
| 9 | `not_has_artifact: id` — 未持有 | Success |
| 10 | `not_has_artifact: id` — 持有 | Failure |
| 11 | `event_semantic_type: type` — recent_events 中存在匹配 | Success |
| 12 | `event_semantic_type: type` — recent_events 中无匹配 | Failure |
| 13 | `world_state: key, eq: value` — 包级共享状态匹配 | Success |
| 14 | `world_state: key, eq: value` — key 不存在 | Failure |
| 15 | `ticks_since_event: type, lt: 5` — 最近一次在 5 tick 内 | Success |
| 16 | `ticks_since_event: type, lt: 5` — 最近一次超过 5 tick | Failure |
| 17 | `ticks_since_event: type, lt: 5` — 从未发生过 | Failure（+∞，任何比较不满足） |
| 18 | `in: collection` — 值在集合中 | Success |
| 19 | `not_in: collection` — 值不在集合中 | Success |
| 20 | `all: [cond1, cond2]` — 两个都满足 | Success |
| 21 | `all: [cond1, cond2]` — 一个不满足 | Failure |
| 22 | `any: [cond1, cond2]` — 一个满足 | Success |
| 23 | `any: [cond1, cond2]` — 都不满足 | Failure |
| 24 | 嵌套 `all` + `any` | 按布尔逻辑正确求值 |
| 25 | `eq: false` 对 `event_semantic_type` 的否定行为 | 近期窗口不存在该类型 → Success |

测试辅助：构建最小 `InferenceContext` mock（仅填充 `pack_state` 的必要字段）。

### 2.2 实现

**文件**: `apps/server/src/inference/providers/behavior_tree/context_resolver.ts`

纯函数，无副作用：

```typescript
function evaluateCondition(
  condition: BTConditionExpr | BTCompoundCondition,
  ctx: BTEvalContext
): boolean;

function resolveContextValue(
  key: BTConditionKey,
  ctx: BTEvalContext
): unknown;
```

`resolveContextValue` 按 §3.3.1 解析表实现 switch-case 映射。`evaluateCondition` 递归处理 `all`/`any` 嵌套，叶子条件按运算符分发。

缺失字段统一返回 `undefined`（不是抛异常），上层 `evaluateCondition` 将 `undefined` 视为条件不满足。

### 阶段二验证

- [ ] 25 个测试用例全部通过
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过

---

## 阶段三：节点求值器（测试 → 实现）

### 3.1 测试先行：组合节点

**文件**: `apps/server/tests/unit/behavior_tree_composites.spec.ts`

| # | 测试场景 | 预期 |
|---|---------|------|
| 1 | Selector — 第一个子节点 Success | 返回 Success，第二个子节点不执行 |
| 2 | Selector — 第一个 Failure，第二个 Success | 执行两个，返回 Success |
| 3 | Selector — 全部 Failure | 返回 Failure |
| 4 | Selector — 空 children | 返回 Failure |
| 5 | Sequence — 全部 Success | 依次执行全部，返回 Success |
| 6 | Sequence — 第二个 Failure | 执行第一、二个，返回 Failure，第三个不执行 |
| 7 | Sequence — 空 children | 返回 Failure |
| 8 | Sequence — 中间 action 写入 `__last_decision`，最终只有最后一个保留 | blackboard 中 `__last_decision` 为最后一个 action 的值 |

### 3.2 测试先行：装饰节点

**文件**: `apps/server/tests/unit/behavior_tree_decorators.spec.ts`

| # | 测试场景 | 预期 |
|---|---------|------|
| 1 | Inverter — 子节点 Success | 返回 Failure |
| 2 | Inverter — 子节点 Failure | 返回 Success |
| 3 | Cooldown — 冷却期内（当前 tick - last_success < cooldown_ticks） | 跳过子节点，返回 Failure |
| 4 | Cooldown — 冷却期外，子节点 Success | 执行子节点，更新 last_success_tick，返回 Success |
| 5 | Cooldown — 冷却期外，子节点 Failure | 执行子节点，不更新 last_success_tick，返回 Failure |
| 6 | Probability — `weight: 0` | 始终返回 Failure（验证确定性 PRNG 固定种子） |
| 7 | Probability — `weight: 1` | 始终执行子节点，子节点结果原样返回 |
| 8 | Probability — 同一 agent+tree+tick 多次求值 | 结果相同（确定性 PRNG） |
| 9 | 多装饰器堆栈 `[cooldown, probability]` — 冷却期内 | 直接返回 Failure，Probability 不执行 |
| 10 | 多装饰器堆栈 `[cooldown, probability]` — 冷却期外 | 先过 Cooldown，再过 Probability，再执行子节点 |
| 11 | 多装饰器堆栈 `[inverter, cooldown]` — 冷却期内 | Cooldown 返回 Failure → Inverter 反转为 Success |
| 12 | 空 decorators 列表 | 直接执行子节点，无异于无装饰器 |

### 3.3 测试先行：叶子节点

**文件**: `apps/server/tests/unit/behavior_tree_leaves.spec.ts`

| # | 测试场景 | 预期 |
|---|---------|------|
| 1 | Action — semantic_intent 类型 | blackboard 中 `__last_decision` 包含正确的 semantic_intent |
| 2 | Action — kernel 类型（trigger_event） | blackboard 中 `__last_decision` 包含正确的 kernel 动作 |
| 3 | Action — 含 target_ref、reasoning 等完整字段 | DecisionResult 结构完整 |
| 4 | LLM Decision — 调用成功 | blackboard 中 `__last_decision` 为 LLM 返回的 DecisionResult |
| 5 | LLM Decision — 调用失败（超时/限流） | 返回 Failure，不抛异常 |
| 6 | Condition 叶子（通过 context_resolver） | condition 满足 → Success，不满足 → Failure |

LLM Decision 测试使用 mock AI provider，不发起真实 HTTP 请求。

### 3.4 实现

**文件**: `apps/server/src/inference/providers/behavior_tree/nodes/composites.ts`

```typescript
async function tickSelector(children: BTNodeDef[], ctx: BTEvalContext): Promise<BTStatus>;
async function tickSequence(children: BTNodeDef[], ctx: BTEvalContext): Promise<BTStatus>;
```

Sequence 实现要点：维护 `__last_decision` 的覆盖逻辑；校验阶段保证最多一个 action/llm_decision 叶子，但求值器本身不依赖此校验（防御性：即使有多个 action，也只保留最后一个）。

**文件**: `apps/server/src/inference/providers/behavior_tree/nodes/decorators.ts`

```typescript
async function tickDecorated(
  decorators: BTDecoratorDef[],
  child: BTNodeDef,
  ctx: BTEvalContext
): Promise<BTStatus>;
```

按列表顺序从左到右求值（索引 0 = 最外层）。每个装饰器实现为独立的内部函数：`applyInverter`、`applyCooldown`、`applyProbability`。Cooldown 状态存储通过依赖注入（`cooldownStore: Map<string, BTCooldownState>`），不在模块内创建全局状态。

**文件**: `apps/server/src/inference/providers/behavior_tree/nodes/leaves.ts`

```typescript
function tickCondition(condition: BTConditionExpr | BTCompoundCondition, ctx: BTEvalContext): BTStatus;
async function tickAction(action: BTActionDef, ctx: BTEvalContext): Promise<BTStatus>;
async function tickLLMDecision(llm: BTLLMDecisionDef, ctx: BTEvalContext): Promise<BTStatus>;
```

`tickLLMDecision` 内部调用 AI Gateway —— 需要从 `ctx.inferenceContext` 中获取 gateway 引用（通过 `AppContext` 端口或依赖注入）。

### 阶段三验证

- [ ] 组合节点 8 个测试用例全部通过
- [ ] 装饰节点 12 个测试用例全部通过
- [ ] 叶子节点 6 个测试用例全部通过
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过

---

## 阶段四：TreeRegistry（测试 → 实现）

### 4.1 测试先行

**文件**: `apps/server/tests/unit/behavior_tree_registry.spec.ts`

| # | 测试场景 | 预期 |
|---|---------|------|
| 1 | 加载单个无 `$ref` 的树定义 | 返回展开后的 `BTTreeDefinition`，root 不变 |
| 2 | 加载含 `$ref` 的树定义（同包内引用） | `$ref` 被展开为被引用树的 root 节点 |
| 3 | 多层 `$ref` 引用（A → B → C） | 完全展开，深度正确累加 |
| 4 | `$ref` 目标不存在 | 抛出明确错误，信息包含引用链 |
| 5 | `$ref` 环路（A → B → A） | DFS 检测，抛出错误，信息包含完整环 |
| 6 | `$ref` 自引用（A → A） | 自边检测，抛出错误 |
| 7 | 展开后深度 = 16 | 正常加载 |
| 8 | 展开后深度 = 17 | 抛出深度超限错误 |
| 9 | 空树映射（`behavior_trees: {}`） | 正常，registry 为空 |
| 10 | 同一树名注册两次 | 后注册者覆盖，发出警告 |
| 11 | Sequence 子节点中 action/llm_decision 叶子 > 1 | 抛出校验错误 |
| 12 | Parallel 节点 | 抛出校验错误 |
| 13 | 树定义不符合 Zod schema | 抛出校验错误，信息包含具体字段 |

### 4.2 实现

**文件**: `apps/server/src/inference/providers/behavior_tree/tree_registry.ts`

```typescript
class TreeRegistry {
  constructor(private readonly packId: string);

  // 注册原始 YAML 树定义（在包加载阶段调用）
  register(rawTrees: Record<string, unknown>): void;

  // 获取展开后的树定义（在求值时调用）
  get(treeName: string): BTTreeDefinition;

  // 列出所有已注册的树名
  list(): string[];
}
```

内部职责：

1. Zod schema 校验（调用 `schema.ts`）
2. `$ref` 展开（递归，深度累加）
3. DFS 环路检测（维护访问栈 + 完成标记）
4. 自引用检测（展开前检查 `$ref` 目标是否等于当前树名）
5. 深度限制检查（展开后 AST 深度 ≤ 16）
6. Sequence action 数量校验
7. Parallel 节点拒绝

展开算法：

```
expand(node, registry, depth, visiting):
  if depth > 16 → 抛出深度超限
  if node.$ref:
    if node.$ref == 当前树名 → 抛出自引用
    if node.$ref in visiting → 抛出环路
    visiting.add(当前树名)
    result = expand(registry.get(node.$ref), registry, depth + 1, visiting)
    visiting.remove(当前树名)
    return result
  if node.children:
    node.children = node.children.map(c => expand(c, registry, depth + 1, visiting))
  if node.child:
    node.child = expand(node.child, registry, depth + 1, visiting)
  return node
```

注意：`$ref` 展开后，需保留节点的"展开后路径"信息（用于 Cooldown 状态的 key 生成）。

### 阶段四验证

- [ ] 13 个测试用例全部通过
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过

---

## 阶段五：求值器主循环（测试 → 实现）

### 5.1 测试先行

**文件**: `apps/server/tests/unit/behavior_tree_evaluator.spec.ts`

以设计文档 §4.1 的 `notebook_holder` 树为 fixture，测试完整遍历：

| # | 测试场景 | 预期 |
|---|---------|------|
| 1 | `notebook_holder` — 第一优先级条件满足（未持有笔记） | 返回 `claim_notebook` 的 DecisionResult，遍历路径正确 |
| 2 | `notebook_holder` — 前两优先级 Failure，命中第三条 | 返回 `form_judgement_intent`，跳过的节点标记为 `skipped` 或 `failure` |
| 3 | `notebook_holder` — 所有条件 Failure | 返回空 DecisionResult（`decision: null`），根节点返回 Failure |
| 4 | 含 `llm_decision` 叶子的混合树 — LLM 成功 | LLM 叶子 Success，返回 LLM 产出的 DecisionResult |
| 5 | 含 `llm_decision` 叶子的混合树 — LLM 失败 | LLM 叶子 Failure，由父 Selector 尝试下一个分支 |
| 6 | 整棵树只有 condition 叶子（无 action） | 所有条件 Failure → 根节点 Failure → 空 DecisionResult |
| 7 | 整棵树只有一个 action 叶子（无条件） | 直接返回该 action 的 DecisionResult |
| 8 | 含 Cooldown 装饰器的树 — 冷却期内 | 冷却的分支 Failure，Selector 尝试下一个分支 |
| 9 | 求值器内部意外异常 | 捕获，不抛到上层，返回空 DecisionResult |
| 10 | 决策追踪 — 验证 trace 包含完整的节点遍历路径和最终决策 | trace.nodes 按深度优先顺序记录，finalDecision 正确 |

### 5.2 实现

**文件**: `apps/server/src/inference/providers/behavior_tree/evaluator.ts`

```typescript
async function evaluateTree(
  tree: BTTreeDefinition,
  ctx: BTEvalContext,
  cooldownStore: Map<string, BTCooldownState>
): Promise<{ decision: ProviderDecisionRaw | null; trace: BTDecisionTrace }>;
```

内部调用 `tick()` 递归函数（如设计文档 §5.2 伪代码），遍历过程中收集 `BTNodeTrace` 记录。

顶层 try/catch 包裹整个求值过程——任何意外异常捕获后记录 ERROR 日志，返回 `{ decision: null, trace: ... }`。

### 阶段五验证

- [ ] 10 个测试用例全部通过
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过

---

## 阶段六：InferenceProvider 接入（测试 → 实现）

### 6.1 测试先行

**文件**: `apps/server/tests/unit/behavior_tree_provider.spec.ts`

| # | 测试场景 | 预期 |
|---|---------|------|
| 1 | Provider.name 为 `'behavior_tree'` | 字符串匹配 |
| 2 | Provider.strategies 包含 `'behavior_tree'` | `strategies.includes('behavior_tree')` |
| 3 | Provider.requiresPrompt 为 `false` | 布尔值 |
| 4 | `provider.run(context)` — context 中 actor 有绑定的行为树 | 调用 evaluator，返回 DecisionResult |
| 5 | `provider.run(context)` — context 中 actor 未绑定行为树 | 抛出配置错误 |

### 6.2 实现

**文件**: `apps/server/src/inference/providers/behavior_tree/provider.ts`

```typescript
export const createBehaviorTreeProvider = (deps: BehaviorTreeProviderDeps): InferenceProvider => ({
  name: 'behavior_tree',
  strategies: ['behavior_tree'],
  requiresPrompt: false,
  run: async (context, _prompt) => {
    // 1. 从 context 中解析 actor 对应的行为树名
    // 2. 从 TreeRegistry 获取展开后的树定义
    // 3. 调用 evaluator.evaluateTree()
    // 4. 返回 ProviderDecisionRaw
  }
});
```

`BehaviorTreeProviderDeps` 包含：
- `treeRegistry: TreeRegistry`
- `aiGateway: AIGateway`（供 llm_decision 叶子使用）
- `logger: Logger`

### 6.3 修改：推理工作流路由

**文件**: `apps/server/src/inference/service.ts`

1. 行 271-275：检查 `provider.requiresPrompt`。若 `false`，跳过 `buildWorkflowPromptBundle()`，传入空占位 `prompt`
2. provider 注册表新增 `behavior_tree` provider 实例

### 阶段六验证

- [ ] 5 个测试用例全部通过
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过

---

## 阶段七：Context Builder 改造（测试 → 实现）

### 7.1 测试先行

**文件**: `apps/server/tests/unit/behavior_tree_context_builder.spec.ts`

| # | 测试场景 | 预期 |
|---|---------|------|
| 1 | `pack_state.recent_events` 包含最近 N tick 的事件（有事件数据） | 列表非空，按 tick 倒序 |
| 2 | `pack_state.recent_events` — 无事件数据 | 空列表 `[]` |
| 3 | Actor 声明 `inference.provider: behavior_tree` | `context.strategy` 为 `'behavior_tree'` |
| 4 | Actor 声明 `inference.provider: openai_compatible` | `context.strategy` 为 `'model_routed'` |
| 5 | Actor 未声明 `inference` | `context.strategy` 沿用包级默认值 |

### 7.2 实现

**文件**: `apps/server/src/inference/context_builder.ts`

1. 在构建 `pack_state` 时注入 `recent_events`：查询 pack event 表，`SELECT ... WHERE pack_id = ? ORDER BY tick DESC LIMIT 20`
2. 在构建 `InferenceContext` 时，读取 actor 对应的 `entityDefinition.inference`（通过 `pack.entities.actors` 匹配 `agent_id`），若存在则覆盖 `strategy` 和 `world_ai`

`recent_events` 查询建议封装为独立函数以便测试 mock：

```typescript
async function fetchRecentEvents(
  packId: string,
  maxTicks: number,
  db: PrismaClient
): Promise<InferencePackLatestEventSnapshot[]>;
```

### 阶段七验证

- [ ] 5 个测试用例全部通过
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过

---

## 阶段八：Pack 校验集成（测试 → 实现）

### 8.1 测试先行

**文件**: `apps/server/tests/unit/behavior_tree_pack_validation.spec.ts`

| # | 测试场景 | 预期 |
|---|---------|------|
| 1 | 合法行为树定义 | 校验通过，无错误 |
| 2 | `$ref` 目标不存在 | 校验失败，错误信息含引用链 |
| 3 | `$ref` 环路 | 校验失败 |
| 4 | `$ref` 自引用 | 校验失败 |
| 5 | 展开后深度超 16 | 校验失败 |
| 6 | Parallel 节点 | 校验失败 |
| 7 | Sequence 中 > 1 个 action/llm_decision 叶子 | 校验失败 |
| 8 | `behavior_trees` 键存在但值为空 | 校验通过（空树映射合法） |
| 9 | 树引用了不存在的条件键 | 警告（不阻止加载） |

### 8.2 实现

**文件**: `apps/server/src/cli/validate_pack_cli.ts`（修改）

在 `validatePack()` 函数中新增行为树校验步骤。调用 `TreeRegistry` 的注册 + 校验流程（但不在 CLI 中创建持久 registry——仅做校验，校验完即丢弃）。

校验步骤（按设计文档 §5.6 顺序）：

1. Zod schema 合规性
2. 所有 `$ref` 目标存在
3. 无 `$ref` 环路
4. 无 `$ref` 自引用
5. 展开后 AST 深度 ≤ 16
6. 无 Parallel 节点
7. Sequence 直接子节点中 action/llm_decision 叶子不超过 1 个
8. `decorators` 列表中无重复 `type`（警告）
9. 所有条件键为已知键名

### 阶段八验证

- [ ] 9 个测试用例全部通过
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm validate:pack --all` 对现有 pack 不报错（现有 pack 无 `behavior_trees` 键，应跳过校验）

---

## 阶段九：集成测试

### 9.1 测试

**文件**: `apps/server/tests/integration/behavior_tree_provider_integration.spec.ts`

| # | 测试场景 | 预期 |
|---|---------|------|
| 1 | 端到端：pack 加载 → 行为树 provider 注册 → 推理决策 → 返回 DecisionResult | 全链路通过 |
| 2 | 端到端：行为树产出 `semantic_intent` → 进入意图落地管线 | ActionIntent 正确生成 |
| 3 | 端到端：Cooldown 跨 tick 行为 | tick N 执行动作后，tick N+5 冷却期内跳过，tick N+11 冷却期外再次执行 |
| 4 | 端到端：包级默认 LLM actor 与行为树 actor 混合运行 | 各 actor 使用各自配置的 provider |
| 5 | 端到端：行为树求值异常 → 不中断模拟循环 | 该 tick 该 agent 返回空决策，其他 agent 正常运行 |

### 阶段九验证

- [ ] 5 个集成测试用例全部通过
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm test:integration` 全部通过

---

## 阶段十：rule_based.ts 废弃路径

### 10.1 Death Note pack 行为树迁移

在 `data/world_packs/death_note/config/pack.yaml`（或对应配置路径）中新增 `behavior_trees` 定义，将 `rule_based.ts` 中三角色的决策逻辑翻译为行为树 YAML。

### 10.2 rule_based.ts 标记废弃

**文件**: `apps/server/src/inference/providers/rule_based.ts`

在文件顶部和 provider 注册处添加 `@deprecated` 标记。不做任何逻辑修改。

### 阶段十验证

- [ ] Death Note pack 使用行为树 provider 后，行为与 `rule_based` 一致（手动对比 decision trace）
- [ ] 现有 Death Note 相关测试通过

---

## 阶段十一：文档同步与收尾

### 11.1 更新 `docs/subsystems/AI_GATEWAY.md`

当前文档行 121-127 列出了 `mock`、`rule_based`、`model_routed`、`gateway_backed` 四种 provider/策略。需新增：

- `behavior_tree` 作为第四个 `InferenceStrategy` 字面量（与 `mock`、`rule_based`、`model_routed` 并列）
- 简述：行为树是包作者可在 `pack.yaml` 中定义的确定性决策树，通过 YAML 配置 Selector/Sequence/装饰器/条件/动作节点来表达 NPC 行为模式。纯行为树不需要 LLM 调用（除非使用 `llm_decision` 叶子）
- 不改变文档对 `model_routed` 和 provider adapter 的现有描述

### 11.2 更新 `docs/ARCH.md`

- 行 597 的 `inference/` 目录描述中新增 `providers/behavior_tree/` 子目录
- 架构要点部分新增一行：行为树作为确定性推理路径与 LLM 推理路径并列存在，包内可混合使用

### 11.3 更新 `.limcode/design/behavior-tree-design.md`

在文档顶部添加实现计划链接：

```markdown
> 实现计划: `.limcode/plans/behavior-tree-implementation.md`
```

### 11.4 将暂缓项移入 `.limcode/enhancements-backlog.md`

从设计文档 §六（暂不纳入首版）和 §九（盲点推论）中提取以下条目，写入 backlog：

| 条目 | 来源 | backlog 位置 |
|------|------|-------------|
| Parallel 节点完整实现 | §六 | 新建 `## 行为树 Parallel 节点` |
| 跨包子树引用 | §六 | 新建 `## 行为树跨包子树引用` |
| Cooldown 状态持久化 | §六 | 新建 `## 行为树 Cooldown 持久化` |
| 子树宏/参数化 | §六 | 新建 `## 行为树子树宏/参数化` |
| Running 状态跨 tick 持久化 | §六 | 新建 `## 行为树 Running 状态持久化` |
| 行为树可视化编辑器 | §六 | 新建 `## 行为树可视化编辑器` |
| 运行时动态修改树结构 | §六 | 新建 `## 行为树运行时动态修改` |
| Sequence 多 action 链式执行（策略 B） | §六 | 追加到已有 `## 链式行为（复合行为）` |
| `noop` 显式跳过动作 | §9.6 | 新建 `## 行为树 noop 显式跳过` |
| 树级 `default_action` 兜底 | §9.6 | 与 noop 合并为同一 backlog 条目 |

### 11.5 验证

- [ ] `docs/subsystems/AI_GATEWAY.md` 中 `behavior_tree` 描述准确、无时间锚定
- [ ] `docs/ARCH.md` inference 目录描述更新
- [ ] `.limcode/enhancements-backlog.md` 所有条目格式一致、暂缓原因明确
- [ ] `.limcode/design/behavior-tree-design.md` 顶部有实现计划链接
- [ ] 文档无 §、无"当前/现在/已完成"等时间锚定词

---

## 完整文件清单

### 新建文件

| 文件 | 阶段 |
|------|------|
| `apps/server/src/inference/providers/behavior_tree/types.ts` | 一 |
| `apps/server/src/inference/providers/behavior_tree/schema.ts` | 一 |
| `apps/server/src/inference/providers/behavior_tree/context_resolver.ts` | 二 |
| `apps/server/src/inference/providers/behavior_tree/nodes/composites.ts` | 三 |
| `apps/server/src/inference/providers/behavior_tree/nodes/decorators.ts` | 三 |
| `apps/server/src/inference/providers/behavior_tree/nodes/leaves.ts` | 三 |
| `apps/server/src/inference/providers/behavior_tree/tree_registry.ts` | 四 |
| `apps/server/src/inference/providers/behavior_tree/evaluator.ts` | 五 |
| `apps/server/src/inference/providers/behavior_tree/provider.ts` | 六 |
| `apps/server/tests/unit/behavior_tree_context_resolver.spec.ts` | 二 |
| `apps/server/tests/unit/behavior_tree_composites.spec.ts` | 三 |
| `apps/server/tests/unit/behavior_tree_decorators.spec.ts` | 三 |
| `apps/server/tests/unit/behavior_tree_leaves.spec.ts` | 三 |
| `apps/server/tests/unit/behavior_tree_registry.spec.ts` | 四 |
| `apps/server/tests/unit/behavior_tree_evaluator.spec.ts` | 五 |
| `apps/server/tests/unit/behavior_tree_provider.spec.ts` | 六 |
| `apps/server/tests/unit/behavior_tree_context_builder.spec.ts` | 七 |
| `apps/server/tests/unit/behavior_tree_pack_validation.spec.ts` | 八 |
| `apps/server/tests/integration/behavior_tree_provider_integration.spec.ts` | 九 |

### 修改文件

| 文件 | 阶段 | 变更内容 |
|------|------|---------|
| `apps/server/src/inference/types.ts` | 一 | `InferenceStrategy` 新增 `'behavior_tree'`；`InferencePackStateSnapshot` 新增 `recent_events` |
| `apps/server/src/inference/provider.ts` | 一 | `InferenceProvider` 新增 `requiresPrompt` |
| `apps/server/src/inference/providers/mock.ts` | 一 | 添加 `requiresPrompt: false` |
| `apps/server/src/inference/providers/rule_based.ts` | 一/十 | 添加 `requiresPrompt: false` + `@deprecated` 标记 |
| LLM provider 实现文件 | 一 | 添加 `requiresPrompt: true` |
| `apps/server/src/packs/schema/constitution_schema.ts` | 一 | `entityDefinitionSchema` 新增 `inference` 字段 |
| `apps/server/src/inference/context_builder.ts` | 七 | 注入 `recent_events`；读取 actor 级 inference 配置 |
| `apps/server/src/inference/service.ts` | 六 | 检查 `requiresPrompt`；注册 behavior_tree provider |
| `apps/server/src/cli/validate_pack_cli.ts` | 八 | 新增行为树校验步骤 |
| `docs/subsystems/AI_GATEWAY.md` | 十一 | 新增 `behavior_tree` 策略描述 |
| `docs/ARCH.md` | 十一 | 更新 `inference/` 目录描述和架构要点 |
| `.limcode/design/behavior-tree-design.md` | 十一 | 顶部添加实现计划链接 |
| `.limcode/enhancements-backlog.md` | 十一 | 新增 8 条暂缓项 |

---

## 依赖关系图

```
阶段一 (类型/接口)
  └─→ 阶段二 (context_resolver)
       └─→ 阶段三 (节点求值器)
            └─→ 阶段五 (evaluator 主循环)
                 └─→ 阶段六 (provider)
                      └─→ 阶段九 (集成测试)
                           └─→ 阶段十 (rule_based 废弃)
                                └─→ 阶段十一 (文档同步与收尾)

  阶段一 ─→ 阶段四 (tree_registry) ─→ 阶段五
  阶段一 ─→ 阶段七 (context_builder) ─→ 阶段九
  阶段一 ─→ 阶段八 (pack 校验) ─→ 阶段九
```

阶段二、三、四、七、八可部分并行（它们依赖阶段一的类型定义，但彼此独立）。阶段十一在所有功能阶段完成后执行。

---

## 不在此次范围内

- Running 状态跨 tick 持久化
- Parallel 节点的完整实现
- 跨包子树引用 (`$ref: "other_pack::tree"`)
- 行为树可视化编辑器
- 运行时动态修改树结构
- 子树宏/参数化
- Cooldown 状态持久化
- Sequence 多 action 链式执行（策略 B）
- `noop` 显式跳过动作
- 树级 `default_action` 兜底
- Prometheus 指标 / 健康暴露
- 行为树特定的 AI Gateway observability 集成（首版复用现有 decision trace 机制）
