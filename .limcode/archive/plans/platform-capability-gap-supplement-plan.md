# 平台通用能力补充 — 实施计划

> 基于: `.limcode/design/platform-capability-gap-supplement.md`
> 范围: P0 三项（动态 authority、variables 在规则中引用、projection 规则）
> 原则: 测试和接口定义先行

---

## 零、架构前置发现

在追踪代码路径时发现以下关键架构事实，直接影响实施方案：

### 0.1 两条独立的 delta/mutation 管线

| 管线 | 位置 | 触发时机 | 消费的 delta 类型 |
|------|------|---------|------------------|
| World engine step 管线 | `world_engine_persistence.ts:166-282` | step 2（Rust 边车返回后） | `WorldStateDeltaOperation`（7 种 op） |
| Enforcement 管线 | `enforcement_engine.ts:315-324` | step 5（action dispatch 时） | `ObjectiveMutationEffect`（仅 entity state） |

**两条管线互不连通。** Step 管线定义了 7 种 op（`upsert_world_entity`、`upsert_entity_state`、`put_mediator_binding`、`put_authority_grant`、`append_rule_execution`、`set_clock`、`custom`），但 switch 只实现了 3 种（`upsert_entity_state`、`append_rule_execution`、`set_clock`），其余 4 种走 `default: break` 静默丢弃。Enforcement 管线根本没有 authority grant 的概念。

### 0.2 规则匹配的实际执行者是 Rust 边车

`objective_rule_resolver.ts` 的 `resolveObjectiveRulePlan()` 导出但**全代码库零外部调用者**。生产路径是：

```
enforcement_engine.ts:301-310
  → buildSidecarObjectiveExecutionRequest() → 发送到 Rust sidecar
  → Rust sidecar 做 when/then 匹配
  → toObjectiveRulePlanFromSidecarResult() → 返回 plan
  → applyMutationEffect() → upsertPackEntityState() 逐条写 DB
```

这意味着**所有 `when`/`then` 的修改都需要在 Rust 边车侧配合**，或者将匹配逻辑迁回 TS 侧。

### 0.3 `authority_grants` 表的 `status` / `revocable` 字段从未被读取

`authority/resolver.ts:155-188` 的主循环不检查 `status` 或 `revocable`。即使写入 `status: "revoked"`，resolver 仍然会匹配并返回该 grant。

---

## 一、P0-1: 动态 authority 变更

### 1.1 问题

`put_authority_grant` delta op 已定义但全代码库零产出。运行时无法授予或撤销 authority grant。Enforcement 管线甚至不支持 authority grant 类型的 mutation。

### 1.2 接口定义（先写）

#### 1.2.1 新增 enforcement 管线 mutation 类型

```typescript
// 当前定义位置:
//   TS 侧: apps/server/src/domain/rule/objective_rule_resolver.ts:8-12 (interface)
//   contracts 侧: packages/contracts/src/world_engine.ts:387-391 (zod schema)
// enforcement_engine.ts 的 applyMutationEffect 消费该类型

// 现有（仅 entity state）
interface ObjectiveMutationEffect {
  entity_id: string;
  state_namespace: string;
  state_patch: Record<string, unknown>;
}

// 新增 — 扩展为判别联合
type ObjectiveMutationEffect =
  | {
      kind: 'entity_state';
      entity_id: string;
      state_namespace: string;
      state_patch: Record<string, unknown>;
    }
  | {
      kind: 'authority_grant';
      grant_id: string;
      source_entity_id: string;
      target_selector_json: Record<string, unknown>;
      capability_key: string;
      grant_type: string;
      mediated_by_entity_id: string | null;
      scope_json: Record<string, unknown> | null;
      conditions_json: Record<string, unknown> | null;
      priority: number;
      status: string;  // "active" | "revoked"
      revocable: boolean;
    };
```

#### 1.2.2 新增 sidecar 协议字段

