# 多包对等重构实施计划 — 方案 A + DB Migration

> 来源: `.limcode/design/multi-pack-symmetry-refactoring.md` + 诚实性审计
> 前置: 方案 D 已实施（world engine 对称加载）
> 创建: 2026-05-11
> 状态: Phase 0 已完成

## 总体策略

按依赖顺序分 5 个 Phase 实施。每个 Phase 完成后跑全量测试并验证前一个 Phase 仍未退化。

**核心原则**：
1. DB migration 先行 — 没有 `pack_id` 列，所有包隔离查询无法实现
2. 接口定义先行 — 先定新接口，再改调用方
3. 调用方按模块分批改造 — 每个 batch 内文件可并行修改
4. 消除旧接口在最后 — 所有调用方迁移完之前，旧接口保留

## 依赖关系

```
Phase 0: DB Migration
  │
  ▼
Phase 1: 新接口定义 + SimulationManager 拆分
  │
  ├─► Phase 2A: Loop 六步 packId 透传
  │    │
  │    ├─► Phase 2B: Scheduler 包隔离
  │    │
  │    └─► Phase 2C: Inference workflow 包隔离
  │
  ├─► Phase 2D: 服务层调用方迁移
  │
  └─► Phase 2E: 路由层适配
  │
  ▼
Phase 3: 旧接口清除 + 测试更新
  │
  ▼
Phase 4: 集成验证 + 文档更新
```

---

## Phase 0: DB Migration

**目标**: 为缺少 `pack_id` 的核心表添加列、索引，回填数据。

**验收标准**: 所有既有测试通过（含新列的 nullable 约束不破坏现有写入）。

### 0.1 — Prisma schema 添加 `pack_id` 列

**需 migration 的表（16 张）**:

| 表 | `pack_id` 类型 | 索引 | 备注 |
|----|---------------|------|------|
| `Agent` | `String?` (nullable) | `@@index([pack_id, type])` | 主包 agent 回填为 active pack ID |
| `Event` | `String?` (nullable) | `@@index([pack_id, tick])` | 关键：时钟恢复依赖此列 |
| `ActionIntent` | `String?` (nullable) | `@@index([pack_id, status])` | dispatcher 按 pack 过滤 |
| `InferenceTrace` | `String?` (nullable) | `@@index([pack_id, created_at])` | 通过 `DecisionJob.pack_id` 关联 |
| `Relationship` | `String?` (nullable) | `@@index([pack_id, from_id])` | |
| `RelationshipAdjustmentLog` | `String?` (nullable) | `@@index([pack_id, created_at])` | |
| `SNRAdjustmentLog` | `String?` (nullable) | `@@index([pack_id, agent_id])` | |
| `Post` | `String?` (nullable) | `@@index([pack_id])` | |
| `WorldVariable` | `String?` (nullable) | `@@unique([pack_id, key])` 替代 `@@id(key)` | 变更主键结构，需谨慎 |
| `AtmosphereNode` | `String?` (nullable) | `@@index([pack_id])` | |
| `Circle` | `String?` (nullable) | `@@index([pack_id])` | |
| `CircleMember` | `String?` (nullable) | `@@index([pack_id])` | |
| `Identity` | `String?` (nullable) | `@@index([pack_id])` | |
| `Policy` | `String?` (nullable) | `@@index([pack_id, resource, action])` | |
| `AiInvocationRecord` | `String?` (nullable) | `@@index([pack_id, created_at])` | |
| `ConversationMemory` | `String?` (nullable) | `@@index([pack_id])` | |

**文件变更**:

| 文件 | 变更 |
|------|------|
| `apps/server/prisma/schema.prisma` | 16 张表添加 `pack_id String?` 和对应索引；`WorldVariable` 改主键为 `id` + `@@unique([pack_id, key])` |
| `apps/server/prisma/migrations/YYYYMMDD_add_pack_id_to_core_tables/migration.sql` | 新 migration：ALTER TABLE 添加列 + CREATE INDEX |

