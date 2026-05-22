# 同一世界包多副本区分机制 — 实施计划

> 基于 `.limcode/design/same-pack-multi-instance-design.md`，每步精确到文件和具体改动。

## Commit 1：核心链路（Schema → Loader → Core → Materializer → Catalog → Registry Service）

### 步骤 1.1 — contracts schema 扩展

**文件**: `packages/contracts/src/schemas/pack.ts`（或 `constitution_schema.ts` 中 metadataSchema 定义处）

改动：`metadataSchema` 新增字段：
```typescript
instance_id: z.string().min(1).optional()
```

### 步骤 1.2 — constitution schema 同步

**文件**: `apps/server/src/packs/schema/constitution_schema.ts`

改动：同样在 `metadataSchema` 中新增 `instance_id: z.string().min(1).optional()`。

---

### 步骤 1.3 — PackManifestLoader 重构

**文件**: `apps/server/src/packs/manifest/loader.ts`

改动：

1. 新增 `instanceIndex: Map<string, string> = new Map()` 私有字段（instanceId → folderName）

2. 新增公共方法 `deriveInstanceId(pack: WorldPack, folderName: string): string`：
   ```typescript
   public deriveInstanceId(pack: WorldPack, folderName: string): string {
     const explicit = (pack.metadata as Record<string, unknown>).instance_id as string | undefined;
     return explicit?.trim() || folderName;
   }
   ```

3. 修改 `loadPack(folderName)`：
   - 删除 `this.packs.set(parsed.metadata.id, parsed)` 这一行（不再以 metadata.id 为键缓存）
   - 在 `this.packs.set(folderName, parsed)` 之后新增冲突检测：
     ```typescript
     const instanceId = this.deriveInstanceId(parsed, folderName);
     const existingFolder = this.instanceIndex.get(instanceId);
     if (existingFolder && existingFolder !== folderName) {
       throw new Error(
         `instance_id conflict: "${instanceId}" claimed by both "${existingFolder}" and "${folderName}"`
       );
     }
     this.instanceIndex.set(instanceId, folderName);
     ```

4. 新增 `getPackByFolderName(folderName: string): WorldPack | undefined`

5. 新增 `getPackByInstanceId(instanceId: string): WorldPack | undefined`：
   ```typescript
   public getPackByInstanceId(instanceId: string): WorldPack | undefined {
     const folderName = this.instanceIndex.get(instanceId);
     return folderName ? this.packs.get(folderName) : undefined;
   }
   ```

6. 新增 `getFolderNameByInstanceId(instanceId: string): string | undefined`

7. 修改 `getAllPacks()`：从 `Array.from(new Set(this.packs.values()))` 改为 `Array.from(this.packs.values())`（因为已无重复键问题）

8. **不修改** `listAvailablePacks()`、`getMergedVariables()`（逻辑不变）

---

### 步骤 1.4 — PackRuntimeHandle 接口改造

**文件**: `apps/server/src/core/pack_runtime_handle.ts`

改动：
```typescript
// 改前
export interface PackRuntimeHandle {
  pack_id: string;
  pack_folder_name: string;
  pack: WorldPack;
  // ...
}

// 改后
export interface PackRuntimeHandle {
  instance_id: string;
  metadata_id: string;
  pack_folder_name: string;
  pack: WorldPack;
  // ...
}
```

### 步骤 1.5 — PackRuntimeHealth 类型改造

**文件**: `apps/server/src/core/pack_runtime_health.ts`

改动：
```typescript
// PackRuntimeStatusSnapshot
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

// ExperimentalPackRuntimeStatusRecord 同样新增 instance_id / metadata_id
```

### 步骤 1.6 — PackRuntimeInstance 改造

**文件**: `apps/server/src/core/pack_runtime_instance.ts`

改动：

1. `PackRuntimeInstanceOptions` 新增 `instanceId: string` 必填字段

2. 构造函数内 `this.handle` 构建改为：
   ```typescript
   this.handle = {
     instance_id: options.instanceId,
     metadata_id: this.pack.metadata.id,
     pack_folder_name: this.packFolderName,
     pack: this.pack,
     getClockSnapshot: () => this.getClockSnapshot(),
     getRuntimeSpeedSnapshot: () => this.getRuntimeSpeedSnapshot(),
     getHealthSnapshot: () => this.getHealthSnapshot()
   };
   ```

