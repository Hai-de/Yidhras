# 同一世界包多副本区分机制 — 实现方案

> **实现状态**: 已完成（2026-05-23）。实施计划见 `.limcode/plans/same-pack-multi-instance-implementation.md`。
> 修复了一个代码 bug：`context_builder.ts:buildForPack()` 中有 5 处使用 `pack.metadata.id` 进行运行时查询，已统一改为 `input.pack_id`（instance_id）。

## 问题

`metadata.id` 在系统中承担双重角色：既表达"这是什么世界包"，又作为"这是哪个运行实例"的唯一标识。两个目录声明相同 `metadata.id` 时，loader 缓存互相覆盖、registry 无法同时加载、运行时数据库路径冲突、操作员绑定无法区分。

## 核心概念

引入 `instance_id` 作为实例级标识，`metadata.id` 降为类型/模板标识。

```
instance_id = pack.yaml 中 metadata.instance_id ?? 目录名(folder_name)
```

```
┌──────────────────────────────────────────────────┐
│  pack.yaml                                        │
│  metadata.id        = "world-death-note"           │  ← 类型身份（可跨实例共享）
│  metadata.instance_id = "dn-prod"    (可选)        │  ← 实例标识（覆盖目录名）
│  metadata.name      = "Death Note World"           │
└──────────────────────────────────────────────────┘
                        │
                        ▼  instance_id = metadata.instance_id ?? folder_name
                        │
┌──────────────────────────────────────────────────┐
│  全系统以 instance_id 为主键                        │
│  - registry:        hosts.get(instance_id)         │
│  - runtime SQLite:  data/world_packs/<instance_id>/│
│  - API 路由:        /:packId 承载 instance_id       │
│  - operator binding: pack_id = instance_id          │
│  - 前端 URL:        /packs/<instance_id>/overview   │
└──────────────────────────────────────────────────┘
```

### 单实例场景兼容性

现有 pack，目录 `world-death-note/`，`metadata.id = "world-death-note"`，无 `instance_id` 字段：

→ `instance_id = "world-death-note"` = 原来的 `metadata.id` 值

**系统行为完全不变，零配置变更。**

---

## 设计决策

### 决策 1：`instance_id` 来源

**默认等于目录名，`pack.yaml` 中 `metadata.instance_id` 可覆盖。**

目录名在文件系统上天然唯一。显式覆盖用于需要稳定标识（不受目录重命名影响）的场景。

### 决策 2：权限绑定到 `instance_id`

不同实例是独立运行时环境（dev/staging/experiment），访问控制应独立。"按类型一键绑定所有实例"作为后续便利功能。

### 决策 3：运行时数据按实例完全隔离

snapshot、runtime SQLite、plugin runtime 全部按 `instance_id` 隔离。路径从 `data/world_packs/<metadata.id>/` 变为 `data/world_packs/<instance_id>/`。pack 源文件继续位于 `data/world_packs/<folder_name>/`。

### 决策 4：前端 URL 保持 `/packs/:packId` 模式

URL 结构和路由参数名不变，但 `:packId` 承载的值从 `metadata.id` 变为 `instance_id`。前端 `route.params.packId` 自动获得 `instance_id` 值。

---

## 分层实现

### 第 1 层：合约与 Schema

**文件**: `packages/contracts/src/schemas/pack.ts`（或 constitution schema 定义处）

```typescript
// metadata schema 新增可选字段
instance_id: z.string().min(1).optional()
```

### 第 2 层：Manifest 加载

**文件**: `apps/server/src/packs/manifest/loader.ts`