### 0.2 — 数据回填脚本

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/migrations/backfill_pack_id.ts` | 新文件：将现有数据的 `pack_id` 设为主包 ID（从 `SimulationManager.getActivePackId()` 或配置读取）；`WorldVariable` 需特殊处理（key + packId 复合唯一） |

### 0.3 — Prisma client 重新生成

```bash
cd apps/server && npx prisma generate
```

### 0.4 — 写入路径补 `pack_id`

所有创建上述 16 张表记录的服务函数需在 `create` 时传入 `pack_id`。

| 文件 | 涉及函数 | 当前状态 |
|------|---------|---------|
| `apps/server/src/app/services/action_intent_repository.ts` | `createActionIntent`, `createPendingIntent`, `createDispatchedIntent` | 需加 `packId` 参数 |
| `apps/server/src/app/services/inference_workflow/workflow_job_repository.ts` | `createPendingDecisionJob`, `createReplayDecisionJob` | 已有 `pack_id: input.request_input.pack_id`，OK |
| `apps/server/src/inference/service.ts` | `InferenceTrace` 创建 | 需从 context 获取 `packId` |
| `apps/server/src/ai/observability.ts` | `AiInvocationRecord` 创建 | 需从 context 获取 `packId` |
| `apps/server/src/app/runtime/action_dispatcher_runner.ts` | `ActionIntent` 创建（通过 repository） | 已在 repository 层处理 |
| `apps/server/src/app/services/identity.ts` | `Agent` 创建 | 需加 `packId` |

**注意**: Phase 0 中 `pack_id` 为 nullable，现有写入不传 `pack_id` 时默认 `null`，不破坏现有功能。后续 Phase 逐步将写入路径改为必传。

---

## Phase 1: 新接口定义 + SimulationManager 拆分

**目标**: 定义 `PackRuntimePort` 和 `MultiPackRuntimePort` 接口，拆分 `SimulationManager`，不改变任何调用方（旧接口保留）。

**验收标准**: 全量测试通过；新接口可编译但尚无调用方。

### 1.1 — 定义新端口接口

**文件**:

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/services/pack_runtime_ports.ts` | **新增** `PackRuntimePort` 接口（per-pack 运行时操作）和 `MultiPackRuntimePort` 接口（跨包聚合查询） |

```typescript
export interface PackRuntimePort {
  getPackId(): string;
  getCurrentTick(): bigint;
  getCurrentRevision(): bigint;
  getPack(): WorldPack;
  resolvePackVariables(template: string, permission?: unknown, actorState?: Record<string, unknown> | null): string;
  getStepTicks(): bigint;
  getRuntimeSpeedSnapshot(): RuntimeSpeedSnapshot;
  setRuntimeSpeedOverride(stepTicks: bigint): void;
  clearRuntimeSpeedOverride(): void;
  getAllTimes(): unknown;
  step(amount?: bigint): Promise<void>;
  getPackSlotDeclarations(): Record<string, Record<string, unknown>> | null;
  applyClockProjection(snapshot: RuntimeClockProjectionSnapshot): void;
}

export interface MultiPackRuntimePort {
  listPacks(): string[];
  getPackTick(packId: string): bigint;
  getGlobalClock(): AggregatedClockSnapshot;
  getPackRuntime(packId: string): PackRuntimePort;
  assertRuntimeReady(packId: string, feature: string): void;
}

export interface AggregatedClockSnapshot {
  packs: Record<string, { tick: bigint; revision: bigint }>;
  primaryPackId: string;
}
```

### 1.2 — 实现 `DefaultPackRuntimePort`

每个 `PackRuntimeInstance` 持有自己的 `clock`、`runtimeSpeed`、`activePack`、`currentRevision`。`PackRuntimePort` 是对 `PackRuntimeInstance` 的 facade。

**文件**:

| 文件 | 变更 |
|------|------|
| `apps/server/src/packs/orchestration/default_pack_runtime_port.ts` | **新增** 实现 `PackRuntimePort`，持有 `PackRuntimeInstance` 引用 |

`PackRuntimePort` 的实现直接委托给 `PackRuntimeInstance`（已有 clock/speed/pack 字段），加上 `applyClockProjection` 委托给实例的 clock。

### 1.3 — 拆分 `SimulationManager`

从 `SimulationManager` 中提取：

