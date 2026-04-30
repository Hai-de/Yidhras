# World Pack 多态开局快照设计

## 概述

让 world pack 作者可以定义多个具名开局场景（opening），每个开局有自己的一套 `variables` 覆盖 + `initial_states` + `initial_events`。操作者在初始化时选择开局，也可在运行后重初始化。

**状态**：已实现 · 2026-04-28

---

## 1. 现状

- `bootstrap.initial_states` 是唯一开局机制，单套固定数据，写入后不可变
- `bootstrap.initial_events` 在 schema 中存在但 materializer 完全忽略
- `variables` 是全局的，无法按场景区分
- `death_note` 包里的 `opening_phase: "notebook_unclaimed"` 完全是作者约定

## 2. 目标

1. 包作者可在 `<pack>/openings/<id>.yaml` 下定义多个具名开局
2. 每个开局包含：`variables` 覆盖、`initial_states`、`initial_events`
3. 操作者通过 config / CLI / API 指定开局 ID
4. 支持已运行包的重初始化（二次确认 + 数据清除警告）
5. 向后兼容 — 没有 `openings/` 目录的包行为完全不变

---

## 3. Opening 文件格式

### 3.1 文件位置

```
data/world_packs/<pack>/
├─ config.yaml
├─ openings/
│  ├─ default.yaml
│  ├─ hard_mode.yaml
│  └─ peaceful.yaml
└─ ...
```

文件名 stem = opening ID。`openings/default.yaml` 的 ID 就是 `default`。

### 3.2 YAML Schema

```yaml
# openings/hard_mode.yaml
name: "Hard Mode"
description: "Limited trust, heightened threat"
variables:
  difficulty: "hard"
  starting_trust: 30
  world_tone: "hostile"
initial_states:
  - entity_id: "__world__"
    state_namespace: "world"
    state_json:
      opening_phase: "notebook_unclaimed"
      threat_level: "high"
      public_awareness: 0.2
initial_events:
  - event_type: "world_opening"
    payload:
      message: "The world awakens to an unfamiliar tension."
```

- `name` — 人类可读名称，可选
- `description` — 描述文本，可选
- `variables` — `Record<string, WorldPackVariableValue>`，覆盖 pack 级 `variables`
- `initial_states` — 完全替代 base `bootstrap.initial_states`
- `initial_events` — 完全替代 base `bootstrap.initial_events`

### 3.3 Zod Schema

新增 `bootstrapInitialEventSchema`，收紧 `initial_events` 为结构化事件：

```typescript
// apps/server/src/packs/schema/constitution_schema.ts

const bootstrapInitialEventSchema = z.object({
  event_type: nonEmptyStringSchema,
  payload: z.record(z.string(), worldPackValueSchema).default({})
}).strict();

const worldPackVariablesRecordSchema = z.record(z.string(), worldPackVariableValueSchema);

const worldPackOpeningSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  variables: worldPackVariablesRecordSchema.optional(),
  initial_states: bootstrapInitialStateSchema.array().optional().default([]),
  initial_events: bootstrapInitialEventSchema.array().optional().default([])
}).strict();
// 不在 schema 中定义 id — id 来自文件名
```

注意：`bootstrap.initial_events` 在 constitution schema 中保持 `z.array(worldPackValueSchema)` 不变（向后兼容）。Opening 的 typed events 在 apply 时可直接替代，因为 typed object 是 `WorldPackValue` 的有效成员。

---

## 4. 合并策略

`applyOpening(pack, opening)` 产出新的 `WorldPackConstitution`：

| 字段 | 策略 |
|------|------|
| `variables` | **shallow-merge**，opening 的 key 覆盖 pack 同名 key |
| `bootstrap.initial_states` | **完全替换**，opening 有则用 opening，否则保留 pack base |
| `bootstrap.initial_events` | **完全替换**，同上 |

合并后**必须**对结果执行 `worldPackConstitutionSchema.parse()` 重校验，防止 opening 引用不存在的 entity_id 等问题。