```typescript
export class PackManifestLoader {
  // key = folderName（不再用 metadata.id 做键）
  private packs: Map<string, WorldPack> = new Map();
  // 反向索引：instanceId → folderName，用于 O(1) 查找和冲突检测
  private instanceIndex: Map<string, string> = new Map();

  public deriveInstanceId(pack: WorldPack, folderName: string): string {
    const explicit = (pack.metadata as Record<string, unknown>).instance_id as string | undefined;
    return explicit?.trim() || folderName;
  }

  public loadPack(folderName: string): WorldPack {
    if (this.packs.has(folderName)) {
      return this.packs.get(folderName)!;
    }

    // ... 读取 pack.yaml、resolveIncludes、parseWorldPackConstitution（不变）...

    const instanceId = this.deriveInstanceId(parsed, folderName);

    // 冲突检测
    const existingFolder = this.instanceIndex.get(instanceId);
    if (existingFolder && existingFolder !== folderName) {
      throw new Error(
        `instance_id conflict: "${instanceId}" claimed by both "${existingFolder}" and "${folderName}"`
      );
    }

    this.packs.set(folderName, parsed);
    this.instanceIndex.set(instanceId, folderName);
    return parsed;
  }

  public getPackByFolderName(folderName: string): WorldPack | undefined {
    return this.packs.get(folderName);
  }

  public getPackByInstanceId(instanceId: string): WorldPack | undefined {
    const folderName = this.instanceIndex.get(instanceId);
    return folderName ? this.packs.get(folderName) : undefined;
  }

  public getFolderNameByInstanceId(instanceId: string): string | undefined {
    return this.instanceIndex.get(instanceId);
  }

  // 原 getPack(idOrFolderName) 移除 —— 不再支持按 metadata.id 查找
}
```

**文件**: `apps/server/src/packs/schema/constitution_schema.ts`

`metadataSchema` 新增 `instance_id: z.string().min(1).optional()`。

### 第 3 层：Catalog 服务

**文件**: `apps/server/src/packs/orchestration/pack_catalog_service.ts`

```typescript
export interface PackInstanceInfo {
  instanceId: string;
  metadataId: string;
  folderName: string;
  name: string;
  version: string;
}

export class DefaultPackCatalogService implements PackCatalogService {
  // 主解析方法：按 instance_id → folder_name 顺序匹配
  // 不再匹配 metadata.id（调用者不应再通过类型 ID 定位实例）
  public resolvePackByIdOrFolder(packRef: string): PackResolution | null {
    const normalized = packRef.trim();
    if (!normalized) return null;

    // 1. instance_id 精确匹配
    const byInstance = this.resolveByInstanceId(normalized);
    if (byInstance) return byInstance;

    // 2. folder_name 精确匹配（fallback）
    for (const folderName of this.listAvailablePacks()) {
      if (folderName === normalized) {
        const pack = this.loader.loadPack(folderName);
        return { pack, packFolderName: folderName };
      }
    }

    return null;
  }

  public resolveByInstanceId(instanceId: string): PackResolution | null {
    const folderName = this.loader.getFolderNameByInstanceId(instanceId);
    if (!folderName) return null;
    const pack = this.loader.loadPack(folderName);
    return { pack, packFolderName: folderName };
  }

  public listAllInstances(): PackInstanceInfo[] {
    return this.listAvailablePacks().map(folderName => {
      const pack = this.loader.loadPack(folderName);
      return {
        instanceId: this.loader.deriveInstanceId(pack, folderName),
        metadataId: pack.metadata.id,
        folderName,
        name: pack.metadata.name,
        version: pack.metadata.version
      };
    });
  }
}
```

**`resolvePackByIdOrFolder` 移除 `metadata.id` 匹配的说明**：此变更与 API 路由改造（第 6 层）必须原子完成 —— 路由改造后 URL 中的 `:packId` 承载的已是 `instance_id`，`metadata.id` 匹配不再需要。实施时第 3 层和第 6 层合并在同一 commit。

### 第 4 层：运行时核心

**4.1 `pack_runtime_handle.ts`**

```typescript
export interface PackRuntimeHandle {
  instance_id: string;       // 实例标识（原 pack_id）
  metadata_id: string;       // 类型标识（新增）
  pack_folder_name: string;  // 不变
  pack: WorldPack;
  getClockSnapshot(): PackRuntimeClockSnapshot;
  getRuntimeSpeedSnapshot(): RuntimeSpeedSnapshot;
  getHealthSnapshot(): PackRuntimeHealthSnapshot;
}
```

消费者审计：