3. `getPackId()` 返回 `this.handle.instance_id`

4. `buildPackRuntimeClock` 和 `buildDefaultStepStrategy` 两个私有工厂函数不变（它们只读 `pack` 内容）

---

### 步骤 1.7 — InMemoryPackRuntimeRegistry 标注

**文件**: `apps/server/src/core/pack_runtime_registry.ts`

改动：在接口 `PackRuntimeRegistry` 和类 `InMemoryPackRuntimeRegistry` 上各加一行 JSDoc：
```typescript
/**
 * All method `packId` parameters accept instance_id (not metadata.id).
 */
```

实现逻辑不变（已有的 `Map<string, ...>` 键语义自动切换，因为调用者传入的 `packId` 实参将变为 `instance_id`）。

---

### 步骤 1.8 — PackRuntimePorts 标注

**文件**: `apps/server/src/core/pack_runtime_ports.ts`

改动：四个接口（`PackRuntimeLocator`、`PackRuntimeControl`、`PackRuntimeObservation`、`PackRuntimeLookupPort`）各加 JSDoc 标注参数语义。

---

### 步骤 1.9 — pack_db_locator 标注

**文件**: `apps/server/src/packs/storage/pack_db_locator.ts`

改动：三个导出函数各加 JSDoc `@param packId — instance_id`。实现逻辑不变（参数透传给 `normalizePackId`）。

---

### 步骤 1.10 — installPackRuntime 接收 instanceId

**文件**: `apps/server/src/kernel/install/install_pack.ts`

改动：

1. 函数签名从 `installPackRuntime(pack: WorldPack, packStorageAdapter: PackStorageAdapter)` 改为：
   ```typescript
   export const installPackRuntime = async (
     instanceId: string,
     pack: WorldPack,
     packStorageAdapter: PackStorageAdapter
   ): Promise<InstalledPackRuntimeSummary>
   ```

2. 第 17 行 `pack.metadata.id` 改为 `instanceId`：
   ```typescript
   const materialized = await storageEngine.materializeStoragePlan(instanceId, { ... });
   ```

---

### 步骤 1.11 — materializePackRuntimeCoreModels 接收 instanceId

**文件**: `apps/server/src/packs/runtime/materializer.ts`

改动：

1. 函数签名新增第一参数 `instanceId: string`

2. 删除 `const packId = pack.metadata.id`（第 73 行），所有后续 `packId` 变量引用改为 `instanceId`

3. 这会影响：
   - `buildWorldEntityId(instanceId, entityId)` → `"<instanceId>:entity:<entityId>"`
   - `buildEntityStateId(instanceId, entityId, ns)` → `"<instanceId>:state:<entityId>:<ns>"`
   - `buildMediatorBindingId(instanceId, mediatorId)` → `"<instanceId>:mediator:<mediatorId>"`
   - 所有 `createWorldEntityInput(instanceId, ...)` 调用
   - 所有 `createEntityStateInput(instanceId, ...)` 调用
   - 所有 upsert 的 `pack_id` 字段值
   - `metaStateId` 构建
   - 返回值 `{ pack_id: instanceId, ... }`

---

### 步骤 1.12 — materializeActorBridges 接收 instanceId

**文件**: `apps/server/src/packs/runtime/materializer.ts`（同一文件）

改动：

1. 函数签名新增第一参数 `instanceId: string`

2. 删除 `const packId = pack.metadata.id`（第 296 行），所有后续 `packId` 变量引用改为 `instanceId`

3. 这会影响：
   - `buildBridgedAgentId(instanceId, actorId)` → `"<instanceId>:<actorId>"`
   - `buildBridgedIdentityId(instanceId, identityId)` → `"<instanceId>:identity:<identityId>"`
   - Agent.upsert 的 `id` 和 `where.id`
   - Identity.upsert 的 `id` 和 `where.id`
   - IdentityNodeBinding.upsert 的 `id`（`${instanceId}:binding:...`）和 `where.id`
   - 返回值 `{ pack_id: instanceId, ... }`

4. `teardownActorBridges` 函数**签名不变**（参数名叫 `packId` 但实参会是 `instance_id`，前缀匹配逻辑自动正确）

---

### 步骤 1.13 — MaterializePackRuntimeInput 新增 instanceId

**文件**: `apps/server/src/packs/orchestration/pack_materializer.ts`

改动：

1. `MaterializePackRuntimeInput` 新增 `instanceId: string`

