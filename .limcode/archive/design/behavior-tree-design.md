# 行为树 InferenceProvider 设计草案

> 评估时间: 2026-05-21
> 实现计划: `.limcode/plans/behavior-tree-implementation.md`
> 触发: `apps/server/src/inference/providers/rule_based.ts` 中 479 行手写决策树需要泛化为包作者可定义的 YAML 配置
> 关联: `.limcode/enhancements-backlog.md` §链式行为

## 一、动机

当前系统有三种推理提供者（`InferenceProvider`）：

| 提供者 | 决策方式 | 包作者可定制 |
|--------|---------|------------|
| LLM (openai/anthropic) | AI 推理，开放文本→`semantic_intent` | 仅通过 prompt 模板间接影响 |
| `rule_based` | TypeScript 硬编码 if-else 优先级链 | 否，需改服务端代码 |
| `mock` | 固定返回观察事件 | 否 |

`rule_based.ts` 的本质就是一个退化的行为树：按优先级顺序检查条件，命中后执行对应动作。Death Note 包的 notebook holder/investigator/observer 三角色决策逻辑全硬编码在 TypeScript 中。任何其他包如果想让 NPC 有类似的确定性行为模式，要么忍受 LLM 推理的成本和不可控性，要么在服务端写代码。

行为树的定位：**第四个 InferenceProvider**，让包作者在 `pack.yaml` 中定义可组合、可复用的决策树。

## 二、核心设计

### 2.1 插入点

```
InferenceProvider 接口 (apps/server/src/inference/provider.ts)
├── LLM providers (openai_compatible, anthropic)
├── rule_based provider      ← 手写决策树，本设计的目标替代物
├── mock provider
└── behavior_tree provider   ← 新增：通用行为树求值器
```

行为树实现 `InferenceProvider.run(context) → Promise<DecisionResult>`。对调度器、作业执行器、意图落地器完全透明——它们不关心 DecisionResult 来自 LLM 还是行为树。

`InferenceStrategy` 联合类型新增 `'behavior_tree'` 字面量：

```typescript
// apps/server/src/inference/types.ts
export type InferenceStrategy = 'mock' | 'rule_based' | 'model_routed' | 'behavior_tree';
```

`selectProvider()` 通过 `provider.strategies.includes(strategy)` 匹配，无需改动路由逻辑。

### 2.2 求值模型

采用**无状态求值**（首版）。

每次 `run(context)` 从根节点开始 tick，遍历至叶子。节点返回三种状态：

- `Success` — 节点完成，父节点按组合策略继续
- `Failure` — 节点未满足条件或执行失败，父节点决定下一个兄弟或整体失败
- `Running` — 首版不支持跨 tick 保持 Running；行为树在单次 `run()` 内完成求值并返回 DecisionResult。Running 预留为未来扩展（长时行为跨 tick 保持状态）

选择无状态首版的原因：
- 模拟循环本身就是每 tick 重新求值，自然匹配无状态树
- 避免引入行为树内部状态的持久化/恢复机制
- Running 状态需要与调度器的 cooldown/single-flight 策略协调，增加复杂度

**Tick 定义**：本文档中"tick"指模拟时钟的一次推进单位，即 `SimulationClock.tick`。`cooldown_ticks: 10` 意为"10 个模拟 tick 后冷却结束"。模拟速度（`sim speed`）只影响 wall clock 间隔，不影响 tick 计数的语义。

**无状态求值的边界**：Cooldown 装饰器（§3.2）需要记录每个智能体在每个装饰器实例上的 `last_success_tick`。这是首版中唯一的求值器外状态，存储在内存中，key 为 `(agent_id, tree_name, 节点路径)`。它不与行为树内部遍历位置耦合，不需要持久化，不构成"行为树状态机"——因此不打破无状态求值的设计前提。

**空结果语义**：行为树求值结束时可能不产出任何 DecisionResult——根节点返回 `Failure`（所有分支的条件均不满足）或整棵树只包含 condition 叶子且全部 Failure。这**不是错误**，也不等同于调度失败。行为树做出了它的决策：当前 tick 无事可做。求值器返回空的 `ProviderDecisionRaw`（`decision: null` 或等效标记），调度器将其视为一次成功的推理周期——该智能体本 tick 不执行动作。

与之区分的是"显式跳过"——未来可引入 `semantic_intent: noop`（或 `kernel: noop`）作为显式的"主动等待"动作。它产出一个完整的 DecisionResult，走意图落地管线（可能触发 invocation rule 或写入事件日志）。显式跳过和空结果对调度器等同（都是成功的 tick），但对决策追踪的意义不同：前者是 `decision: noop`（主动选择等待），后者是 `decision: null`（没有匹配的动作分支）。此区分留作后续扩展，首版只需保证空结果不触发错误路径。

### 2.3 上下文黑板

`InferenceProvider.run(context)` 的整个 `context` 参数即为黑板。条件节点读取 `context.pack_state.*`、`context.policy_summary.*` 等字段，动作节点产出的 `DecisionResult` 与 LLM provider 的产出格式完全相同。

## 三、节点类型

### 3.1 组合节点

**Selector（优先级选择器）** `type: selector`

从左到右依次执行子节点。遇到第一个 `Success` 即停止并返回 `Success`。全 `Failure` 则返回 `Failure`。等同于 if-else 优先级链。

```yaml
# 示例：notebook holder 的优先级决策
type: selector
children:
  - condition: { not_has_artifact: artifact-death-note }
    action: { semantic_intent: claim_notebook }
  - condition: { state: knows_notebook_power, eq: false }
    action: { semantic_intent: understand_notebook_power }
  - condition: { state: murderous_intent, eq: false }
    action: { semantic_intent: form_judgement_intent }
```