| 文件 | 原引用 | 改为 |
|------|--------|------|
| `pack_runtime_registry_service.ts:getStatus()` | `handle.pack_id` | `handle.instance_id` |
| `routes/packs.ts` 构建 runtimeStatusMap | key 为 `metadata.id` | key 为 `instance_id` |
| `routes/experimental_runtime.ts` | `handle.pack_id` | `handle.instance_id` |
| `routes/system.ts` 返回 RuntimeWorldMetadata | `id` = `handle.pack_id` | `id` = `handle.instance_id`，新增 `metadata_id` 字段 |
| `runtime_clock_projection.ts` | `handle.pack_id` | `handle.instance_id` |
| `pack_runtime_registry_service.ts:load()` world engine | `snapshot.pack_id` = `packId` | `snapshot.pack_id` = `instanceId` |

**4.2 `pack_runtime_instance.ts`**

```typescript
export interface PackRuntimeInstanceOptions {
  pack: WorldPack;
  packFolderName: string;
  instanceId: string;          // NEW: 必填
  clock?: ChronosEngine;
  runtimeSpeed?: RuntimeSpeedPolicy;
  initialStatus?: PackRuntimeHealthSnapshot['status'];
  initialMessage?: string | null;
}

// 构造函数内
this.handle = {
  instance_id: options.instanceId,
  metadata_id: this.pack.metadata.id,
  pack_folder_name: this.packFolderName,
  pack: this.pack,
  getClockSnapshot: () => this.getClockSnapshot(),
  getRuntimeSpeedSnapshot: () => this.getRuntimeSpeedSnapshot(),
  getHealthSnapshot: () => this.getHealthSnapshot()
};

// getPackId() 返回 instance_id
public getPackId(): string {
  return this.handle.instance_id;
}
```

**4.3 `pack_runtime_registry.ts`**

所有方法签名不变（参数名仍为 `packId`），但语义变为 `instance_id`。接口和 `InMemoryPackRuntimeRegistry` 的 `hosts` / `states` Map 键均使用 `instance_id`。

```typescript
// 在接口和实现类上加 JSDoc 标注
/** @param packId — instance_id (not metadata.id) */
```

**4.4 `pack_runtime_health.ts`**

```typescript
export interface PackRuntimeStatusSnapshot {
  instance_id: string;       // 新增
  metadata_id: string;       // 新增
  pack_folder_name: string;
  health_status: 'loaded' | 'running' | 'paused' | 'stopped' | 'failed';
  current_tick: string;
  runtime_speed: RuntimeSpeedSnapshot;
  startup_level: 'ok' | 'degraded' | 'fail';
  runtime_ready: boolean;
  message?: string | null;
}
```

`ExperimentalPackRuntimeStatusRecord` 同理新增 `instance_id` / `metadata_id`。

**4.5 `pack_db_locator.ts`**

`getPackRootDir(packId)` 的 `packId` 参数语义变更为 `instance_id`。路径 `data/world_packs/<instance_id>/`。

### 第 5 层：Materializer 链路（关键：原设计盲点）

**这是整个方案最核心的改造点。** 当前 `materializePackRuntime` → `installPackRuntime` → `materializePackRuntimeCoreModels` / `materializeActorBridges` 整条链路内部硬编码 `const packId = pack.metadata.id`，`instance_id` 传不进去。

**5.1 `MaterializePackRuntimeInput` 新增 `instanceId`**

```typescript
// pack_materializer.ts
export interface MaterializePackRuntimeInput {
  instanceId: string;      // NEW
  pack: WorldPack;
  prisma: PrismaClient;
  packStorageAdapter: PackStorageAdapter;
  initialTick: bigint;
  appliedOpeningId?: string;
}

export async function materializePackRuntime(
  input: MaterializePackRuntimeInput
): Promise<MaterializePackRuntimeOutput> {
  const { instanceId, pack, prisma, packStorageAdapter, initialTick, appliedOpeningId } = input;

  const install = await installPackRuntime(instanceId, pack, packStorageAdapter);
  const coreModels = await materializePackRuntimeCoreModels(instanceId, pack, initialTick, packStorageAdapter, appliedOpeningId);
  const actorBridges = await materializeActorBridges(instanceId, pack, prisma, initialTick);

  return { install, coreModels, actorBridges };
}
```