| 新组件 | 职责 | 来源字段 |
|--------|------|---------|
| `PackRuntimeCoordinator` | 多包生命周期：load/unload/reinitialize | `packRuntimeRegistryService`, `loadExperimentalPackRuntime`, `unloadExperimentalPackRuntime` |
| `MultiPackRuntimeFacade` | 跨包查询：listPacks, getPackTick, getGlobalClock, getPackRuntime | `listLoadedPackRuntimeIds`, `getPackRuntimeHandle`, 新增聚合方法 |

**`SimulationManager` 保留**：`RuntimeDatabaseBootstrap`, `PackCatalogService`（这两个是全局服务）。

**`SimulationManager` 删除**：`activePackRuntimeFacade`, `clock`, `runtimeReady`, `paused`, `spatialRuntime` 及所有 `HostRuntimeKernelFacade` 委托方法。这些迁移到 `PackRuntimePort`。

**文件**:

| 文件 | 变更 |
|------|------|
| `apps/server/src/core/simulation.ts` | 拆出 `PackRuntimeCoordinator` 和 `MultiPackRuntimeFacade`，保留 `RuntimeDatabaseBootstrap` 和 `PackCatalogService` |
| `apps/server/src/core/pack_runtime_coordinator.ts` | **新增** 多包生命周期管理 |
| `apps/server/src/core/multi_pack_runtime_facade.ts` | **新增** 跨包查询聚合 |

### 1.4 — 更新 `AppContext` 端口

在 `AppContext` 中新增端口，暂与旧端口并存：

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/services/app_context_ports.ts` | 新增 `PackRuntimePort` 和 `MultiPackRuntimePort` 接口（上 1.1 已定义） |
| `apps/server/src/app/context.ts` | 新增 `packRuntime?: PackRuntimePort` 和 `multiPackRuntime?: MultiPackRuntimePort` 端口；保留 `activePackRuntime` 和 `clock` |

### 1.5 — `PackRuntimeInstance` 增强

当前 `PackRuntimeInstance`（在 `pack_runtime_registry_service.ts` 中）已有 `clock`、`runtimeSpeed`、`pack` 字段。需额外添加：

| 文件 | 变更 |
|------|------|
| `apps/server/src/packs/orchestration/pack_runtime_registry_service.ts` | `PackRuntimeInstance` 增加 `currentRevision: bigint` 字段（初始 0n），增加 `getPackRuntimePort()` 方法返回 `DefaultPackRuntimePort` |

### 1.6 — `PackRuntimeScopeMode` 移除准备

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/services/pack_scope_resolver.ts` | 添加 `resolvePackScope(packId)` 方法，使用 `PackRuntimeRegistry`（当前 Implementation B 的逻辑），保留 `assertPackScope` 中 stable/experimental 分支暂时不动 |
| `apps/server/src/app/runtime/PackScopeResolver.ts` | 无变更 — 已经是对称设计 |

---

## Phase 2A: Loop 六步 packId 透传

**目标**: `PackSimulationLoop` 的六步全部接收 `packId`，所有 `context.activePackRuntime!` 替换为 pack-scoped 调用。

**验收标准**: Loop 代码中不再有 `context.activePackRuntime!` 调用；每个 step 使用 `this.packRuntimePort`（或在 step 内通过 registry 获取的 `PackRuntimePort`）。

### 2A.1 — `PackSimulationLoop` 持有 `PackRuntimePort`

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/runtime/PackSimulationLoop.ts` | 构造函数新增 `packRuntime: PackRuntimePort`；替换所有 `context.activePackRuntime!.getCurrentTick()` 为 `this.packRuntime.getCurrentTick()`；替换 `context.activePackRuntime?.getActivePack()` 为 `this.packRuntime.getPack()` |

具体替换点（第 255 行等）：

| 原调用 | 新调用 |
|--------|--------|
| `context.activePackRuntime!.getCurrentTick()` (L255) | `this.packRuntime.getCurrentTick()` |
| `context.activePackRuntime?.getActivePack()` (L93) | `this.packRuntime.getPack()` |

### 2A.2 — Step 1: `expirePackIdentityBindings` 加 `packId`

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/runtime/identity_binding_expiry.ts` | 函数签名加 `packId: string`；内部 `context.activePackRuntime!.getCurrentTick()` → `packRuntimePort.getCurrentTick()` 或改为接收 tick 参数 |

