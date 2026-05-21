# Behavior Tree InferenceProvider / 行为树推理提供者

行为树是 Yidhras 的确定性推理路径之一。它作为 `InferenceProvider` 接入现有 inference pipeline，让 world-pack 作者通过声明式 YAML 表达 NPC / actor 的条件判断、优先级分支和动作选择，而不是把规则硬编码在服务端 TypeScript 中。

本文档说明当前代码中的行为树运行逻辑与限制。公共 HTTP inference contract 见 `../specs/API.md`；推理到执行的业务主线见 `../LOGIC.md`；AI 模型调用路径见 `AI_GATEWAY.md`。

## 1. 定位

行为树 provider 位于：

- `apps/server/src/inference/providers/behavior_tree/provider.ts`
- `apps/server/src/inference/providers/behavior_tree/tree_registry.ts`
- `apps/server/src/inference/providers/behavior_tree/evaluator.ts`
- `apps/server/src/inference/providers/behavior_tree/context_resolver.ts`
- `apps/server/src/inference/providers/behavior_tree/nodes/*`

在 inference pipeline 中，它与 mock / model-routed provider 并列：

```text
buildInferenceContext()
  -> select provider by InferenceStrategy
  -> behavior_tree provider
  -> evaluateTree()
  -> ProviderDecisionRaw
  -> normalizeDecision()
  -> groundDecisionIntent()
  -> ActionIntentDraft
```

行为树 provider 设置为：

```ts
requiresPrompt: false
```

因此普通行为树推理不会构建 Prompt Workflow bundle，也不会调用模型。`service.ts` 在这种路径下把 trace metadata 的 `prompt_version` 记录为 `null`。

## 2. world-pack 配置入口

world-pack 通过两个位置启用行为树。

### 2.1 顶层 `behavior_trees`

pack YAML 顶层可声明树定义：

```yaml
behavior_trees:
  patrol_guard:
    type: selector
    children:
      - condition:
          event_semantic_type: alarm_triggered
        action:
          semantic_intent: investigate_alarm
          reasoning: "Alarm event is visible to this actor"
      - action:
          semantic_intent: patrol
          reasoning: "No urgent event; continue patrol"
```

运行时 `buildInferenceContext()` 会把当前 pack 的 `behavior_trees` 带入 `InferenceContext.world_pack.behavior_trees`。provider 按 pack id 懒加载注册到 `TreeRegistry`，所以同一进程内每个 pack 有独立 registry cache。

### 2.2 actor 级 `inference`

actor 通过 `inference.provider: behavior_tree` 选择行为树，并用 `behavior_tree` 指定树名：

```yaml
entities:
  actors:
    - id: guard_001
      label: Guard 001
      inference:
        provider: behavior_tree
        behavior_tree: patrol_guard
```

`context_builder.ts` 会把该 actor 的策略解析为：

```ts
strategy = 'behavior_tree';
attributes.behavior_tree = inf.behavior_tree;
```

provider 当前优先从 `context.attributes.behavior_tree` 读取树名。

## 3. TreeRegistry：注册、展开与节点路径

`TreeRegistry` 负责：

1. 使用 Zod schema 校验节点结构。
2. 注册 pack 内树定义。
3. 解析同包 `$ref`。
4. 检测 `$ref` 缺失、自引用、循环与展开深度上限。
5. 在 `get()` 时返回展开后的树，并给每个节点分配内部 `__node_path`。

节点路径用于运行期状态隔离。例如 cooldown key 和 probability seed 都依赖节点路径，避免同一棵树内多个装饰器互相污染。

示例路径形态：

```text
patrol_guard
patrol_guard.children[0]
patrol_guard.children[0].child
```

`__node_path` 是内部运行时字段，不是 YAML schema 的公开配置项。

## 4. 求值状态

行为树节点返回：

```ts
type BTStatus = 'success' | 'failure' | 'running';
```

当前实现的主要语义：

- `success`：节点条件满足或动作产出成功。
- `failure`：节点不满足、被 cooldown/probability 阻断，或当前不支持的分支失败。
- `running`：类型预留；当前首版没有跨 tick running 状态持久化。

`evaluateTree()` 每次 provider run 都从根节点重新求值，不保存遍历位置。

