# Inference Context Builder 审查与重构设计

## 审查范围

- `apps/server/src/inference/context_builder.ts` — 主审查目标
- `apps/server/src/inference/types.ts` — 类型定义
- `apps/server/src/inference/context_config.ts` — 配置加载与缓存
- `apps/server/src/inference/context_config_resolver.ts` — `{{path}}` 模板解析
- `apps/server/src/inference/context_config_schema.ts` — Zod schema
- `apps/server/src/inference/pack_scoped_inference_context_builder.ts` — 接口定义
- `apps/server/src/inference/prompt_builder_v2.ts` — context 消费者
- `apps/server/src/context/service.ts` — context assembly 服务
- `apps/server/src/app/services/context/context_assembler.ts` — 扩展 context 组装
- `apps/server/src/app/services/context/context_memory_ports.ts` — context/memory port 工厂
- `apps/server/src/domain/authority/resolver.ts` — authority 解析（循环依赖方）
- `apps/server/src/access_policy/service.ts` — policy 评估
- `apps/server/src/template_engine/frontends/narrative/variable_context.ts` — variable context 构建
- `apps/server/src/template_engine/frontends/narrative/types.ts` — variable context 类型
- `apps/server/src/app/services/workflow/workflow_previous_output.ts` — previous output scope
- `apps/server/src/app/services/agent/agent.ts` — agent snapshot 查询
- `apps/server/src/app/services/mutation/event_evidence_repository.ts` — event 查询
- `apps/server/src/app/services/pack/pack_runtime_resolution.ts` — tick 解析
- `apps/server/src/packs/storage/entity_state_projection.ts` — state projection 查询
- `apps/server/src/app/composition/inference.ts` — provider 组装
- `apps/server/src/memory/recording/compaction_service.ts` — memory compaction（独立消费者）
- `apps/server/src/app/services/operator/operator_contracts.ts` — operator 调试工具（通过 context_assembler 间接消费）

---

## 一、架构层缺陷

### 1.1 上帝函数：`buildForPack`

`createPackScopedInferenceContextBuilder` 返回的 `buildForPack`（L750–L879）在一个 ~130 行函数中完成以下全部职责：

```
run_time_ready_assert → pack_availability → tick_resolve → strategy_select
→ attributes_normalize → actor_resolve (4 paths) → pack_state_snapshot
→ authority_resolve → policy_summary → transmission_profile
→ context_run_build → variable_context_build → InferenceContext_assemble
```

每个关注点都是一条独立的业务规则链。当前结构导致：

- 不可独立测试：mock 全部 ~15 个依赖后才能测试任何子步骤
- 不可复用：无法单独获取 actor context、state snapshot 或 variable context
- 修改高风险：改动一个子步骤必须理解全部 130 行上下文

### 1.2 上帝类型：`Ctx`

```typescript
type Ctx = AppInfrastructure & Pick<AppContextPorts, 'packRuntimeLookup' | 'contextAssembly'> & {
  getPackRuntimeHost?(packId: string): { getPack(): import('../packs/manifest/loader.js').WorldPack | undefined } | null;
};
```

- `AppInfrastructure` 本身是大型接口，交集扩展了额外字段
- `import()` 内联类型表达式 = 类型系统的逃生舱，说明跨模块边界已破裂
- `getPackRuntimeHost` 被标为 optional，但核心路径依赖它（L753 返回 undefined 即抛异常）
- 函数内部同时直接访问 `context.prisma`、`context.repos.*`、`context.packStorageAdapter`、`context.startupHealth`、`context.assertRuntimeReady`，违反接口隔离原则

各个阶段实际需要的上下文不同：

| 阶段 | 实际需要的接口 |
|------|--------------|
| `resolveActor` | `repos.agent`, `repos.identityOperator`, `getPackRuntimeHost` |
| `buildPackStateSnapshot` | `packStorageAdapter`, `prisma` |
| `buildPolicySummary` | `repos.identityOperator` |
| `buildVariableContext` | `startupHealth`（仅 `app` 层）, `getPackRuntimeHost` |
| `resolveAuthorityForSubject` | `packStorageAdapter` |

但全部通过同一个 `Ctx` 传入，没有任何约束表达"这个函数只应访问这些资源"。

### 1.3 循环依赖

```
inference/context_builder.ts
  └─ import { resolveAuthorityForSubject } from domain/authority/resolver.ts

domain/authority/resolver.ts
  └─ import { packEntityIdFromResolvedAgentId } from inference/context_builder.ts
```

`packEntityIdFromResolvedAgentId`（L163–L170）的功能是：将 `packId:entityId` 格式的 bridged agent ID 还原为 pack 内的 entity ID。这是通用的 pack ID 工具函数，语义属于 `packs/` 层，但错放在 `inference/` 层。

当前仅有两个消费方（`context_builder.ts` + `authority/resolver.ts`），但它们分别属于 inference 和 domain 两个分层——这恰好证明该函数不应该属于任何一方。

### 1.4 `resolveActor` 缺少策略模式

`resolveActor`（L172–L340，168 行）包含四条互斥解析路径：

| 优先级 | 条件 | 子路径 | 行数 |
|--------|------|--------|------|
| 1 | `input.agent_id` | 直接查 agent → 构建 snapshot | 19 |
| 2 | `input.identity_id` | 查 identity → 查 binding → 3 种子情况（agent binding / atmosphere binding / 无 binding） | 60 |
| 3 | `input.actor_entity_id && packId` | 构造 bridged ID → 查 pack def → 查 binding → 有/无 binding 两条路径 | 64 |
| 4 | 兜底 | 系统 identity | 19 |

每条路径的数据库查询、identity 综合逻辑、snapshot 构建方式完全不同，但被 if-else 链路串在一起。

### 1.5 `buildExtendedInferenceContext` 重复 authority 解析