### 2A.3 — Step 2: `stepPackWorldEngine`

已接收 `packId`，但 `applyClockProjection` 路径需修复：

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/runtime/world_engine_persistence.ts` | `applyClockProjection` 调用改为 `context.multiPackRuntime!.getPackRuntime(packId).applyClockProjection(snapshot)` 或传递 port |

### 2A.4 — Step 3: `runAgentScheduler`

已接收 `packId`，但内部有 4 处 `context.activePackRuntime!.getCurrentTick()`：

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/runtime/agent_scheduler.ts` | 接收 `packRuntime: PackRuntimePort` 参数；替换 4 处 `context.activePackRuntime!.getCurrentTick()` |

### 2A.5 — Step 4: `runDecisionJobRunner` 加 `packId`

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/runtime/decision_job_runner.ts` | 函数签名加 `packId: string, packRuntime: PackRuntimePort`；将 `packId` 传给 workflow 内部调用 |

### 2A.6 — Step 5: `runActionDispatcher` 加 `packId`

当前有 8+ 处 `context.activePackRuntime!.getCurrentTick()` 和 `context.activePackRuntime!.getActivePack()?.metadata.id`：

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/runtime/action_dispatcher_runner.ts` | 函数签名加 `packId: string, packRuntime: PackRuntimePort`；替换 8+ 处 `activePackRuntime` 调用 |

### 2A.7 — Step 6: `runPerceptionPipeline` 加 `packId`

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/runtime/perception_pipeline.ts` | 函数签名加 `packId: string, packRuntime: PackRuntimePort`；替换 `getActivePack()` 和 `getCurrentTick()` |

---

## Phase 2B: Scheduler 包隔离

**目标**: 所有 scheduler 文件的 `context.activePackRuntime!.getCurrentTick()` 替换为 pack-scoped 调用；scheduler signal 查询按 `pack_id` 过滤。

**前置**: Phase 0（DB migration 使查询可过滤）

### 2B.1 — scheduler 文件迁移

| 文件 | 调用点数 | 变更 |
|------|---------|------|
| `apps/server/src/app/runtime/scheduler_ownership.ts` | 7 | 接收 `packRuntime: PackRuntimePort`；替换所有 `context.activePackRuntime!.getCurrentTick()` |
| `apps/server/src/app/runtime/agent_scheduler.ts` | 4 | 已在 2A.4 处理 |
| `apps/server/src/app/runtime/scheduler_lease.ts` | 2 | 接收 `packRuntime: PackRuntimePort`；替换调用 |
| `apps/server/src/app/runtime/scheduler_rebalance.ts` | 2（间接） | 接收 `packRuntime: PackRuntimePort`；替换间接调用 |

### 2B.2 — scheduler signal 查询增加 `pack_id` 过滤

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/services/inference_workflow/scheduler_signal_repository.ts` | 所有 `findMany` / `findFirst` 查询需追加 `where: { pack_id }` 条件；`Agent` 查询需加 `where: { type: 'active', pack_id }`；`Event`、`RelationshipAdjustmentLog`、`SNRAdjustmentLog` 查询需加 `pack_id` |

### 2B.3 — `context.clock.getCurrentTick()` 在 scheduler 中的替换

scheduler 通过 `PackRuntimePort` 获取 tick，不再走全局 clock。涉及的 19 处 `context.clock.getCurrentTick()` 中的 scheduler 相关部分全部替换。

---

## Phase 2C: Inference Workflow 包隔离

**目标**: inference workflow 全部使用 pack-scoped tick 和 pack-scoped 过滤。