```typescript
// packages/contracts/src/world_engine.ts

// WorldRuleExecuteObjectiveResult 的 mutations 数组元素需扩展
// 当前 WorldObjectiveMutation 仅支持 entity state
// 需新增 authority grant mutation 的序列化格式
```

#### 1.2.3 resolver 新增 status 过滤

```typescript
// apps/server/src/domain/authority/resolver.ts

// resolveAuthorityForSubject() 的主循环中新增:
// if (authority.status && authority.status !== 'active') {
//   blocked_authority_ids.push(authority.id);
//   continue;
// }
```

### 1.3 测试（先写）

| 文件 | 测试内容 |
|------|---------|
| `tests/unit/authority_resolver.spec.ts` | status 过滤 — `status: "revoked"` 的 grant 不被匹配；`status: null` 的 grant 正常匹配 |
| `tests/unit/enforcement_engine.spec.ts` | `applyMutationEffect` 处理 `kind: "authority_grant"` — upsert grant 到 DB |
| `tests/integration/authority_dynamic.spec.ts` | 端到端：objective_enforcement rule 的 `then` 产出 authority grant mutation → 持久化 → resolver 可读取/过滤 |

### 1.4 受影响文件

```
packages/contracts/src/world_engine.ts          # WorldRuleExecuteObjectiveResult mutations 扩展
apps/server/src/domain/rule/enforcement_engine.ts  # applyMutationEffect 新增 authority_grant 分支
apps/server/src/domain/rule/sidecar_objective_execution.ts  # 序列化适配
apps/server/src/domain/authority/resolver.ts    # status 过滤
apps/server/src/packs/storage/authority_repo.ts # 确认 upsert 支持 status 字段更新
apps/server/src/packs/runtime/core_models.ts    # PackRuntimeAuthorityGrantInput 确认 status/revocable
apps/server/rust/world_engine_sidecar/          # sidecar 协议: mutation 类型扩展
```

### 1.5 逻辑断裂与盲点

**盲点 A — sidecar 协议版本协商**：`buildSidecarObjectiveExecutionRequest()` 中硬编码了字符串 `'world_engine/v1alpha1'`，而 `enforcement_engine.ts` 正确引用了 `@yidhras/contracts` 导出的常量 `WORLD_ENGINE_PROTOCOL_VERSION`。两处同一值但引用方式不一致——如果未来协议版本升级，硬编码处会静默不同步。

**盲点 B — authority grant 的 target_selector 模板渲染**：当 rule 的 `then` 产出 authority grant 时，`target_selector_json` 可能包含 `{{subject_entity_id}}` 等模板变量。这些模板在何处渲染？sidecar 侧还是 TS 侧？当前 enforcement 管线中 entity state mutation 的 `state_patch` 模板渲染发生在 sidecar 侧（因为 sidecar 返回的是已渲染的值）。authority grant mutation 的模板渲染需要同样在 sidecar 侧完成。

**盲点 C — `authority_grants` 表的主键语义**：当前 `upsertPackAuthorityGrant` 用 `id` 作为主键 upsert。如果同一个 rule 多次触发产出同一个 `grant_id`，upsert 会覆盖。但如果 intent 是"每次触发创建一个新 grant"，则需要不同的 id 生成策略。需明确：撤销是 upsert 同一个 id（`status: "revoked"`）还是创建新记录 + 标记旧记录？

**断裂 1 — enforcement 管线绕过 step 管线的原子性**：`enforcement_engine.ts` 中 `applyMutationEffect` 直接写 DB（`upsertPackEntityState`），不走 `world_engine_persistence.ts` 的 `applyPreparedWorldStateDelta`。这意味着 authority grant 变更不会出现在 step 的 delta 记录中，也不会被 `persistPreparedStep` 的事务包裹。如果 step 2 和 step 5 各自独立写 authority_grants 表，存在竞态条件。

**断裂 2 — step 管线 `put_authority_grant` 与 enforcement 管线 authority grant mutation 是两套机制**：step 管线定义了 `WorldStateDeltaOperation` 的 `put_authority_grant` op，但无人产出。enforcement 管线如果新增 authority grant 支持，走的是另一条路径。两条路径操作同一张表但互不知晓。需决策：统一为一条路径还是保持两条？