2. `materializePackRuntime` 函数体内解构 `instanceId`，向下传递：
   ```typescript
   const install = await installPackRuntime(instanceId, pack, packStorageAdapter);
   const coreModels = await materializePackRuntimeCoreModels(instanceId, pack, initialTick, packStorageAdapter, appliedOpeningId);
   const actorBridges = await materializeActorBridges(instanceId, pack, prisma, initialTick);
   ```

---

### 步骤 1.14 — DefaultPackCatalogService 重构

**文件**: `apps/server/src/packs/orchestration/pack_catalog_service.ts`

改动：

1. loader 暴露访问器（如果尚未有）：
   ```typescript
   public getLoader(): PackManifestLoader { return this.loader; }
   ```

2. 新增 `resolveByInstanceId(instanceId: string): PackResolution | null`：
   ```typescript
   const folderName = this.loader.getFolderNameByInstanceId(instanceId);
   if (!folderName) return null;
   const pack = this.loader.loadPack(folderName);
   return { pack, packFolderName: folderName };
   ```

3. 修改 `resolvePackByIdOrFolder(packRef)`：先按 `instance_id` 匹配（调用 `resolveByInstanceId`），再按 `folder_name` 匹配（直接字符串比对）。移除 `metadata.id` 和 `metadata.name` 匹配。

4. 新增 `listAllInstances(): PackInstanceInfo[]`

5. `findFolderNameByPackId` 改为按 `instance_id` 查找：
   ```typescript
   public findFolderNameByPackId(instanceId: string): string | null {
     return this.loader.getFolderNameByInstanceId(instanceId) ?? null;
   }
   ```

---

### 步骤 1.15 — DefaultPackRuntimeRegistryService 适配

**文件**: `apps/server/src/packs/orchestration/pack_runtime_registry_service.ts`

改动：

1. `load(packRef)` 方法：
   - `const packId = resolved.pack.metadata.id` 改为：
     ```typescript
     const instanceId = this.packCatalog.getLoader().deriveInstanceId(resolved.pack, resolved.packFolderName);
     ```
   - 所有后续 `packId` 局部变量引用改为 `instanceId`
   - `materializePackRuntime({ instanceId, pack, ... })` 传入 instanceId
   - `new PackRuntimeInstance({ instanceId, pack, packFolderName, ... })` 传入 instanceId
   - `this.registry.register(instanceId, host)` 注册键为 instanceId
   - `this.multiPackLoopHost.startLoop(instanceId, ...)` 
   - `this.worldEngine.loadPack({ pack_id: instanceId, ... })`

2. `unload(packId)` 方法：参数 `packId` 语义为 `instance_id`，内部逻辑不变

3. `getStatus(packId)` 方法：
   - `handle.pack_id` 改为 `handle.instance_id`
   - 返回值新增 `instance_id: handle.instance_id` 和 `metadata_id: handle.metadata_id`

4. `listStatuses()` 方法：
   - `handle.pack_id` 改为 `handle.instance_id`

5. 其余方法（`getHandle`、`getHost`、`hasPackRuntime` 等）签名不变，参数语义变为 `instance_id`

---

## Commit 2：API 路由 + 中间件 + 子系统

### 步骤 2.1 — Pack 列表路由

**文件**: `apps/server/src/app/routes/packs.ts`

改动：

1. `PackListItem` 接口：
   ```typescript
   interface PackListItem {
     instance_id: string;     // was "id"
     metadata_id: string;     // new
     folder_name: string;
     name: string;
     // ... 其余不变
   }
   ```

2. 路由处理函数内：
   - `runtimeStatusMap` 构建改为：key 已经是 `instance_id`（因为 `listLoadedPackRuntimeIds()` 返回 instance IDs），无需额外改动 Map 构建逻辑
   - 但是注意：原来 `runtimeStatusMap.get(metadata.id)` 的 key 是 `metadata.id`，现在 `listLoadedPackRuntimeIds()` 返回的是 `instance_id`，所以要改为 `runtimeStatusMap.get(instanceId)`
   - pack 对象构建：
     ```typescript
     const instanceId = loader.deriveInstanceId(pack, folderName);
     packs.push({
       instance_id: instanceId,
       metadata_id: metadata.id,
       folder_name: folderName,
       // ...
       runtime_status: runtimeStatusMap.has(instanceId) ? 'loaded' : 'not_loaded',
     });
     ```