### 2C.1 — workflow repository 迁移

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/services/inference_workflow/workflow_job_repository.ts` | 6 处 `context.clock.getCurrentTick()` → `packRuntime.getCurrentTick()` 或显式 `packId` 参数；`listRunnableDecisionJobs` 增加 `packId` 过滤 |
| `apps/server/src/app/services/inference_workflow/scheduler_signal_repository.ts` | 已在 2B.2 处理 |
| `apps/server/src/app/services/inference_workflow/workflow_query.ts` | `buildInferenceJobsWhere` 已有 `filters.pack_ids` 参数，确保所有查询路径传递 `packId` |

### 2C.2 — inference service 迁移

| 文件 | 变更 |
|------|------|
| `apps/server/src/inference/service.ts` | 3 处 `context.clock.getCurrentTick()` → pack-scoped tick |

### 2C.3 — 其他全局 clock 调用点迁移

| 文件 | 调用点 | 变更 |
|------|--------|------|
| `apps/server/src/domain/invocation/invocation_dispatcher.ts` | L104, L193 | 接收 `packRuntime` 参数 |
| `apps/server/src/access_policy/service.ts` | L229 | 接收 `packId` 或 `packRuntime` |
| `apps/server/src/ai/observability.ts` | L112 | 接收 `packId` |
| `apps/server/src/operator/auth/token.ts` | L53, L60, L80 | 接收 `packId` — `OperatorSession` 已有 `pack_id` |
| `apps/server/src/operator/audit/logger.ts` | L19 | 接收 `packId` — `OperatorAuditLog` 已有 `pack_id` |
| `apps/server/src/ai/tool_executor.ts` | L233-234 | 接收 `packRuntime` 参数 |

---

## Phase 2D: 服务层调用方迁移

**目标**: 所有 `context.activePackRuntime!` 调用点替换为 `context.multiPackRuntime!.getPackRuntime(packId)` 或直接传入 `PackRuntimePort`。

### 2D.1 — 服务文件迁移（高优先级）

| 文件 | 调用点数 | 变更 |
|------|---------|------|
| `apps/server/src/app/services/action_dispatcher.ts` | 5 | 每个函数接收 `packRuntime: PackRuntimePort` |
| `apps/server/src/app/services/identity.ts` | 4 | 函数接收 `packId` + `packRuntime` |
| `apps/server/src/app/services/operators.ts` | 3 | 函数接收 `packRuntime` |
| `apps/server/src/app/services/operator_contracts.ts` | 1 | 函数接收 `packId` |
| `apps/server/src/app/services/operator_agent_bindings.ts` | 2 | 函数接收 `packRuntime` |
| `apps/server/src/app/services/operator_grants.ts` | 1 | 函数接收 `packRuntime` |
| `apps/server/src/app/services/operator_pack_bindings.ts` | 1 | 函数接收 `packRuntime` |
| `apps/server/src/app/services/action_intent_repository.ts` | 6 | 函数接收 `packRuntime` |
| `apps/server/src/app/services/social.ts` | 1 | 函数接收 `packRuntime` |
| `apps/server/src/app/services/relational/graph_projection.ts` | 1 | 函数接收 `packRuntime` |
| `apps/server/src/app/services/relational/queries.ts` | 1 | 函数接收 `packRuntime` |
| `apps/server/src/app/services/system.ts` | 2 | 函数接收 `packRuntime` |
| `apps/server/src/app/services/runtime_control.ts` | 2 | 函数接收 `packRuntime` |
| `apps/server/src/app/services/agent.ts` | 1 | 函数接收 `packRuntime` |

### 2D.2 — 内存/推理子系统迁移

| 文件 | 调用点数 | 变更 |
|------|---------|------|
| `apps/server/src/inference/context_builder.ts` | 5 | 每个 buildContext 函数接收 `packRuntime` |
| `apps/server/src/memory/recording/compaction_service.ts` | 2 | 函数接收 `packRuntime` |
| `apps/server/src/memory/blocks/store.ts` | 1 | 存储操作接收 `packRuntime` |

### 2D.3 — 插件上下文迁移

| 文件 | 调用点数 | 变更 |
|------|---------|------|
| `apps/server/src/plugins/context.ts` | 3 | 插件 context 构建时注入 `packRuntime` |

### 2D.4 — 中间件迁移

| 文件 | 调用点数 | 变更 |
|------|---------|------|
| `apps/server/src/app/middleware/capability.ts` | 1 | 从 `req.packRuntime` 读取而非 `context.activePackRuntime` |

### 2D.5 — World engine 辅助迁移

| 文件 | 调用点数 | 变更 |
|------|---------|------|
| `apps/server/src/app/runtime/world_engine_snapshot.ts` | 3 | 接收 `packRuntime` 参数 |

---

## Phase 2E: 路由层适配

**目标**: 所有路由处理函数通过 `/:packId` 解析出 `PackRuntimePort`，传给服务层。

### 2E.1 — 路由中间件

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/middleware/pack_scope.ts`（或等效文件） | 中间件解析 `req.params.packId`，调用 `context.multiPackRuntime.getPackRuntime(packId)`，挂载到 `res.locals.packRuntime` 或 `req.packRuntime` |

