# 共享 Pack Runtime Materialization 接口抽取

## 1. 背景与动机

### 1.1 当前状态

`activateWorldPackRuntime()`（`runtime_activation.ts`）完成以下五步，产出一个可运行的 pack runtime：

```
loadPack → installPackRuntime → materializePackRuntimeCoreModels
                                → materializeActorBridges
                                → resolvePackClock
                                → discoverPackLocalPlugins
```

但实验性多包运行时加载路径（`PackRuntimeRegistryService.load()` → `PackRuntimeInstance`）**只修改内部健康状态字段**，完全不执行上述任何一步：

```typescript
// pack_runtime_instance.ts — 当前实现（空壳）
public async load(): Promise<void> {
    this.health = { status: 'loaded', message: this.health.message ?? null };
}
```

这导致通过 `/api/experimental/runtime/packs/:packId/load` 加载的 pack 只是一个占位符，不具备真实的运行时语义。

### 1.2 关键事实

经过对存储引擎层的深入审查，**pack runtime 的存储基础设施已经天然多包兼容**：

- `resolvePackRuntimeDatabaseLocation(packId)` 基于 `packId`（= `pack.metadata.id`）定位 `data/world_packs/<packId>/runtime.sqlite`，完全不依赖 active pack 概念
- 所有 repo（entity / state / authority / mediator / rule_execution）使用 `node:sqlite` 的 `DatabaseSync`，每次 CRUD 独立打开/关闭连接
- `installPackRuntime()` 是幂等的（`CREATE TABLE IF NOT EXISTS`）
- `materializePackRuntimeCoreModels()` 和 `materializeActorBridges()` 只依赖 `pack` 对象 + `prisma`（kernel-side），不依赖全局状态

**结论：不需要改造存储层。唯一缺失的是在实验性加载路径中调用这些已有函数。**

### 1.3 双目录结构

Pack 配置与 runtime DB 使用不同目录（当 `folderName` ≠ `metadata.id` 时）：

| 用途 | 路径 | 示例 |
|------|------|------|
| Pack 配置加载 | `data/world_packs/<folderName>/config.yaml` | `death_note/config.yaml` |
| Runtime SQLite DB | `data/world_packs/<metadata.id>/runtime.sqlite` | `world-death-note/runtime.sqlite` |

提取共享函数时，`installPackRuntime` / `materializePackRuntimeCoreModels` / `materializeActorBridges` 只需要 `pack`，不依赖 `folderName`。`discoverPackLocalPlugins` 需要 `folderName` 用于定位插件目录。

---

## 2. 目标

### 2.1 核心目标

抽取一个可复用的 `materializePackRuntime()` 函数，同时满足：
- **Active pack activation**：`activateWorldPackRuntime()` 重构为调用共享函数
- **Experimental pack load**：`PackRuntimeRegistryService.load()` 调用共享函数完成真实 materialization

### 2.2 设计目标

1. **接口统一**：两条路径共享同一 materialization contract
2. **可测试**：共享函数为纯异步函数，可独立单测
3. **向后兼容**：active pack activation 行为不变，所有现有测试继续通过
4. **独立时钟**：实验性 pack 拥有独立的 `ChronosEngine`，不与 active pack 时钟同步
5. **手动模式**：本轮只实现 `start_mode: 'manual'`，`bootstrap_list` 保留配置钩子但不实现启动逻辑

### 2.3 非目标

- 不实现多 pack 并行 step / 调度
- 不实现 `bootstrap_list` 启动模式
- 不实现实验性 pack 的 plugin discovery（defer，见 §7.4）
- 不实现卸载时的 runtime.sqlite 文件清理
- 不改变 `SimulationManager` 的 `syncClockFromActiveRuntime` 行为

---

## 3. 接口设计

### 3.1 核心共享函数