---

### 步骤 2.2 — 系统状态路由

**文件**: `apps/server/src/app/routes/system.ts`

改动：

1. `GET /api/status` 路由中 `packId` 验证逻辑不变（仍从 `req.query.packId` 取值）

2. `getRuntimeStatusSnapshot` 函数（或等效的状态组装逻辑）中：
   - `handle.pack_id` → `handle.instance_id`
   - 返回的 `RuntimeWorldMetadata` 新增 `instance_id` 和 `metadata_id` 字段
   - 原有 `id` 字段改为返回 `instance_id`

---

### 步骤 2.3 — PackScopeResolver

**文件**: `apps/server/src/app/runtime/PackScopeResolver.ts`

改动：无。实现逻辑不变（`registry.getState(normalized)` 查询的 key 语义自动变为 `instance_id`）。

仅在类上加 JSDoc 标注 `packId` 参数语义。

---

### 步骤 2.4 — pack_scope_middleware

**文件**: `apps/server/src/app/http/pack_scope_middleware.ts`

改动：无。从 `req.params.packId` 取值后传给 `PackScopeResolver.resolve()`，值自动变为 `instance_id`。

---

### 步骤 2.5 — pack_access guard

**文件**: `apps/server/src/operator/guard/pack_access.ts`

改动：无。`findPackBinding(operatorId, packId)` 中 `packId` 现在是 `instance_id`，binding 表中的 `pack_id` 也存 `instance_id`（由路由层传入），匹配逻辑不变。

---

### 步骤 2.6 — operator_pack_bindings 路由

**文件**: `apps/server/src/app/routes/operator_pack_bindings.ts`

改动：无代码改动。`req.params.packId` 的值自动变为 `instance_id`，穿透到 service 层 `createPackBinding(context, instance_id, ...)`。

数据库 `operator_pack_bindings.pack_id` 列存储的值从 `metadata.id` 变为 `instance_id`。已有的旧 binding 记录在开发环境中随 `reset:dev-db` 清除。

---

### 步骤 2.7 — operator_grants 路由

**文件**: `apps/server/src/app/routes/operator_grants.ts`

改动：无。`req.params.packId` 语义自动变为 `instance_id`。

---

### 步骤 2.8 — plugins 路由

**文件**: `apps/server/src/app/routes/plugins.ts`

改动：无。`req.params.packId` 语义自动变为 `instance_id`。路由路径 `/api/packs/:packId/plugins` 不变。

---

### 步骤 2.9 — plugin_runtime_web 路由

**文件**: `apps/server/src/app/routes/plugin_runtime_web.ts`

改动：无。`req.params.packId` 语义自动变为 `instance_id`。

---

### 步骤 2.10 — pack_snapshots 路由

**文件**: `apps/server/src/app/routes/pack_snapshots.ts`

改动：无。`parseParams(packIdParamsSchema, req.params, ...)` 提取的 `packId` 现在是 `instance_id`，后续传给 snapshot 服务的 `packId` 即为 `instance_id`。

---

### 步骤 2.11 — pack_frontend_assets 路由

**文件**: `apps/server/src/app/routes/pack_frontend_assets.ts`

改动：

1. 第 54 行 `pack.metadata.id === packId` 改为 `loader.deriveInstanceId(pack, folderName) === packId`

2. 路由 `/api/packs/:packId/frontend/{*assetPath}` 中 `:packId` 语义变为 `instance_id`

---

### 步骤 2.12 — inference 路由

**文件**: `apps/server/src/app/routes/inference.ts`

改动：`pack_id` 相关字段的注释/标注更新，值语义变为 `instance_id`。如有硬编码 `pack.metadata.id` 的比较逻辑，改为 `instance_id`。

---

### 步骤 2.13 — 其余 pack-scoped 路由

以下文件无代码改动，仅 `req.params.packId` / `?packId=` query param 的值语义自动变为 `instance_id`：

