# 行为树 InferenceProvider 设计草案

> 评估时间: 2026-05-21
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

注意：首版无状态求值下，Sequence 的所有动作叶子会在同一次 `run()` 中连续产出多个 DecisionResult。对此有两种处理策略：

- **A. 仅保留最后一个** — 前面的动作视为"状态检查/副作用"，最终 DecisionResult 由最后一个动作叶子产生（简单，推荐首版）。关键约束：前面的动作叶子产出的 DecisionResult **不会**被提交到 ActionIntent 管线——它们只写入黑板（`__last_decision` 被后续叶子覆盖），不触发实际的 invocation/enforcement 流程。只有最后一个动作叶子的 DecisionResult 会被返回并进入意图落地管线。
- **B. 链式产出** — Sequence 产出一个 DecisionResult 数组，由上层决定如何执行（需要链式行为支持，暂缓）

```yaml
# 示例：先收集情报，再选择目标，再裁决（逻辑上顺序依赖）
type: sequence
children:
  - action: { semantic_intent: gather_target_intel }
  - action: { semantic_intent: choose_target }
  - action: { semantic_intent: judge_target }
```

**Parallel（并行执行器）** `type: parallel`

首版不接受 Parallel 节点。在包加载校验阶段，若行为树定义中包含 `type: parallel`，校验直接失败并给出明确错误信息。

Parallel 的完整语义（多子节点同时求值、`policy: require_all/require_one` 成功策略）留待后续版本实现。届时需要解决的核心问题：无状态求值下"并行"意味着什么（真正的并发还是顺序求值后合并结果），以及与调度器 single-flight 策略的交互。

### 3.2 装饰节点

**Inverter** `decorator: inverter`

反转子节点结果：`Success` → `Failure`，`Failure` → `Success`。

**Cooldown** `decorator: cooldown`

记录上次 `Success` 的 tick，在冷却期内跳过子树求值直接返回 `Failure`。

```yaml
decorator: cooldown
cooldown_ticks: 10
child:
  action: { semantic_intent: publish_case_update }
```

Cooldown 的状态存储在求值器内存中，key 为 `(agent_id, tree_name, 节点路径)`。每次求值时查询该 key：若当前 tick 与 `last_success_tick` 之差 < `cooldown_ticks`，跳过子树直接返回 `Failure`；否则正常求值子树，并在子树返回 `Success` 时更新 `last_success_tick`。子树返回 `Failure` 时不更新 `last_success_tick`——冷却只对成功的动作有意义。

**Probability** `decorator: probability`

以指定概率执行子树，否则跳过返回 `Failure`。

```yaml
decorator: probability
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
| `event_semantic_type` | 最近事件类型匹配 | `{ event_semantic_type: post_execution_pressure_feedback }` |
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
| `state: <key>` | `context.pack_state.<key>`（per-agent 私有状态） | 视为条件不满足 → `Failure` |
| `has_artifact: <id>` | `context.inventory.held_artifacts` 集合 | 未持有 → 条件不满足 |
| `not_has_artifact: <id>` | 同上 | 未持有 → 条件满足 |
| `event_semantic_type: <type>` | `context.recent_events[*].semantic_type` | 无匹配 → 条件不满足 |
| `world_state: <key>` | `context.world_state.<key>`（包级共享状态） | 视为条件不满足 |
| `ticks_since_event: <type>` | 最近一次匹配 `semantic_type` 的事件距今 tick 数 | 从未发生 → `+∞`，任何比较均不满足 |
| `in: <collection>` / `not_in: <collection>` | 配合字面值使用，检查字面值是否属于 `context.<collection>` | 集合不存在 → 条件不满足 |

`world_state` 是包级共享的键值存储，同一 pack 下所有智能体共享同一视图。与 `state`（per-agent）的区分：`state` 是智能体私有状态，`world_state` 是包内公共事实（如"笔记已被认领"、"公开调查阶段已开始"）。

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
          - action: { semantic_intent: share_case_intel }
          - action: { semantic_intent: request_joint_observation }
      - action:
          semantic_intent: investigate_death_cluster
          reasoning: "继续推进调查"
```

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

跨包引用（未来扩展，首版可限定同包内引用）：

```yaml
- $ref: "death_note::_common/ensure_notebook"
```

**环路检测**：子树引用在包加载时展开为有向图。加载器对 `$ref` 边执行 DFS 环路检测——若发现环路（A → B → A），包加载失败并给出包含完整引用链的错误信息。首版同时限制最大展开深度为 32 层，超出视为逻辑错误（大概率是意外环路）。

### 4.3 智能体分配

在 `entities.actors` 中为每个 actor 指定使用的行为树：

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

**错误与 fallback**：

- `provider: behavior_tree` 但 `behavior_tree` 键缺失或指向不存在的树名 → 包加载阶段报错，拒绝加载
- 运行时求值器内部意外异常 → 捕获异常，记录 ERROR 日志，返回空 DecisionResult（该 tick 智能体不执行任何动作），不中断模拟循环
- 不存在从 behavior_tree provider 到其他 provider 的隐式 fallback——配置错误就是错误，不静默降级

## 五、实现要点

### 5.1 新增文件