### 2E.2 — 路由文件适配

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/routes/system.ts` | 全局路由改为聚合所有 pack 状态 |
| `apps/server/src/app/routes/pack_snapshots.ts` | 4 处 `activePackRuntime` → `packRuntime` |
| `apps/server/src/app/routes/pack_openings.ts` | 1 处 `activePackRuntime` → `packRuntime` |
| 其他 pack-scoped 路由 | 提取 `packRuntime` 从 request，传给服务层 |

### 2E.3 — `create_app.ts` 全局状态

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/create_app.ts` | L56 `activePackRuntime?.getActivePack()?.metadata.id` → 从 `multiPackRuntime` 获取 |

---

## Phase 3: 旧接口清除 + SimulationManager 重构

**目标**: 删除 `ActivePackRuntimeFacade` 接口和 `DefaultActivePackRuntimeFacade` 类，删除 `AppContext.activePackRuntime` 和 `AppContext.clock`。重构 `SimulationManager` 为纯协调器。

**前置**: Phase 2A-2E 全部完成，不再有代码引用旧接口。

### 3.1 — 删除旧接口和实现

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/services/app_context_ports.ts` | 删除 `ActivePackRuntimeFacade` 接口 |
| `apps/server/src/core/active_pack_runtime_facade.ts` | **删除整个文件** |
| `apps/server/src/app/context.ts` | 删除 `activePackRuntime` 和 `clock` 属性 |
| `apps/server/src/core/simulation.ts` | 删除所有 `HostRuntimeKernelFacade` 和 `ActivePackProvider` 实现；删除 `syncClockFromActiveRuntime()`；删除 `activePackRuntimeFacade`、`clock`、`spatialRuntime`、`runtimeReady`、`paused` 字段 |

### 3.2 — `PackRuntimeScopeMode` 移除

| 文件 | 变更 |
|------|------|
| `apps/server/src/core/pack_runtime_ports.ts` | 删除 `PackRuntimeScopeMode = 'stable' | 'experimental'` |
| `apps/server/src/app/services/pack_scope_resolver.ts` | 统一所有包走 registry 查询路径（删除 stable 分支）；`assertPackScope` 简化为调用 Implementation B 的 `resolve()` |
| `apps/server/src/packs/orchestration/pack_runtime_registry_service.ts` | 删除 `resolveStablePackScope` 和 `resolveExperimentalPackScope` 恒等函数 |

### 3.3 — 启动流程重构

| 文件 | 变更 |
|------|------|
| `apps/server/src/index.ts` | 主包加载不再走 `activePackRuntime.init()`，改为走 `PackRuntimeCoordinator.load()` 统一路径；`sim.setWorldEngine()` 保持不变 |

### 3.4 — 空闲状态处理

当没有 pack 加载时：

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/routes/system.ts` | `GET /api/system/status` 返回 `{ status: 'idle', packs: [] }` |
| `apps/server/src/app/middleware/runtime_ready.ts` | `assertRuntimeReady(feature)` 在 idle 状态下返回 503 |

### 3.5 — 测试更新

约 19+ 测试文件 mock `activePackRuntime`，全部改为 mock `PackRuntimePort`：

| 废弃模式 | 新模式 |
|----------|--------|
| `context.activePackRuntime = { getCurrentTick: () => 100n }` | `context.multiPackRuntime = { getPackRuntime: () => ({ getCurrentTick: () => 100n }) }` |
| `context.clock = { getCurrentTick: () => 100n }` | 通过 `PackRuntimePort` 获取 |

---

## Phase 4: 集成验证 + 文档更新

**目标**: 端到端验证多包运行时正确性，更新文档。

### 4.1 — 多包集成测试

