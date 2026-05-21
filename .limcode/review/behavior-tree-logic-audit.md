# 行为树逻辑断裂与盲点评审
- 日期: 2026-05-21
- 概述: 行为树当前实现的逻辑断裂与盲点评审，基于实际代码、计划文档和设计文档核对。
- 状态: 进行中
- 总体结论: 待定

## 评审范围

# 行为树逻辑断裂与盲点评审

## 范围

本评审基于以下实际材料：

- `.limcode/plans/behavior-tree-implementation.md`
- `.limcode/archive/design/behavior-tree-design.md`
- `apps/server/src/inference/providers/behavior_tree/*`
- `apps/server/src/inference/service.ts`
- `apps/server/src/inference/context_builder.ts`
- `apps/server/src/app/composition/inference.ts`
- `apps/server/src/cli/validate_pack_cli.ts`
- `apps/server/src/packs/schema/constitution_schema.ts`
- 行为树相关 unit/integration tests

## 总体结论

当前行为树已经具备最小 evaluator、schema、provider、actor inference 配置解析与 CLI 校验，但尚未达到“可完整用于 world pack 运行时”的状态。

主要断裂集中在三类：

1. 运行时接入断裂：pack 中的 `behavior_trees` 没有注册到实际 provider 使用的 `TreeRegistry`。
2. 推理主线断裂：`requiresPrompt: false` 后，`service.ts` 仍无条件访问 `prompt.metadata.prompt_version`。
3. 语义暴露过度：`llm_decision` 在 schema/evaluator 中开放，但运行时实现永远返回 `failure`。

## 发现项

### F-001：运行时没有把 pack 的 `behavior_trees` 注册进 provider

**严重度：高**

代码位置：

- `apps/server/src/app/composition/inference.ts`
- `apps/server/src/cli/validate_pack_cli.ts`
- `apps/server/src/inference/context_builder.ts`

当前 `createInferenceProviders()` 创建的是空 registry：

```ts
const treeRegistry = new TreeRegistry('global');
```

`validate_pack_cli.ts` 只在校验阶段临时注册树，运行时没有复用。

`context_builder.ts` 会把 actor 的 `inference.provider === 'behavior_tree'` 解析为：

```ts
strategy = 'behavior_tree';
attributes.behavior_tree = inf.behavior_tree;
```

但 provider 运行时调用：

```ts
const treeDef = treeRegistry.get(treeName);
```

如果 registry 没有运行时注册该 pack 的树，会抛出 `Tree "xxx" not found in pack "global"`。

**结论：**行为树 actor 配置解析已接入，但树定义运行时装载未接入。

---

### F-002：`requiresPrompt: false` 与 `service.ts` trace metadata 冲突

**严重度：高**

代码位置：

- `apps/server/src/inference/service.ts`
- `apps/server/src/inference/providers/behavior_tree/provider.ts`

`service.ts` 在 provider 不需要 prompt 时传入 `null`：

```ts
const prompt = provider.requiresPrompt
  ? (await buildWorkflowPromptBundle(...)).bundle
  : (null as any);
```

但后续无条件访问：

```ts
prompt.metadata.prompt_version
```

行为树 provider 设置：

```ts
requiresPrompt: false
```

**结论：**行为树 provider 成功返回 decision 后，trace metadata 构建阶段存在空指针崩溃。

---

### F-003：`llm_decision` 对外可配置，但运行时永远失败

**严重度：高**

代码位置：

- `apps/server/src/inference/providers/behavior_tree/schema.ts`
- `apps/server/src/inference/providers/behavior_tree/evaluator.ts`
- `apps/server/src/inference/providers/behavior_tree/nodes/leaves.ts`

schema 允许：

```ts
type: z.enum(['selector', 'sequence', 'condition', 'action', 'llm_decision'])
```

evaluator 会路由到：

```ts
return tickLLMDecision(llmDef, ctx);
```

但实现是 stub：

```ts
export async function tickLLMDecision(...): Promise<BTStatus> {
  // Stub: Phase 6 wires AI Gateway
  return 'failure';
}
```

**结论：**`llm_decision` 当前是误导性能力。包作者可写，校验可过，但运行时不会触发 LLM。

---

### F-004：行为树 trace 只记录根节点，不记录完整遍历