**Sequence（顺序执行器）** `type: sequence`

从左到右依次执行子节点。任一 `Failure` 则立即停止并返回 `Failure`。全 `Success` 则返回 `Success`。

首版无状态求值下，Sequence 的所有动作叶子会在同一次 `run()` 中连续产出多个 DecisionResult。采用**策略 A：仅保留最后一个 DecisionResult**。前面的动作视为"状态检查/副作用"，最终 DecisionResult 由最后一个动作叶子产生。前面的动作叶子产出的 DecisionResult **不会**被提交到 ActionIntent 管线——它们只写入黑板（`__last_decision` 被后续叶子覆盖），不触发实际的 invocation/enforcement 流程。

**Sequence 动作叶子限制**：包加载校验阶段，检查 Sequence 节点的直接子节点中 action 和 llm_decision 类型的叶子总数不超过 1。超出则校验失败并报错。此限制防止包作者误以为多个 action 都会执行——在链式行为基础设施就绪之前，只有最后一个 action 会进入意图落地管线。待链式行为就绪后，解除此限制并升级为真正的链式执行。

```yaml
# 示例：先收集情报，再选择目标，再裁决（逻辑上顺序依赖）
type: sequence
children:
  - action: { semantic_intent: gather_target_intel }
  - action: { semantic_intent: choose_target }
  - action: { semantic_intent: judge_target }
```

以上示例中有三个 action 叶子，在首版校验阶段会被拒绝。包作者需要将前两个步骤改为 condition 检查，或将中间步骤移到父级 Selector 中。

**Parallel（并行执行器）** `type: parallel`

首版不接受 Parallel 节点。在包加载校验阶段，若行为树定义中包含 `type: parallel`，校验直接失败并给出明确错误信息。

Parallel 的完整语义（多子节点同时求值、`policy: require_all/require_one` 成功策略）留待后续版本实现。届时需要解决的核心问题：无状态求值下"并行"意味着什么（真正的并发还是顺序求值后合并结果），以及与调度器 single-flight 策略的交互。

### 3.2 装饰节点

装饰器采用**堆栈语法**：`decorators` 是一个有序列表，从上到下为**最外层到最内层**。求值时，列表首元素（最外层）先拦截，逐层向内传递，最终到达 `child`；结果沿相反方向逐层向外传播。

```yaml
# 单装饰器：退化为一元素列表
decorators:
  - type: cooldown
    cooldown_ticks: 10
child:
  action: { semantic_intent: publish_case_update }

# 多装饰器堆栈：cooldown 包裹 probability 包裹 action
decorators:
  - type: cooldown
    cooldown_ticks: 10     # 最外层，先求值
  - type: probability
    weight: 0.3            # 内层，后求值
child:
  action: { semantic_intent: publish_case_update }
```

求值顺序（以上述多装饰器为例）：

1. Cooldown 检查：若冷却期内 → 直接返回 `Failure`（Probability 和 action 均不执行）
2. Cooldown 通过 → Probability 检查：按权重随机决定是否执行
3. Probability 通过 → 执行 action
4. action 结果沿 Probability → Cooldown → 调用者逐层向上传播

此设计消除了嵌套 `child:` 的深层缩进，增减/重排装饰器只需调整列表。单装饰器退化为一元素列表，无语法特例。

**Inverter** `type: inverter`

反转子节点结果：`Success` → `Failure`，`Failure` → `Success`。

```yaml
decorators:
  - type: inverter
child:
  condition: { state: target_alive, eq: true }
```

**Cooldown** `type: cooldown`

记录上次 `Success` 的 tick，在冷却期内跳过子树求值直接返回 `Failure`。

```yaml
decorators:
  - type: cooldown
    cooldown_ticks: 10
child:
  action: { semantic_intent: publish_case_update }
```

Cooldown 的状态存储在求值器内存中，key 为 `(agent_id, tree_name, 节点路径)`。每次求值时查询该 key：若当前 tick 与 `last_success_tick` 之差 < `cooldown_ticks`，跳过子树直接返回 `Failure`；否则正常求值子树，并在子树返回 `Success` 时更新 `last_success_tick`。子树返回 `Failure` 时不更新 `last_success_tick`——冷却只对成功的动作有意义。

**Cooldown 状态不持久化**：服务重启后所有冷却状态归零。重启后短期内（通常几个 tick）可能出现冷却动作被重新触发的情况，对叙事一致性的影响可忽略。这是有意的 tradeoff——避免引入持久化机制和迁移脚本。

**`$ref` 子树中的 Cooldown**：当 cooldown 装饰器位于被 `$ref` 引用的子树内部时，`节点路径` 是展开后调用树中的路径，而非子树定义中的路径。这确保同一智能体通过不同树引用同一子树时，cooldown 状态彼此独立。

**Probability** `type: probability`

以指定概率执行子树，否则跳过返回 `Failure`。

```yaml
decorators:
  - type: probability
    weight: 0.3
child:
  action: { semantic_intent: raise_false_suspicion }
```

随机源使用确定性 PRNG（`seedrandom` 或等效实现），种子由 `agent_id + tree_name + sim_tick` 拼接后哈希得到。同一智能体在同一 tick 对同一概率装饰器的多次求值（如子树引用导致的重复访问）会产生相同结果，确保模拟可复现。

### 3.3 叶子节点

**Condition（条件）** `type: condition`

检查上下文状态。支持的运算符：