### 1.6 推荐路径

走 enforcement 管线（改动最小，与现有 entity state mutation 模式一致）：

1. 扩展 `ObjectiveMutationEffect` 为判别联合（kind: "entity_state" | "authority_grant"）
2. `enforcement_engine.ts` 的 `applyMutationEffect` 新增 authority_grant 分支
3. sidecar 协议同步扩展
4. resolver 新增 status 过滤
5. step 管线的 `put_authority_grant` op 保持不变（未来由 StepContributor 使用），但需注意当前该 op 走 `default: break` 静默丢弃——实施时至少加日志标记

---

## 二、P0-2: variables 在规则中引用

### 2.1 问题

`enforcement_engine.ts` 通过 `buildSidecarObjectiveExecutionRequest` 向 Rust 边车发送：
- invocation（调用上下文）
- objective_rules（`when`/`then` 规则体）
- world_entities（id + kind）

**不包含** pack variables。`then` 中的 `{{variables.model_defense.emperor_ear.firewall}}` 无法解析。

### 2.2 接口定义（先写）

#### 2.2.1 扩展 sidecar 请求协议

```typescript
// packages/contracts/src/world_engine.ts

// WorldRuleExecuteObjectiveRequest 新增字段:
interface WorldRuleExecuteObjectiveRequest {
  protocol_version: string;
  pack_id: string;
  invocation: WorldObjectiveRuleInvocation;
  effective_mediator_id: string | null;
  objective_rules: WorldObjectiveRuleDefinition[];
  world_entities: WorldObjectiveWorldEntity[];
  pack_variables?: Record<string, unknown> | null;  // 新增
}
```

#### 2.2.2 扩展 packRuntime 类型

```typescript
// apps/server/src/domain/rule/enforcement_engine.ts
// apps/server/src/domain/rule/sidecar_objective_execution.ts

// 当前 inline 结构类型（不含 variables）:
packRuntime?: { getPack(): { metadata: { id: string }; rules?: { ... } } }

// 扩展为（补充 variables 字段声明）:
packRuntime?: { getPack(): { metadata: { id: string }; rules?: { ... }; variables?: Record<string, unknown> } }
```

**修正**：完整的 `PackRuntimePort` 接口（`pack_runtime_ports.ts:10-28`）中 `getPack(): WorldPack` 已包含 `variables` 字段（`constitution_schema.ts:624` 定义为 optional）。运行时数据路径上 `variables` 已可通过 `PackRuntimePort.getPack().variables` 获取。此处需求是**扩展 inline 结构类型的声明**以让 TypeScript 通过编译，而非从零构建数据管线。

#### 2.2.3 sidecar 响应不变

Sidecar 返回的 `mutations` 已经是渲染后的值（entity state 路径已验证）。pack variables 仅用于 sidecar 内部的 `when` 匹配和 `then` 模板渲染。TS 侧收到的 plan 与现在一致。

### 2.3 测试（先写）

| 文件 | 测试内容 |
|------|---------|
| `tests/unit/sidecar_objective_execution.spec.ts` | `buildSidecarObjectiveExecutionRequest` 正确序列化 `pack_variables` |
| `tests/integration/objective_rule_variables.spec.ts` | `then` 中 `{{variables.xxx}}` 被正确渲染为实际值 |
| `tests/integration/objective_rule_variables.spec.ts` | `when` 条件中 variables 引用正确匹配（取决于 sidecar 是否支持 `when` 中的变量比较） |
| `packages/contracts/src/__tests__/world_engine.test.ts` | schema 验证 `pack_variables` 可选字段 |

### 2.4 受影响文件