**严重度：中**

代码位置：

- `apps/server/src/inference/providers/behavior_tree/evaluator.ts`
- `apps/server/src/inference/providers/behavior_tree/nodes/composites.ts`
- `apps/server/src/inference/providers/behavior_tree/nodes/decorators.ts`

`evaluateTree()` 只对根节点调用 `tickWithTrace()`。组合节点、装饰器内部调用普通 `tick()`，不会记录 child trace。

**结论：**trace 类型表达了完整遍历记录，但实际只有根节点，无法支持调试 selector/sequence 分支命中过程。

---

### F-005：cooldown key 不包含节点路径，同树多个 cooldown 会互相污染

**严重度：高**

代码位置：

- `apps/server/src/inference/providers/behavior_tree/nodes/decorators.ts`

当前 key：

```ts
return `${agentId}::${treeName}`;
```

设计要求 key 粒度为 `(agent_id, tree_name, 节点路径)`。

**结论：**同一 agent 的同一棵树内，任意 cooldown 成功会影响整棵树其他 cooldown 装饰器。

---

### F-006：probability 随机种子不含节点路径，多个概率节点同 tick 完全相关

**严重度：中**

代码位置：

- `apps/server/src/inference/providers/behavior_tree/nodes/decorators.ts`

当前 seed：

```ts
const seed = `${ctx.inferenceContext.actor_ref?.agent_id ?? 'unknown'}_${ctx.inferenceContext.tick}`;
```

不包含 tree name / node path。

**结论：**同一 agent 同一 tick 内所有 probability 装饰器共享同一个 roll。

---

### F-007：condition schema 未真正约束条件键白名单

**严重度：中**

代码位置：

- `apps/server/src/inference/providers/behavior_tree/schema.ts`
- `apps/server/src/inference/providers/behavior_tree/context_resolver.ts`

schema 使用：

```ts
z.record(z.string(), btConditionScalarSchema)
```

任意 key 都可通过 schema。拼错条件键只会在运行时静默失败。

**结论：**计划中的“条件表达式校验（运算符白名单、类型检查）”未完整落地。

---

### F-008：复合条件同时存在 `all` 和 `any` 时，`any` 被忽略

**严重度：中**

代码位置：

- `apps/server/src/inference/providers/behavior_tree/schema.ts`
- `apps/server/src/inference/providers/behavior_tree/context_resolver.ts`

schema 允许：

```yaml
condition:
  all: [...]
  any: [...]
```

运行时优先处理 `all`：

```ts
if (cond.all) return cond.all.every(...);
if (cond.any) return cond.any.some(...);
```

**结论：**schema 与 evaluator 语义不一致。

---

### F-009：`ticks_since_event` 的 null 语义与测试注释矛盾

**严重度：低**

代码位置：

- `apps/server/src/inference/providers/behavior_tree/context_resolver.ts`
- `apps/server/tests/unit/behavior_tree_context_resolver.spec.ts`

实现中事件不存在返回 `null`，随后 evaluate condition 直接 false。

测试注释写：

```ts
// null signals "never occurred" → treated as +∞
```

**结论：**当前并未把 never occurred 作为 `+∞` 处理。

---

### F-010：Sequence 多 action 校验不能覆盖装饰器和 `$ref` 后的 action

**严重度：中**

代码位置：

- `apps/server/src/inference/providers/behavior_tree/tree_registry.ts`

当前只统计直接 child：

```ts
(c) => c.type === 'action' || c.type === 'llm_decision'
```

不覆盖：

- decorated action
- `$ref` 展开后的 action
- 子树中实际会写入 `__last_decision` 的节点

**结论：**sequence 多 action 仍可能出现，后一个 action 会覆盖前一个 action。

---

### F-011：`in` / `not_in` 同时作为 condition key 和 operator，解析歧义导致 role condition 不可用

**严重度：中**

代码位置：

- `apps/server/src/inference/providers/behavior_tree/types.ts`
- `apps/server/src/inference/providers/behavior_tree/context_resolver.ts`

`in` / `not_in` 同时出现在：

```ts
BTConditionOperator
BTConditionKey
```

解析 condition key 时会过滤 operators：

```ts
const conditionKey = keys.find((k) => !OPERATORS.includes(k as BTConditionOperator));
```