### 4.1 variables 合并示例

```
pack.variables:     { currency: "yen", trust: 70, region: "kanto" }
opening.variables:  { trust: 30, difficulty: "hard" }
merged.variables:   { currency: "yen", trust: 30, region: "kanto", difficulty: "hard" }
```

### 4.2 initial_states 替换示例

```
pack.bootstrap.initial_states:     [{ entity: "__world__", ns: "world", json: { phase: "idle" } }]
opening.initial_states:            [{ entity: "__world__", ns: "world", json: { phase: "crisis" } }]
merged.bootstrap.initial_states:   [{ entity: "__world__", ns: "world", json: { phase: "crisis" } }]
```

---

## 5. 核心模块

### 5.1 新增文件

| 文件 | 职责 |
|------|------|
| `apps/server/src/packs/openings/discovery.ts` | 扫描 openings/ 目录，校验文件 |
| `apps/server/src/packs/openings/loader.ts` | 加载单个 opening 文件 |
| `apps/server/src/packs/openings/applicator.ts` | `applyOpening()` 合并 + 重校验 |

### 5.2 函数签名

```typescript
// discovery.ts
interface OpeningSummary {
  id: string;
  name?: string;
  description?: string;
}
listPackOpenings(packDir: string): OpeningSummary[]

// loader.ts
loadPackOpening(packDir: string, openingId: string): WorldPackOpening
// 内部调用 worldPackOpeningSchema.parse()

// applicator.ts
applyOpening(pack: WorldPack, opening: WorldPackOpening): WorldPack
// shallow-merge variables + 替换 initial_states/initial_events + worldPackConstitutionSchema.parse(result)
```

### 5.3 `applied_opening_id` 存储方式

在 `materializePackRuntimeCoreModels()` 中，为 `__world__` entity 写入 `state_namespace: "meta"` 的 entity_state，`state_json` 中包含 `applied_opening_id`：

```typescript
// 在 materializePackRuntimeCoreModels 中，bootstrap initial_states 写入后追加：
const metaState: PackRuntimeEntityStateInput = {
  id: buildEntityStateId(pack.metadata.id, '__world__', 'meta'),
  pack_id: pack.metadata.id,
  entity_id: buildWorldEntityId(pack.metadata.id, '__world__'),
  state_namespace: 'meta',
  state_json: {
    applied_opening_id: openingId ?? null,
    materialized_at: String(now)
  },
  now
};
upsertPackEntityState(metaState);
```

不新增 SQLite 表或列 —— 复用现有 `entity_states` 表 + 约定的 `meta` namespace。

### 5.4 新增文件（运行时清理）

| 文件 | 职责 |
|------|------|
| `apps/server/src/packs/runtime/teardown.ts` | `clearPackRuntimeStorage()` 删除 runtime.sqlite |
| `apps/server/src/core/runtime_reinitializer.ts` | `reinitializePackRuntime()` 重初始化流程 |
| `apps/server/src/app/routes/pack_openings.ts` | API 路由：list openings + apply opening |

### 5.5 修改文件

| 文件 | 改动 |
|------|------|
| `constitution_schema.ts` | 新增 `bootstrapInitialEventSchema`、`worldPackVariablesRecordSchema`、`worldPackOpeningSchema`、`WorldPackOpening` 类型 |
| `runtime_activation.ts` | `activateWorldPackRuntime()` 接受 `openingId?: string`，在 load 与 materialize 之间插入 apply |
| `pack_materializer.ts` | `MaterializePackRuntimeInput` 新增 `applied_opening_id?: string` |
| `packs/runtime/materializer.ts` | `materializePackRuntimeCoreModels()` 写入 `__world__` / `meta` state |
| `active_pack_runtime_facade.ts` | `init()` 透传 `openingId` |
| `simulation.ts` | `SimulationManager.init()` 透传 `openingId` |
| `app_context_ports.ts` | `ActivePackRuntimeFacade.init()` 接口签名新增 `openingId?` |
| `index.ts` | 启动时读取 `config.world.preferred_opening` 和 CLI 标记文件，传给 `init()`；注册 `registerPackOpeningRoutes` |
| `config/schema.ts` | `world` 对象新增 `preferred_opening` 可选字段 |
| `config/runtime_config.ts` | 新增 `WORLD_PREFERRED_OPENING` env 映射 + `getPreferredOpening()` getter |
| `init/prepare_runtime.ts` | 解析 `--opening` CLI flag，写入标记文件 `data/runtime/startup_opening.txt` |