| 运算符 | 语义 | 示例 |
|--------|------|------|
| `eq` / `neq` | 等于/不等于 | `{ state: murderous_intent, eq: true }` |
| `gt` / `gte` / `lt` / `lte` | 数值比较 | `{ state: suspicion_level, gte: 0.5 }` |
| `in` / `not_in` | 集合成员 | `{ role: investigator, in: actor_roles }` |
| `has_artifact` | 持有物品 | `{ has_artifact: artifact-death-note }` |
| `not_has_artifact` | 未持有 | `{ not_has_artifact: artifact-death-note }` |
| `event_semantic_type` | 近期事件窗口中是否存在指定类型的事件（存在量词） | `{ event_semantic_type: post_execution_pressure_feedback }` |
| `world_state` | 世界状态检查 | `{ world_state: opening_phase, eq: notebook_claimed }` |
| `ticks_since_event` | 某事件类型最近一次发生距今的 tick 数 | `{ ticks_since_event: suspicious_death_occurred, lt: 5 }` |

复合条件用 `all` / `any` 嵌套：

```yaml
condition:
  all:
    - { state: evidence_chain_strength, gte: 0.55 }
    - { state: evidence_chain_strength, lt: 0.68 }
    - any:
        - { event_semantic_type: suspicious_death_occurred }
        - { event_semantic_type: post_execution_pressure_feedback }
```

#### 3.3.1 上下文解析规则

条件运算符通过以下映射从 `InferenceProvider.run(context)` 中读取值：

| 条件键 | 解析路径 | 缺失时行为 |
|--------|---------|-----------|
| `state: <key>` | `context.pack_state.actor_state.<key>`（per-agent 私有状态） | 视为条件不满足 → `Failure` |
| `has_artifact: <id>` | `context.pack_state.owned_artifacts` 集合 | 未持有 → 条件不满足 |
| `not_has_artifact: <id>` | 同上 | 未持有 → 条件满足 |
| `event_semantic_type: <type>` | `context.pack_state.recent_events[*].semantic_type`（存在量词：近期事件窗口中是否存在至少一条匹配） | 无匹配 → 条件不满足 |
| `world_state: <key>` | `context.pack_state.world_state.<key>`（包级共享状态） | 视为条件不满足 |
| `ticks_since_event: <type>` | 从 `context.pack_state.recent_events` 列表中匹配 `semantic_type`，取最近一次事件距今的 tick 数 | 从未发生 → `+∞`，任何比较均不满足 |
| `in: <collection>` / `not_in: <collection>` | 配合字面值使用，检查字面值是否属于 `context.<collection>` | 集合不存在 → 条件不满足 |

`world_state` 是包级共享的键值存储，同一 pack 下所有智能体共享同一视图。与 `state`（per-agent）的区分：`state` 是智能体私有状态，`world_state` 是包内公共事实（如"笔记已被认领"、"公开调查阶段已开始"）。

`ticks_since_event` 依赖 `context.pack_state.recent_events`——这是一个按 tick 倒序排列的事件历史列表（由 context_builder 在构建推理上下文时从 pack event 表注入，拉取最近 N tick 的事件记录）。与 `latest_event`（仅单条最新事件）不同，`recent_events` 允许查询"过去 5 tick 内是否发生过 X 事件"，语义更完整。

**缺失字段统一语义**：不存在的键等价于条件不满足。此定义对 Inverter 装饰器同样适用——`inverter → { state: nonexistent, eq: true }` 求值为：缺失 → 条件不满足 → `Failure` → Inverter 反转 → `Success`。包作者如需检测键是否存在，应使用 `neq` 或设置显式默认值。

**类型不匹配**：对字符串值使用 `gte`/`lte` 等数值运算符，视为条件不满足，返回 `Failure`，不抛出异常。

#### 3.3.2 条件扩展（后续版本候选）

以下条件类型当前未实现，根据实际需求决定是否加入：

| 运算符 | 语义 |
|--------|------|
| `string_contains` / `string_prefix` / `string_suffix` | 字符串模式匹配 |
| `between` | 数值区间（等价于 `all: [{gte: a}, {lte: b}]` 的语法糖） |
| `cooldown_remaining` | 查询指定 action 的剩余冷却 tick 数 |

**Action（动作）** `type: action`

产出 DecisionResult。两种子类型：

1. **`semantic_intent`** — 走意图落地管线（`IntentGrounder` → invocation rules → enforcement engine）
2. **`kernel`** — 直接产出 kernel 动作（`trigger_event`、`post_message`、`adjust_snr`、`adjust_relationship`、`move`）

```yaml
# semantic_intent 动作
action:
  semantic_intent: gather_target_intel
  proposed_method: covert_background_check
  target_ref:
    entity_id: agent-002
    kind: actor
  reasoning: "需要补齐目标情报再行动"

# kernel 动作
action:
  kernel: trigger_event
  payload:
    event_type: history
    title: "观察局势"
    description: "暂时观望"
```

**LLM Decision（LLM 叶子）** `type: llm_decision`

在行为树的某个叶子调用 LLM 做开放推理。允许混合树：结构由树控制，开放决策点在叶子交给 LLM。

```yaml
type: selector
children:
  # 确定性优先级链处理常规情况
  - condition: { has_artifact: artifact-death-note, eq: false }
    action: { semantic_intent: claim_notebook }
  # 持有笔记后，具体裁决策略交给 LLM
  - type: llm_decision
    prompt_template: notebook_holder_judgement_strategy
    provider: openai_compatible
    model: claude-opus-4-7
```

LLM 叶子产出的仍是标准 DecisionResult，与其他叶子无异。