| 测试文件 | 内容 |
|----------|------|
| `apps/server/tests/integration/multi_pack_symmetry.spec.ts` | **新增**：同时加载两个 pack，验证时钟独立、scheduler 隔离、world engine 并发 step、推理任务按 pack 分发 |
| `apps/server/tests/integration/pack_lifecycle.spec.ts` | **新增**：load → step → unload → reload，验证时钟从 DB 恢复 |
| `apps/server/tests/integration/pack_clock_isolation.spec.ts` | **新增**：两个 pack 的时钟投影独立，不互相覆盖 |

### 4.2 — 世界引擎多会话测试

| 测试文件 | 内容 |
|----------|------|
| `apps/server/tests/e2e/world_engine_multi_session.spec.ts` | **新增**：sidecar 多会话加载、步骤、卸载的端到端验证 |

### 4.3 — 文档更新

| 文件 | 变更 |
|------|------|
| `docs/ARCH.md` | 更新架构图：删除"主包"概念，添加 pack-scoped 架构描述 |
| `docs/ARCH_DIAGRAM.md` | 更新调用流图 |
| `docs/specs/API.md` | 更新 system status 返回格式、包统一管理 API |
| `docs/LOGIC.md` | 更新时钟、调度器的包隔离描述 |
| `AGENTS.md` | 更新架构描述段 |

---

## 风险缓解对照

| 风险（审计已识别） | 缓解措施 |
|---------------------|---------|
| 盲点 1：时钟投影数据竞争 | Phase 2A.3 修复 `applyClockProjection` 为 pack-scoped |
| 盲点 2：`PackSimulationLoop.clock` 死代码 | Phase 2A.1 直接使用 `PackRuntimePort`，删除 `this.clock` 死代码 |
| 盲点 3：Loop step 4/5/6 缺 packId | Phase 2A.5-2A.7 全部补上 |
| 盲点 4：调度器跨包时钟污染 | Phase 2B 全部替换为 pack-scoped tick |
| 盲点 5：DB 核心表缺 pack_id | Phase 0 添加列并回填 |
| 盲点 6：Inference workflow 无包隔离 | Phase 2C 全部修复 |
| 盲点 7：pause/runtimeReady/spatialRuntime 全局单例 | Phase 1.3 拆分到 per-pack |
| 盲点 8：PackRuntimePort 接口遗漏 | Phase 1.1 定义完整接口 |
| 盲点 9：load/unload 竞态条件 | Phase 2A 中 `stopLoop` 改为 graceful（等当前 iteration 完成） |
| 盲点 10：两个 PackScopeResolver 行为差异 | Phase 3.2 统一 |
| 盲点 11：DB migration 前置 | Phase 0 先于一切 |
| 补充发现：时钟初始化不对称 | Phase 1.3 中 `PackRuntimeCoordinator.load()` 统一走 `resolvePackClock` 从 DB 恢复 |
| 补充发现：PackRuntimeScopeMode 连锁反应 | Phase 3.2 处理 |

---

## 预估工作量

| Phase | 文件变更 | 预估天数 |
|-------|---------|---------|
| Phase 0: DB Migration | ~20 文件（schema + migration + 回填 + 写入路径） | 2 |
| Phase 1: 新接口 + 拆分 | ~8 文件 | 2 |
| Phase 2A: Loop packId 透传 | ~8 文件 | 2 |
| Phase 2B: Scheduler 包隔离 | ~5 文件 | 1.5 |
| Phase 2C: Inference workflow | ~5 文件 | 1.5 |
| Phase 2D: 服务层迁移 | ~20 文件 | 3 |
| Phase 2E: 路由层适配 | ~5 文件 | 1 |
| Phase 3: 旧接口清除 | ~6 文件 | 1.5 |
| Phase 4: 集成验证 | ~5 新文件 + 文档 | 2 |
| **合计** | **~80 文件** | **~17 天** |

---

## Phase 0 实施记录 (2026-05-11)

### 0.1 — Prisma Schema 变更

**变更文件**: `schema.sqlite.prisma`, `schema.pg.prisma`, `schema.prisma`（三家同步）

**实际变更**:

- 16 张表添加 `pack_id String?`（nullable）+ 对应 `@@index`
- `WorldVariable` **保留 `key @id`** 原主键结构，仅添加 `pack_id String?` + `@@index([pack_id, key])`
- `ConversationMemory` 和 `ConversationEntryRecord` 从 `schema.prisma` 同步到 `.sqlite.prisma` 和 `.pg.prisma`（此前缺失）
- `DecisionJob.pack_id` 已存在于 schema 中，无需再次添加
- `IdentityNodeBinding.pack_id` 已存在，无需再次添加

**WorldVariable PK 决策变更**: 原计划改为 `id @id @default(uuid())` + `@@unique([pack_id, key])`。实施中发现 Prisma v6 对 nullable 复合唯一约束的 `WhereUniqueInput` 类型生成 `pack_id: string`（不接受 null），导致 `upsert`/`findUnique` 无法使用。改为保留 `key @id` 原结构，仅添加 `pack_id String?` + 索引。Lookup 使用 `findFirst({ where: { key, pack_id } })` 替代 `findUnique`。

### 0.2 — 数据回填

跳过。项目未上线，无生产数据。DB 已从零重建。

### 0.3 — Migration

- Migration 名称: `20260511133849_add_pack_id_to_core_tables`
- 16 条 `ALTER TABLE ... ADD COLUMN "pack_id" TEXT`
- 16 条 `CREATE INDEX`
- 无表重定义，无数据丢失风险
- Prisma Client 已重新生成

### 0.4 — 写入路径 pack_id 支持

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/services/identity.ts` | `RegisterIdentityInput` 和 `CreateIdentityBindingInput` 新增 `packId?: string \| null`；`registerIdentity()` 和 `createIdentityBinding()` 在 create data 中传递 `pack_id` |
| `apps/server/src/app/services/agent_signal_repository.ts` | `createEventEvidence()` 和 `createSnrAdjustmentLog()` 的 input 类型新增 `pack_id?: string \| null`，直接透传给 Prisma create |
| `apps/server/src/app/services/relationship_mutation_repository.ts` | `RelationshipAdjustmentLogInput`、`createRelationship()`、`writeRelationshipAdjustmentLog()` 新增可选 `pack_id` 字段 |
| `apps/server/src/app/services/repositories/NarrativeEventRepository.ts` | `getWorldVariable()` 和 `setWorldVariable()` 新增可选 `packId` 参数；改用 `findFirst` 替代 `findUnique`（因 key 不再是唯一标识符结合 pack_id）；`upsert` 的 update 中也写入 `pack_id` |
| `apps/server/src/inference/sinks/prisma.ts` | `InferenceTrace` 和 `ActionIntent` 的 upsert create 中传入 `pack_id: event.input.pack_id ?? null`（`event.input.pack_id` 已存在于 `InferenceRequestInput` 类型中） |

**未在 Phase 0 修改的写入路径**：`pack_id` 为 nullable，现有代码在不传 `pack_id` 时自动填 `null`，不破坏任何功能。以下文件将在后续 Phase 中传递实际 packId 值：
- `apps/server/src/ai/observability.ts` — `AiInvocationRecord` 创建
- `apps/server/src/app/services/repositories/SocialRepository.ts` — `Post` 创建
- `apps/server/src/conversation/store_prisma.ts` — `ConversationMemory` 创建
- `apps/server/src/db/seed_*.ts` — seed 函数

### 0.5 — 验证结果

- **单元测试**: 96 files, 1001 tests passed, 1 skipped（与 Phase 0 前一致）
- **TypeScript**: 仅 `plugins/discovery.ts` 存在预先存在的类型错误，Phase 0 未引入新错误
- **Runtime**: `pnpm prepare:runtime` 成功（DB 从零初始化、seed identity + operator 成功）

### 实施偏差总结

1. **WorldVariable PK 保留** — 见上文 0.1 节
2. **跳过数据回填** — 无生产数据
3. **`action_intent_repository.ts` 未创建新函数** — 计划提到的 `createActionIntent`/`createPendingIntent`/`createDispatchedIntent` 在代码中不存在，ActionIntent 创建在 `inference/sinks/prisma.ts` 中处理
4. **ConversationMemory 模型同步** — schema 同步时发现 `.sqlite.prisma` 和 `.pg.prisma` 缺失此模型，一并补上