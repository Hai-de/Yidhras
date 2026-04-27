<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/experimental-pack-runtime-materialization.md","contentHash":"sha256:bb59b08ea2848de6dd46f016857e9ae71b8ad5aef8b1733c97159207ece759b2"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 新建 pack_materializer.ts 接口文件（类型定义 + 空函数签名）  `#t1`
- [x] 新建 pack_materializer.spec.ts 单元测试（6 个用例）  `#t2`
- [x] 实现 materializePackRuntime() 函数体（三条已有函数调用）  `#t3`
- [x] 重构 runtime_activation.ts：三行调用 → 一行 materializePackRuntime  `#t4`
- [x] 重构 PackRuntimeRegistryService.load()：注入 materialization + 独立时钟  `#t5`
- [x] 扩展 pack_runtime_registry.spec.ts（load 集成测试 + unload 清理测试）  `#t6`
- [x] 全量回归：unit / integration / e2e + tsc --noEmit  `#t7`
<!-- LIMCODE_TODO_LIST_END -->

# 实现计划：共享 Pack Runtime Materialization 接口抽取

## 关联设计文档

- 设计：`.limcode/design/experimental-pack-runtime-materialization.md`

## 总览

按 TDD 顺序（接口 → 测试 → 实现），将 `activateWorldPackRuntime` 中的三个 materialization 调用抽取为可复用的 `materializePackRuntime()` 函数，然后重构 active activation 调用共享函数，并在 `PackRuntimeRegistryService.load()` 中接入共享函数以打通实验性多包加载路径。

## 阶段 1：接口定义

### T1. 新建 `pack_materializer.ts` 接口文件

**文件**: `apps/server/src/core/pack_materializer.ts`

- 定义 `MaterializePackRuntimeInput` 接口（`pack: WorldPack`, `prisma: PrismaClient`, `initialTick: bigint`）
- 定义 `MaterializePackRuntimeOutput` 接口（`install`, `coreModels`, `actorBridges`）
- 导出 `materializePackRuntime()` 函数签名（空实现，throw `new Error('not implemented')`）

**依赖**: 无（纯类型文件）
**验证**: TypeScript 编译通过，接口可被 import

---

## 阶段 2：单元测试

### T2. 新建 `pack_materializer.spec.ts` 测试文件

**文件**: `apps/server/tests/unit/pack_materializer.spec.ts`

**测试用例**（6 个）：

| # | 名称 | 验证点 |
|---|------|--------|
| 1 | `materializes a fresh pack` | `install.runtimeDbCreated === true`，`coreModels.world_entity_count > 0`，`actorBridges.agent_count > 0` |
| 2 | `idempotent: second call returns same counts` | 调用两次，第二次 `runtimeDbCreated === false`，counts 与第一次相同 |
| 3 | `creates runtime.sqlite and storage-plan.json` | `fs.existsSync` 验证两个文件存在 |
| 4 | `actor bridges use pack-scoped IDs` | Agent ID 格式 `${packId}:${actor.id}`，Identity ID 格式 `${packId}:identity:...` |
| 5 | `handles pack without storage config` | 使用最小 pack（无 `storage` 字段），仍成功，使用默认值 |
| 6 | `handles pack with custom pack_collections` | 自定义 collection 的 DDL 被创建（通过 SQLite introspection 或 storage-plan.json 验证） |

**测试辅助**：
- 复用 `tests/helpers/runtime.ts` 中的 `createIsolatedRuntimeEnvironment` 创建隔离文件系统
- 使用最小合法 pack 对象（`parseWorldPackConstitution({ metadata: { id, name, version }, entities: { actors: [...] } })`）
- 使用 mock PrismaClient（`vi.fn()` + chain `.upsert()` mock）

**依赖**: T1（接口定义）

---

## 阶段 3：共享函数实现

### T3. 实现 `materializePackRuntime()` 函数体

**文件**: `apps/server/src/core/pack_materializer.ts`

- 实现函数：调用 `installPackRuntime(pack)` → `materializePackRuntimeCoreModels(pack, initialTick)` → `materializeActorBridges(pack, prisma, initialTick)`
- 添加 JSDoc 注释（幂等性说明、调用顺序说明）
- 无异常捕获，直接传播错误

**依赖**: T1, T2
**验证**: `npx vitest run tests/unit/pack_materializer.spec.ts` 全部通过

---

## 阶段 4：重构 Active Pack Activation

### T4. 重构 `runtime_activation.ts`

**文件**: `apps/server/src/core/runtime_activation.ts`