```
packages/contracts/src/world_engine.ts             # WorldRuleExecuteObjectiveRequest 新增 pack_variables
apps/server/src/domain/rule/sidecar_objective_execution.ts  # buildSidecarObjectiveExecutionRequest 传入 variables
apps/server/src/domain/rule/enforcement_engine.ts  # packRuntime 类型扩展 + 传入链路
apps/server/src/domain/invocation/invocation_dispatcher.ts  # 确认 packRuntime 包含 variables
apps/server/src/app/runtime/PackSimulationLoop.ts  # 确认构建 packRuntime 时注入 variables
apps/server/src/packs/runtime/core_models.ts       # PackRuntime 类型是否有 variables 字段
apps/server/rust/world_engine_sidecar/             # 读取 pack_variables，用于 when 匹配 + then 渲染
```

### 2.5 逻辑断裂与盲点

**盲点 D — variables 的运行时存储（已澄清）**：`PackRuntimePort.getPack(): WorldPack` 已包含 `variables` 字段（`constitution_schema.ts:624`），运行时数据路径上 variables 可访问。问题在于 inline 结构类型未声明该字段（见 §2.2.2 修正）。enforcement 发生在 step 5，物化已完成，variables 从物化结果中读取即可。

**盲点 E — `when` 中的变量比较语义**：`when` 当前做的是相等匹配（`when.capability === invocation.capability_key`）。如果 `when` 中包含变量引用如 `when.min_score: "{{variables.threshold}}"`，sidecar 需要先渲染模板再做比较，还是做变量路径的引用相等？需与 sidecar 实现对齐语义。

**盲点 F — sidecar 变量的安全边界**：pack variables 可以包含任意嵌套结构。发送到 sidecar 的 `pack_variables` 是整个 variables 对象的引用还是子集？如果 variables 包含敏感数据（如 API key），需考虑是否过滤。

**断裂 3 — TS 侧 `objective_rule_resolver.ts` 也有模板渲染但无人调用**：`buildObjectiveTemplateContext()` 和 `renderStringTemplate()` 存在于 `objective_rule_resolver.ts`，但由于该文件的函数无人调用，修它没有效果。实际需要修改的是 sidecar 侧。这意味着**此需求的实现依赖 Rust 侧修改**，TS 侧只需传数据。

**断裂 4 — `renderStringTemplate` 与 sidecar 模板引擎的能力不一致**：TS 侧的 `renderStringTemplate` 是简单正则替换（`{{path}}`），sidecar 的模板引擎能力未知。如果 sidecar 的模板语法与 TS 侧不同，pack 作者需要面对两套语法。需统一或至少文档化差异。

---

## 三、P0-3: projection 规则实现

### 3.1 问题

`rules.projection` 在 schema 中定义为 `z.array(worldRuleDefinitionSchema).default([])`。全代码库零消费者。projection 规则需要从零实现。

### 3.2 范围限定

projection 规则的功能定位：每个 tick 的特定阶段，读取世界状态，按 `when` 条件筛选触发，按 `then` 执行计算，将结果写入 projection 存储。

赛博朋克世界包的最小需求：
1. 比赛积分排名（读取 entity state → 计算分数 → 写入可查询的投影）
2. 碎片归属统计（读取 mediator binding → 计数 → 写入投影）
3. 对抗结果记录（读取 rule execution 记录 → 汇总 → 写入投影）

### 3.3 接口定义（先写）

#### 3.3.1 新增 projection rule 专用类型

```typescript
// apps/server/src/domain/projection/types.ts（新建）

interface ProjectionWhenClause {
  // 触发条件
  tick_interval?: number;          // 每 N tick 触发一次
  on_event_type?: string;          // 特定事件类型触发
  entity_type_is?: string;         // 仅针对特定 entity_type
}

interface ProjectionThenClause {
  // 计算指令
  compute: 'count' | 'sum' | 'max' | 'min' | 'collect';
  source_entity_type?: string;     // 从哪种 entity 读取
  source_state_key?: string;       // 读取 state 的哪个 key
  source_collection?: string;      // 或从哪个 collection 读取
  target_projection: string;       // 写入哪个 projection key
  aggregate_by?: string[];         // 按哪些维度分组
  filter_condition?: Record<string, unknown>;  // 过滤条件
}
```