| 文件 | 说明 |
|------|------|
| `routes/agent.ts` | `packIdQuery: 'packId'` 从 query 取值，值变为 instance_id |
| `routes/clock.ts` | `readVisibleClockSnapshot({ packId })` 的 packId 变为 instance_id |
| `routes/experimental_runtime.ts` | 全部 packId 引用自动变为 instance_id |
| `routes/experimental_pack_projection.ts` | 同上 |
| `routes/graph.ts` | pack scope 路由 |
| `routes/identity.ts` | pack scope 路由 |
| `routes/narrative.ts` | pack scope 路由 |
| `routes/overview.ts` | pack scope 路由 |
| `routes/relational.ts` | pack scope 路由 |
| `routes/scheduler.ts` | `?packId=` query param 变为 instance_id |
| `routes/social.ts` | pack scope 路由 |
| `routes/audit.ts` | pack scope 路由 |
| `routes/operator_audit.ts` | `pack_id` query param 变为 instance_id |
| `routes/operator_auth.ts` | `body.pack_id` 变为 instance_id |

---

### 步骤 2.14 — 子系统适配

**World Engine sidecar 接口**: `apps/server/src/app/runtime/world_engine_ports.ts`
- `loadPack({ pack_id })` 的 `pack_id` 语义标注为 `instance_id`

**Plugin runtime**: `apps/server/src/plugins/runtime.ts`
- `clearRuntimes(packId)` 的 `packId` 语义标注为 `instance_id`

**Snapshot**: `apps/server/src/packs/snapshots/` 目录下 `snapshot_locator.ts`、`snapshot_capture.ts`、`snapshot_restore.ts`
- 所有 `getPackRootDir(packId)` 调用中的 `packId` 语义变为 `instance_id`
- 快照元数据新增 `instance_id` 和 `metadata_id` 字段

**Scheduler**: `apps/server/src/packs/storage/internal/SqliteSchedulerStorageAdapter.ts`
- `resolvePackRuntimeDatabaseLocation(packId)` 的 `packId` 语义变为 `instance_id`

**Memory / Vector**: 如有按 `pack_id` 分区的逻辑，语义标注为 `instance_id`

**SimulationManager**: `apps/server/src/core/simulation.ts`
- `handle.pack_id` → `handle.instance_id`

**experimental_multi_pack_runtime.ts**: `apps/server/src/app/services/runtime/experimental_multi_pack_runtime.ts`
- `handle.pack_id` → `handle.instance_id`

---

## Commit 3：前端

### 步骤 3.1 — PackListItem 类型更新

**文件**: `apps/web/composables/api/usePackListApi.ts`

改动：
```typescript
export interface PackListItem {
  instance_id: string;     // was "id"
  metadata_id: string;     // new
  folder_name: string;
  // ... 其余不变
}
```

---

### 步骤 3.2 — RuntimeWorldMetadata 类型更新

**文件**: `apps/web/composables/api/useSystemApi.ts`

改动：
```typescript
interface RuntimeWorldMetadata {
  instance_id: string;     // was "id"
  metadata_id: string;     // new
  name: string;
  // ... 其余不变
}
```

---

### 步骤 3.3 — resolvePackId 更新

**文件**: `apps/web/composables/shared/resolvePackId.ts`

改动：回退路径 `runtime.worldPack?.id` 改为 `runtime.worldPack?.instance_id`。

---

### 步骤 3.4 — runtime store 更新

**文件**: `apps/web/stores/runtime.ts`

改动：所有引用 `worldPack.id` 的地方改为 `worldPack.instance_id`。如有需要展示 `metadata_id` 的地方，使用 `worldPack.metadata_id`。

---

### 步骤 3.5 — packs 列表页

**文件**: `apps/web/pages/packs.vue`

改动：
- `pack.id` → `pack.instance_id`（共 3 处：enterPack 参数、卡片显示、enterPack 函数内 URL 构建）
- 新增显示 `pack.metadata_id`（当 `metadata_id !== instance_id` 时以小字/灰色展示，提示多实例）

---

### 步骤 3.6 — packs/[packId].vue 分发页

**文件**: `apps/web/pages/packs/[packId].vue`

改动：
- 第 22 行 `packId` 取值不变（`route.params.packId` 现在为 instance_id）
- 第 30 行 `p.id === packId.value` 改为 `p.instance_id === packId.value`
- 第 41 行 watch 保持不变

---

### 步骤 3.7 — packs/[packId]/index.vue

**文件**: `apps/web/pages/packs/[packId]/index.vue`

改动：无。`route.params.packId` 自动变为 `instance_id`，重定向 URL 中的值自动正确。

---

### 步骤 3.8 — packs/[packId]/plugins/[pluginId]/[[...path]].vue

**文件**: `apps/web/pages/packs/[packId]/plugins/[pluginId]/[[...path]].vue`

