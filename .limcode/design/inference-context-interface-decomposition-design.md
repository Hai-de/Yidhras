# InferenceContext 接口拆分设计

> 状态：设计完成，类型定义已写入代码（不改变运行时行为）
>
> 来源：核心链路结构性问题清单 Issue 6-8

---

## 1. 动机

`InferenceContext` 当前持有 21 个字段，承载了角色解析（actor resolution）、Pack 状态检索（pack state resolution）、Prompt 渲染（prompt rendering）、推理调度（inference dispatch）四类职责。单个巨型接口导致：

1. **隐式耦合**：消费者只需 3-5 个字段却依赖了整个 21 字段结构体，模块间形成不必要的耦合。
2. **测试困难**：构造最小 Prompt 渲染测试需要填充所有 21 个字段。
3. **扩容阻力**：新增字段时无法判断影响范围。

P2-A 已引入 `PromptResolvableContext` 作为最小 Prompt 路径，但它是扁平的 14 字段接口，未按语义分组。本轮（P2-B）将其进一步拆分为语义子接口，为后续渐进式迁移建立类型基础。

---

## 2. 字段-消费方矩阵

### 2.1 ActorResolvable（角色解析层）

| 字段 | 类型 | 消费方 |
|---|---|---|
| `actor_ref` | `InferenceActorRef` | task_prompt_builder, prompt_builder, providers (mock/rule_based), service, workflow/runtime, context_assembler, intent_grounder |
| `actor_display_name` | `string` | task_prompt_builder, prompt_builder, providers (mock/rule_based) |
| `identity` | `IdentityContext` | prompt_builder, context_assembler, variable_context |
| `binding_ref` | `InferenceBindingRef \| null` | task_prompt_builder, prompt_builder (条件性), context_assembler, service |
| `resolved_agent_id` | `string \| null` | prompt_builder, providers (fallback), intent_grounder, context_assembler |
| `agent_snapshot` | `InferenceAgentSnapshot \| null` | prompt_builder (payload), transmission_profile 计算 |

### 2.2 PackStateResolvable（Pack 状态与运行时合约层）

| 字段 | 类型 | 消费方 |
|---|---|---|
| `pack_state` | `InferencePackStateSnapshot` | task_prompt_builder, prompt_builder, rule_based provider, context_assembler, compaction_service |
| `pack_runtime` | `InferencePackRuntimeContract` | intent_grounder (invocation_rules), context_assembler |
| `world_pack` | `InferenceWorldPackRef` | task_prompt_builder, prompt_builder, providers, service, workflow/runtime, intent_grounder, context_assembler |

### 2.3 PromptResolvableContext（Prompt 渲染最小集）

继承 ActorResolvable + PackStateResolvable，添加 Prompt 特有字段：

| 字段 | 类型 | 消费方 |
|---|---|---|
| `tick` | `bigint` | prompt_builder, service |
| `strategy` | `InferenceStrategy` | task_prompt_builder, prompt_builder, service, workflow/runtime |
| `attributes` | `Record<string, unknown>` | task_prompt_builder, prompt_builder, providers (mock 属性) |
| `world_prompts` | `Record<string, string>` | prompt_builder (global_prefix, agent_initial_context) |
| `variable_context` | `PromptVariableContext` | prompt_builder (renderNarrativeTemplate) |
| `variable_context_summary` | `PromptVariableContextSummary` | prompt_builder (payload) |
| `context_run` | `ContextRun \| null` | prompt_builder (条件读写), workflow/runtime (读写) |
| `memory_context` | `MemoryContextPack \| null` | prompt_builder, workflow/runtime (读写), compaction |

### 2.4 InferenceContext 独有字段（推理调度层）

| 字段 | 类型 | 消费方 |
|---|---|---|
| `inference_id` | `string` | task_prompt_builder, service (trace/result), compaction |
| `world_ai` | `WorldPackAiConfig \| null` | gateway_backed, rule_based, compaction |
| `visible_variables` | `VariablePool` | prompt_builder (条件性) |
| `policy_summary` | `InferencePolicySummary` | prompt_builder (条件性), rule_based provider |
| `transmission_profile` | `InferenceTransmissionProfile` | providers (mock/rule_based) |

---

## 3. 子接口定义

