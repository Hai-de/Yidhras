<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/group-collective-entity-kind-design.md","contentHash":"sha256:c0091435d6727b1a83201e68ff8eb32da7cbecaba54afa378ef1a7b5dc5922a9"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 更新 world engine contract：允许 collective entity kind 与 member_of selector  `#contract`
- [x] 更新 WORLD_PACK 文档与 cyberpunk 世界包草稿示例  `#docs-and-draft`
- [x] 更新 runtime materializer：materialize collectives 为 world entity 与 core state，且不桥接为 actor agent  `#materializer`
- [x] 更新 authority resolver：实现 member_of 匹配逻辑和 matched_via 类型  `#resolver`
- [x] 更新 pack schema：加入 collective entity kind、collectives 分类、member_of selector 与校验  `#schema`
- [x] 补充 schema、resolver、materializer/contract 相关测试  `#tests`
- [x] 运行类型检查与单元测试，修复发现的问题  `#validation`
<!-- LIMCODE_TODO_LIST_END -->

# Group / Collective Entity 机制实施计划

## 来源设计

- 设计文档：`.limcode/design/group-collective-entity-kind-design.md`
- 本计划严格以该设计为来源：新增 `kind: "collective"`，新增 `target_selector.kind: "member_of"`，成员关系第一版存储在 member entity 的 `core.state.member_of` 中。

## 目标

实现第一版 group/collective 机制：

1. world pack schema 接受 `entities.collectives[]` 与 `kind: "collective"`；
2. world engine contract 接受 `entity_kind: "collective"`；
3. authority schema 接受 `target_selector.kind: "member_of"`，并要求 `entity_id`；
4. authority resolver 能把授予 group 的 capability 解析给其成员；
5. materializer 能把 `entities.collectives` 写入 runtime world entities 与 core state；
6. 测试覆盖 schema、materializer/loader、resolver 与 contract；
7. 文档和赛博朋克草稿同步使用新机制。

## 非目标

本轮不实现：

- group state 自动继承；
- group 解散/成员退出级联行为；
- 群体内通信；
- collective 作为可调度 AI subject；
- 独立 membership 表；
- 历史数据迁移或向后兼容。

项目未上线且仅单人使用，因此允许直接破坏旧数据、重写示例包和草稿，不做兼容层。

## 当前代码关键观察

### Schema 层

- `apps/server/src/packs/schema/common_schema.ts`
  - `packEntityKindSchema` 当前不含 `collective`。
  - `packReferenceKindSchema` 当前不含 `member_of`。
- `apps/server/src/packs/schema/constitution_schema.ts`
  - `entities` 当前包含 `actors`、`artifacts`、`mediators`、`domains`、`institutions`。
  - 顶层 `superRefine` 收集 entity ids 时只遍历上述集合。
  - `targetSelectorSchema` 当前未校验 `member_of`。

### Runtime/materializer 层

- `apps/server/src/packs/runtime/materializer.ts`
  - 当前分别 materialize actors/artifacts/domains/institutions/mediators。
  - 需要新增 collectives loop。
  - collective state 应写入 `state_namespace: "core"`。

### Authority resolver 层

- `apps/server/src/domain/authority/resolver.ts`
  - 当前实现 `direct_entity`、`holder_of`、`subject_entity`、`all_actors`、`entity_type_is`。
  - 需要新增 `member_of`。
  - `matched_via` 联合类型需要加入 `'member_of'`。

### Contract 层

- `packages/contracts/src/world_engine.ts`
  - `WORLD_ENTITY_BASE_KINDS` 当前不含 `collective`、`relay`、`persona`。
  - `worldBindingKindSchema` 当前不含 `member_of`，且与 server schema/documentation 不完全一致。

## 实施步骤

### 1. 更新 pack schema 基础枚举

文件：`apps/server/src/packs/schema/common_schema.ts`

修改：

1. `packEntityKindSchema` 加入 `collective`。
2. `packReferenceKindSchema` 加入 `member_of`。

建议顺序：

```ts
export const packEntityKindSchema = z.enum([
  'actor',
  'collective',
  'artifact',
  'mediator',
  'domain',
  'institution',
  'abstract_authority',
  'state_transform',
  'relay',
  'persona'
]);
```

`packReferenceKindSchema` 中加入：

```ts
'member_of'
```

### 2. 更新 world pack constitution schema

文件：`apps/server/src/packs/schema/constitution_schema.ts`

#### 2.1 entities schema 加入 collectives

在 entities object schema 中加入：

```ts
collectives: z.array(entityDefinitionSchema).default([])
```

并在 default object 中加入：

```ts
collectives: []
```

#### 2.2 duplicate id 检查加入 collectives

在 entities 内部 duplicate id 检查中，将 collectives id 纳入统一集合。

当前附近逻辑会汇总：

- actors
- artifacts
- mediators
- domains
- institutions

需要加入：

```ts
...value.collectives.map(item => item.id)
```

#### 2.3 顶层 entityIds 收集加入 collectives