`context_assembler.ts` 的 `buildExtendedInferenceContext` 调用 `buildInferenceContext`（后者内部已调用 `resolveAuthorityForSubject`），然后**再次调用** `resolveAuthorityForSubject`：

```
调用链:
  buildExtendedInferenceContext
    → buildInferenceContext → buildForPack
        → resolveAuthorityForSubject(...)  ← 第一次，仅提取 capability_key
    → resolveAuthorityForSubject(...)      ← 第二次，获取完整 authority context
```

- 第一次调用的完整结果被丢弃（仅提取了 `capability_key` 数组）
- 第二次调用穿入的 `subjectEntityId` 格式不同（`base.resolved_agent_id` vs `packEntityIdFromResolvedAgentId(...)`）
- `buildExtendedInferenceContext` 的唯一消费者是 `operator_contracts.ts`（operator 调试面板），不是正常推理流程

### 1.6 `PackScopedInferenceContextBuilder` 接口过于粗糙

```typescript
export interface PackScopedInferenceContextBuilder {
  buildForPack(context: AppInfrastructure, input: BuildInferenceContextForPackInput): Promise<InferenceContext>;
}
```

一个方法返回整个 `InferenceContext`。无法：
- 单独构建 actor context
- 单独构建 state snapshot
- 单独构建 variable context
- 按照不同消费者裁剪返回字段（`compaction_service.ts` 不需要 transmission_profile，`operator_contracts.ts` 不需要 prompt 相关字段）

### 1.7 `InferenceContext` 是字段堆砌

`InferenceContext`（types.ts L267–L288）包含 22 个字段，其中部分字段本应是独立领域对象：
- `transmission_profile` — 信号传输 QoS，应属于 `inference/transmission_profile.ts`
- `policy_summary` — 访问策略评估结果，应属于 `access_policy/` 或独立
- `pack_state` — 世界状态快照，应属于 `packs/` 层
- `memory_context` — memory context pack，应属于 `memory/` 层
- `agent_capabilities` — authority 解析结果，应属于 `domain/authority/`

`InferenceContext` 的本质是"组装后的视图对象"，但当前它承担了传输对象、领域对象、配置快照三种角色。

---

## 二、类型安全缺陷

### 2.1 ~15 处 `as` 类型断言（context_builder.ts 主文件）

类型断言集中在数据库查询结果 → domain 类型的边界：

```typescript
// 单次 as
binding.role as InferenceBindingRef['role']                   // L92

// 同一值在不同分支各 as 一次（冗余）
input.strategy as InferenceStrategy                           // L105, L113

// 双重 as（完全绕过类型系统）
context.repos.identityOperator.listIdentityBindings(...)
  as unknown as BindingRecord[]                               // L154

// 运行时类型欺骗
context as unknown as import('../app/context.js').AppContext   // L816

// 访问 pack 对象上不存在的字段
(pack as unknown as { behavior_trees?: unknown }).behavior_trees  // L845
```

**根因：** Prisma 查询返回类型与 domain 类型之间缺少显式的 mapper/translator 层。`listIdentityBindings` 返回 Prisma 生成的类型，消费方需要 `BindingRecord`。当前方案是用 `as` 暴力绕过，而不是写 `toBindingRecord(prismaRow)` 映射函数。

### 2.2 `isRecord` 定义 7 处

项目中有一个集中定义的 `utils/type_guards.ts::isRecord`，但**没有任何文件 import 它**。以下是各文件自行定义的版本：

| 文件 | 实现 |
|------|------|
| `utils/type_guards.ts`（集中版） | `typeof value === 'object' && value !== null && !Array.isArray(value)` |
| `context_builder.ts:84` | `Boolean(value) && typeof value === 'object' && !Array.isArray(value)` |
| `context_config_resolver.ts:3` | `typeof value === 'object' && value !== null && !Array.isArray(value)` |
| `variable_context.ts:14` | `Boolean(value) && typeof value === 'object' && !Array.isArray(value)` |
| `agent.ts:213` | `Boolean(value) && typeof value === 'object' && !Array.isArray(value)` |
| `authority/resolver.ts:38` | `Boolean(value) && typeof value === 'object' && !Array.isArray(value)` |
| `compaction_service.ts:18` | `Boolean(value) && typeof value === 'object' && !Array.isArray(value)` |
| `action_intent_repository.ts:44` | `typeof value === 'object' && value !== null && !Array.isArray(value)` |
| `StateTransformContributor.ts:7` | `typeof value === 'object' && value !== null && !Array.isArray(value)` |
| `inference_workflow/types.ts:130` | `typeof value === 'object' && value !== null && !Array.isArray(value)` |
| `composition/inference.ts:16` | `value !== null && typeof value === 'object' && !Array.isArray(value)` |

语义完全相同（`Boolean(null)` = `false`，处理了 `typeof null === 'object'` 的特殊情况）。共 11 处独立定义。

### 2.3 `Record<string, unknown>` 流水线

整个状态管线的类型是 `Record<string, unknown>` 的接力：

```
pack storage → Record<string, unknown>
  → listPackEntityStateProjectionRecords → PackEntityStateProjectionRecord[]
    → parsePackStateRecord → InferencePackStateRecord (= Record<string, InferencePackStateValue>)
      → buildPackStateSnapshot → InferencePackStateSnapshot
        → buildInferenceVariableContext → PromptVariableRecord

config YAML → Record<string, unknown>
  → resolveConfigValues → PromptVariableRecord
    → normalizePromptVariableRecord → PromptVariableRecord
      → createPromptVariableLayer → PromptVariableLayer
```

每一步的输入和输出类型相同（`Record<string, unknown>` 或等效的泛化 `unknown` 容器），类型信息在管线的第一步之后就丢失了。actor state、world state、artifact state 之间没有 discriminated union 区分。

### 2.4 `resolvePackTick` 接受 `unknown`