**LLM 叶子的 prompt 构建**：LLM 叶子的 prompt 由行为树求值器内部自行构建——使用叶子定义的 `prompt_template` 和 `model` 配置，调用 AI Gateway 完成推理。这不同于上层 `service.ts` 中按 task 类型（`agent_decision`）统一构建的 `PromptBundleV2`。LLM 叶子的 prompt 构建与 task 级 prompt 管线解耦，这也是混合树的设计意图：结构由树控制，开放决策点由 LLM 自行决定 prompt 策略。

## 四、YAML 定义与分配

### 4.1 树定义

树定义放在 `pack.yaml` 顶层新键 `behavior_trees` 下：

```yaml
behavior_trees:
  notebook_holder:
    type: selector
    children:
      - condition: { not_has_artifact: artifact-death-note }
        action:
          semantic_intent: claim_notebook
          reasoning: "必须先持有死亡笔记"
      - condition: { state: knows_notebook_power, eq: false }
        action:
          semantic_intent: understand_notebook_power
          reasoning: "需要确认笔记的规则效力"
      - condition: { state: murderous_intent, eq: false }
        type: selector
        children:
          - condition: { state: suspicion_level, gte: 0.35 }
            action:
              semantic_intent: raise_false_suspicion
              target_ref: { entity_id: agent-002, kind: actor }
          - action:
              semantic_intent: form_judgement_intent
      - condition: { state: target_name_confirmed, eq: false }
        action:
          semantic_intent: gather_target_intel
          proposed_method: covert_background_check
      - action:
          semantic_intent: judge_target
          desired_effect: kill
          reasoning: "时机成熟，执行裁决"

  investigator:
    type: selector
    children:
      - condition:
          any:
            - { event_semantic_type: suspicious_death_occurred }
            - { state: evidence_chain_strength, lt: 0.55 }
        action:
          semantic_intent: investigate_death_cluster
      - condition: { state: evidence_chain_strength, gte: 0.55 }
        type: sequence
        children:
          - condition: { state: case_intel_shared, eq: false }
            action: { semantic_intent: share_case_intel }
          - action: { semantic_intent: request_joint_observation }
      - action:
          semantic_intent: investigate_death_cluster
          reasoning: "继续推进调查"
```

注意：`investigator` 树的 Sequence 节点有两个 action 叶子，这在首版校验中会被拒绝。在链式行为就绪之前，包作者应将 `share_case_intel` 和 `request_joint_observation` 拆分为两个独立的 tick 动作（分别放在 Selector 的不同优先级分支中）。

### 4.2 子树引用

通过 `$ref` 引用同包或其他包定义的树，实现复用：

```yaml
behavior_trees:
  # 可复用的子树
  _common/ensure_notebook:
    type: selector
    children:
      - condition: { not_has_artifact: artifact-death-note }
        action: { semantic_intent: claim_notebook }
      - condition: { state: knows_notebook_power, eq: false }
        action: { semantic_intent: understand_notebook_power }

  notebook_holder:
    type: sequence
    children:
      - $ref: _common/ensure_notebook
      - type: selector
        children:
          # ... 裁决逻辑
```

跨包引用（未来扩展，首版限定同包内引用）：

```yaml
- $ref: "death_note::_common/ensure_notebook"
```

**展开归属**：`$ref` 的解析和展开在 `TreeRegistry` 内部自行处理——行为树模块接收原始 YAML 节点，自行解析 `$ref` 并展开为完整 AST。PackManifestLoader 不做任何行为树特定的预处理。这与 `include:` 指令的职责分离：`include:` 是 YAML 文件级别的物理拼接（属于 pack 加载管线），`$ref` 是行为树定义内部的逻辑引用（属于行为树模块内部）。

**环路检测**：`TreeRegistry` 在展开 `$ref` 时执行 DFS 环路检测。展开过程将树定义构建为有向图（节点 = 树名，边 = `$ref` 引用）。检测三种错误：

1. **环路**（A → B → … → A）：DFS 发现回边，包加载失败，错误信息包含完整引用链
2. **自引用**（A → A）：单独检测并报告（"树 `X` 引用了自身"），因为自引用几乎肯定是笔误
3. **深度超限**：展开后 AST 深度超过 **16** 层，包加载失败。此限制针对的是展开后的树定义深度（`$ref` 完全展开后的 AST 最大嵌套层级）。正常行为树深度通常不超过 5-8 层，16 层已足够宽松，同时能在自引用未被前两项检测捕获的边缘情况下较早发现问题

### 4.3 智能体分配

在 `entities.actors` 中为每个 actor 指定使用的推理配置：

```yaml
entities:
  actors:
    - id: agent-001
      name: "夜神月"
      entity_type: human
      inference:
        provider: behavior_tree
        behavior_tree: notebook_holder
    - id: agent-002
      name: "L"
      entity_type: human
      inference:
        provider: openai_compatible
        model: claude-opus-4-7
        # L 仍使用 LLM 推理，因为其行为需要高度开放性
    - id: agent-003
      name: "背景NPC"
      entity_type: human
      inference:
        provider: behavior_tree
        behavior_tree: background_citizen
```

同一个包内可以混合使用 LLM provider（主角，开放叙事）和行为树 provider（NPC，确定性模式）。

**Actor 级 inference 配置的语义**：

- actor 级 `inference` 是**完整的独立配置块**，不与包级 `ai:` 做字段级 fallback
- 当 actor 声明了 `inference` 时，该 actor 的所有推理配置完全从 actor 级取；不存在"部分字段覆盖，其余回退到包级"的合并逻辑
- 当 actor 未声明 `inference` 时，使用包级 `ai:` 下的默认配置
- `provider: behavior_tree` 的 actor 需要 `behavior_tree` 键指定树名
- `provider: openai_compatible`（或 `anthropic`）的 actor 需要在 `inference` 块内直接指定 `model`，不从包级 `ai.tasks.agent_decision.route` 继承