**5.2 `installPackRuntime` 接收 `instanceId`**

```typescript
// install_pack.ts
export const installPackRuntime = async (
  instanceId: string,          // NEW: 替代原来从 pack.metadata.id 取值
  pack: WorldPack,
  packStorageAdapter: PackStorageAdapter
): Promise<InstalledPackRuntimeSummary> => {
  const compiledStorage = compilePackStoragePlan(pack);
  const storageEngine = createPackStorageEngine(packStorageAdapter);
  const materialized = await storageEngine.materializeStoragePlan(instanceId, {
    // ↑ 使用 instanceId 而非 pack.metadata.id
    strategy: compiledStorage.strategy,
    runtime_db_file: compiledStorage.runtimeDbFile,
    engine_owned_collections: compiledStorage.engineOwnedCollections,
    pack_collections: compiledStorage.packCollections,
    projections: compiledStorage.projections,
    install: compiledStorage.installPolicy
  });
  return toInstalledPackRuntimeSummary(materialized);
};
```

**5.3 `materializePackRuntimeCoreModels` 接收 `instanceId`**

```typescript
// runtime/materializer.ts
export const materializePackRuntimeCoreModels = async (
  instanceId: string,          // NEW: 替代原来的 const packId = pack.metadata.id
  pack: WorldPack,
  now: bigint,
  packStorageAdapter: PackStorageAdapter,
  appliedOpeningId?: string
): Promise<PackRuntimeMaterializeSummary> => {
  // 所有 entity/state/authority/mediator 记录的 pack_id 使用 instanceId
  // buildWorldEntityId(instanceId, entityId) → "<instanceId>:entity:<entityId>"
  // buildEntityStateId(instanceId, entityId, ns) → "<instanceId>:state:<entityId>:<ns>"
  // buildMediatorBindingId(instanceId, mediatorId) → "<instanceId>:mediator:<mediatorId>"
  // ...
};
```

**5.4 `materializeActorBridges` 接收 `instanceId`**

```typescript
// runtime/materializer.ts
export const materializeActorBridges = async (
  instanceId: string,          // NEW
  pack: WorldPack,
  prisma: PrismaClient,
  now: bigint
): Promise<ActorBridgeSummary> => {
  // Agent ID:    "<instanceId>:<actorId>"
  // Identity ID: "<instanceId>:identity:<identityId>"
  // Binding ID:  "<instanceId>:binding:<actorId>:<identityId>"
  // ...
};
```

**5.5 `teardownActorBridges` 不变**

```typescript
export const teardownActorBridges = async (packId: string, prisma: PrismaClient): Promise<number> => {
  // packId 已经是 instance_id（由调用者传入）
  const prefix = `${packId}:`;
  // ...前缀匹配删除，逻辑不变
};
```

### 第 6 层：运行时编排服务

**文件**: `apps/server/src/packs/orchestration/pack_runtime_registry_service.ts`

`load()` 方法核心变更：

```typescript
public async load(packRef: string): Promise<...> {
  const resolved = this.packCatalog.resolvePackByIdOrFolder(packRef);
  if (!resolved) {
    throw new ApiError(404, 'EXPERIMENTAL_PACK_RUNTIME_NOT_FOUND', '...', { pack_id: packRef });
  }

  // 从 loader 获取 instance_id（唯一来源，不自己推导）
  const instanceId = this.packCatalog.getLoader().deriveInstanceId(resolved.pack, resolved.packFolderName);

  // 检查已有实例
  const existing = this.registry.getHandle(instanceId);
  if (existing) {
    return { handle: existing, loaded: false, already_loaded: true };
  }

  this.registry.transitionTo(instanceId, 'loading');

  // materialize 链路全部传入 instanceId
  await materializePackRuntime({
    instanceId,                               // NEW
    pack: resolved.pack,
    prisma: this.prisma,
    packStorageAdapter: this.packStorageAdapter,
    initialTick: runtimeConfig.initialTick
  });

  const host = new PackRuntimeInstance({
    instanceId,                               // NEW
    pack: resolved.pack,
    packFolderName: resolved.packFolderName,
    clock,
    runtimeSpeed,
    initialStatus: 'loaded'
  });
  host.load();
  this.registry.register(instanceId, host);   // key = instanceId

  // ... plugin discovery, loop start, world engine 全部使用 instanceId ...
  if (this.multiPackLoopHost) {
    this.multiPackLoopHost.startLoop(instanceId, clock, packRuntimePort);
  }

  if (this.worldEngine) {
    await this.worldEngine.loadPack({
      pack_id: instanceId,                    // instanceId
      mode: 'active',
      hydrate: { source: 'host_snapshot', snapshot }
    });
  }

  return { handle: host.getHandle(), loaded: true, already_loaded: false };
}
```