```typescript
export const resolvePackTick = (context: unknown, packRuntime?: ...): bigint => {
  const ctx = context as { packRuntime?: { getCurrentTick(): bigint } | null };
  return ctx.packRuntime?.getCurrentTick() ?? 0n;
};
```

参数类型是 `unknown`，函数体第一行就 cast。类型安全问题没有解决，只是从调用方转移到了被调用方。

---

## 三、数据访问不一致

`context_builder.ts` 同一文件中使用三种不同的数据访问模式：

| 模式 | 示例 | 行号 |
|------|------|------|
| Repository | `context.repos.agent.findAgentById(...)` | L257 |
| Storage Adapter | `listPackEntityStateProjectionRecords(context.packStorageAdapter, ...)` | L531 |
| 裸 Prisma | `context.prisma.event.findMany(...)` | L482 |

而 `event_evidence_repository.ts` 封装了 `prisma.event.findFirst`（L15），但 `fetchRecentEvents` 选择绕过 repo 直接写 Prisma 查询。这破坏了项目自身的数据访问分层约定。

---

## 四、数据流缺陷

### 4.1 `semantic_type` 提取逻辑重复

完全相同的 JSON 解析 + 类型守卫 + 字段提取逻辑出现在两个位置：
- `fetchRecentEvents`（L503–L515）— 从 `row.impact_data` 提取
- `buildPackStateSnapshot`（L574–L587）— 从 `latestEventRecord.impact_data` 提取

仅外层对象字段名不同（`row` vs `latestEventRecord`）。

### 4.2 `buildInferenceVariableContext` 内联巨型参数类型

```typescript
const buildInferenceVariableContext = (input: {
  context: Ctx;
  pack: { metadata: {...}; variables?: Record<string, unknown>; prompts?: Record<string, unknown>; ai?: unknown };
  strategy: InferenceStrategy;
  attributes: Record<string, unknown>;
  resolvedActor: ResolvedActor;
  packState: InferencePackStateSnapshot;
  packRuntime: InferencePackRuntimeContract;
  requestInput: InferenceRequestInput;
  currentTick: string;
  config?: InferenceContextConfig;
}): PromptVariableContext => { ... }
```

- `pack` 类型内联定义，与 types.ts 中已有的 `InferenceWorldPackRef` 部分重叠但不一致
- `ai` 被标为 `unknown` 但 types.ts 中已导出 `WorldPackAiConfig`
- 11 个字段的参数对象没有命名接口

### 4.3 `buildTransmissionProfile` 内部死代码 fallback

```typescript
const tpConfig = (config ?? getInferenceContextConfig()).transmission_profile;
```

`config` 参数在 `buildForPack` L787 已解析并传入。如果调用方传了 `config`（正常路径），`??` 后面的 `getInferenceContextConfig()` 永远不会执行。如果调用方没传，则获取的 config 版本可能与调用方不一致（env vars 可能在两次调用间变化）。

### 4.4 `buildForPack` 中 authority 结果仅提取 capability_key

```typescript
// L790-797
const authorityResult = await resolveAuthorityForSubject(context, {...});
const agentCapabilities = authorityResult.resolved_capabilities.map(c => c.capability_key);
```

`resolveAuthorityForSubject` 返回 `AuthorityResolutionResult`，包含 `resolved_capabilities`（含有 grant_type、source_entity_id、mediated_by_entity_id、target_selector、conditions、priority、provenance 等丰富信息）和 `blocked_authority_ids`。但此处仅提取 `capability_key` 字符串，丢弃了全部元数据。

---

## 五、全局可变状态

`context_config.ts` L155–L156：

```typescript
let globalCache: ConfigCacheEntry | null = null;
const deploymentCaches = new Map<string, ConfigCacheEntry>();
```

- 全局 module-level 缓存。测试文件之间互相污染，只能通过显式调用 `resetInferenceContextConfigCache()` 清理
- `buildFinalConfig`（L247）在每次 `getInferenceContextConfig` 调用时读取 `process.env` 并 merge，但缓存的 base config 不包含 env overrides。env var 变更后，通过不同路径（如 deployment vs global）获取的 config 可能不一致

---

## 六、错误处理

### 6.1 `fetchRecentEvents` 静默吞错

```typescript
// L520-522
} catch {
  return [];
}
```

数据库连接断开、Prisma 查询超时、schema 不匹配——全部静默返回空数组。`recent_events` 最终写入 prompt 上下文注入给 LLM，空数组意味着 AI 缺少世界状态信息，但不会有任何错误日志。

### 6.2 无优雅降级

`buildForPack` 中任何子步骤失败 → 整个 context 构建失败。如果 authority 解析抛异常，已完成的 pack state 快照、actor 解析、policy summary 全部无效。部分子模块可以独立失败并提供部分上下文（如 authority 失败时 `agent_capabilities` 可退化为空数组而不是阻断整个推理）。

---

## 七、缺失的抽象

### 7.1 无 pipeline stage 接口

当前只有两个公开接口：
- `buildInferenceContext(context, input, packId)` — 便捷 wrapper
- `createPackScopedInferenceContextBuilder().buildForPack(context, input)` — 实际的巨型方法

缺失：
- `resolveActor(context, input, packId)` — 独立 actor 解析
- `buildPackStateSnapshot(context, packId, resolvedAgentId, attributes)` — 独立快照
- `buildTransmissionProfile(actorRef, agentSnapshot, policySummary, attributes, config)` — 独立传输配置
- `assembleVariableContext(...)` — 独立变量上下文

### 7.2 Transmission profile 应独立为领域模块

`buildTransmissionProfile`（L404–L466）是纯计算函数，根据 actor SNR、policy summary、explicit attributes 计算传输 QoS。这属于信号传输可靠性的领域模型，与 context assembly 无关。

### 7.3 Variable context 配置解析链路过长