此设计避免字段级合并的歧义（如包级默认 model 为 `claude-opus-4-7`，但 actor 级别只覆盖了 `provider: behavior_tree`——合并后会出现无意义的 model 残留）。

**实现要点**：

1. `entityDefinitionSchema`（`constitution_schema.ts:277`）需新增可选 `inference` 子 schema，使用 Zod discriminated union 按 `provider` 值区分允许的字段
2. context_builder 在构建推理上下文时，读取 actor 的 `inference` 配置（若存在）来设置 `context.strategy` 和 `context.world_ai`；若不存在则沿用现有包级逻辑

**错误与 fallback**：

- `provider: behavior_tree` 但 `behavior_tree` 键缺失或指向不存在的树名 → 包加载阶段报错，拒绝加载
- 运行时求值器内部意外异常 → 捕获异常，记录 ERROR 日志，返回空 DecisionResult（该 tick 智能体不执行任何动作），不中断模拟循环
- 不存在从 behavior_tree provider 到其他 provider 的隐式 fallback——配置错误就是错误，不静默降级

## 五、实现要点

### 5.1 新增文件

```
apps/server/src/inference/providers/behavior_tree/
  provider.ts              — InferenceProvider 实现入口，run(context) → DecisionResult
  evaluator.ts             — 树求值器，递归 tick 遍历。内部处理 llm_decision 叶子的 prompt 构建
  nodes/
    composites.ts          — Selector, Sequence
    decorators.ts          — Inverter, Cooldown, Probability
    leaves.ts              — Condition, Action, LLM Decision
  context_resolver.ts      — 条件运算符求值（从 inference context 中读取状态）
  tree_registry.ts         — 树定义加载/缓存/$ref 解析展开/环路检测/深度校验
  schema.ts                — Zod schema，验证 pack.yaml 中的 behavior_trees 定义
```

**`InferenceProvider` 接口扩展**：

```typescript
export interface InferenceProvider {
  readonly name: string;
  readonly strategies: InferenceStrategy[];
  readonly requiresPrompt: boolean;  // 新增：声明是否需要 PromptBundleV2
  run(context: InferenceContext, prompt: PromptBundleV2): Promise<ProviderDecisionRaw>;
}
```

- 行为树 provider：`requiresPrompt: false`。`service.ts` 在调用 `provider.run()` 之前检查此标志，若为 `false` 则跳过 `buildWorkflowPromptBundle()` 调用
- LLM 类 provider：`requiresPrompt: true`
- Mock provider：`requiresPrompt: false`
- `rule_based` provider：`requiresPrompt: false`

当行为树包含 `llm_decision` 叶子时，prompt 由求值器内部在叶子求值时自行构建（见 §3.3），不依赖上层传入的 `PromptBundleV2` 参数——传入的 `prompt` 参数在 `requiresPrompt: false` 时可能为空占位对象。

### 5.2 求值器伪代码

```typescript
type BTStatus = 'success' | 'failure' | 'running';

interface BTContext {
  inferenceContext: Parameters<InferenceProvider['run']>[0];
  blackboard: Record<string, unknown>;  // 节点间共享临时数据
}

async function tick(node: BTNodeDef, ctx: BTContext): Promise<BTStatus> {
  switch (node.type) {
    case 'selector':
      for (const child of node.children) {
        const status = await tick(child, ctx);
        if (status !== 'failure') return status; // success 或 running 都向上传
      }
      return 'failure';

    case 'sequence':
      for (const child of node.children) {
        const status = await tick(child, ctx);
        if (status !== 'success') return status; // failure 或 running 都向上传
      }
      return 'success';

    case 'condition':
      return evaluateCondition(node, ctx) ? 'success' : 'failure';

    case 'action':
      ctx.blackboard['__last_decision'] = buildDecisionResult(node, ctx);
      return 'success';

    case 'llm_decision': {
      // 求值器内部构建 prompt 并调用 LLM
      const prompt = await buildLLMDecisionPrompt(node.prompt_template, node.model, ctx);
      const result = await callLLM(prompt, node.model);
      ctx.blackboard['__last_decision'] = result;
      return 'success';
    }

    // decorators 堆栈：从最外层到最内层依次包装 child
    case 'decorated':
      return tickDecorated(node.decorators, node.child, ctx);
  }
}

// 装饰器堆栈求值：从左（最外层）到右（最内层）依次拦截
async function tickDecorated(
  decorators: DecoratorDef[],
  child: BTNodeDef,
  ctx: BTContext
): Promise<BTStatus> {
  if (decorators.length === 0) return tick(child, ctx);

  const [outermost, ...rest] = decorators;
  const innerNode: BTNodeDef = rest.length > 0
    ? { type: 'decorated', decorators: rest, child }
    : child;

  switch (outermost.type) {
    case 'inverter': {
      const status = await tick(innerNode, ctx);
      if (status === 'success') return 'failure';
      if (status === 'failure') return 'success';
      return status; // running 原样返回
    }
    case 'cooldown':
      if (isInCooldown(outermost, ctx)) return 'failure';
      const status = await tick(innerNode, ctx);
      if (status === 'success') updateCooldown(outermost, ctx);
      return status;
    case 'probability':
      if (!rollProbability(outermost, ctx)) return 'failure';
      return tick(innerNode, ctx);
    default:
      return tick(innerNode, ctx);
  }
}
```

### 5.3 与现有系统的关系