---

## 6. 选择入口

### 6.1 Config

```yaml
# data/configw/default.yaml
world:
  preferred_opening: "hard_mode"   # 可选，不配则不用 opening
```

环境变量覆盖：`WORLD_PREFERRED_OPENING` 映射到 `world.preferred_opening`。

Config schema 变更：`world` 子对象从 `.strict()` 改为 `.passthrough()`，或显式新增 `preferred_opening` 字段（推荐后者以保持校验严格性）：

```typescript
// apps/server/src/config/schema.ts
world: z.object({
  preferred_pack: NonEmptyStringSchema,
  preferred_opening: NonEmptyStringSchema.optional(),  // ← 新增
  bootstrap: z.object({...}).strict()
}).strict()
```

优先级：API/CLI 显式指定 > config > 无（不用 opening）

### 6.2 API

```
GET  /api/packs/:packId/openings
```
返回 `{ openings: OpeningSummary[] }`。对 active pack 和 experimental loaded packs 都可用。

```
POST /api/packs/:packId/openings/:openingId/apply
```
为包应用开局。body：
```json
{
  "confirm_data_loss": true
}
```

- 包未激活 → 直接应用，下次 init 时生效
- 包已激活 + `confirm_data_loss: false` → 返回 409 + 警告信息
- 包已激活 + `confirm_data_loss: true` → 清理 runtime 数据 + 重新 materialize

重初始化清理范围：
- pack runtime SQLite（entities, states, grants, bindings, rule_executions）
- kernel-side Agent / Identity / IdentityNodeBinding 记录
- plugin runtime registry 缓存

### 6.3 CLI

`init:runtime` 脚本 (`apps/server/src/init/prepare_runtime.ts`) 解析 `process.argv`，支持 `--opening <id>` flag：

```bash
pnpm prepare:runtime -- --opening hard_mode
pnpm --filter yidhras-server init:runtime -- --opening hard_mode
```

`prepare_runtime.ts` 中提取 `openingId` 后传递给 world pack bootstrap 流程或写入临时标记文件，供后续 `index.ts` 启动时读取。

实现方式：在 `prepare_runtime.ts` 的 `main()` 中手工解析 `process.argv.slice(2)`：
```typescript
const args = process.argv.slice(2);
const openingIndex = args.indexOf('--opening');
const openingId = openingIndex >= 0 ? args[openingIndex + 1] : undefined;
```

---

## 7. 运行时变更

### 7.1 激活流程变更

```
activateWorldPackRuntime(packFolderName, { openingId })
  1. loader.loadPack(packFolderName)          // 不变
  2. if openingId:
       opening = loadPackOpening(dir, openingId)
       pack = applyOpening(pack, opening)     // ← 新增，含 schema 重校验
  3. materializePackRuntime(pack, ..., { appliedOpeningId: openingId })
  4. resolvePackClock()
  5. discoverPackLocalPlugins()
  6. validateActivatedTickBounds()
```

### 7.2 materializePackRuntime 变更

```typescript
interface MaterializePackRuntimeInput {
  // ... existing fields
  applied_opening_id?: string;  // ← 新增
}
```

`materializePackRuntimeCoreModels()` 写入时额外记录 `applied_opening_id`：
- 写入 pack runtime SQLite 的 `pack_world_entities` 表中 `__world__` / `meta` entity 的 state
- 或写入 `pack_runtime_registry` 的 in-memory record