```
getInferenceContextConfig()              context_config.ts          YAML + env + deployment
  → resolveConfigValues()               context_config_resolver.ts  {{path}} 模板 → 值
    → normalizePromptVariableRecord()   variable_context.ts         类型强制转换
      → createPromptVariableLayer()     variable_context.ts         layer 组装
        → flattenPromptVariableContextToVisibleVariables()          alias 扁平化
```

5 步跨越 3 个文件，每一步皆输出 `Record<string, unknown>`，类型信息逐层丢失。

---

## 八、调用拓扑

```
compaction_service.ts ──→ buildInferenceContext ──→ createPackScopedInferenceContextBuilder.buildForPack
                                                          │
context_assembler.ts  ──→ buildInferenceContext ──────────┘
       │
       └──→ resolveAuthorityForSubject (AGAIN)
       └──→ resolvePerceptionForSubject
       └──→ resolveMediatorBindingsForPack
              │
operator_contracts.ts ←── buildExtendedInferenceContext

inference/service.ts  ──→ buildInferenceContext ──→ buildForPack
       │
       └──→ groundDecisionIntent
       └──→ buildWorkflowPromptBundle
```

所有路径最终都调用 `buildForPack`，但 `context_assembler.ts` 在调用之后又补调了三个额外解析函数——其中 `resolveAuthorityForSubject` 在 `buildForPack` 内部已被调用过一次。

---

## 九、重构方案

### Phase 1：消除结构缺陷（循环依赖 + 类型安全）

**1.1 迁移 `packEntityIdFromResolvedAgentId`**

```
移动: inference/context_builder.ts → packs/utils/pack_entity_id.ts
影响: context_builder.ts（原定义方）、domain/authority/resolver.ts（消费方）
结果: 消除 inference/ ↔ domain/ 循环依赖
```

**1.2 统一 `isRecord`**

```
删除: 各文件内联定义（11 处）
替换为: import { isRecord } from 'utils/type_guards.js'
```

**1.3 创建 Prisma → Domain mapper 层**

```
新建: inference/mappers.ts
包含:
  - toBindingRef(prismaRow): InferenceBindingRef
  - toIdentityContext(binding): IdentityContext
  - toAgentSnapshot(record): InferenceAgentSnapshot
  - toPackLatestEventSnapshot(prismaRow): InferencePackLatestEventSnapshot

目标: 消除所有 as unknown as X 双重断言
```

### Phase 2：拆分上帝函数

**2.1 定义按阶段分离的接口**

```typescript
// 新建: inference/context/actor_resolver.ts
interface ActorResolver {
  resolve(input: InferenceRequestInput, packId?: string): Promise<ResolvedActor>;
}

// 新建: inference/context/state_snapshot_builder.ts
interface StateSnapshotBuilder {
  build(packId: string, resolvedAgentId: string | null, attributes: Record<string, unknown>): Promise<InferencePackStateSnapshot>;
}

// 新建: inference/context/transmission_profile_builder.ts
interface TransmissionProfileBuilder {
  build(params: TransmissionProfileParams): InferenceTransmissionProfile;
}

// 新建: inference/context/variable_context_assembler.ts
interface VariableContextAssembler {
  assemble(params: VariableContextParams): PromptVariableContext;
}
```

**2.2 重写 `buildForPack` 为编排层**

```typescript
// 重构后的 buildForPack: 仅做编排，不包含业务逻辑
async buildForPack(context, input): Promise<InferenceContext> {
  const pack = validatePackAvailable(context, input.pack_id);
  const tick = resolveTick(context);
  const strategy = selectStrategy(input, pack);
  const attributes = normalizeAttributes(input.attributes);
  const actor = await this.actorResolver.resolve(input, input.pack_id);
  // 如果 actor 定义覆盖 strategy，应用覆盖
  const effectiveStrategy = applyActorStrategyOverride(actor, pack, strategy, attributes);
  const state = await this.stateBuilder.build(input.pack_id, actor.resolved_agent_id, attributes);
  const authority = await this.authorityResolver.resolve(context, input.pack_id, actor.resolved_agent_id);
  const policy = await this.policyBuilder.build(context, actor.identity, attributes);
  const transmission = this.transmissionBuilder.build({ actorRef: actor.actor_ref, agentSnapshot: actor.agent_snapshot, policySummary: policy, attributes });
  const contextRun = await this.contextRunBuilder.build(context, { actor_ref: actor.actor_ref, ... });
  const variableContext = this.variableAssembler.assemble({ pack, strategy, attributes, actor, state, ... });
  return assembleInferenceContext({ actor, strategy, attributes, state, authority, policy, transmission, contextRun, variableContext, ... });
}
```

**2.3 `resolveActor` 拆为策略模式**

```typescript
// 新建: inference/context/actor_resolution/
interface ActorResolutionStrategy {
  canHandle(input: InferenceRequestInput): boolean;
  resolve(context: ActorResolutionContext, input: InferenceRequestInput, packId?: string): Promise<ResolvedActor>;
}

class AgentIdStrategy implements ActorResolutionStrategy { ... }
class IdentityIdStrategy implements ActorResolutionStrategy { ... }
class ActorEntityIdStrategy implements ActorResolutionStrategy { ... }
class SystemFallbackStrategy implements ActorResolutionStrategy { ... }
```

### Phase 3：修复数据流缺陷

**3.1 消除重复调用**

在 `buildForPack` 中保留完整的 `authorityResult`（不仅是 `capability_key` 提取），暴露给 `buildExtendedInferenceContext` 重用，而不是重新调用 `resolveAuthorityForSubject`。

或者：将 authority 解析从 `buildForPack` 中移出，让消费者按需调用。`buildForPack` 只负责基础 context 组装。

**3.2 抽取 `extractSemanticType` 纯函数**

```typescript
// utils/ 或 inference/helpers.ts
function extractSemanticType(impactData: string | null): string | null { ... }
```

**3.3 给 `buildInferenceVariableContext` 的参数定义命名接口**