```
apps/server/src/inference/providers/behavior_tree/
  provider.ts              — InferenceProvider 实现入口，run(context) → DecisionResult
  evaluator.ts             — 树求值器，递归 tick 遍历
  nodes/
    composites.ts          — Selector, Sequence, Parallel
    decorators.ts          — Inverter, Cooldown, Probability
    leaves.ts              — Condition, Action, LLM Decision
  context_resolver.ts      — 条件运算符求值（从 inference context 中读取状态）
  tree_registry.ts         — 树定义加载/缓存/子树引用解析
  schema.ts                — Zod schema，验证 pack.yaml 中的 behavior_trees 定义
```

### 5.2 求值器伪代码

```typescript
type BTStatus = 'success' | 'failure' | 'running';

interface BTContext {
  inferenceContext: Parameters<InferenceProvider['run']>[0];
  blackboard: Record<string, unknown>;  // 节点间共享临时数据
}

function tick(node: BTNodeDef, ctx: BTContext): BTStatus {
  switch (node.type) {
    case 'selector':
      for (const child of node.children) {
        const status = tick(child, ctx);
        if (status !== 'failure') return status; // success 或 running 都向上传
      }
      return 'failure';

    case 'sequence':
      for (const child of node.children) {
        const status = tick(child, ctx);
        if (status !== 'success') return status; // failure 或 running 都向上传
      }
      return 'success';

    case 'condition':
      return evaluateCondition(node, ctx) ? 'success' : 'failure';

    case 'action':
      ctx.blackboard['__last_decision'] = buildDecisionResult(node, ctx);
      return 'success';

    case 'llm_decision':
      const result = await callLLM(node.prompt_template, node.model, ctx);
      ctx.blackboard['__last_decision'] = result;
      return 'success';

    // decorator 节点包裹单个 child
    case 'decorator':
      return tickDecorator(node, ctx);
  }
}
```

### 5.3 与现有系统的关系

| 系统 | 关系 |
|------|------|
| 调度器 (agent_scheduler) | 无变化 — 调度器仍按信号/周期选择智能体，不感知推理提供者类型 |
| 作业执行器 (job_runner) | 无变化 — 仍调用 `inferenceService.executeDecisionJob()` |
| 推理工作流 (inference_workflow) | 需增加一行路由：`provider === 'behavior_tree'` 时调用行为树求值器 |
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
| `$ref` 环路 | 加载时 | 包加载失败（§4.2） |
| 空组合节点（Selector/Sequence 无 children） | 加载时 | 警告，运行时该节点直接返回 `Failure` |
| Parallel 节点 | 加载时 | 校验失败，拒绝加载（§3.1） |
| 树最大深度超过 32 | 加载时 | 校验失败，拒绝加载 |
| 求值器内部意外异常 | 运行时 | 捕获，ERROR 日志，该 tick 返回空 DecisionResult |

### 5.6 可观测性与调试

**决策追踪**：每次 `run()` 调用产出结构化的决策追踪记录（decision trace），包含：

- 智能体 ID、树名、sim tick
- 遍历路径：每个节点的状态（`Success` / `Failure` / `Skipped`）和求值耗时
- 最终产出的 DecisionResult

决策追踪以 DEBUG 级别输出到服务器日志，格式为 JSON Line。包作者通过调整日志级别即可观察行为树的逐 tick 决策过程，无需额外工具。

**包校验集成**：`validate:pack` 命令在现有校验基础上增加行为树专项检查：

1. Schema 合规性（Zod 校验）
2. 所有 `$ref` 目标存在
3. 无 `$ref` 环路
4. 无 Parallel 节点（首版）
5. 所有条件键为已知键名（基于 §3.3.1 的运算符白名单）
6. 树深度不超过 32

## 六、暂不纳入首版的内容

| 内容 | 原因 |
|------|------|
| Running 状态跨 tick 持久化 | 模拟循环每 tick 重新求值已覆盖；长时行为可用事件驱动循环替代 |
| 并行节点 (Parallel) 的完整实现 | 无状态求值下"并行"语义不清晰（真正并发 vs 顺序求值后合并结果）；首版在加载校验阶段直接拒绝 |
| 跨包子树引用 (`$ref: "other_pack::tree"`) | 需要先解决包间依赖声明和子树版本化问题 |
| 行为树可视化编辑器 | 先验证 YAML 定义的人机工程学，再考虑可视化工具 |
| 运行时动态修改树结构 | 行为树在 pack 加载时编译，运行时不可变。动态性通过条件节点的状态检查实现 |
| 子树宏/参数化 | 先观察 `$ref` 的实际复用模式，再决定是否需要模板参数 |

## 七、与链式行为的关系

行为树的 Sequence 节点天然表达"依次执行多个动作"的语义。首版 Sequence 采用策略 A（仅保留最后一个 DecisionResult），因为同时执行多个动作需要链式行为的基础设施支持。

当链式行为的基础设施就绪后（见 `.limcode/enhancements-backlog.md` §链式行为），Sequence 节点可以升级为策略 B——在同一 tick 内顺序执行多个 ActionIntent。这两个能力是正交的：

- **行为树** 解决"如何做决策"（decision-making 结构）
- **链式行为** 解决"如何执行多个动作"（action execution 管道）