#### 3.3.2 新增 ProjectionEvaluator

```typescript
// apps/server/src/domain/projection/projection_evaluator.ts（新建）

interface ProjectionRuleDef {
  id: string;
  when: ProjectionWhenClause;
  then: ProjectionThenClause;
}

interface ProjectionEvaluationResult {
  projection_key: string;
  computed_value: unknown;
  dimensions: Record<string, string>;
}

function evaluateProjectionRules(
  rules: ProjectionRuleDef[],
  context: ProjectionEvaluationContext
): ProjectionEvaluationResult[];
```

#### 3.3.3 新增 loop 步骤或钩子注册

projection 规则评估需要在 loop 中触发。两种选择：

- **(A) 新增 step 7**：在 `PackSimulationLoop` 的 steps 数组中添加 `step7_projection`
- **(B) 注册为 afterStep6 钩子**：利用已有 `PackLoopHooks` 机制

推荐 (A)，因为 projection 是通用平台能力而非包特定行为。

### 3.4 测试（先写）

| 文件 | 测试内容 |
|------|---------|
| `tests/unit/projection_evaluator.spec.ts` | `evaluateProjectionRules` 对 `compute: "count"` 返回正确计数 |
| `tests/unit/projection_evaluator.spec.ts` | `when.tick_interval` 触发条件 — 非整数倍 tick 不触发 |
| `tests/unit/projection_evaluator.spec.ts` | `aggregate_by` 分组维度正确 |
| `tests/integration/projection_rules.spec.ts` | 端到端：定义 projection rule → 执行 tick → projection 写入 storage |

### 3.5 受影响文件

```
apps/server/src/domain/projection/types.ts               # 新建 — 类型定义
apps/server/src/domain/projection/projection_evaluator.ts  # 新建 — 规则评估器
apps/server/src/app/runtime/PackSimulationLoop.ts         # 新增 step7 或钩子注册
apps/server/src/packs/schema/constitution_schema.ts       # projection rule 专用 schema（替换泛型 worldRuleDefinitionSchema）
apps/server/src/packs/runtime/projections/                # 新增 projection 写入适配器
```

### 3.6 逻辑断裂与盲点

**盲点 G — projection 结果的写入目标**：`storage.projection` 定义了 projection 的 schema（表结构），但 `rules.projection` 的计算结果如何写入这些表？需要一个 `ProjectionWriter` 适配层，将 `ProjectionEvaluationResult` 映射到 `StorageProjectionDefinition` 的表字段。

**盲点 H — `worldRuleDefinitionSchema` 对 projection 的适用性**：当前 `worldRuleDefinitionSchema` 的 `when`/`then` 是自由格式 `Record<string, WorldPackValue>`。如果 projection 规则沿用它，则无编译期检查。感知规则的先例是定义专用 `PerceptionWhenClause` + `PerceptionThenClause`。projection 应该同样定义专用类型，并与 `worldRuleDefinitionSchema` 建立兼容关系或替换之。

**盲点 I — projection 规则与 storage.projection 的关系**：`storage.projection` 定义"存什么"（schema），`rules.projection` 定义"怎么算"（logic）。两者的 `key` 需要关联。当前 schema 中没有显式的关联字段——projection rule 的 `then.target_projection` 需要通过约定匹配 `storage.projection[].key`。是否需要 schema 级别的引用完整性校验？

**断裂 5 — projection 需要读取世界状态，但 evaluator 的输入来源未定义**：evaluator 需要访问 entity states、mediator bindings、authority grants、rule execution records。这些数据从哪里传入？两种选择：
- 直接从 DB 查询（简单但增加 DB 负载）
- 从 `WorldEngineSessionContext` 读取（需要 step 2 之后保留快照）
- 从 packStorageAdapter 查询（与 enforcement 管线一致）

推荐从 packStorageAdapter 查询，与 enforcement 管线模式一致。