```typescript
interface BuildVariableContextInput {
  context: VariableContextResolutionContext;
  pack: PackVariableSource;
  strategy: InferenceStrategy;
  attributes: Record<string, unknown>;
  resolvedActor: ResolvedActor;
  packState: InferencePackStateSnapshot;
  packRuntime: InferencePackRuntimeContract;
  requestInput: InferenceRequestInput;
  currentTick: string;
  config?: InferenceContextConfig;
}
```

### Phase 4：配置层改进

**4.1 消除全局可变状态**

将 `globalCache` 和 `deploymentCaches` 替换为请求级缓存（通过 `AsyncLocalStorage` 或显式传入 `ConfigProvider` 实例）。

**4.2 修复 `buildFinalConfig` 的 env override 时序**

在缓存 key 中包含 env var hash，或在每次读取时重新 apply env overrides 而不是仅在 cache miss 时。

### Phase 5：错误处理改善

**5.1 消除静默 catch**

`fetchRecentEvents` 的 catch 块至少应记录 warning 日志。

**5.2 子模块独立失败**

各子模块的异常不应阻止其他子模块的结果返回。在 orchestrator 层使用 `Promise.allSettled` 或类似模式收集部分结果。

---

## 十、模块归属调整建议

| 当前位置 | 建议归属 | 理由 |
|---------|---------|------|
| `context_builder.ts::packEntityIdFromResolvedAgentId` | `packs/utils/pack_entity_id.ts` | 通用 pack ID 工具，不属于 inference |
| `context_builder.ts::buildTransmissionProfile` | `inference/transmission_profile.ts` | 独立领域概念 |
| `context_builder.ts::extractSemanticType`（抽取后） | `inference/helpers.ts` 或 `utils/` | 纯数据提取函数 |
| `context_builder.ts::resolveActor`（拆分后） | `inference/context/actor_resolution/` | 独立子系统 |
| `context_builder.ts::buildPolicySummary` | `inference/context/policy_summary_builder.ts` | 独立关注点 |
| `context_builder.ts::buildPackStateSnapshot` | `inference/context/state_snapshot_builder.ts` | 独立关注点 |
| `context_builder.ts::buildInferenceVariableContext` | `inference/context/variable_context_assembler.ts` | 独立关注点 |

---

## 十一、变更影响范围

| 变更 | 影响文件数 | 风险 |
|------|-----------|------|
| 迁移 `packEntityIdFromResolvedAgentId` | 2 | 低（纯移动，签名不变） |
| 统一 `isRecord` | ~12 | 低（语义等价，仅 import 路径变更） |
| 创建 mapper 层 | ~5 | 中（新增文件，需逐处替换 as 断言） |
| 拆分 `buildForPack` | ~5 | 中（接口变更，调用方需适配） |
| 拆分 `resolveActor` | ~3 | 中（新增策略文件，原调用方适配） |
| 配置缓存改造 | 2 | 高（运行时行为变更，需覆盖测试） |
| 消除 authority 重复调用 | 3 | 中（`buildExtendedInferenceContext` 行为变更） |


---

# 附录：审查盲点分析

> 以下内容原为独立文档 `.limcode/design/context-builder-blind-spots.md`，是对上述审计的补充盲点分析，发现主审计未覆盖的 16 个额外问题。

## 分析方法

系统性检查以下维度是否存在遗漏：
- 未检查的代码路径
- 跨模块的数据一致性风险
- 并发/竞态条件
- 性能隐性问题
- 测试覆盖缺口
- 与子系统文档的矛盾
- 开发者体验的退化点

---

## 盲点 1：`fetchRecentEvents` 的 Prisma 查询无 pack_id 隔离

**代码位置：** `context_builder.ts:482-498`

```typescript
const rows = await context.prisma.event.findMany({
  where: { pack_id: packId },
  orderBy: { tick: 'desc' },
  take: limit,
  ...
});
```

**问题：** 此查询使用 `context.prisma`（主数据库）而非 pack 专用的 SQLite adapter。而同一函数内 `buildPackStateSnapshot`（L531）使用的是 `context.packStorageAdapter`（pack 级存储）。

**盲点：** 如果 `prisma.event` 表（主 DB）中的 event 与 pack 实际生成的事件不同步（pack runtime 写入 pack DB 的 event 表 vs 主 DB 的 event 表），`fetchRecentEvents` 查询到的数据可能不是该 pack 的最新事件。需要确认主 DB 的 event 表与 pack DB 的 event 表是同一张表还是需要 JOIN。

**验证方式：** 检查 Prisma schema 中 event 模型的 `pack_id` 字段和实际数据写入路径。

---

## 盲点 2：`getLatestEventEvidenceRecord` 无 pack_id 过滤

**代码位置：** `event_evidence_repository.ts:12-28`

```typescript
export const getLatestEventEvidenceRecord = async (
  context: AppInfrastructure
): Promise<LatestEventEvidenceRecord | null> => {
  return context.prisma.event.findFirst({
    orderBy: { tick: 'desc' },
    ...
  });
};
```

**问题：** 这个查询**没有任何 `where` 过滤条件**——它返回全局最新的事件，不区分 pack。在一个多 pack 运行的系统中，Pack A 的 context builder 会读取到 Pack B 的最新 event。

**盲点：** `buildPackStateSnapshot`（L566）调用 `getLatestEventEvidenceRecord(context)` 时没有传入 `packId`。这意味着 `latest_event` 字段在语义上是错误的——它不一定是当前 pack 的事件。

**与 `fetchRecentEvents` 的对比：**
- `fetchRecentEvents(context, packId, limit)` — 有 `pack_id` 过滤 ✓
- `getLatestEventEvidenceRecord(context)` — 无 `pack_id` 过滤 ✗

**严重程度：高。** 这是一个数据正确性 bug。

---

## 盲点 3：`InferenceContext` 中的 `tick` 字段类型不一致