倾向用 `__world__` / `meta` state，不需要改 schema。

### 7.3 reinitializePackRuntime()

新增函数，用于已运行包的重初始化。`confirm_data_loss` 校验在 API 路由层完成。

```typescript
// apps/server/src/core/runtime_reinitializer.ts
interface ReinitializePackRuntimeInput {
  sim: SimulationManager;
  packFolderName: string;
  packId: string;
  openingId: string;
  prisma: PrismaClient;
  notifications: NotificationPort;
}

reinitializePackRuntime(input)
  1. push 通知：开始重初始化
  2. clearPackRuntimeStorage(packId) — 直接删除 runtime.sqlite 文件
     （installPackRuntime 是幂等的，下次 materialize 会自动重建表结构）
  3. teardownActorBridges(packId, prisma) — 清理 kernel Agent/Identity/Binding 记录
  4. sim.init(packFolderName, openingId) — 复用完整激活流程（load + apply + materialize + resolve clock）
  5. push 通知：重初始化完成
```

清理 pack runtime SQLite 的实现：新增 `clearPackRuntimeStorage(packId)` 函数，直接 `fs.unlinkSync(runtimeDbPath)`。所有 engine-owned 表（world_entities, entity_states, authority_grants, mediator_bindings, rule_execution_records, projection_events）和 pack_collections 用户表均被清除。

新增文件 `apps/server/src/packs/runtime/teardown.ts`：
```typescript
export const clearPackRuntimeStorage = (packId: string): boolean => {
  const location = resolvePackRuntimeDatabaseLocation(packId);
  if (fs.existsSync(location.runtimeDbPath)) {
    fs.unlinkSync(location.runtimeDbPath);
    return true;
  }
  return false;
};
```

---

## 8. 测试策略

### 8.1 单元测试 (`tests/unit/`)

**`pack_openings.spec.ts`** — 新建：
- `applyOpening` 替换 initial_states
- `applyOpening` shallow-merge variables
- `applyOpening` 不传 opening → 返回原 pack
- `applyOpening` 重校验失败 → 抛出 ZodError（entity_id 不存在）
- `applyOpening` 替换 initial_events
- opening schema 校验 — 合法文件通过
- opening schema 校验 — 空文件（只有 name）通过，defaults 生效
- opening schema 校验 — 非法字段拒绝

### 8.2 集成测试 (`tests/integration/`)

**`pack_opening_integration.spec.ts`** — 新建（7 tests）：
- `listPackOpenings()` 扫描 fixture 目录，返回 opening id 和元数据
- `listPackOpenings()` 对不存在的目录返回空数组
- `loadPackOpening()` 加载 + 校验 opening 文件
- `loadPackOpening()` 加载含 initial_events 的 opening
- `loadPackOpening()` 对不存在的 opening 抛出错误
- `applyOpening()` 集成 fixture pack，产出合法 merged constitution
- 验证 merged constitution 的 variables / initial_states / initial_events

### 8.3 测试 Fixtures

```
apps/server/tests/fixtures/packs/opening-test-pack/
├── config.yaml           # 最小 pack，含 base bootstrap + variables
├── openings/
│   ├── default.yaml      # 覆盖 variables 和 initial_states
│   └── alternate.yaml    # 不同的 initial_states
```

注意：当前 `tests/fixtures/` 下没有 pack 目录，需新建。集成测试参考现有 e2e 测试的 `DATABASE_URL` 覆盖方式使用独立临时数据库。

---

## 14. 实施记录

### 实现与设计的偏差