所以：

```yaml
condition:
  in: investigator
```

找不到 condition key，直接 false。

**结论：**role membership 条件当前不可用。

---

### F-012：缺树配置返回 idle，和计划“配置错误抛出”不一致

**严重度：中**

代码位置：

- `apps/server/src/inference/providers/behavior_tree/provider.ts`
- `.limcode/plans/behavior-tree-implementation.md`

计划要求 actor 未绑定行为树时抛配置错误。实际返回：

```ts
action_type: 'idle'
payload: { reason: 'behavior_tree_no_tree_name' }
```

**结论：**配置错误被吞成正常 idle，不利于暴露 pack 配置问题。

---

### F-013：空决策被转换成 `idle` 后仍进入 grounder / ActionIntent 流水线

**严重度：中**

代码位置：

- `apps/server/src/inference/providers/behavior_tree/provider.ts`
- `apps/server/src/inference/service.ts`

行为树根节点 failure 后 provider 返回 `idle` decision。`service.ts` 后续仍会执行：

```ts
const grounded = await groundDecisionIntent(...);
const actionIntentDraft = service.buildActionIntentDraft(...);
```

**结论：**当前没有真正表达“不创建 ActionIntent”的空决策语义。

---

### F-014：pack 校验未确认 actor 引用的 behavior tree 是否存在

**严重度：中**

代码位置：

- `apps/server/src/cli/validate_pack_cli.ts`
- `apps/server/src/packs/schema/constitution_schema.ts`

当前行为树校验检查 `behavior_trees` 本体，但未从 actor inference 配置反查 `behavior_tree` 名称是否存在于 `behavior_trees`。

**结论：**actor 引用错树名可能无法在 validate_pack 阶段暴露。

## 建议处理顺序

### P0

1. 修复 `requiresPrompt: false` 下 `service.ts` 的 `prompt.metadata` 空指针。
2. 接通运行时 `behavior_trees` 注册，确保 provider 使用当前 pack 的树定义。
3. 对 `llm_decision` 做明确决策：暂时禁止并在 schema/校验阶段报错，或立即接入 AI Gateway。
4. 修复 cooldown key 粒度，至少包含稳定节点路径。

### P1

1. 修复 trace 只能记录根节点的问题。
2. 修复 `in` / `not_in` 解析歧义。
3. 强化 condition schema 白名单。
4. 修复 `all` / `any` 同时存在的语义。
5. 校验 actor 引用树名。

### P2

1. 明确空决策是否应短路 ActionIntent 创建。
2. 明确 `ticks_since_event` 的 never occurred 语义。
3. 强化 sequence 多 action 校验覆盖 decorated / `$ref` 情况。
4. probability seed 增加节点路径，消除同 tick 多节点完全相关。

## 评审摘要

- 当前状态: 进行中
- 已审模块: 待定
- 当前进度: 已记录 0 个里程碑
- 里程碑总数: 0
- 已完成里程碑: 0
- 问题总数: 0
- 问题严重级别分布: 高 0 / 中 0 / 低 0
- 最新结论: 待定
- 下一步建议: 待定
- 总体结论: 待定

## 评审发现

<!-- no findings -->

## 评审里程碑

<!-- no milestones -->

## 最终结论

_最终结论待补充。_

## 评审快照

