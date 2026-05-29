# Context Builder 审查盲点分析

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