## 5. 组合节点

### 5.1 Selector

实现位置：`nodes/composites.ts`

Selector 按顺序求值子节点：

```text
for child in children:
  status = tick(child)
  if status != failure:
    return status
return failure
```

因此 Selector 表达“优先级分支”：前面的分支优先级更高，成功或 running 后不会继续检查后续分支。

### 5.2 Sequence

Sequence 按顺序求值子节点：

```text
for child in children:
  status = tick(child)
  if status != success:
    return status
return success
```

因此 Sequence 表达“全部前置条件必须成立”。当前 registry 限制直接 sequence children 中最多一个 `action` 或 `llm_decision` 叶子，避免多个 action 在同一次 tick 中互相覆盖最终 decision。

## 6. 叶子节点

### 6.1 Condition

条件节点通过 `context_resolver.ts` 从 `InferenceContext.pack_state` 读取值。

当前支持的条件入口包括：

| 条件键 | 数据来源 | 语义 |
|--------|----------|------|
| `state` | `pack_state.actor_state` | 当前 actor 私有状态字段 |
| `has_artifact` | `pack_state.owned_artifacts` | actor 是否持有指定 artifact id |
| `not_has_artifact` | `pack_state.owned_artifacts` | actor 是否未持有指定 artifact id |
| `event_semantic_type` | `pack_state.recent_events` | 最近事件中是否出现指定 semantic type |
| `world_state` | `pack_state.world_state` | pack 级世界状态字段 |
| `ticks_since_event` | `pack_state.recent_events` + `context.tick` | 当前 tick 距最近匹配事件的 tick 差 |
| `in` | `pack_state.actor_roles` | actor 是否拥有指定 role |
| `not_in` | `pack_state.actor_roles` | actor 是否不拥有指定 role |

当前支持的比较操作符包括：

```ts
eq | neq | gt | gte | lt | lte | in | not_in
```

注意：`in` / `not_in` 目前同时存在于条件键与操作符类型中，历史实现存在解析歧义；这一点属于后续 P1 修复范围。编写新树时优先使用已有测试覆盖的条件形式，并通过 `validate:pack` 和行为测试验证。

### 6.2 Action

Action 叶子会构造 `ProviderDecisionRaw` 并写入黑板：

```ts
ctx.blackboard['__last_decision'] = buildDecisionResult(action);
```

动作定义当前支持：

```ts
semantic_intent?: string;
kernel?: string;
proposed_method?: string;
target_ref?: { entity_id: string; kind: string };
reasoning?: string;
desired_effect?: string;
payload?: Record<string, unknown>;
```

最终 `action_type` 取：

```ts
semantic_intent ?? kernel ?? 'unknown'
```

之后仍走统一的 intent grounding / ActionIntentDraft 路径。行为树只决定“想做什么”，是否能落地、如何落地仍由 grounder / dispatcher / enforcement 负责。

### 6.3 LLM Decision

`llm_decision` 当前不支持。

代码中 schema 类型和 evaluator 路由仍保留历史痕迹，但 `TreeRegistry.register()` 当前明确拒绝 `type: llm_decision`。原因是 AI Gateway wiring 尚未实现；如果允许通过，会导致包作者以为可调用 LLM，而运行时实际无法产出模型决策。

因此当前稳定语义是：

```text
行为树首版 = 确定性树，不含 LLM 叶子。
```

## 7. 装饰器

装饰器节点形态：

```yaml
decorators:
  - type: cooldown
    cooldown_ticks: 10
child:
  type: action
  action:
    semantic_intent: publish_update
```

多个装饰器按列表顺序从外到内应用。

### 7.1 Inverter

`inverter` 翻转子节点结果：

- child `success` -> `failure`
- child `failure` -> `success`
- child `running` -> `running`

### 7.2 Cooldown

`cooldown` 在子节点成功后记录当前 tick。在冷却期内直接返回 `failure`，不 tick 子节点。

状态存储在 provider 闭包中的内存 `Map`：

```ts
const cooldownStore = new Map<string, BTCooldownState>();
```

key 粒度：

```text
agent_id::tree_name::node_path
```

如果节点没有经过 `TreeRegistry.get()` 分配路径，则回退为旧粒度：

```text
agent_id::tree_name
```

