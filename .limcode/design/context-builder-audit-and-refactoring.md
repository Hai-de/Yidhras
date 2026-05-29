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