改动：无。`route.params.packId` 自动变为 `instance_id`。

---

### 步骤 3.9 — PackFrontendMount 组件

**文件**: `apps/web/features/shell/components/PackFrontendMount.vue`

改动：
- 第 56 行 `resolveEntryUrl` 中 `pack.id` 改为 `pack.instance_id`
- 第 62 行 `p.id === props.packId` 改为 `p.instance_id === props.packId`

---

### 步骤 3.10 — AppShell 组件

**文件**: `apps/web/features/shell/components/AppShell.vue`

改动：无。`route.params.packId` 自动变为 `instance_id`，所有基于 packId 的导航/路径构建自动正确。

---

### 步骤 3.11 — theme 插件

**文件**: `apps/web/plugins/theme.ts`

改动：
- `worldPack.value?.id` → `worldPack.value?.instance_id`（第 16、42 行）
- `worldPack?.id` → `worldPack?.instance_id`（第 42 行）

---

### 步骤 3.12 — theme 相关工具

**文件**: `apps/web/lib/theme/source.ts`

改动：`worldPack.id` → `worldPack.instance_id`

**文件**: `apps/web/lib/theme/resolver.ts`

改动：`options?.worldPack?.id` → `options?.worldPack?.instance_id`

---

### 步骤 3.13 — useShellContext

**文件**: `apps/web/composables/app/useShellContext.ts`

改动：无。`route.params.packId` 自动变为 `instance_id`。`pack_id` 字段值自动变为 `instance_id`。

---

### 步骤 3.14 — useShellNavigation

**文件**: `apps/web/composables/app/useShellNavigation.ts`

改动：无。`switchPack(packId)` 的参数名不变，语义变为 `instance_id`。

---

### 步骤 3.15 — navigation 工具

**文件**: `apps/web/features/shared/navigation.ts`

改动：无。`route.params.packId` 自动变为 `instance_id`。

---

### 步骤 3.16 — usePluginRuntimeBootstrap

**文件**: `apps/web/composables/app/usePluginRuntimeBootstrap.ts`

改动：`worldPack.value?.id` → `worldPack.value?.instance_id`

---

### 步骤 3.17 — usePluginManagementPage

**文件**: `apps/web/features/plugins/composables/usePluginManagementPage.ts`

改动：`runtime.worldPack?.id` → `runtime.worldPack?.instance_id`（第 68 行）

---

### 步骤 3.18 — HTTP client

**文件**: `apps/web/lib/http/client.ts`

改动：无。`packId` 选项的值现在由调用者传入 `instance_id`，`buildUrl` 逻辑不变。

---

### 步骤 3.19 — 各 API composable

下列文件无代码改动——它们全部通过 `resolvePackId()` 获取 packId 后传入 `requestApiData`，`resolvePackId()` 已在步骤 3.3 更新为返回 `instance_id`：

| 文件 |
|------|
| `composables/api/useAgentApi.ts` |
| `composables/api/useGraphApi.ts` |
| `composables/api/useOverviewApi.ts` |
| `composables/api/useSchedulerApi.ts` |
| `composables/api/useSocialApi.ts` |
| `composables/api/useTimelineApi.ts` |
| `composables/api/useWorkflowApi.ts` |

`usePluginApi.ts` 有手动构造 URL 的逻辑（`/api/packs/${packId}/plugins`），但 `packId` 参数来自调用者传入的 `instance_id`，URL 自动正确。

---

## 验证清单

### Commit 1 后

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm --filter yidhras-server test:unit` 通过
- [ ] 手动验证：启动服务器，加载一个已有的单实例 pack，确认 pack 列表 API 返回 `instance_id` 字段且值等于原 `id`

### Commit 2 后

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm --filter yidhras-server test:unit` 通过
- [ ] `pnpm --filter yidhras-server test:integration` 通过
- [ ] 手动验证：创建两个同 `metadata.id` 不同目录名的 pack，确认：
  - `GET /api/packs` 返回两条记录，`instance_id` 不同
  - 可分别加载两个实例
  - 两个实例的 runtime status 独立

### Commit 3 后

- [ ] `pnpm typecheck` 通过（含 web）
- [ ] `pnpm test:unit` 通过（含 web 单测）
- [ ] 手动验证：前端 pack 列表正确展示 `instance_id`，点击进入后各工作区页面正常工作