```typescript
/**
 * Subset of InferenceContext fields needed to resolve the acting identity/agent.
 * Consumers: resolveActor(), intent_grounder, context_assembler, compaction_service.
 */
interface ActorResolvable {
  actor_ref: InferenceActorRef;
  actor_display_name: string;
  identity: IdentityContext;
  binding_ref: InferenceBindingRef | null;
  resolved_agent_id: string | null;
  agent_snapshot: InferenceAgentSnapshot | null;
}

/**
 * Subset of InferenceContext fields needed to resolve pack-level state and runtime contracts.
 * Consumers: context_assembler, intent_grounder, rule_based provider.
 */
interface PackStateResolvable {
  pack_state: InferencePackStateSnapshot;
  pack_runtime: InferencePackRuntimeContract;
  world_pack: InferenceWorldPackRef;
}

/**
 * Minimum context required to render a prompt bundle.
 * Extends ActorResolvable + PackStateResolvable with prompt-specific fields.
 * `context_run` and `memory_context` are nullable to support partial (non-inference) usage.
 */
interface PromptResolvableContext extends ActorResolvable, PackStateResolvable {
  tick: bigint;
  strategy: InferenceStrategy;
  attributes: Record<string, unknown>;
  world_prompts: Record<string, string>;
  variable_context: PromptVariableContext;
  variable_context_summary: PromptVariableContextSummary;
  context_run: ContextRun | null;
  memory_context: MemoryContextPack | null;
}

interface InferenceContext extends PromptResolvableContext {
  inference_id: string;
  world_ai?: WorldPackAiConfig | null;
  visible_variables: VariablePool;
  policy_summary: InferencePolicySummary;
  transmission_profile: InferenceTransmissionProfile;
  context_run: ContextRun;        // override: non-null
  memory_context: MemoryContextPack;  // override: non-null
  pack_runtime: InferencePackRuntimeContract;  // override: non-null (via PackStateResolvable)
}
```

---

## 4. 继承层次

```
ActorResolvable (6 fields)
PackStateResolvable (3 fields)
    └── PromptResolvableContext (extends both, +8 fields)
            └── InferenceContext (extends PromptResolvableContext, +5 fields, 3 overrides)
```

字段计算：
- ActorResolvable: 6
- PackStateResolvable: 3
- PromptResolvableContext: 6 + 3 + 8 = 17
- InferenceContext: 17 + 5 (new) + 3 (override from nullable to non-null) = 21 字段（与重构前一致）

---

## 5. 迁移路径

### 5.1 当前状态（P2-B 完成后）

- `ActorResolvable` 和 `PackStateResolvable` 类型定义已写入 `inference/types.ts`
- `PromptResolvableContext` 已重构为 `extends ActorResolvable, PackStateResolvable`
- `InferenceContext` 继承关系不变
- **运行时行为完全不变**：所有消费者仍使用 `InferenceContext` 或 `PromptResolvableContext`
- `prompt_builder.ts` 的 `PromptContext = InferenceContext | PromptResolvableContext` 联合类型不变

### 5.2 后续渐进迁移

| 阶段 | 变更 | 风险 |
|---|---|---|
| Phase A | 消费方函数签名从 `(context: InferenceContext)` 改为 `(context: ActorResolvable)` 等窄接口 | 低 — TypeScript structural typing 保证兼容 |
| Phase B | `resolveActor()` 返回 `ActorResolvable` 而非完整 `InferenceContext` 子集 | 低 — 调用方按需解构 |
| Phase C | `buildPackStateSnapshot()` 返回 `PackStateResolvable` 而非完整 `InferencePackStateSnapshot` | 低 — 接口兼容 |
| Phase D | `context_assembler` 输入从完整 `InferenceContext` 收窄为 `ActorResolvable & PackStateResolvable` | 中 — 需验证所有子属性是否可从窄接口获取 |

每个阶段都应该在单次 PR 中完成，附带对应的类型收窄测试。

### 5.3 不在迁移范围内的变更

- 不将 `InferenceContext` 拆分为多个独立参数传递（函数签名爆炸）
- 不引入 `Pick<InferenceContext, ...>` 硬编码字段选择器（脆弱、难以重构）
- 不改变 `InferenceProvider.run(context: InferenceContext)` 接口（Provider 需要完整上下文）

---

## 6. 依赖关系图

```
                    ┌─────────────────┐
                    │ InferenceContext │
                    │ (21 fields)     │
                    └────────┬────────┘
                             │ extends
                    ┌────────┴────────┐
                    │ PromptResolvable│
                    │ Context (17)     │
                    └────────┬────────┘
                             │ extends
               ┌─────────────┼─────────────┐
               │                           │
    ┌──────────┴──────────┐  ┌─────────────┴──────────┐
    │ ActorResolvable (6) │  │ PackStateResolvable (3) │
    └─────────────────────┘  └────────────────────────┘
```

---

## 7. 验收标准

- [x] `ActorResolvable` 接口已定义，包含 6 个字段
- [x] `PackStateResolvable` 接口已定义，包含 3 个字段
- [x] `PromptResolvableContext` 重构为 `extends ActorResolvable, PackStateResolvable`
- [x] `InferenceContext` 继承关系不变，总 21 字段不变
- [x] Typecheck 通过（仅预存错误）
- [x] 设计文档归档于 `.limcode/design/`
- [ ] 主路径代码仍使用 `InferenceContext` 完整类型（**设计阶段不改变**）