正常运行时会经过 registry，因此同一棵树内不同 cooldown 节点互不影响。

当前 cooldown 不持久化。进程重启后 cooldown 状态丢失。

### 7.3 Probability

`probability` 使用确定性 hash 模拟概率抽样：

```text
seed = agent_id::tree_name::node_path::tick
roll = hash(seed) % 10000 / 10000
```

如果 `roll >= weight`，节点返回 `failure`；否则 tick 子节点。

由于 seed 包含 node path，同一 actor 同一 tick 内不同 probability 节点不会再共享同一个 roll。

## 8. 空决策语义

`evaluateTree()` 返回 `decision: null` 时，provider 当前会返回一个 `idle` decision：

```ts
action_type: 'idle'
payload: { reason: 'behavior_tree_no_decision' }
confidence: 0
```

也就是说，当前代码没有在 service 层短路“不创建 ActionIntent”。`idle` 仍会进入 normalize / grounder / ActionIntentDraft 流水线。是否进一步把空行为短路，是后续语义修正项。

如果 actor 使用 behavior_tree strategy 但没有配置树名，provider 当前也返回：

```ts
action_type: 'idle'
payload: { reason: 'behavior_tree_no_tree_name' }
```

这与早期计划中“配置错误抛出”的目标不同，属于后续待收敛行为。

## 9. 当前明确限制

当前实现明确不支持：

- `type: parallel`
- `type: llm_decision`
- 跨包 `$ref`，例如 `other_pack::tree`
- Running 状态跨 tick 持久化
- cooldown 状态持久化
- 运行时动态修改树结构
- 子树宏 / 参数化
- Sequence 多 action 链式执行
- 行为树可视化编辑器

这些限制不是推测；其中多项已在 `.limcode/enhancements-backlog.md` 或评审文档中记录为后续增强项。

## 10. 校验与测试入口

### 10.1 pack 校验

CLI 校验入口：

```bash
pnpm --filter yidhras-server validate:pack
```

相关代码：

- `apps/server/src/cli/validate_pack_cli.ts`
- `apps/server/src/inference/providers/behavior_tree/schema.ts`
- `apps/server/src/inference/providers/behavior_tree/tree_registry.ts`

校验覆盖 schema、`$ref` 展开、循环、深度、parallel 拒绝和 sequence action 限制。

### 10.2 测试

行为树相关测试位于：

- `apps/server/tests/unit/behavior_tree_context_resolver.spec.ts`
- `apps/server/tests/unit/behavior_tree_composites.spec.ts`
- `apps/server/tests/unit/behavior_tree_decorators.spec.ts`
- `apps/server/tests/unit/behavior_tree_evaluator.spec.ts`
- `apps/server/tests/unit/behavior_tree_leaves.spec.ts`
- `apps/server/tests/unit/behavior_tree_registry.spec.ts`
- `apps/server/tests/integration/behavior_tree_provider_integration.spec.ts`

可运行：

```bash
pnpm --filter yidhras-server exec vitest run --config vitest.unit.config.ts \
  tests/unit/behavior_tree_decorators.spec.ts \
  tests/unit/behavior_tree_evaluator.spec.ts \
  tests/unit/behavior_tree_registry.spec.ts \
  tests/unit/behavior_tree_context_resolver.spec.ts \
  tests/unit/behavior_tree_composites.spec.ts \
  tests/unit/behavior_tree_leaves.spec.ts

pnpm --filter yidhras-server exec vitest run --config vitest.integration.config.ts \
  tests/integration/behavior_tree_provider_integration.spec.ts
```

## 11. 与 AI Gateway 的关系

当前行为树 provider 不走 AI Gateway。它产生的是确定性 `ProviderDecisionRaw`。

AI Gateway 文档负责说明模型调用路径、provider adapters、routing、tool loop 和 invocation observability；行为树文档只说明 deterministic provider 的配置、注册和求值语义。

后续如果重新启用 `llm_decision`，需要明确接入 AI Gateway / AiTaskService，并补充：

- LLM 叶子的 prompt 构建方式
- route/model 决策来源
- `AiInvocationRecord` 关联方式
- tool calling 是否允许
- 行为树 trace 与 AI invocation trace 的关联方式