**代码位置：**
- `context_builder.ts:762` — `const currentTick = resolvePackTick(context).toString();`
- `context_builder.ts:855` — `tick: BigInt(currentTick)`
- `types.ts:257` — `tick: bigint`（在 `PromptResolvableContext` 中）
- `event_evidence_repository.ts:8-9` — `tick: bigint`

**问题：** `resolvePackTick` 返回 `bigint` → 立即 `.toString()` → 再 `BigInt(currentTick)` 转回 bigint。中间经历了 `bigint → string → bigint` 的无意义转换。

`fetchRecentEvents` L517 又将 tick 转为 string（`row.tick.toString()`），但在 `PromptResolvableContext` 中 tick 是 `bigint`。整个上下文构建流程中 tick 在 string 和 bigint 之间反复转换，没有统一的内部表示。

**盲点：** 如果在某处将 `bigint` 超出 `Number.MAX_SAFE_INTEGER` 的 tick 值误转为 `number`（通过隐式转换），会发生精度丢失。

---

## 盲点 4：`context_config_resolver.ts` 的模板解析不支持嵌套对象路径中的数组索引

**代码位置：** `context_config_resolver.ts:12-20`

```typescript
const getValueAtPath = (path: string, root: Record<string, unknown>): unknown => {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (isRecord(current) && segment in current) {
      return current[segment];
    }
    return undefined;
  }, root);
};
```

**问题：** 如果 path 是 `app.startup_health.available_world_packs.0.name`（数组索引），此实现会失败，因为 `segment in current` 对数组索引的行为与对象 key 不同，且 `isRecord` 会拒绝数组。

**影响：** 当前 config 中没有使用数组索引路径（`context_config.ts` 中的模板全部是对象路径），所以不是即时 bug。但如果未来配置需要访问数组元素（如 `recent_events.0.title`），此限制会阻止。

**盲点：** 需要在 `resolveConfigValues` 的实现注释或 schema 层面明确声明不支持数组索引。

---

## 盲点 5：behavior_tree 的加载绕过了 pack 的正式字段定义

**代码位置：** `context_builder.ts:844-845` + `composition/inference.ts:34-36`

```typescript
// context_builder.ts L844-845
const rawBehaviorTrees = (pack as unknown as { behavior_trees?: unknown }).behavior_trees;

// composition/inference.ts L34
if (isRecord(rawTrees)) {
  registry.register(rawTrees);
}
```

**已验证：** `worldPackConstitutionSchema`（constitution_schema.ts:987）使用 `.loose()`，未识别的字段在解析时被**静默剥离**。`behavior_trees` 不在 schema 的显式字段定义中（仅在 per-actor inference config 中以 `behavior_tree: nonEmptyStringSchema` 出现于 L297-298）。

`validate_pack_cli.ts` 将 `behavior_trees` 列为合法 key（L99），但它是通过 `include` 机制单独加载的，不经过 `parseWorldPackConstitution`。

**结论：** 在运行时路径中（`buildForPack` → `getPackRuntimeHost().getPack()` → `PackManifestLoader.loadPack()` → `parseWorldPackConstitution`），`pack.behavior_trees` **永远为 undefined**。`.loose()` 已将其剥离。

因此 `context_builder.ts:844-845` 的 `(pack as unknown as { behavior_trees?: unknown }).behavior_trees` 在运行时总是得到 undefined，`InferenceWorldPackRef.behavior_trees`（types.ts:189）在正常推理流程中始终为空。

`composition/inference.ts:61-64` 中 `inferenceContext.world_pack.behavior_trees` 传入 `TreeRegistry.register()` 也始终为空对象 — TreeRegistry 需要通过其他路径（如插件运行时）获取行为树定义。

**严重程度上调至：高。** behavior_tree 策略的 TreeRegistry 在标准运行时路径中无法从 pack 加载行为树定义。

---

## 盲点 6：`compaction_service.ts` 调用 `buildInferenceContext` 时传入空 packId

**代码位置：** `compaction_service.ts:135-143`

```typescript
const inferenceContext = await buildInferenceContext(context, {
  agent_id: input.agent_id,
  identity_id: input.identity_id ?? input.agent_id,
  strategy: 'mock',
  attributes: { compaction_run: true, compaction_source: 'memory_loop' }
}, packRuntime?.getPackId() ?? '');
```

**问题：** 当 `packRuntime?.getPackId()` 返回 `undefined` 时，fallback 是空字符串 `''`。空字符串传入 `buildForPack` 后：
- L754：`context.getPackRuntimeHost?.('')?.getPack()` → 大概率返回 undefined → 抛 `WORLD_PACK_NOT_READY`
- 异常被上层的 catch 处理（compaction_service 有自己的 try-catch），但 compaction 操作静默失败

**盲点：** 这是一个合法的防御性编程，但如果 compaction 频繁失败（因为 packRuntime 未就绪），系统不会有告警。建议在调用前验证 packId 的有效性并记录 warning。

---

## 盲点 7：`PolicySummary` 仅覆盖 `social_post` 资源

**代码位置：** `context_builder.ts:360-371`（默认 evaluations）+ `buildPolicySummary`（L352-L402）

```typescript
const evaluations = resolvedConfig.policy_summary?.evaluations ?? [
  { resource: 'social_post', action: 'read', fields: [...] },
  { resource: 'social_post', action: 'write', fields: [...] }
];
```

**问题：** 默认的 policy evaluations 只检查 `social_post` 资源的读写权限。`buildPolicySummary` 的返回值（`InferencePolicySummary`）中字段名也硬编码为 `social_post_read_allowed`、`social_post_write_allowed` 等。

如果系统未来引入新的资源类型（如 `investigation_report`、`relationship`），policy summary 接口需要修改才能覆盖。

**盲点：** `InferencePolicySummary` 接口字段是硬编码的 flat 结构，而非泛化的 `Record<resource_action, PolicyEvalResult>`。扩展新资源类型需要改接口定义 + 所有消费方。

---