`unload()` 中 `teardownActorBridges(packId, prisma)` 的 `packId` 实参已为 `instance_id`，前缀匹配正确。

### 第 7 层：API 路由

**7.1 Pack 列表** — `routes/packs.ts`

```typescript
interface PackListItem {
  instance_id: string     // 主键（原 id）
  metadata_id: string     // 世界包类型（新增）
  folder_name: string
  name: string
  version: string
  description: string | null
  presentation: Record<string, unknown> | null
  frontend: Record<string, unknown> | null
  runtime_status: 'loaded' | 'not_loaded'
  health_status: string | null
  current_tick: string | null
}
```

列表构建逻辑：

```typescript
app.get('/api/packs', (_req, res) => {
  const availableFolders = loader.listAvailablePacks();

  // runtimeStatusMap 改用 instance_id 为键
  const runtimeStatusMap = new Map(
    context.listLoadedPackRuntimeIds?.()
      .map(id => {  // id 现在是 instance_id
        const handle = context.getPackRuntimeHandle?.(id);
        return [id, { health_status: ..., current_tick: ... }];
      }) ?? []
  );

  const packs: PackListItem[] = [];
  for (const folderName of availableFolders) {
    const pack = loader.loadPack(folderName);
    const instanceId = loader.deriveInstanceId(pack, folderName);
    const runtime = runtimeStatusMap.get(instanceId);

    packs.push({
      instance_id: instanceId,
      metadata_id: pack.metadata.id,
      folder_name: folderName,
      name: pack.metadata.name,
      // ...
      runtime_status: runtime ? 'loaded' : 'not_loaded',
    });
  }

  jsonOk(res, { packs });
});
```

**7.2 PackScopeResolver** — 不变，`resolve(packId)` 的 `packId` 语义变为 `instance_id`，查询 registry state 的逻辑不变。

**7.3 所有 pack-scoped 路由** — `req.params.packId` 的值变为 `instance_id`。路由参数名保持 `:packId`。`packAccessGuard` 中 `findPackBinding(operatorId, instanceId)` 正常匹配（binding 表 `pack_id` 已存 `instance_id`）。

**7.4 系统状态 API** — `routes/system.ts`

`RuntimeWorldMetadata` 同时返回两个字段：

```typescript
interface RuntimeWorldMetadata {
  instance_id: string;     // 实例标识
  metadata_id: string;     // 世界包类型标识（新增）
  name: string;
  version: string;
  // ... 其他字段不变
}
```

**7.5 Scheduler 旧数据** — scheduler 的 `pack_id` 分区键变为 `instance_id`。对于 `metadata.id` ≡ `folder_name` 的常见情况，值不变。对于 `metadata.id` ≠ `folder_name` 的情况，旧 scheduler lease/cursor 成为孤立记录。**开发数据可丢弃，不提供迁移脚本。** 如需清理，`pnpm --filter yidhras-server reset:dev-db`。

### 第 8 层：其他后端子系统