**断裂 6 — `worldRuleDefinitionSchema` 如果被 projection 专用 schema 替换，invocation 和 capability_resolution 规则是否也需要各自专用 schema**：当前三者共用 `worldRuleDefinitionSchema`。如果 projection 走向专用 schema，剩下 invocation 和 capability_resolution 还共用泛型 schema，造成不一致。需决策：全部走向专用 schema（像 perception 一样），还是保持泛型？

**推荐**：projection 先用专用 schema（参照 perception 模式），invocation 和 capability_resolution 保持泛型不做改动，缩小变更面。

---

## 四、综合受影响文件清单

### 合约层

| 文件 | P0-1 | P0-2 | P0-3 | 变更类型 |
|------|------|------|------|---------|
| `packages/contracts/src/world_engine.ts` | ✓ | ✓ | — | 扩展 sidecar 协议类型 |

### 领域逻辑层

| 文件 | P0-1 | P0-2 | P0-3 | 变更类型 |
|------|------|------|------|---------|
| `apps/server/src/domain/rule/enforcement_engine.ts` | ✓ | ✓ | — | 扩展 mutation 类型 + packRuntime 类型 |
| `apps/server/src/domain/rule/sidecar_objective_execution.ts` | ✓ | ✓ | — | 序列化适配 |
| `apps/server/src/domain/authority/resolver.ts` | ✓ | — | — | status 过滤 |
| `apps/server/src/domain/projection/types.ts` | — | — | ✓ | 新建 |
| `apps/server/src/domain/projection/projection_evaluator.ts` | — | — | ✓ | 新建 |

### 存储层

| 文件 | P0-1 | P0-2 | P0-3 | 变更类型 |
|------|------|------|------|---------|
| `apps/server/src/packs/storage/authority_repo.ts` | ✓ | — | — | 确认 upsert 能力 |
| `apps/server/src/packs/runtime/core_models.ts` | ✓ | ✓ | — | 类型确认 |
| `apps/server/src/packs/runtime/projections/` | — | — | ✓ | 新建 projection writer |

### Loop 与管线

| 文件 | P0-1 | P0-2 | P0-3 | 变更类型 |
|------|------|------|------|---------|
| `apps/server/src/app/runtime/PackSimulationLoop.ts` | — | ✓ | ✓ | packRuntime 注入 variables + 新增 projection 步骤 |
| `apps/server/src/app/runtime/world_engine_persistence.ts` | — | — | — | 不变（enforcement 管线不经过此文件） |

### Schema 层

| 文件 | P0-1 | P0-2 | P0-3 | 变更类型 |
|------|------|------|------|---------|
| `apps/server/src/packs/schema/constitution_schema.ts` | — | — | ✓ | projection 规则专用 schema |

### Rust 边车

| 文件 | P0-1 | P0-2 | P0-3 | 变更类型 |
|------|------|------|------|---------|
| `apps/server/rust/world_engine_sidecar/` | ✓ | ✓ | — | mutation 类型扩展 + variables 接收与使用 |

### 测试

| 文件 | P0-1 | P0-2 | P0-3 | 变更类型 |
|------|------|------|------|---------|
| `tests/unit/authority_resolver.spec.ts` | ✓ | — | — | 新建/扩展 |
| `tests/unit/enforcement_engine.spec.ts` | ✓ | — | — | 新建/扩展 |
| `tests/integration/authority_dynamic.spec.ts` | ✓ | — | — | 新建 |
| `tests/unit/sidecar_objective_execution.spec.ts` | — | ✓ | — | 新建/扩展 |
| `tests/integration/objective_rule_variables.spec.ts` | — | ✓ | — | 新建 |
| `tests/unit/projection_evaluator.spec.ts` | — | — | ✓ | 新建 |
| `tests/integration/projection_rules.spec.ts` | — | — | ✓ | 新建 |

---

## 五、全局盲点与架构风险

### 5.1 TS 侧 vs Rust 侧职责边界模糊