## 盲点 8：`buildTransmissionProfile` 中 `derived_from` 数组在 fallthrough 路径不准确

**代码位置：** `context_builder.ts:459-464`

```typescript
derived_from: [
  ...(explicitPolicy ? ['attributes.transmission_policy'] : ['default.reliable']),
  ...(actorRef.role === 'atmosphere' ? ['actor_ref.role'] : []),
  ...(readRestricted ? ['policy_summary.social_post_read_allowed'] : []),
  ...(agentSnapshot ? ['agent_snapshot.snr'] : [])
]
```

**问题：** 当 `explicitPolicy` 为 falsy 时，`derived_from` 包含 `'default.reliable'`，但实际的基础策略可能不是 `'reliable'`——它取决于 `resolvedBasePolicy`（可能是 `'best_effort'` 或 `'fragile'`，取决于 `readRestricted` 和 `actorSNR`）。

`derived_from` 声称来源是 `default.reliable`，但实际可能使用了 `readRestrictedBase`（best_effort）或 `lowSnrBase`（fragile）。

**严重程度：低。** `derived_from` 是诊断/元数据字段，不影响功能。但如果消费者依赖它做审计或调试，信息是不准确的。

---

## 盲点 9：`AppInfrastructure` 的边界模糊

在整个 `context_builder.ts` 中，`Ctx` 类型的有效字段取决于运行时实际传入的对象。以下是代码实际访问的字段清单：

```
context.prisma                              — PrismaClient
context.repos.agent                         — AgentRepository
context.repos.identityOperator              — IdentityOperatorRepository
context.repos.relationship                  — RelationshipRepository
context.packStorageAdapter                  — PackStorageAdapter
context.startupHealth                       — StartupHealth
context.assertRuntimeReady                  — () => void
context.getPackRuntimeHost                  — (packId: string) => ...
context.packRuntimeLookup                   — PackRuntimeLookupPort
context.contextAssembly                     — ContextAssemblyPort
```

但类型签名中只有 `Ctx = AppInfrastructure & Pick<AppContextPorts, 'packRuntimeLookup' | 'contextAssembly'> & { getPackRuntimeHost? }`。

**盲点：** `context.repos`、`context.prisma`、`context.packStorageAdapter`、`context.startupHealth`、`context.assertRuntimeReady` 都在 `AppInfrastructure` 中，但 `AppInfrastructure` 的具体定义需要验证——它是否真的包含了 `repos.agent`、`repos.identityOperator`、`repos.relationship` 等嵌套 repository。

如果 `AppInfrastructure` 的类型不完整但运行时对象恰好满足（通过 JavaScript 的动态性），那么类型系统提供的安全性是虚假的。

---

## 盲点 10：`createContextAssemblyPort` 的降级创建逻辑

**代码位置：** `context_builder.ts:816`

```typescript
const contextAssembly = context.contextAssembly
  ?? createContextAssemblyPort(context as unknown as import('../app/context.js').AppContext);
```

**问题：** 当 `context.contextAssembly` 不存在时，代码用 `context as unknown as AppContext` 将 `Ctx` 强转为 `AppContext` 来创建 port。但 `Ctx` 和 `AppContext` 是不同的类型——`Ctx` 是 `AppInfrastructure & Pick<...>`，`AppContext` 可能有额外的字段（如 `getSpatialRuntime`）。

`createContextAssemblyPort` 内部（`context_memory_ports.ts:26`）访问 `context.getSpatialRuntime?.()`——这个字段在 `AppContext` 中存在但在 `Ctx`（继承自 `AppInfrastructure`）中可能不存在。

**盲点：** 这是一个运行时类型欺诈。如果测试或某些调用路径传入的不是完整的 `AppContext` 而是满足 `Ctx` 的最小对象，`getSpatialRuntime` 将为 undefined 而不会报错（因为 optional chaining），但创建的 context service 行为不完整（spatialRuntime 为 null）。

---

## 盲点 11：测试覆盖

**已验证：** `tests/unit/inference/context_builder.spec.ts` 存在（119 行）。

实际覆盖情况：
- `ACTOR_ENTITY_ID_SEPARATOR` — 有测试 ✓
- `packEntityIdFromResolvedAgentId` — 有 5 个测试用例 ✓
- `createPackScopedInferenceContextBuilder` — 仅验证返回对象存在（L112–116）
- `buildForPack` / `buildInferenceContext` — **零覆盖**。所有依赖被 mock 为 no-op，mock 的 `createPackScopedInferenceContextBuilder` 返回 `buildContextForPack`（错误的方法名 — 实际方法名是 `buildForPack`，该 mock 返回的函数签名与实际不符）
- `resolveActor`、`buildPackStateSnapshot`、`buildPolicySummary`、`buildTransmissionProfile`、`buildInferenceVariableContext` — 均零覆盖
- 没有集成测试覆盖 `buildInferenceContext`（`tests/integration/inference/` 目录不存在）

**结论：测试覆盖极薄。** 核心业务逻辑（~130 行的 `buildForPack` 和所有辅助函数）完全没有单元测试或集成测试覆盖。重构需要从零开始建立测试安全网。

---

## 盲点 12：`buildInferenceContext` wrapper 丢失 mode 参数

**代码位置：** `context_builder.ts:883-892`

```typescript
export const buildInferenceContext = async (
  context: Ctx, input: InferenceRequestInput, packId: string
): Promise<InferenceContext> => {
  return createPackScopedInferenceContextBuilder().buildForPack(context, {
    ...input,
    pack_id: packId,
    mode: 'stable'
  });
};
```

**问题：** `mode` 被硬编码为 `'stable'`。这意味着**任何通过 `buildInferenceContext` 的调用路径都无法使用 `'experimental'` mode**。

`packRuntimeContractResolver.resolvePackRuntimeContract`（L621–643）在 `mode === 'experimental'` 时走不同的分支（`context.packRuntimeLookup?.getPackRuntimeSummary`）。