```typescript
// apps/server/src/core/pack_materializer.ts （新建）

import type { PrismaClient } from '@prisma/client';
import type { WorldPack } from '../packs/manifest/loader.js';
import type { ActorBridgeSummary } from '../packs/runtime/materializer.js';
import type { InstalledPackRuntimeSummary } from '../kernel/install/install_pack.js';
import type { PackRuntimeMaterializeSummary } from '../packs/runtime/core_models.js';

export interface MaterializePackRuntimeInput {
  pack: WorldPack;
  prisma: PrismaClient;
  initialTick: bigint;
}

export interface MaterializePackRuntimeOutput {
  install: InstalledPackRuntimeSummary;
  coreModels: PackRuntimeMaterializeSummary;
  actorBridges: ActorBridgeSummary;
}

/**
 * 对任意 pack 执行完整的 runtime materialization：
 *   1. installPackRuntime   — 创建/确认 per-pack SQLite 数据库与表结构
 *   2. materializePackRuntimeCoreModels — 写入 entities / states / authorities / mediators
 *   3. materializeActorBridges — 在 kernel-side Prisma 创建 Agent / Identity / Binding
 *
 * installPackRuntime 是幂等的（CREATE TABLE IF NOT EXISTS）。
 * materialization repos 使用 upsert，重复调用不会重复创建。
 *
 * 如果 runtime.sqlite 尚未创建，materialization repos 会抛出异常；
 * 因此必须先调用 installPackRuntime。
 */
export async function materializePackRuntime(
  input: MaterializePackRuntimeInput
): Promise<MaterializePackRuntimeOutput> {
  const { pack, prisma, initialTick } = input;

  const install = await installPackRuntime(pack);
  const coreModels = await materializePackRuntimeCoreModels(pack, initialTick);
  const actorBridges = await materializeActorBridges(pack, prisma, initialTick);

  return { install, coreModels, actorBridges };
}
```

### 3.2 Active Pack Activation 重构

```typescript
// runtime_activation.ts — 重构后

export const activateWorldPackRuntime = async ({
  packFolderName, loader, prisma, runtimeSpeed, packsDir
}: ActivateWorldPackRuntimeOptions): Promise<ActivatedWorldPackRuntime> => {
  const pack = loader.loadPack(packFolderName);
  const runtimeConfig = getWorldPackRuntimeConfig(pack);
  const calendars = (pack.time_systems ?? []) as unknown as CalendarConfig[];

  configureRuntimeSpeedFromPack(runtimeSpeed, pack);

  // ★ 调用共享 materialization
  await materializePackRuntime({ pack, prisma, initialTick: runtimeConfig.initialTick });

  const clock = await resolvePackClock({
    calendars,
    initialTick: runtimeConfig.initialTick,
    prisma
  });

  const discoveredPlugins = await discoverPackLocalPlugins({
    prismaContext: { prisma },
    pack,
    packRootDir: path.join(packsDir, packFolderName)
  });

  validateActivatedTickBounds(pack, clock);

  return { pack, clock, discoveredPlugins };
};
```

### 3.3 Experimental Pack Load 路径

```typescript
// pack_runtime_registry_service.ts — load() 方法扩展

public async load(packRef: string): Promise<{
  handle: PackRuntimeHandle;
  loaded: boolean;
  already_loaded: boolean;
}> {
  const resolved = this.packCatalog.resolvePackByIdOrFolder(packRef);
  if (!resolved) { /* 现有错误处理保持不变 */ }

  const existing = this.registry.getHandle(resolved.pack.metadata.id);
  if (existing) { /* 现有 already_loaded 逻辑保持不变 */ }

  const { max_loaded_packs: maxLoadedPacks } = getRuntimeMultiPackConfig();
  if (this.registry.listLoadedPackIds().length >= maxLoadedPacks) { /* 现有容量检查保持不变 */ }

  // ★ 在 register 之前完成 materialization
  const runtimeConfig = getWorldPackRuntimeConfig(resolved.pack);
  await materializePackRuntime({
    pack: resolved.pack,
    prisma: this.prisma,
    initialTick: runtimeConfig.initialTick
  });

  // ★ 构造可用的 PackRuntimeInstance（含真实时钟）
  const calendars = (resolved.pack.time_systems ?? []) as unknown as CalendarConfig[];
  const clock = new ChronosEngine(calendars, runtimeConfig.initialTick);
  const runtimeSpeed = new RuntimeSpeedPolicy(runtimeConfig.configuredStepTicks ?? 1n);

  const host = new PackRuntimeInstance({
    pack: resolved.pack,
    packFolderName: resolved.packFolderName,
    clock,
    runtimeSpeed,
    initialStatus: 'loaded',
    initialMessage: 'experimental operator-loaded runtime'
  });
  await host.load();
  this.registry.register(resolved.pack.metadata.id, host);

  // ★ 验证注册后 handle 可获取
  const verifyHandle = this.registry.getHandle(resolved.pack.metadata.id);
  if (!verifyHandle) { /* 现有验证逻辑保持不变 */ }

  return {
    handle: host.getHandle(),
    loaded: true,
    already_loaded: false
  };
}
```