- 移除 `activateWorldPackRuntime` 中对 `installPackRuntime`、`materializePackRuntimeCoreModels`、`materializeActorBridges` 的三行直接调用
- 替换为一行 `await materializePackRuntime({ pack, prisma, initialTick: runtimeConfig.initialTick })`
- 移除已不再需要的 import（`installPackRuntime`、`materializePackRuntimeCoreModels`、`materializeActorBridges`，如果这些不再被本文件其他函数引用）
- 其余逻辑不变（`resolvePackClock`、`discoverPackLocalPlugins`、`validateActivatedTickBounds`）

**依赖**: T3
**验证**: 现有 `tests/unit/pack_runtime_materializer.spec.ts` 全部通过

---

## 阶段 5：集成 — 实验性加载路径

### T5. 重构 `PackRuntimeRegistryService.load()`

**文件**: `apps/server/src/core/pack_runtime_registry_service.ts`

- 在 `packCatalog.resolvePackByIdOrFolder(packRef)` 成功后、`registry.register()` 之前，插入 materialization 调用：

```
const runtimeConfig = getWorldPackRuntimeConfig(resolved.pack);
await materializePackRuntime({
  pack: resolved.pack,
  prisma: this.prisma,
  initialTick: runtimeConfig.initialTick
});
```

- 构造 `PackRuntimeInstance` 时传入独立 `clock` 和 `runtimeSpeed`（不再使用默认值）：
  - `clock`: `new ChronosEngine(calendars, runtimeConfig.initialTick)`
  - `runtimeSpeed`: `new RuntimeSpeedPolicy(runtimeConfig.configuredStepTicks ?? 1n)`

- 添加 import: `ChronosEngine`, `CalendarConfig`, `getWorldPackRuntimeConfig`, `RuntimeSpeedPolicy`, `materializePackRuntime`

**依赖**: T3, T4
**验证**: 
- 扩展 `tests/unit/pack_runtime_registry.spec.ts`，新增 `load triggers materialization` 测试
- TypeScript 编译通过

---

## 阶段 6：扩展注册表测试

### T6. 扩展 `pack_runtime_registry.spec.ts`

**文件**: `apps/server/tests/unit/pack_runtime_registry.spec.ts`

在现有测试后追加两个新测试：

| # | 名称 | 验证点 |
|---|------|--------|
| 1 | `load triggers materialization` | mock `materializePackRuntime` 被调用且参数正确（pack、prisma、initialTick），`PackRuntimeInstance` 构造有独立 clock |
| 2 | `load then unload cleans up actor bridges` | 验证 unload 调用 `teardownActorBridges`（通过 spy on `prisma.agent.deleteMany` 等） |

- 对 T5 中的 `.load()` 进行隔离测试（mock `materializePackRuntime`、mock `PackRuntimeInstance`）

**依赖**: T5
**验证**: 新增测试全部通过

---

## 阶段 7：回归验证

### T7. 全量测试回归

- 运行 `npx vitest run --config vitest.unit.config.ts`
- 运行 `npx vitest run --config vitest.integration.config.ts`
- 运行 `npx vitest run --config vitest.e2e.config.ts`（如果有）
- 确认所有现有测试继续通过
- `npx tsc --noEmit` 无 error

**依赖**: T1-T6
**验证**: CI 全绿，无回归

---

## 注意事项

1. **Mock Prisma 策略**: `materializeActorBridges` 使用 `prisma.agent.upsert`、`prisma.identity.upsert`、`prisma.identityNodeBinding.upsert`。测试中需要 mock 这些 Prisma 方法（`vi.fn().mockResolvedValue(...)`），或使用 `tests/helpers/runtime.ts` 中已有的测试基础设施。

2. **测试隔离**: `pack_materializer.spec.ts` 使用 `createIsolatedRuntimeEnvironment` 创建临时 `WORKSPACE_ROOT`，测试后清理。

3. **Import 路径**: 注意确保 `pack_materializer.ts` 的 import 路径与项目其他文件一致（使用 `.js` 扩展名）。

4. **向后兼容**: `runtime_activation.ts` 对外接口 `activateWorldPackRuntime` 的签名和返回值类型不变，仅内部实现变化。

## 验收标准（来自设计文档 §8）

- [ ] `materializePackRuntime` 函数存在于 `apps/server/src/core/pack_materializer.ts`
- [ ] `activateWorldPackRuntime` 重构为调用 `materializePackRuntime`
- [ ] `PackRuntimeRegistryService.load()` 在注册前调用 `materializePackRuntime`
- [ ] 实验性 pack load 后，`data/world_packs/<packId>/runtime.sqlite` 存在并包含 entities/states/authorities/mediators
- [ ] 实验性 pack load 后，kernel-side Prisma 中存在对应的 Agent/Identity/Binding
- [ ] 实验性 pack 拥有独立时钟，初始 tick 来自 `pack.simulation_time.initial_tick`
- [ ] 所有现有 unit / integration / e2e 测试继续通过
- [ ] TypeScript 编译无 error