顶层 `superRefine` 当前收集 `value.entities` 下 actors/domains/artifacts/institutions/mediators。

加入：

```ts
for (const collective of value.entities.collectives ?? []) {
  entityIds.add(collective.id);
}
```

这可保证 identities、authorities、mediator/entity refs 等引用校验能识别 collective。

#### 2.4 target selector validation 加入 member_of

`targetSelectorSchema.superRefine()` 中，`member_of` 必须要求 `entity_id`。

将 `member_of` 加入需要 `entity_id` 的 selector kind 列表：

```ts
if (
  value.kind === 'holder_of' ||
  value.kind === 'binding_of' ||
  value.kind === 'direct_entity' ||
  value.kind === 'domain_owner' ||
  value.kind === 'member_of'
) {
  ...
}
```

### 3. 更新 runtime materializer

文件：`apps/server/src/packs/runtime/materializer.ts`

在 institutions loop 前后新增 collectives loop：

```ts
for (const collective of pack.entities?.collectives ?? []) {
  putWorldEntity(
    createWorldEntityInput(packId, collective.id, collective.kind ?? 'collective', collective.label, now, {
      entityType: collective.entity_type ?? null,
      tags: collective.tags,
      staticSchemaRef: collective.static_schema_ref ?? null,
      payload: collective
    })
  );

  if (collective.state) {
    const expandedState = expandStateJson(collective.state, expandScope);
    putEntityState(createEntityStateInput(packId, collective.id, 'core', expandedState, now));
  }
}
```

注意：

- 不要把 collective 纳入 `materializeActorBridges()`。
- collective 不生成 Agent/Identity bridge。
- collective 第一版只是 world entity + state holder。

### 4. 更新 authority resolver

文件：`apps/server/src/domain/authority/resolver.ts`

#### 4.1 类型扩展

将 `ResolvedCapabilityItem.provenance.matched_via` 加入：

```ts
'member_of'
```

`resolveTargetSelectorMatch()` 返回类型也加入。

#### 4.2 添加 helper

新增：

```ts
const asStringArray = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return [];
};
```

#### 4.3 实现 member_of selector

在 `entity_type_is` 分支附近新增：

```ts
if (kind === 'member_of' && typeof targetSelector.entity_id === 'string') {
  const entities = await listPackWorldEntities(context.packStorageAdapter, packId);
  const groupExists = entities.some(e => e.id === targetSelector.entity_id);
  if (!groupExists) return null;

  const states = await listPackEntityStates(context.packStorageAdapter, packId);
  const subjectState = states.find(
    state =>
      candidateEntityIds.includes(state.entity_id) &&
      state.state_namespace === 'core'
  );

  const memberships = asStringArray(subjectState?.state_json?.member_of);
  return memberships.includes(targetSelector.entity_id) ? 'member_of' : null;
}
```

注意：

- 第一版只检查 group entity 存在，不强制 `entity_kind === 'collective'`。
- 允许 `member_of` 为字符串或字符串数组。
- 如果 group entity 不存在，必须不匹配。

### 5. 更新 world engine contract

文件：`packages/contracts/src/world_engine.ts`

#### 5.1 entity base kind 加入 collective，并与 server schema 收敛

更新 `WORLD_ENTITY_BASE_KINDS`：

```ts
const WORLD_ENTITY_BASE_KINDS = [
  'actor',
  'collective',
  'artifact',
  'domain',
  'institution',
  'mediator',
  'state_transform',
  'abstract_authority',
  'relay',
  'persona'
] as const;
```

#### 5.2 binding/target selector kind 加入 member_of

更新 `worldBindingKindSchema`，加入：

```ts
'member_of'
```

可选择顺手把 server schema 中已有但 contract 缺失的 selector 也同步进去：

- `binding_of`
- `domain_owner`
- `ritual_participant`

但由于 resolver 当前未实现这三种，建议本轮至少加入 `member_of`，并在文档中单独记录 selector 不一致清理项；如果测试暴露 contract/schema 不一致，则一并收敛。

### 6. 更新文档

文件：`docs/specs/WORLD_PACK.md`

#### 6.1 entity kind 文档

在 entity kind 说明处加入 `collective`。如果当前文档没有集中列 entity kind，则新增一小节说明：

- `collective`：群体/集合实体，表示成员共享群体身份，但第一版不自动继承 state，不参与调度。

#### 6.2 target_selector 表格加入 member_of

在 `## 2.4 权限与 target_selector` 的 selector 表格中加入：

| kind | 必需字段 | 匹配逻辑 |
|---|---|---|
| `member_of` | `entity_id` | 匹配 subject core state 中 `member_of` 包含该 group entity id 的实体 |

#### 6.3 添加 YAML 示例

新增示例：