当前 enforcement 管线的职责分裂为：
- TS 侧：capability 检查、mediator binding 验证、spatial 过滤（预过滤 rules）
- Rust 侧：`when`/`then` 匹配、模板渲染、mutation 生成
- TS 侧：mutation 应用、事件发射

P0-1 和 P0-2 都跨越 TS/Rust 边界。每次协议变更需要两边同步，且没有自动化的一致性测试。建议在集成测试中增加 sidecar 协议版本协商的验证。

### 5.2 `objective_rule_resolver.ts` 死代码的处置

`resolveObjectiveRulePlan()` 是文件唯一导出函数，零外部调用者。该文件的全部可执行代码（`buildObjectiveTemplateContext`、`renderStringTemplate`、`renderObjectiveEffectValue`、`renderObjectiveStatePatch`、`resolveObjectiveRulePlanFromRules`）均通过 `resolveObjectiveRulePlan` 链式调用——从外部看整个文件是可执行死代码。

该文件内的模板引擎与 sidecar 的模板渲染逻辑可能不一致。处置选项：
- **(a) 删除**：避免维护两套实现，减少混淆
- **(b) 保留作为 fallback**：当 sidecar 不可用时降级使用 TS 侧实现
- **(c) 保留作为测试辅助**：单元测试中使用 TS 侧实现验证规则逻辑

推荐 (a) 删除，因为当前无消费者，fallback 路径未验证过，且维护两套模板引擎的成本高于收益。

### 5.3 两条管线操作同一张表

step 管线（`world_engine_persistence.ts`）和 enforcement 管线（`enforcement_engine.ts`）都写 `entity_states` 表。如果两者在不同 step 中对同一 entity 的同一 state key 写入不同值，后者覆盖前者，无冲突检测。P0-1 实施后，两条管线也可能同时写 `authority_grants` 表。

建议：至少在 `authority_grants` 的写入路径上增加 last-write-wins 的时间戳比较，或明确文档化管线优先级（enforcement > step）。

### 5.4 回滚与事务边界

`enforcement_engine.ts:315-351` 中，mutations 逐个执行（循环 + `await`），不是单事务。如果第 2 个 mutation 失败，第 1 个已写入且不会回滚。Enforcement 管线的错误处理只记录 rule execution 为 `failed`，不做数据回滚。

P0-1 的 authority grant mutation 如果与 entity state mutation 混合在一个 plan 中，部分成功会导致不一致状态。

建议：将 enforcement plan 的 mutation 执行包装在事务中，或至少记录"部分应用"的诊断信息。

---

## 六、实施顺序

```
第 1 批: 测试 + 接口（不依赖 Rust 变更）
  ├── P0-1: resolver status 过滤 + 单元测试
  ├── P0-1: enforcement_engine mutation 类型定义 + 单元测试
  ├── P0-2: sidecar 请求协议扩展 + schema 测试
  ├── P0-3: projection 类型定义 + evaluator 单元测试
  └── contracts 包类型更新

第 2 批: TS 侧实现（Rust 侧 stub）
  ├── P0-1: enforcement_engine authority grant mutation 处理
  ├── P0-2: packRuntime 链路注入 variables
  └── P0-3: projection evaluator + loop 步骤 + writer

第 3 批: Rust 侧实现
  ├── P0-1: sidecar mutation 类型扩展
  ├── P0-2: sidecar variables 接收与模板渲染
  └── 集成测试

第 4 批: 清理
  ├── objective_rule_resolver.ts 死代码删除
  └── 文档更新
```

---

## 七、验证计划

```bash
# 合约类型检查
pnpm typecheck

# 单元测试
pnpm --filter yidhras-server test:unit

# 针对性集成测试
pnpm --filter yidhras-server exec vitest run --config vitest.integration.config.ts \
  tests/integration/authority_dynamic.spec.ts \
  tests/integration/objective_rule_variables.spec.ts \
  tests/integration/projection_rules.spec.ts

# schema 验证
pnpm --filter yidhras-server validate:pack data/world_packs/snowbound_mansion

# Rust 侧检查
pnpm --filter yidhras-server check:rust
```