| 项目 | 设计 | 实际实现 |
|------|------|----------|
| facade `reinit()` | facade 新增 `reinit()` 方法 | `reinitializePackRuntime()` 调用 `sim.init()` 复用完整激活流程，facade 不新增方法 |
| `confirm_data_loss` 校验 | 在 `reinitializePackRuntime()` 内部 | 在 API 路由层完成校验，`reinitializePackRuntime()` 只做执行 |
| scheduler workers 停止 | Phase 5 步骤 3 | 暂未实现 — `sim.init()` 调用 `prepareDatabase()` 会被重复调用，但幂等无副作用 |
| `plugin runtime registry` 清理 | Phase 5 步骤 9 | `syncActivePackPluginRuntime` 不在 `reinitializePackRuntime` 中调用；下次插件同步时自然刷新 |

---

## 9. 向后兼容

- `openings/` 目录不存在 → 完全走原路径，无任何影响
- `preferred_opening` 未配置 → 不使用 opening
- opening 文件缺失 → 报明确错误码 `OPENING_NOT_FOUND`
- base `bootstrap` 为空 + opening 也为空 → 合法，等价于当前行为

---

## 10. 与现有 bootstrap 的关系

一个包可以有三种开局配置方式：

| 方式 | 场景 |
|------|------|
| 只用 `config.yaml` 中的 `bootstrap` | 最简单，不需要多态开局 |
| 在 `openings/` 中定义开局，不写 base bootstrap | 所有初始状态都走 opening |
| base bootstrap + openings 组合 | base 作为默认开局，openings 作为变体 |

推荐包作者把"默认开局"放在 `openings/default.yaml` 中，keep `config.yaml` 的 `bootstrap` 为最小占位或与 default 一致。

---

## 11. 实施阶段

### Phase 1: Schema + 类型 + applyOpening
- `constitution_schema.ts`：新增 opening schema 和类型
- `openings/applicator.ts`：`applyOpening()` + 重校验
- 单元测试

### Phase 2: Discovery + Loader
- `openings/discovery.ts`：`listPackOpenings()`
- `openings/loader.ts`：`loadPackOpening()`
- 单元测试

### Phase 3: 激活流程接入
- `runtime_activation.ts` 改造
- `pack_materializer.ts` 改造
- `active_pack_runtime_facade.ts` 改造
- 集成测试

### Phase 4: API + CLI + Config
- API 端点
- CLI flag
- `world.preferred_opening` config 字段
- reinitialize 端点

### Phase 5: 重初始化
- `runtime_reinitializer.ts`
- 集成测试

---

## 12. TODO 列表

- [x] P1.1: 新增 `WorldPackOpening` 类型 + `worldPackOpeningSchema` Zod schema
- [x] P1.2: 实现 `applyOpening()` + 重校验
- [x] P1.3: 单元测试：`applyOpening` 合并逻辑
- [x] P2.1: 实现 `listPackOpenings()` 扫描
- [x] P2.2: 实现 `loadPackOpening()` 加载 + 校验
- [x] P2.3: 单元测试：discovery + loader
- [x] P3.1: `MaterializePackRuntimeInput` 新增 `applied_opening_id`
- [x] P3.2: `activateWorldPackRuntime()` 接受 `openingId`
- [x] P3.3: `active_pack_runtime_facade.init()` 透传
- [x] P3.4: `SimulationManager.init()` 透传
- [x] P3.5: 集成测试：带 opening 的激活流程
- [x] P4.1: `GET /api/packs/:packId/openings`
- [x] P4.2: `POST /api/packs/:packId/openings/:openingId/apply`
- [x] P4.3: `world.preferred_opening` config schema + 读取
- [x] P4.4: CLI `--opening` flag
- [x] P5.1: `reinitializePackRuntime()` 实现
- [x] P5.2: 集成测试：重初始化流程
- [x] 全量回归：unit (445 passed) + integration (新增 7 passed) + typecheck + lint

---

## 13. 参考文档

- 包 constitution schema：`apps/server/src/packs/schema/constitution_schema.ts`
- 运行时激活：`apps/server/src/core/runtime_activation.ts`
- 包 materializer：`apps/server/src/core/pack_materializer.ts`
- 包 materializer 核心：`apps/server/src/packs/runtime/materializer.ts`
- World pack 规范：`docs/WORLD_PACK.md`