```yaml
entities:
  collectives:
    - id: "jailbreakers_current"
      label: "第 9 届匿名越狱者集合"
      kind: "collective"
      entity_type: "jailbreaker_cohort"
      state:
        cohort: 9
        shared_reputation: 0

  actors:
    - id: "jailbreaker_001"
      label: "匿名参赛者 001"
      kind: "actor"
      entity_type: "jailbreaker"
      state:
        exploit: 72
        stealth: 81
        persistence: 66
        member_of: ["jailbreakers_current"]

authorities:
  - id: "grant-current-jailbreakers-attempt"
    source_entity_id: "ugc"
    target_selector:
      kind: "member_of"
      entity_id: "jailbreakers_current"
    capability_key: "invoke.jailbreak_attempt"
    grant_type: "institutional"
```

### 7. 更新赛博朋克世界包草稿

文件：`.limcode/design/cyberpunk-ai-oligarchy-world-pack-draft.md`

将 `jailbreakers_current` 从 workaround 语义改为正式 collective 表达：

1. 新增/调整：

```yaml
entities:
  collectives:
    - id: "jailbreakers_current"
      kind: "collective"
      entity_type: "jailbreaker_cohort"
```

2. 给相关 jailbreaker actors 添加：

```yaml
state:
  member_of: ["jailbreakers_current"]
```

3. 将需要“第 9 届当前参赛者”而非“所有 jailbreaker 类型”的 authority 从：

```yaml
target_selector:
  kind: "entity_type_is"
  entity_type: "jailbreaker"
```

改为：

```yaml
target_selector:
  kind: "member_of"
  entity_id: "jailbreakers_current"
```

保留确实表示“所有 jailbreaker 类型”的 `entity_type_is` 用法。

### 8. 测试计划

#### 8.1 schema 测试

文件：`apps/server/tests/unit/world_pack_schema.spec.ts`

新增测试：

1. 接受 `entities.collectives`；
2. 接受 `kind: "collective"`；
3. 接受 `target_selector.kind: "member_of"` + `entity_id`；
4. 拒绝缺少 `entity_id` 的 `member_of` selector；
5. duplicate id 检查覆盖 collectives 与其他 entity 分类冲突。

#### 8.2 authority resolver 测试

文件：`apps/server/tests/unit/authority_resolver.spec.ts`

新增 describe：`resolveAuthorityForSubject member_of selector`。

覆盖：

1. `member_of` 数组包含 group id → 返回 capability；
2. `member_of` 字符串等于 group id → 返回 capability；
3. `member_of` 不包含 group id → blocked；
4. subject 没有 core state → blocked；
5. group entity 不存在 → blocked；
6. provenance `matched_via` 为 `member_of`；
7. actor 同时属于多个 group 时，不同 group grant 分别解析。

#### 8.3 materializer 测试

如果已有 materializer 单测，新增 collectives case；如果没有，则在最接近的 pack runtime/materialization 测试中验证：

1. `entities.collectives` materialize 为 `world_entities`；
2. entity kind 为 `collective`；
3. state 写入 `entity_states`，namespace 为 `core`；
4. collective 不产生 actor bridge。

#### 8.4 contract 测试

在合适的 contract/schema 测试中验证：

1. `worldEntitySnapshotSchema` 接受 `entity_kind: "collective"`；
2. authority grant snapshot 接受 `target_selector_json.kind: "member_of"`，如果 contract 对该字段有 kind 校验。

### 9. 验证命令

实施后建议运行：

```bash
pnpm --filter @yidhras/server test:unit
pnpm --filter @yidhras/contracts test
pnpm test
```

若 package scripts 不完全匹配，先查看：

```bash
cat apps/server/package.json
cat packages/contracts/package.json
```

至少需要确保：

- TypeScript 编译通过；
- server unit tests 通过；
- world pack schema tests 通过；
- authority resolver tests 通过。

## 风险与注意事项

1. **loader 是否固定枚举 entities 分类**  
   已观察到 constitution schema 与 materializer 均固定枚举分类，因此需要明确加入 `collectives`。

2. **schema/contract/resolver selector 不一致**  
   现有 `binding_of`、`domain_owner`、`ritual_participant` 已存在不一致。本计划不强制一次性实现这三者，但实施时若触发测试或类型问题，应同步整理。

3. **member_of 是普通 state 字段**  
   没有 DB 外键。第一版依赖 resolver 检查 group entity 存在，后续可加 pack load validation。

4. **collective 不应桥接成 agent**  
   不要把 collectives 加入 `materializeActorBridges()`。

5. **不做向后兼容**  
   如果现有草稿或 fixture 使用 workaround，可直接改成新结构，不需要同时保留旧写法。

## 验收标准

完成后应满足：

1. world pack 可以定义 `entities.collectives`；
2. `kind: "collective"` 被 server schema 和 contract 接受；
3. materializer 将 collective 写入 runtime world entity，并写入 core state；
4. `target_selector.kind: "member_of"` 在 schema 中合法，缺少 `entity_id` 非法；
5. resolver 能把 group grant 解析给 `member_of` 成员；
6. resolver 不会在 group entity 不存在时匹配；
7. `matched_via` 能记录为 `member_of`；
8. 文档包含 `collective` 和 `member_of` 示例；
9. cyberpunk 草稿中的 `jailbreakers_current` 使用正式 collective 机制；
10. 相关单元测试通过。