| 系统 | 关系 |
|------|------|
| `InferenceStrategy` 类型 (`types.ts:13`) | 新增 `'behavior_tree'` 字面量 |
| `InferenceProvider` 接口 (`provider.ts`) | 新增 `requiresPrompt: boolean` 字段 |
| `InferencePackStateSnapshot` (`types.ts:181`) | 新增 `recent_events: InferencePackLatestEventSnapshot[]` 字段，支持 `ticks_since_event` |
| `entityDefinitionSchema` (`constitution_schema.ts:277`) | 新增可选 `inference` 子 schema（按 provider 区分） |
| context_builder (`context_builder.ts`) | 注入 `recent_events` 到 `pack_state`；读取 actor 级 `inference` 配置设置 `strategy` |
| 调度器 (agent_scheduler) | 无变化 — 调度器仍按信号/周期选择智能体，不感知推理提供者类型 |
| 作业执行器 (job_runner) | 无变化 — 仍调用 `inferenceService.executeDecisionJob()` |
| 推理工作流 (inference_workflow) | 需增加一行路由：`provider === 'behavior_tree'` 时调用行为树求值器 |
| `service.ts` (`executeDecision`) | 检查 `provider.requiresPrompt`，若为 `false` 跳过 `buildWorkflowPromptBundle()` |
| 意图落地器 (intent_grounder) | 无变化 — 行为树产出的 `semantic_intent` 与其他提供者产出的走相同管线 |
| Action Dispatch | 无变化 — 消费的是 ActionIntent，不关心来源 |
| Enforcement Engine | 无变化 |
| rules.invocation / rules.objective_enforcement | 互补关系 — 行为树决定"做什么"，invocation/objective 规则决定"怎么做/是否允许做" |

### 5.4 对 rule_based.ts 的处理

行为树 provider 实现后，`rule_based.ts` 进入废弃路径：

1. 将 Death Note 包的三角色决策逻辑迁移为 `pack.yaml` 中的 `behavior_trees` 定义
2. `rule_based.ts` 保留一个过渡期（标记 deprecated），确保现有测试通过
3. 过渡期结束后删除 `rule_based.ts`

`rule_based.ts` 中 `notebook_investigation_reference` profile 的所有分支（claim_notebook → understand_notebook_power → gather_target_intel → ...），正是 Selector 优先级链的标准实例。

### 5.5 错误处理

| 场景 | 阶段 | 行为 |
|------|------|------|
| 条件运算符类型不匹配（如对字符串做 `gte`） | 运行时 | 视为条件不满足，返回 `Failure`，不抛异常 |
| 条件键缺失 | 运行时 | 视为条件不满足，返回 `Failure`（§3.3.1） |
| LLM 叶子调用失败（超时、限流、模型不可用） | 运行时 | 叶子返回 `Failure`，由父组合节点决定后续路径。不重试——重试逻辑由 AI Gateway 层统一处理 |
| `$ref` 指向不存在的树 | 加载时 | 包加载失败，错误信息包含引用链 |
| `$ref` 环路（A → B → A） | 加载时 | `TreeRegistry` DFS 检测，包加载失败，错误信息包含完整引用链 |
| `$ref` 自引用（A → A） | 加载时 | `TreeRegistry` 自边检测，包加载失败 |
| 展开后 AST 深度超过 16 | 加载时 | 包加载失败 |
| 空组合节点（Selector/Sequence 无 children） | 加载时 | 警告，运行时该节点直接返回 `Failure` |
| Sequence 直接子节点中 action/llm_decision 叶子超过 1 个 | 加载时 | 校验失败，包加载失败 |
| `decorators` 列表中同一 `type` 出现多次 | 加载时 | 警告（不阻止加载），如 `[cooldown, probability, cooldown]` 中的重复 cooldown 可能是笔误 |
| Parallel 节点 | 加载时 | 校验失败，拒绝加载（§3.1） |
| 求值器内部意外异常 | 运行时 | 捕获，ERROR 日志，该 tick 返回空 DecisionResult |

### 5.6 可观测性与调试

**决策追踪**：每次 `run()` 调用产出结构化的决策追踪记录（decision trace），包含：

- 智能体 ID、树名、sim tick
- 遍历路径：每个节点的状态（`Success` / `Failure` / `Skipped`）和求值耗时
- 最终产出的 DecisionResult
- 若为 Sequence 节点，被丢弃的中间 action 叶子的 DecisionResult 标记为 `evaluated_but_discarded`，便于包作者调试

决策追踪以 DEBUG 级别输出到服务器日志，格式为 JSON Line。包作者通过调整日志级别即可观察行为树的逐 tick 决策过程，无需额外工具。

**包校验集成**：`validate:pack` 命令在现有校验基础上增加行为树专项检查：

1. Schema 合规性（Zod 校验）
2. 所有 `$ref` 目标存在
3. 无 `$ref` 环路
4. 无 `$ref` 自引用
5. 展开后 AST 深度不超过 16
6. 无 Parallel 节点（首版）
7. Sequence 直接子节点中 action/llm_decision 叶子不超过 1 个
8. `decorators` 列表中无重复 `type`（警告级别）
9. 所有条件键为已知键名（基于 §3.3.1 的运算符白名单）

## 六、暂不纳入首版的内容