按 `pack_id` → `instance_id` 语义变更适配：
- World Engine sidecar: `loadPack({ pack_id: instanceId })`
- Plugin runtime: `pluginRuntimeRegistry.clearRuntimes(instanceId)`
- Snapshot: 目录 `data/world_packs/<instance_id>/snapshots/`，元数据记录 `instance_id` + `metadata_id`
- Memory / Vector embeddings: 分区键变更为 `instance_id`

### 第 9 层：前端

**9.1 类型更新** — `usePackListApi.ts`

```typescript
export interface PackListItem {
  instance_id: string     // was "id"
  metadata_id: string     // new
  folder_name: string
  // ...
}
```

**9.2 列表页** — `pages/packs.vue`

- `pack.instance_id` 替代 `pack.id`
- 展示 `metadata_id`（当 `metadata_id !== instance_id` 时高亮提示）
- `enterPack(pack.instance_id)` 替代 `enterPack(pack.id)`

**9.3 详情分发页** — `pages/packs/[packId].vue`

- `route.params.packId` 值为 `instance_id`
- 匹配逻辑从 `pack.id === packId` 改为 `pack.instance_id === packId`

**9.4 PackFrontendMount** — `features/shell/components/PackFrontendMount.vue`

```typescript
// 入口 URL 构建从 pack.id 改为 pack.instance_id
const entryUrl = `/api/packs/${pack.instance_id}/frontend/${entry}`
```

**9.5 resolvePackId** — `composables/shared/resolvePackId.ts`

返回值语义变为 `instance_id`，实现逻辑不变（仍从 `route.params.packId` 取值）。

**9.6 系统状态** — `useSystemApi.ts`

`RuntimeWorldMetadata` 类型新增 `instance_id` / `metadata_id` 字段。`runtimeStore.worldPack.id` 改为 `runtimeStore.worldPack.instance_id`。

---

## 实施顺序

| 阶段 | 内容 | 涉及文件 |
|------|------|---------|
| **Phase A** | Schema + Manifest：contracts 新增 `instance_id`、loader 重构（deriveInstanceId、冲突检测、反向索引）、constitution schema | `packages/contracts/`, `packs/manifest/loader.ts`, `packs/schema/constitution_schema.ts` |
| **Phase B** | Core runtime：handle/instance/registry/db_locator 改造 | `core/pack_runtime_handle.ts`, `core/pack_runtime_instance.ts`, `core/pack_runtime_registry.ts`, `core/pack_runtime_health.ts`, `packs/storage/pack_db_locator.ts` |
| **Phase C** | Materializer 链路 + Catalog + Registry service：全部三个 materialize 函数接收 instanceId、catalog 重构、registry_service 适配（load/unload）| `packs/orchestration/pack_materializer.ts`, `kernel/install/install_pack.ts`, `packs/runtime/materializer.ts`, `packs/orchestration/pack_catalog_service.ts`, `packs/orchestration/pack_runtime_registry_service.ts` |
| **Phase D** | API 路由 + 中间件：pack list、scope resolver、全部 pack-scoped 路由、operator binding、system status | `app/routes/packs.ts`, `app/routes/system.ts`, `app/runtime/PackScopeResolver.ts`, `app/routes/operator_pack_bindings.ts`, 全部 pack-scoped 路由文件 |
| **Phase E** | 其他子系统：world engine、scheduler、plugin runtime、snapshot、memory | `app/runtime/`, `plugins/`, snapshot 相关文件 |
| **Phase F** | 前端 + 清理：类型、列表页、路由、API composables、PackFrontendMount | `apps/web/` 全部涉及文件 |

**Phase B 依赖 A，Phase C 依赖 B，Phase D+E 依赖 C。Phase D/E 可并行。Phase F 依赖 D。**

A-B-C 构成不可分割的核心链 —— 从 `instance_id` 推导 → handle 结构变更 → materializer 传参 → registry 注册的端到端通路。建议 A+B+C 合并为单个 commit，D+E 为第二个 commit，F 为第三个 commit。

---

## 不在范围内

- "按类型绑定"（一次绑定到某 `metadata_id` 的所有实例）
- 实例克隆（从实例 A snapshot 创建实例 B）
- 跨实例状态对比
- 实例别名
- 数据迁移工具（开发数据可丢弃）