### 3.4 时钟独立性

实验性 pack `PackRuntimeInstance` 使用从 `pack.simulation_time.initial_tick` 初始化的独立 `ChronosEngine` 和独立的 `RuntimeSpeedPolicy`，与 `SimulationManager` 的时钟**完全解耦**。

当前没有任何 API 端点可以 step 实验性 pack 的时钟。`GET /api/experimental/runtime/packs/:packId/clock` 将返回初始 tick 值。后续可按需添加独立的 step API。

---

## 4. 接口契约

### 4.1 输入约束

| 字段 | 类型 | 必须 | 说明 |
|------|------|------|------|
| `pack` | `WorldPack` | 是 | 已通过 schema validation 的 pack 对象 |
| `prisma` | `PrismaClient` | 是 | kernel-side Prisma 连接（用于 actor bridges） |
| `initialTick` | `bigint` | 是 | 从 `pack.simulation_time.initial_tick` 解析的初始 tick |

### 4.2 输出

| 字段 | 类型 | 说明 |
|------|------|------|
| `install` | `InstalledPackRuntimeSummary` | DB 创建结果（含 runtimeDbPath, runtimeDbCreated 等） |
| `coreModels` | `PackRuntimeMaterializeSummary` | 写入的 entity/state/authority/mediator 计数 |
| `actorBridges` | `ActorBridgeSummary` | 创建的 kernel-side Agent/Identity/Binding 计数 |

### 4.3 幂等性保证

- `installPackRuntime`：`CREATE TABLE IF NOT EXISTS`，重复调用安全
- Materialization repos：使用 upsert（`INSERT … ON CONFLICT(id) DO UPDATE`），重复调用安全
- `materializeActorBridges`：Prisma upsert，重复调用安全

**连续调用两次 `materializePackRuntime` 不会产生副作用。**

### 4.4 错误语义

- 如果 `pack.metadata.id` 为空 → `installPackRuntime` → `compilePackStoragePlan` → schema validation 失败
- 如果 `pack.storage` 无效 → `compilePackStoragePlan` 抛出 Zod 校验异常
- 如果文件系统不可写 → `ensurePackRuntimeDirectory` / `fs.writeFileSync` 抛出系统异常
- 如果 `prisma` 不可用 → `materializeActorBridges` 抛出 Prisma 异常

**不捕获内部异常，由调用方决定如何处理。** 当前两条调用路径：
- Active activation：异常 → 启动失败，`SimulationManager.init()` 向上传播
- Experimental load：异常 → `translateExperimentalLoadError()` 捕获并转为 `ApiError`

---

## 5. 数据流

### 5.1 Before（当前状态）

```
Active pack activation:
  loader.loadPack → installPackRuntime → materializeCoreModels
                                       → materializeActorBridges
                                       → resolvePackClock
                                       → discoverPlugins

Experimental pack load:
  catalog.resolveByIdOrFolder → new PackRuntimeInstance(空壳) → registry.register
                              → (无 materialization)
                              → (无 clock 初始化)
```

### 5.2 After（目标状态）

```
Shared materialization:
  materializePackRuntime({ pack, prisma, initialTick })
    ├── installPackRuntime(pack)
    │     └── compilePackStoragePlan → PackStorageEngine.materializeStoragePlan
    │           └── data/world_packs/<packId>/runtime.sqlite 创建/确认
    ├── materializePackRuntimeCoreModels(pack, initialTick)
    │     └── upsert: world_entities, entity_states, authority_grants, mediator_bindings
    └── materializeActorBridges(pack, prisma, initialTick)
          └── upsert: Agent, Identity, IdentityNodeBinding (kernel Prisma)

Active pack activation:
  loader.loadPack → materializePackRuntime → resolvePackClock → discoverPlugins

Experimental pack load:
  catalog.resolve → materializePackRuntime → new PackRuntimeInstance(+clock) → registry.register
```

---

## 6. 测试策略

### 6.1 单元测试（新文件：`tests/unit/pack_materializer.spec.ts`）