| 内容 | 原因 |
|------|------|
| Running 状态跨 tick 持久化 | 模拟循环每 tick 重新求值已覆盖；长时行为可用事件驱动循环替代 |
| 并行节点 (Parallel) 的完整实现 | 无状态求值下"并行"语义不清晰（真正并发 vs 顺序求值后合并结果）；首版在加载校验阶段直接拒绝 |
| 跨包子树引用 (`$ref: "other_pack::tree"`) | 需要先解决包间依赖声明和子树版本化问题 |
| 行为树可视化编辑器 | 先验证 YAML 定义的人机工程学，再考虑可视化工具 |
| 运行时动态修改树结构 | 行为树在 pack 加载时编译，运行时不可变。动态性通过条件节点的状态检查实现 |
| 子树宏/参数化 | 先观察 `$ref` 的实际复用模式，再决定是否需要模板参数 |
| Cooldown 状态持久化 | 重启后几个 tick 内的行为偏差对叙事影响可忽略；先验证内存方案的实际表现 |
| Sequence 多 action 链式执行（策略 B） | 依赖链式行为基础设施（见 §七）；首版限制 Sequence 只能有一个 action 叶子 |

## 七、与链式行为的关系

行为树的 Sequence 节点天然表达"依次执行多个动作"的语义。首版 Sequence 采用策略 A（仅保留最后一个 DecisionResult），并限制每个 Sequence 最多一个 action/llm_decision 叶子，因为同时执行多个动作需要链式行为的基础设施支持。

当链式行为的基础设施就绪后（见 `.limcode/enhancements-backlog.md` §链式行为）：

1. 解除 Sequence 的"最多一个 action 叶子"限制
2. Sequence 升级为策略 B——在同一 tick 内顺序执行多个 ActionIntent，每个都进入意图落地管线

这两个能力是正交的：

- **行为树** 解决"如何做决策"（decision-making 结构）
- **链式行为** 解决"如何执行多个动作"（action execution 管道）

## 八、设计决议记录

以下记录 §八（原"待讨论的未决问题"）的决议结果，供后续实现时回溯决策依据。

| # | 问题 | 决议 | 简要理由 |
|---|------|------|---------|
| 8.1 | `InferenceStrategy` 类型扩展 | 新增 `'behavior_tree'` 字面量 | 最直接的方式，与现有三种策略的模式一致。后续若策略值过多再重构路由机制 |
| 8.2 | Actor 级 `inference` 配置 | 完整独立配置块，不与包级 fallback | 避免字段级合并的歧义。行为树 actor 和 LLM actor 的 schema 走 Zod discriminated union |
| 8.3 | `world_state` 上下文路径 | 修正为 `context.pack_state.world_state` | 纯文档修正，与 `InferencePackStateSnapshot` 实际字段对齐 |
| 8.4 | `ticks_since_event` 数据来源 | 在 context_builder 中注入 `recent_events` 列表到 `InferencePackStateSnapshot` | `latest_event`（单条）无法支持"过去 N tick 内是否发生过 X"的语义。DB 查询开销可忽略 |
| 8.5 | `PromptBundleV2` 冗余开销 | Provider 新增 `requiresPrompt: false` 标志；`llm_decision` 叶子由求值器内部自行构建 prompt | 纯行为树跳过无意义的 prompt 构建。LLM 叶子的 prompt 策略由树控制，与 task 级 prompt 管线解耦 |
| 8.6 | Sequence 仅保留最后一个 DecisionResult | 保持策略 A，且限制 Sequence 直接子节点中最多 1 个 action/llm_decision 叶子 | 在链式行为就绪前，多 action 的表达力本就受限，显式限制比产生误导更好 |
| 8.7 | Cooldown 状态重启丢失 | 接受 tradeoff，不做持久化 | 重启是低频事件，几个 tick 内的噪声级偏差对叙事影响可忽略 |
| 8.8 | `$ref` 展开归属 | `TreeRegistry` 内部自行处理 | 与 `include:` 职责分离：前者是物理文件拼接，后者是行为树逻辑引用。便于后续跨包引用扩展 |
| 8.9 | 树最大深度 | 16 层（展开后 AST 深度）；新增自引用检测；区分三种错误信息 | 正常行为树 ≤ 8 层，16 已是宽松 sanity check。自引用单独报错，不与深度超限混淆 |

## 九、已知盲点与后续需确认的事项

以下问题在设计草案中已明确方向，但具体实现细节需要在编码前进一步敲定。

### 9.1 Actor 级 `inference` 的 Zod schema 设计

`entityDefinitionSchema` 新增的 `inference` 字段需要按 `provider` 值做 discriminated union：

```typescript
// 示意，非最终 schema
const actorInferenceSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('behavior_tree'),
    behavior_tree: z.string()  // 指向 behavior_trees 下的树名
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
```

需要确认：`provider: 'openai_compatible'` 的 actor 是否还需要 `route`（routing strategy）字段？当前包级 `ai.tasks.agent_decision.route` 包含 model + routing strategy 的复合配置，actor 级是只指定 model 还是完整覆盖 routing？

### 9.2 context_builder 中 actor 级 inference 配置的读取路径

当前 `context_builder.ts` 从包级配置（`pack.ai`）获取推理策略。需要新增逻辑：

1. 读取 actor 对应的 `entityDefinition.inference`（若存在）
2. 将 `provider` 映射为 `InferenceStrategy`（`behavior_tree` → `'behavior_tree'`，`openai_compatible` / `anthropic` → `'model_routed'`）
3. 设置 `context.strategy` 和 `context.world_ai`

需确认 `context.world_ai` 的结构是否足以承载 actor 级 LLM 配置（目前它是可选的 `WorldPackAiConfig | null`）。

### 9.3 `recent_events` 的查询范围和性能

`InferencePackStateSnapshot` 需新增 `recent_events` 字段。实现在 context_builder 中查询 pack event 表，拉取最近 N tick（建议 N=20）的事件记录，按 tick 倒序排列。

需要确认：
- pack event 表是否有合适的索引支持此查询（`(pack_id, tick)` 或 `(pack_id, created_at)`）
- 20 tick 的事件窗口是否合理——太短则 `ticks_since_event` 对"较远"的事件无能为力，太长则增加每条推理上下文的构建开销