```json
{
  "formatVersion": 4,
  "kind": "limcode.review",
  "reviewRunId": "review-mpfost38-57q4yn",
  "createdAt": "2026-05-21T00:00:00.000Z",
  "updatedAt": "2026-05-21T00:00:00.000Z",
  "finalizedAt": null,
  "status": "in_progress",
  "overallDecision": null,
  "header": {
    "title": "行为树逻辑断裂与盲点评审",
    "date": "2026-05-21",
    "overview": "行为树当前实现的逻辑断裂与盲点评审，基于实际代码、计划文档和设计文档核对。"
  },
  "scope": {
    "markdown": "# 行为树逻辑断裂与盲点评审\n\n## 范围\n\n本评审基于以下实际材料：\n\n- `.limcode/plans/behavior-tree-implementation.md`\n- `.limcode/archive/design/behavior-tree-design.md`\n- `apps/server/src/inference/providers/behavior_tree/*`\n- `apps/server/src/inference/service.ts`\n- `apps/server/src/inference/context_builder.ts`\n- `apps/server/src/app/composition/inference.ts`\n- `apps/server/src/cli/validate_pack_cli.ts`\n- `apps/server/src/packs/schema/constitution_schema.ts`\n- 行为树相关 unit/integration tests\n\n## 总体结论\n\n当前行为树已经具备最小 evaluator、schema、provider、actor inference 配置解析与 CLI 校验，但尚未达到“可完整用于 world pack 运行时”的状态。\n\n主要断裂集中在三类：\n\n1. 运行时接入断裂：pack 中的 `behavior_trees` 没有注册到实际 provider 使用的 `TreeRegistry`。\n2. 推理主线断裂：`requiresPrompt: false` 后，`service.ts` 仍无条件访问 `prompt.metadata.prompt_version`。\n3. 语义暴露过度：`llm_decision` 在 schema/evaluator 中开放，但运行时实现永远返回 `failure`。\n\n## 发现项\n\n### F-001：运行时没有把 pack 的 `behavior_trees` 注册进 provider\n\n**严重度：高**\n\n代码位置：\n\n- `apps/server/src/app/composition/inference.ts`\n- `apps/server/src/cli/validate_pack_cli.ts`\n- `apps/server/src/inference/context_builder.ts`\n\n当前 `createInferenceProviders()` 创建的是空 registry：\n\n```ts\nconst treeRegistry = new TreeRegistry('global');\n```\n\n`validate_pack_cli.ts` 只在校验阶段临时注册树，运行时没有复用。\n\n`context_builder.ts` 会把 actor 的 `inference.provider === 'behavior_tree'` 解析为：\n\n```ts\nstrategy = 'behavior_tree';\nattributes.behavior_tree = inf.behavior_tree;\n```\n\n但 provider 运行时调用：\n\n```ts\nconst treeDef = treeRegistry.get(treeName);\n```\n\n如果 registry 没有运行时注册该 pack 的树，会抛出 `Tree \"xxx\" not found in pack \"global\"`。\n\n**结论：**行为树 actor 配置解析已接入，但树定义运行时装载未接入。\n\n---\n\n### F-002：`requiresPrompt: false` 与 `service.ts` trace metadata 冲突\n\n**严重度：高**\n\n代码位置：\n\n- `apps/server/src/inference/service.ts`\n- `apps/server/src/inference/providers/behavior_tree/provider.ts`\n\n`service.ts` 在 provider 不需要 prompt 时传入 `null`：\n\n```ts\nconst prompt = provider.requiresPrompt\n  ? (await buildWorkflowPromptBundle(...)).bundle\n  : (null as any);\n```\n\n但后续无条件访问：\n\n```ts\nprompt.metadata.prompt_version\n```\n\n行为树 provider 设置：\n\n```ts\nrequiresPrompt: false\n```\n\n**结论：**行为树 provider 成功返回 decision 后，trace metadata 构建阶段存在空指针崩溃。\n\n---\n\n### F-003：`llm_decision` 对外可配置，但运行时永远失败\n\n**严重度：高**\n\n代码位置：\n\n- `apps/server/src/inference/providers/behavior_tree/schema.ts`\n- `apps/server/src/inference/providers/behavior_tree/evaluator.ts`\n- `apps/server/src/inference/providers/behavior_tree/nodes/leaves.ts`\n\nschema 允许：\n\n```ts\ntype: z.enum(['selector', 'sequence', 'condition', 'action', 'llm_decision'])\n```\n\nevaluator 会路由到：\n\n```ts\nreturn tickLLMDecision(llmDef, ctx);\n```\n\n但实现是 stub：\n\n```ts\nexport async function tickLLMDecision(...): Promise<BTStatus> {\n  // Stub: Phase 6 wires AI Gateway\n  return 'failure';\n}\n```\n\n**结论：**`llm_decision` 当前是误导性能力。包作者可写，校验可过，但运行时不会触发 LLM。\n\n---\n\n### F-004：行为树 trace 只记录根节点，不记录完整遍历\n\n**严重度：中**\n\n代码位置：\n\n- `apps/server/src/inference/providers/behavior_tree/evaluator.ts`\n- `apps/server/src/inference/providers/behavior_tree/nodes/composites.ts`\n- `apps/server/src/inference/providers/behavior_tree/nodes/decorators.ts`\n\n`evaluateTree()` 只对根节点调用 `tickWithTrace()`。组合节点、装饰器内部调用普通 `tick()`，不会记录 child trace。\n\n**结论：**trace 类型表达了完整遍历记录，但实际只有根节点，无法支持调试 selector/sequence 分支命中过程。\n\n---\n\n### F-005：cooldown key 不包含节点路径，同树多个 cooldown 会互相污染\n\n**严重度：高**\n\n代码位置：\n\n- `apps/server/src/inference/providers/behavior_tree/nodes/decorators.ts`\n\n当前 key：\n\n```ts\nreturn `${agentId}::${treeName}`;\n```\n\n设计要求 key 粒度为 `(agent_id, tree_name, 节点路径)`。\n\n**结论：**同一 agent 的同一棵树内，任意 cooldown 成功会影响整棵树其他 cooldown 装饰器。\n\n---\n\n### F-006：probability 随机种子不含节点路径，多个概率节点同 tick 完全相关\n\n**严重度：中**\n\n代码位置：\n\n- `apps/server/src/inference/providers/behavior_tree/nodes/decorators.ts`\n\n当前 seed：\n\n```ts\nconst seed = `${ctx.inferenceContext.actor_ref?.agent_id ?? 'unknown'}_${ctx.inferenceContext.tick}`;\n```\n\n不包含 tree name / node path。\n\n**结论：**同一 agent 同一 tick 内所有 probability 装饰器共享同一个 roll。\n\n---\n\n### F-007：condition schema 未真正约束条件键白名单\n\n**严重度：中**\n\n代码位置：\n\n- `apps/server/src/inference/providers/behavior_tree/schema.ts`\n- `apps/server/src/inference/providers/behavior_tree/context_resolver.ts`\n\nschema 使用：\n\n```ts\nz.record(z.string(), btConditionScalarSchema)\n```\n\n任意 key 都可通过 schema。拼错条件键只会在运行时静默失败。\n\n**结论：**计划中的“条件表达式校验（运算符白名单、类型检查）”未完整落地。\n\n---\n\n### F-008：复合条件同时存在 `all` 和 `any` 时，`any` 被忽略\n\n**严重度：中**\n\n代码位置：\n\n- `apps/server/src/inference/providers/behavior_tree/schema.ts`\n- `apps/server/src/inference/providers/behavior_tree/context_resolver.ts`\n\nschema 允许：\n\n```yaml\ncondition:\n  all: [...]\n  any: [...]\n```\n\n运行时优先处理 `all`：\n\n```ts\nif (cond.all) return cond.all.every(...);\nif (cond.any) return cond.any.some(...);\n```\n\n**结论：**schema 与 evaluator 语义不一致。\n\n---\n\n### F-009：`ticks_since_event` 的 null 语义与测试注释矛盾\n\n**严重度：低**\n\n代码位置：\n\n- `apps/server/src/inference/providers/behavior_tree/context_resolver.ts`\n- `apps/server/tests/unit/behavior_tree_context_resolver.spec.ts`\n\n实现中事件不存在返回 `null`，随后 evaluate condition 直接 false。\n\n测试注释写：\n\n```ts\n// null signals \"never occurred\" → treated as +∞\n```\n\n**结论：**当前并未把 never occurred 作为 `+∞` 处理。\n\n---\n\n### F-010：Sequence 多 action 校验不能覆盖装饰器和 `$ref` 后的 action\n\n**严重度：中**\n\n代码位置：\n\n- `apps/server/src/inference/providers/behavior_tree/tree_registry.ts`\n\n当前只统计直接 child：\n\n```ts\n(c) => c.type === 'action' || c.type === 'llm_decision'\n```\n\n不覆盖：\n\n- decorated action\n- `$ref` 展开后的 action\n- 子树中实际会写入 `__last_decision` 的节点\n\n**结论：**sequence 多 action 仍可能出现，后一个 action 会覆盖前一个 action。\n\n---\n\n### F-011：`in` / `not_in` 同时作为 condition key 和 operator，解析歧义导致 role condition 不可用\n\n**严重度：中**\n\n代码位置：\n\n- `apps/server/src/inference/providers/behavior_tree/types.ts`\n- `apps/server/src/inference/providers/behavior_tree/context_resolver.ts`\n\n`in` / `not_in` 同时出现在：\n\n```ts\nBTConditionOperator\nBTConditionKey\n```\n\n解析 condition key 时会过滤 operators：\n\n```ts\nconst conditionKey = keys.find((k) => !OPERATORS.includes(k as BTConditionOperator));\n```\n\n所以：\n\n```yaml\ncondition:\n  in: investigator\n```\n\n找不到 condition key，直接 false。\n\n**结论：**role membership 条件当前不可用。\n\n---\n\n### F-012：缺树配置返回 idle，和计划“配置错误抛出”不一致\n\n**严重度：中**\n\n代码位置：\n\n- `apps/server/src/inference/providers/behavior_tree/provider.ts`\n- `.limcode/plans/behavior-tree-implementation.md`\n\n计划要求 actor 未绑定行为树时抛配置错误。实际返回：\n\n```ts\naction_type: 'idle'\npayload: { reason: 'behavior_tree_no_tree_name' }\n```\n\n**结论：**配置错误被吞成正常 idle，不利于暴露 pack 配置问题。\n\n---\n\n### F-013：空决策被转换成 `idle` 后仍进入 grounder / ActionIntent 流水线\n\n**严重度：中**\n\n代码位置：\n\n- `apps/server/src/inference/providers/behavior_tree/provider.ts`\n- `apps/server/src/inference/service.ts`\n\n行为树根节点 failure 后 provider 返回 `idle` decision。`service.ts` 后续仍会执行：\n\n```ts\nconst grounded = await groundDecisionIntent(...);\nconst actionIntentDraft = service.buildActionIntentDraft(...);\n```\n\n**结论：**当前没有真正表达“不创建 ActionIntent”的空决策语义。\n\n---\n\n### F-014：pack 校验未确认 actor 引用的 behavior tree 是否存在\n\n**严重度：中**\n\n代码位置：\n\n- `apps/server/src/cli/validate_pack_cli.ts`\n- `apps/server/src/packs/schema/constitution_schema.ts`\n\n当前行为树校验检查 `behavior_trees` 本体，但未从 actor inference 配置反查 `behavior_tree` 名称是否存在于 `behavior_trees`。\n\n**结论：**actor 引用错树名可能无法在 validate_pack 阶段暴露。\n\n## 建议处理顺序\n\n### P0\n\n1. 修复 `requiresPrompt: false` 下 `service.ts` 的 `prompt.metadata` 空指针。\n2. 接通运行时 `behavior_trees` 注册，确保 provider 使用当前 pack 的树定义。\n3. 对 `llm_decision` 做明确决策：暂时禁止并在 schema/校验阶段报错，或立即接入 AI Gateway。\n4. 修复 cooldown key 粒度，至少包含稳定节点路径。\n\n### P1\n\n1. 修复 trace 只能记录根节点的问题。\n2. 修复 `in` / `not_in` 解析歧义。\n3. 强化 condition schema 白名单。\n4. 修复 `all` / `any` 同时存在的语义。\n5. 校验 actor 引用树名。\n\n### P2\n\n1. 明确空决策是否应短路 ActionIntent 创建。\n2. 明确 `ticks_since_event` 的 never occurred 语义。\n3. 强化 sequence 多 action 校验覆盖 decorated / `$ref` 情况。\n4. probability seed 增加节点路径，消除同 tick 多节点完全相关。"
  },
  "summary": {
    "latestConclusion": null,
    "recommendedNextAction": null,
    "reviewedModules": []
  },
  "stats": {
    "totalMilestones": 0,
    "completedMilestones": 0,
    "totalFindings": 0,
    "severity": {
      "high": 0,
      "medium": 0,
      "low": 0
    }
  },
  "milestones": [],
  "findings": [],
  "render": {
    "rendererVersion": 4,
    "bodyHash": "sha256:42d2db2839516e6286dfff5cdcaa6a7e3f5274ec3548c1dabb8513b51f42bb69",
    "generatedAt": "2026-05-21T00:00:00.000Z",
    "locale": "zh-CN"
  }
}
```