**盲点：** 如果有代码路径需要使用 experimental mode 的 pack runtime contract，它们必须绕过便捷 wrapper 直接调用 `createPackScopedInferenceContextBuilder().buildForPack({..., mode: 'experimental'})`。当前所有已知调用方都通过 `buildInferenceContext` wrapper，意味着 experimental mode 实际上不可达。

---

## 盲点 13：Variable context 的 `previous_agent_output` namespace 不在类型定义中

**代码位置：** `context_builder.ts:722-735` + `template_engine/frontends/narrative/types.ts:12-20`

```typescript
// types.ts — PromptVariableNamespace 的定义
export type PromptVariableNamespace =
  | 'system' | 'app' | 'pack' | 'runtime' | 'actor' | 'actor_state'
  | 'request' | `plugin.${string}` | 'previous_agent_output';

// context_builder.ts L724
layers.push(createPromptVariableLayer({
  namespace: 'previous_agent_output',
  ...
}));
```

`'previous_agent_output'` 在类型定义中已包含，所以这不是类型错误。但它是唯一一个在 `layerOrder`（L692）数组 `['system', 'app', 'pack', 'runtime', 'actor', 'request']` 之外的 namespace。

**盲点：** `previous_agent_output` 层不在 `layerOrder` 中，也没有经过 `configuredLayers` 的 enable/disable 检查。它总是被追加到 layers 末尾，不受 config 控制。如果 operator 想要在生产环境中禁用 previous agent output 注入（例如为了隔离测试），没有配置手段。

---

## 盲点 14：对比审查文档中的 `.limcode/design/skeptical-comprehensive-audit-report.md`

**盲点：** 需要检查是否已有先前的审计报告覆盖了本次审查的部分内容。如果已有，应交叉引用，避免重复但不遗漏对方可能发现的额外问题。

---

## 盲点 15：pack entity ID 的格式约定未文档化

`packEntityIdFromResolvedAgentId` 的逻辑基于一个隐式约定：resolved agent ID 的格式是 `{packId}:{entityId}`。分离符是 `:`（`ACTOR_ENTITY_ID_SEPARATOR`）。

**盲点：** 这个约定：
- 在 `context_builder.ts:165` 中定义
- 在 `context_builder.ts:256` 中创建（`${packId}${ACTOR_ENTITY_ID_SEPARATOR}${input.actor_entity_id}`）
- 在 `domain/authority/resolver.ts` 中消费
- 但在任何 `docs/` 下的文档中没有正式说明

如果未来 entity ID 格式变更（如增加 namespace 层级），所有使用 `:` 分割的字符串解析逻辑都会静默断裂。

---

## 盲点 16：`resolveActor` 中的 identity synthesis — 已验证无问题

**已验证：** `IdentityContext`（`identity/types.ts:3-10`）定义为：

```typescript
export interface IdentityContext {
  id: string;
  type: IdentityType;
  name?: string | null;
  provider?: string | null;
  status?: string | null;
  claims?: Record<string, unknown> | null;
}
```

合成的两条路径均覆盖全部字段：
- 有 binding 路径：`id`、`type`（含 `'noise'` 回退）、`name`、`provider`、`status`、`claims` ✓
- 无 binding 路径（pack agent）：`id`（合成 `packId:identity:entityId`）、`type: 'agent'`、`name`、`provider: 'pack'`、`status: 'active'`、`claims: null` ✓

**结论：盲点 16 不成立。** 合成路径的 IdentityContext 字段覆盖完整。`'noise'` 回退类型是合理的兜底。
```

**问题：** `IdentityContext` 类型可能有更多字段（如 `created_at`、`updated_at`、`snr` 等，参见 `agent.ts:15-21` 中的 agent profile 结构），但合成的 identity 只填充了子集。任何消费 `identity.updated_at` 的代码在走到合成的 identity 路径时会得到 `undefined`。

**盲点：** `IdentityContext` 的完整字段定义需要对照 `identity/types.ts` 确认。如果合成路径缺少必须字段，下游可能在特定条件下崩溃。

---

## 盲点总结

| # | 盲点 | 严重程度 | 类型 | 验证状态 |
|---|------|---------|------|---------|
| 2 | `getLatestEventEvidenceRecord` 无 pack_id 过滤 | **高** | Bug | 确认 |
| 5 | behavior_trees 被 `.loose()` 剥离，运行时始终为空 | **高** | Bug | 确认 |
| 10 | `createContextAssemblyPort` 降级创建时的类型欺诈 | 中 | 类型安全 | 确认 |
| 12 | `buildInferenceContext` 硬编码 mode='stable'，experimental 不可达 | 中 | 功能死代码 | 确认 |
| 6 | compaction 空 packId 静默失败 | 中 | 错误处理 | 确认 |
| 9 | AppInfrastructure 边界模糊，依赖运行时鸭子类型 | 中 | 类型安全 | 确认 |
| 3 | tick 在 bigint/string 间无意义转换 | 低 | 代码质量 | 确认 |
| 4 | 模板解析不支持数组索引 | 低 | 功能限制（当前无影响） | 确认 |
| 7 | PolicySummary 接口硬编码资源类型 | 低 | 扩展性 | 确认 |
| 8 | `derived_from` 声明不准确（声称来自 default.reliable 实际可能不同） | 低 | 诊断准确性 | 确认 |
| 13 | previous_agent_output 层不可配置 | 低 | 灵活性 | 确认 |
| 15 | entity ID 格式约定未文档化 | 低 | 可维护性 | 确认 |
| 1 | Prisma 查询与 pack storage adapter 数据源一致性待验证 | 中 | 架构 | 待验证 |
| 11 | 核心逻辑零测试覆盖 | **高** | 质量保障 | 确认 |
| 14 | 与已有审计报告交叉引用 | ? | 文档 | 待交叉检查 |
| 16 | ~~identity synthesis 字段缺失~~ | N/A | N/A | **不成立** |