| 测试用例 | 验证点 |
|----------|--------|
| `materializes a fresh pack` | 对一个无 runtime.sqlite 的 pack 调用，返回 `runtimeDbCreated: true`，entity/state/bridge 计数 > 0 |
| `idempotent: second call returns same counts` | 对同一 pack 调用两次，第二次 `runtimeDbCreated: false`，计数与第一次相同 |
| `creates correct directory structure` | `data/world_packs/<packId>/runtime.sqlite` 和 `.storage-plan.json` 存在 |
| `actor bridges use pack-scoped IDs` | Agent ID 格式为 `${packId}:${actor.id}`，Identity ID 格式为 `${packId}:identity:${actor.id}` |
| `handles pack without storage config` | 使用 default storage config 的 pack 可以成功 materialize |
| `handles pack with custom pack_collections` | 自定义 collection 的 DDL 被正确创建 |

### 6.2 注册表集成测试（扩展：`tests/unit/pack_runtime_registry.spec.ts`）

| 测试用例 | 验证点 |
|----------|--------|
| `load triggers materialization` | 调用 `registryService.load(packRef)` 后，runtime.sqlite 存在且包含数据 |
| `load then unload cleans up actor bridges` | unload 后 kernel-side Agent/Identity/Binding 被前缀匹配删除 |

### 6.3 Active activation 回归（现有：`tests/unit/pack_runtime_materializer.spec.ts`）

| 测试用例 | 验证点 |
|----------|--------|
| 所有现有测试继续通过 | `activateWorldPackRuntime` 行为不变（内部调用 `materializePackRuntime` 代替三行调用） |

---

## 7. 开放问题与后续工作

### 7.1 `bootstrap_list` 启动模式

`runtime.multi_pack.start_mode` 和 `bootstrap_packs` 配置已存在于 schema 中（第 15 行，第 28-29 行）。本轮保留配置但**不实现启动逻辑**。后续可在 `SimulationManager.init()` 或独立 bootstrapper 中实现：读取 `bootstrap_packs` 列表，对每个 pack 依次调用 `materializePackRuntime` + 注册。

### 7.2 实验性 pack 的 step API

当前没有端点可以推进实验性 pack 的时钟。后续可在 `experimental_runtime.ts` 中添加：
```
POST /api/experimental/runtime/packs/:packId/step
```
调用 `host.getClock().tick(amount)`。

### 7.3 卸载清理增强

当前 `teardownActorBridges` 只清理 kernel-side 数据。后续可评估是否需要：
- 删除 `runtime.sqlite` 文件
- 清理 `pluginRuntimeRegistry` 缓存
- 通知 scheduler 停止相关 workers

### 7.4 Plugin Discovery

`discoverPackLocalPlugins` 在 active activation 中被调用，但不在 `materializePackRuntime` 中。
原因：
- 它需要 `packFolderName` 定位目录（§1.3 双目录结构）
- 实验性 pack 的 plugin 运行时语义（注册 context sources / prompt workflow steps / routes）在当前阶段可能不需要

如果后续需要在实验性 pack 中启用 plugins，可以将 `discoverPackLocalPlugins` 作为 `materializePackRuntime` 的可选步骤，或在 `load()` 中单独调用 `syncExperimentalPackPluginRuntime`（当前已经调用，但因为没有真实的 plugin installations 而成为 no-op）。

### 7.5 Scheduler 多包隔离

`experimental_scheduler_runtime.ts` 当前调用全局 kernel scheduler 数据，只用 `packId` 给 `partition_id` 加前缀。真正的 per-pack scheduler 隔离需要更深层的重构，不在本轮范围。

---

## 8. 验收标准

- [ ] `materializePackRuntime` 函数存在于 `apps/server/src/core/pack_materializer.ts`
- [ ] `activateWorldPackRuntime` 重构为调用 `materializePackRuntime`
- [ ] `PackRuntimeRegistryService.load()` 在注册前调用 `materializePackRuntime`
- [ ] 实验性 pack load 后，`data/world_packs/<packId>/runtime.sqlite` 存在并包含 entities/states/authorities/mediators
- [ ] 实验性 pack load 后，kernel-side Prisma 中存在对应的 Agent/Identity/Binding
- [ ] 实验性 pack 拥有独立时钟，初始 tick 来自 `pack.simulation_time.initial_tick`
- [ ] 所有现有 unit / integration / e2e 测试继续通过
- [ ] TypeScript 编译无 error