### 9.4 行为树 provider 的 `requiresPrompt` 与 LLM 叶子的交互

当行为树不包含任何 `llm_decision` 叶子时，`requiresPrompt: false`，上层跳过 prompt 构建。但如果包作者后续在树中添加了 `llm_decision` 叶子，行为树 provider 的 `requiresPrompt` 仍然为 `false`（因为 prompt 由求值器内部构建，不需要上层传入）。此时需要确保求值器内部的 LLM 叶子 prompt 构建管线完整可用——它依赖 AI Gateway、model registry 等组件，这些组件的初始化由 `AppContext` 保证，不依赖上层传入的 `PromptBundleV2`。

### 9.5 Cooldown 节点路径在 `$ref` 子树中的语义

Cooldown 状态 key 为 `(agent_id, tree_name, 节点路径)`。当 cooldown 装饰器位于被 `$ref` 引用的子树中时，"节点路径"定义为展开后调用树中的路径（而非子树定义中的路径）。这确保同一智能体通过不同树引用同一子树时，cooldown 状态彼此独立。

实现时需确保 `TreeRegistry` 展开 `$ref` 后，每个节点的路径信息保留了完整的"展开后调用链"，而非仅在子树定义中的局部路径。求值器在记录 cooldown 状态时使用展开后的全局路径。

### 9.6 空结果 vs 显式跳过的语义区分

当前设计明确：根节点全 Failure → 空 DecisionResult → 视为成功的推理周期（智能体本 tick 不执行动作）。这与"显式跳过"（`semantic_intent: noop`）不同——后者是一个完整的 DecisionResult，走意图落地管线，可能在 invocation rule 中触发副作用（如记录事件日志）。

首版不需要实现 `noop`。需要确认的是：空 DecisionResult 在决策追踪中的标记方式。建议使用 `decision: null`（而非 `decision: { semantic_intent: noop }`），与显式跳过区分开。调度器对两种情况一视同仁（都是成功的 tick，不触发重试或错误路径）。

**推论**：如果未来包作者频繁遇到"不知道该让 NPC 做什么所以全 Failure"的情况，可能需要引入两个辅助特性：(1) 树级 `default_action`——当根节点 Failure 时兜底执行的动作；(2) `noop` 显式跳过动作——让包作者能区分"意外无匹配"和"有意等待"。两者均非首版范围。

### 9.7 装饰器堆栈语法与现有 YAML 示例的兼容性

装饰器语法已从单数 `decorator: <type>` 迁移为列表 `decorators: [{type: ...}, ...]`。此变更影响范围：

- §3.2 所有示例（已更新）
- §5.2 伪代码 `case 'decorated'` + `tickDecorated()`（已更新）
- Zod schema（`schema.ts`）需接纳 `decorators` 列表，列表元素按 `type` 做 discriminated union
- 包加载校验需检查：`decorators` 列表中不能出现重复的 `type`（如两个 `cooldown` 叠加——语义上无意义，可能是笔误）

堆栈求值的正确性依赖一个关键约束：**装饰器的执行顺序必须与列表顺序一致**（顶 = 最外层先求值）。这不是"建议"而是硬规则——Probability 在 Cooldown 内层 vs 外层的语义完全不同：
- `[cooldown, probability]`：冷却期内完全跳过（概率不参与）。冷却期过后，每次 tick 以 `weight` 概率执行。这是"偶尔执行某动作，但执行后冷却"的典型语义。
- `[probability, cooldown]`：每次 tick 以 `weight` 概率进入冷却检查。如果概率未命中，冷却计时器不更新（因为子树未执行）。这会导致冷却期被概率稀释——不太可能是包作者的意图。

包加载时对此给出警告（不阻止加载，因为存在刻意使用的合法场景，如"以概率检查冷却是否到期"），但在文档中明确推荐 `[cooldown, probability]` 的顺序。

### 9.8 `event_semantic_type` 与 `ticks_since_event` 的语义边界

两者都从 `context.pack_state.recent_events` 解析，但语义不同：

| 条件 | 语义 | 返回值类型 | 典型用法 |
|------|------|-----------|---------|
| `event_semantic_type: X` | 存在量词：近期事件窗口中是否存在类型 X 的事件 | boolean（隐式 `eq: true`） | `{ event_semantic_type: suspicious_death_occurred }` → "最近发生过可疑死亡事件吗？" |
| `ticks_since_event: X` | 标量：最近一次类型 X 的事件距今多少 tick | number（配合 `lt`/`gte` 等比较） | `{ ticks_since_event: suspicious_death_occurred, lt: 5 }` → "最近一次可疑死亡事件发生在 5 tick 以内吗？" |

两者的关键区别：`event_semantic_type` 是**无时间精度的存在检查**（有/没有），`ticks_since_event` 是**带时间精度的距离检查**（多久以前）。如果需要"最近事件是否就是 X"（单条检查），应使用 `ticks_since_event: X, lt: 1`——等价于"过去 1 tick 内发生过 X"，即 latest_event 的间接表达。此设计避免了新增一个"仅查 latest_event"的专用运算符，保持条件系统正交。

潜在歧义：`event_semantic_type` 仅写 `{ event_semantic_type: X }` 时，隐含 `eq: true`——即"存在匹配事件"。如果包作者写 `{ event_semantic_type: X, eq: false }`，语义变为"近期事件窗口中不存在类型 X 的事件"，这是合理且有用的（"如果最近没人死亡，就做日常巡逻"）。实现时需确认 `eq: false` 对存在量词的否定行为正确。
