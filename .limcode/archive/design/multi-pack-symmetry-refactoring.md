# 多包对等重构方案 / Multi-Pack Symmetry Refactoring

## 问题现状

当前架构存在主包（stable/active）与附加包（experimental）的不对等设计：

| 能力 | 主包 | 附加包 |
|------|------|--------|
| World Engine sidecar 会话 | 有 (`mode: 'active'`) | 无 |
| 模拟循环（6 步） | 是 | 是（但 Step 2 发往不存在的 world engine session） |
| 可否卸载 | 禁止 | 允许 |
| 时钟来源 | sidecar 同步 | 本地 ChronosEngine |
| Scope mode | `'stable'` | `'experimental'` |
| 启动路径 | `activePackRuntime.init()` | `packRuntimeControl.load()` |

### 根因分析

不对等的根因在三个层面：

**1. 端口层 — `activePackRuntime` 是全局单例**

`AppContext.activePackRuntime` 指向唯一的主包。约 30 个文件通过 `context.activePackRuntime!.getCurrentTick()` 获取当前 tick，没有任何 packId 参数。这意味着整个系统的时钟概念被绑定到单个包。

关键文件：
- `apps/server/src/app/services/app_context_ports.ts:56` — 端口定义
- `apps/server/src/index.ts:159` — `activePackRuntime: sim` 注入
- 30+ 处 `context.activePackRuntime!.getCurrentTick()` 调用

**2. World Engine 加载不对称**

只有主包在启动时调用了 `worldEngine.loadPack()`（`index.ts:403-409`）。附加包加载时（`pack_runtime_registry_service.ts:125-204`）完全跳过了 world engine 注册。但 `MultiPackLoopHost` 为所有包创建的 `PackSimulationLoop` 在 Step 2 都调用 `stepPackWorldEngine()`，发往 world engine sidecar——附加包的 step 会因为 session 不存在而失败。

**3. SimulationManager 上帝对象**

`SimulationManager` 同时实现了 `RuntimeDatabaseBootstrap`、`HostRuntimeKernelFacade`、`PackCatalogService`、`ClockProvider`、`ActivePackProvider` 五个接口。主包状态（`activePack`、`clock`、`currentRevision`）直接存储在这个类的私有字段中，其他 pack 的状态反而存在独立的 `PackRuntimeRegistry` 里。

---

## 约束条件

- 项目未上线，无需考虑向后兼容
- Rust world engine sidecar 已支持多 session（`state.sessions: HashMap<packId, Session>`），`mode` 字段仅作标记用，不 gate 功能
- HTTP 路由层已支持 `/:packId` 前缀，pack-scoped 路由天然多包
- `PackRuntimeRegistry`（内存注册表）和 `MultiPackLoopHost` 已有较完善的多包生命周期管理
- 测试覆盖约 19 个文件涉及 `activePackRuntime` mock

---

## 方案 A：完全对等 — 消除主包概念

### 思路

移除 `activePackRuntime` 端口，所有包通过统一路径加载。运行时操作全部带上 `packId`。不再有"主包"和"附加包"的区分。

### 具体变更

1. **删除 `ActivePackRuntimeFacade` 接口和 `DefaultActivePackRuntimeFacade` 实现**
2. **所有 pack 启动时统一调用 `worldEngine.loadPack({ mode: 'active' })`**
3. **`getCurrentTick()` → `getCurrentTick(packId: string)`**，所有调用方修改
4. **删除 `AppContext.clock`、`AppContext.activePack` 旧别名**
5. **`SimulationManager` 拆分**：不再承担 active pack 特殊状态
6. **移除 `PackRuntimeScopeMode = 'stable' | 'experimental'` 区分**
7. **全局路由（如 system status）改为聚合所有 pack 状态**

### 影响面估算

| 变更类型 | 涉及文件数 |
|----------|-----------|
| `getCurrentTick()` → `getCurrentTick(packId)` | ~25 |
| `getActivePack()` → `getPack(packId)` | ~15 |
| 端口/接口删除 | ~5 |
| SimulationManager 拆分 | 1 重写 |
| 路由适配 | ~3 |
| 测试更新 | ~19 |

### 优点

- 概念最干净，彻底消除不对称
- 任意包可独立启停，互不影响
- 代码意图明确——没有隐式的"当前包"假设
- 未来扩展（如跨包交互、包间事件）天然支持

### 缺点

- 改动量最大，几乎每个服务都要改签名
- **需要解决"请求级默认 packId"问题**：HTTP 请求已经带了 `/:packId`，但 scheduler/loop 内部调用没有 HTTP 上下文。需要通过参数链传递 packId
- 全局视角的操作（如 system status、跨包查询）需要全新设计聚合逻辑
- 原来依赖"只有一个包"的隐式假设（如 scheduler ownership bootstrap）需要显式化
- 测试 mock 改动量非常大

---

## 方案 B：保留默认包，消除能力不对等

### 思路

保留"当前活跃包"（default pack）作为无 packId 参数时的回退，但让所有包享有相同的 world engine 能力。`activePackRuntime` 改名为 `defaultPackRuntime`，语义从"唯一主包"变为"默认目标包"。

### 具体变更

1. **所有 pack 加载时统一接入 world engine**（`loadPack` 调用移至 `PackRuntimeRegistryService.load()`）
2. **保留 `activePackRuntime` 但语义降级为 default**：仅在调用方未提供 packId 时使用
3. **API 层（`/:packId` 路由）提取 packId，透传至服务层**
4. **内部调用（scheduler/loop）通过参数链传递 packId**，不依赖全局默认值
5. **`PackRuntimeScopeMode` 简化为单一模式**
6. **删除 `SimulationManager` 的 active pack 特殊存储**，其状态移入 `PackRuntimeRegistry`

### 影响面估算

| 变更类型 | 涉及文件数 |
|----------|-----------|
| World engine load 逻辑统一 | ~2 |
| 内部服务加 packId 参数 | ~20 |
| API 层透传 packId | ~5 |
| 接口降级（保留 backward compatibility） | ~3 |
| 测试更新 | ~15 |

### 优点

- 改动量适中，API 层和内部调用可以渐进改造
- 过渡平滑：先让所有 pack 能力对等，再逐步消除 default pack 依赖
- 对于确实需要"默认包"的场景（如 CLI 命令、seed 脚本），有明确的回退

### 缺点

- 概念上仍有"默认包"残留，不够彻底
- 两套调用路径（带 packId / 不带 packId）可能造成混乱
- 长期看还是要走到方案 A，等于分两步走

---

## 方案 C：Pack 级上下文隔离 — 每个 pack 拥有独立 AppContext

### 思路

不是给每个方法加 `packId`，而是让每个 pack 拥有自己的 `AppContext` 子实例。pack-scoped 操作在自己的 context 上执行，无需显式传递 packId。

### 具体变更

1. **`AppContext` 拆分为 `HostContext`（全局）+ `PackContext`（per-pack）**
2. **`PackContext` 包含 clock、runtime、spatial runtime 等 pack-scoped 状态**
3. **HTTP 中间件根据 `/:packId` 解析出 `PackContext` 并注入 request**
4. **Loop/scheduler 直接持有 `PackContext` 引用，不通过全局 context 查找**
5. **全局 context 仅保留跨 pack 能力（repos、prisma、notifications、ai gateway 等）**

### 影响面估算

| 变更类型 | 涉及文件数 |
|----------|-----------|
| AppContext 拆分 | ~1 |
| PackContext 创建和管理 | ~3 |
| HTTP 中间件适配 | ~2 |
| 服务层适配（从 `context.clock` → `packContext.clock`） | ~25 |
| Loop 重构 | ~2 |
| 测试更新 | ~15 |

### 优点

- Pack 隔离最彻底——每个 pack 的上下文是独立对象，天然线程安全
- 调用方不需要到处传 packId，替代为持有正确的 context 引用
- 未来如果引入 worker 线程 per pack，context 可以直接 move

### 缺点

- `AppContext` 拆分本身就是大工程（当前 100+ 行的接口）
- 跨 pack 操作（如全局查询、跨包事件）需要显式桥接
- 现有代码大量使用 `context.xxx` 模式，需要判断哪些属于 Host 哪些属于 Pack
- 内存开销：每个 pack 持有完整 context 副本

---

## 方案 D：最小改动 — 仅修复 world engine 不对称

### 思路

只修复最致命的 bug（附加包无 world engine session 导致 step 失败），其他不对称暂时保留。是方案 A/B/C 的前置步骤。

### 具体变更

1. **`PackRuntimeRegistryService.load()` 中增加 `worldEngine.loadPack()` 调用**
2. **`PackRuntimeRegistryService.unload()` 中增加 `worldEngine.unloadPack()` 调用**
3. **`MultiPackLoopHost` 传递 world engine 给每个 loop**（已实现）
4. **修复 `runtime_ready` 判断**（`pack_runtime_registry_service.ts:106`）：不再硬编码 `getActivePackId() === packId`

### 影响面

- ~3 文件，约 30 行变更

### 实施记录 (2026-05-11)

已实施。变更文件：

**`apps/server/src/core/simulation.ts`**
- 新增 `WorldEnginePort` 导入
- 新增 `private worldEngine: WorldEnginePort | null = null` 字段
- 新增 `setWorldEngine(worldEngine)` 方法，将 world engine 传递至 `packRuntimeRegistryService`

**`apps/server/src/packs/orchestration/pack_runtime_registry_service.ts`**
- 新增导入：`WorldEnginePort`、`serializeWorldPackSnapshotRecord`、5 个 pack storage repo 函数（`listPackWorldEntities` 等）、`getErrorMessage`
- `DefaultPackRuntimeRegistryServiceOptions` 新增 `worldEngine?: WorldEnginePort` 可选字段
- 新增 `setWorldEngine()` 方法
- `load()` 方法：在 `materializePackRuntime()` + loop 启动后，构建 hydrate snapshot 并调用 `worldEngine.loadPack({ mode: 'active', hydrate })`
- `unload()` 方法：删除 active pack 不可卸载的限制（原 `throw new Error('cannot unload active pack runtime')`）；在 `stopLoop()` 后、`host.dispose()` 前调用 `worldEngine.unloadPack()`，失败时 warn 不阻断
- `getStatus()` 方法：`runtime_ready` 不再硬编码 `getActivePackId() === packId`，改为检查 pack 自身健康状态

**`apps/server/src/index.ts`**
- 在 `appContext.worldEngine` 创建后立即调用 `sim.setWorldEngine(appContext.worldEngine)`

全量单元测试通过（96 files, 1001 tests, 0 failures）。

### 优点

- 改动最小，风险最低
- 立刻让附加包的模拟循环真正工作
- 可以作为方案 A/B/C 的第一步

### 缺点

- 不解决架构层面的不对称
- `activePackRuntime!` 的非空断言仍然散落各处
- 主包不可卸载的限制仍然存在
- 概念债务继续累积

---

## 方案对比总结

| 维度 | 方案 A（完全对等） | 方案 B（默认包 + 能力对等） | 方案 C（Pack Context） | 方案 D（最小修复） |
|------|-------------------|--------------------------|----------------------|-------------------|
| 概念清洁度 | 最高 | 中 | 高 | 低 |
| 改动量 | 大 (~60 文件) | 中 (~40 文件) | 大 (~50 文件) | 小 (~3 文件) |
| 世界引擎利用 | 充分 | 充分 | 充分 | 修复 bug |
| 任意包独立启停 | 是 | 是 | 是 | 部分 |
| 长期可维护性 | 最好 | 中等 | 好 | 差 |
| 实施周期 | 长 | 中 | 中长 | 短 |
| 回滚风险 | 高 | 中 | 中高 | 低 |

---

## 推荐路径

**分两阶段实施：先 D（立即修复），再 A（彻底重构）。**

理由：
- 方案 D 可以立刻让多包模拟真正跑起来，验证 world engine 多 session 的稳定性
- 方案 A 是最干净的终态，项目未上线无需妥协
- 方案 B 和 C 各有取舍但都不如 A 彻底——在无向后兼容约束下，不值得为"过渡"付出额外的概念复杂度
- 方案 C 的 PackContext 隔离是一个好思路，但可以和方案 A 结合（A 消除主包概念，C 提供上下文隔离机制）

### 实施顺序

**Phase 1：方案 D（1-2 天）**
1. `pack_runtime_registry_service.ts` — load 时调用 `worldEngine.loadPack()`
2. `pack_runtime_registry_service.ts` — unload 时调用 `worldEngine.unloadPack()`
3. 修复 `runtime_ready` 判断逻辑

**Phase 2：方案 A 核心（5-7 天）**
1. 定义新的 pack-scoped 接口替代 `ActivePackRuntimeFacade`
2. 改造所有 `getCurrentTick()` 调用为 `getCurrentTick(packId)`
3. 拆分 `SimulationManager`，消除上帝对象
4. 删除 `stable` / `experimental` scope mode 区分
5. 全局路由聚合逻辑
6. 测试更新

---

## 方案 A 详细设计要点

### 新端口设计

```typescript
// 替换 ActivePackRuntimeFacade 的 per-pack 端口
interface PackRuntimePort {
  getCurrentTick(packId: string): bigint;
  getCurrentRevision(packId: string): bigint;
  getActivePack(packId: string): WorldPack | undefined;
  resolvePackVariables(packId: string, template: string, ...): string;
  getRuntimeSpeedSnapshot(packId: string): RuntimeSpeedSnapshot;
  setRuntimeSpeedOverride(packId: string, stepTicks: bigint): void;
  step(packId: string, amount?: bigint): Promise<void>;
}

// 全局聚合端口（替代直接读 activePackRuntime 的跨包查询）
interface MultiPackRuntimePort {
  listPacks(): string[];
  getPackTick(packId: string): bigint;
  getGlobalClock(): AggregatedClockSnapshot;
}
```

### SimulationManager 拆分

```
SimulationManager (删除)
  ├── PackRuntimeCoordinator   — 多 pack 生命周期协调
  ├── PackRuntimePort          — per-pack 运行时操作
  ├── MultiPackRuntimePort     — 跨包聚合查询
  ├── PackCatalogService       — 包目录（保留）
  └── RuntimeDatabaseBootstrap — 数据库初始化（保留）
```

### 路由层适配

当前 pack-scoped 路由（`/:packId`）已通过 `packScopeMiddleware` 解析 packId。适配点：
- 中间件将 `packId` 挂载到 `req` 或 `res.locals`
- 路由处理函数从 `res.locals.packId` 获取，传给服务层
- 全局路由（如 `/api/system/status`）改为调用 `MultiPackRuntimePort.listPacks()` 聚合

### Scheduler 适配

当前 scheduler 操作（`agent_scheduler.ts`、`scheduler_lease.ts` 等）通过 `context.activePackRuntime!.getCurrentTick()` 获取 tick。改为：
- `PackSimulationLoop` 持有自己的 `packId` 和 `clock` 引用（已实现）
- Loop 将 `packId` 传入 scheduler 调用链
- Scheduler 使用传入的 `packId` 调用 `packRuntimePort.getCurrentTick(packId)`

### 不可卸载约束的解除

当前 `pack_runtime_registry_service.ts:213-215` 阻止卸载 active pack：
```typescript
if (this.getActivePackId() === packId) {
  throw new Error('cannot unload active pack runtime');
}
```

方案 A 下删除此检查，所有 pack 均可卸载。如果运行时没有任何 pack，系统进入 idle 状态（模拟循环停止，API 返回降级状态）。

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| 大规模重构引入回归 | 分 Phase 实施，每个 Phase 跑全量测试 |
| World engine 多 session 稳定性未验证 | Phase 1 先验证，暴露问题 |
| 无 packId 的上下文丢失 | Phase 2 改造时，对所有 `activePackRuntime!` 调用逐一审计 |
| 全局路由（system status 等）聚合逻辑复杂 | 先返回简单的 pack 列表，逐步增强 |
| **时钟投影数据竞争** | `applyClockProjection` 必须改为 pack-scoped（见下方审计 §盲点 1） |
| **调度器跨包时钟污染** | 租约/心跳/重平衡全部依赖全局 clock，需 per-pack 隔离 |
| **Loop step 4/5/6 缺失 packId** | 决策 runner、action dispatcher、感知 pipeline 需全链改造 |

---

## 诚实性审计 (2026-05-11)

以下基于代码交叉验证（git diff、Rust sidecar 源码审查、调用点统计）识别方案文档中与事实不符或过度乐观的断言。

### 盲点 1（严重）：时钟投影数据竞争 — 方案 A 也修不了

`world_engine_persistence.ts:338`：
```typescript
input.context.applyClockProjection?.(snapshot);
```

`AppContext.applyClockProjection` 的签名是 `(snapshot: RuntimeClockProjectionSnapshot) => void`，**不含 packId 参数**。调用链为：

```
context.applyClockProjection(snapshot)
  → SimulationManager.applyClockProjection (simulation.ts:196)
    → activePackRuntimeFacade.applyClockProjection (active_pack_runtime_facade.ts:199)
      → this.clock.setTicks(BigInt(snapshot.current_tick))  // 始终写入同一个全局 clock
```

`InMemoryRuntimeClockProjectionService` 本身是 pack-aware 的（`Map<packId, snapshot>`），但最终的 `context.applyClockProjection` **始终写入同一个 `activePackRuntimeFacade` 的 clock**。

`MultiPackLoopHost` 中每个 pack 的 `PackSimulationLoop` 通过独立的 `setTimeout` 链并发运行（`PackSimulationLoop.ts:145`）。当两个 pack 的 world engine commit 时间重叠时：

```
Pack A loop: step 2 WE commit → 全局 clock 被设为 tick=1000
Pack A loop: step 3 读 getCurrentTick() → 1000 ✓
Pack B loop: step 2 WE commit → 全局 clock 被覆写为 tick=500
Pack A loop: step 4 读 getCurrentTick() → 500 ✘ (应为 1000)
Pack B loop: step 1 读 getCurrentTick() → 500 (可能是 A 的 1000)
```

方案 A 提出 `getCurrentTick(packId)` 但完全没有提及 `applyClockProjection` 也必须改为 pack-scoped。这是一个方案层面的盲点：即使按方案 A 完整实施，如果不修复 `applyClockProjection` 的路由，多包时钟仍然会互相污染。

**修复要点**：`AppContext.applyClockProjection` 签名需改为 `(packId: string, snapshot: RuntimeClockProjectionSnapshot) => void`，或改为 per-pack facade 注册表。单纯给 `getCurrentTick` 加 `packId` 参数不够。

### 盲点 2：PackSimulationLoop.clock 是死代码

`PackSimulationLoop` 构造函数接收 `clock: ChronosEngine` 并存储为 `this.clock`（第 72、87 行），但**整个类体中从未被读取**。所有 tick 查询走的是 `context.activePackRuntime!.getCurrentTick()`。`stepPackWorldEngine()` 中 `step_ticks` 也硬编码为字符串 `'1'`，完全不管 loop 持有的 `this.clock` 的配置步长。

这意味着 loop 明明有自己正确的 clock 引用，所有代码却绕道全局单例。方案文档未提及这一设计缺陷，也未评估"让 loop 使用 `this.clock`"这条比方案 A 更简单的替代路径。

### 盲点 3（严重）：Loop step 4/5/6 完全缺失 packId

`PackSimulationLoop.runIteration()` 的六步中，仅 step 2（world engine）和 step 3（agent scheduler）接收了 `this.packId`：

| Step | 函数 | 接收 packId? | 内部 getCurrentTick 调用 |
|------|------|-------------|------------------------|
| 1 | `expirePackIdentityBindings` | 无 | 1 处 |
| 2 | `stepPackWorldEngine` | 有 | 0（但投影路径有） |
| 3 | `runAgentScheduler` | 有 | 4 处 |
| 4 | `runDecisionJobRunner` | **无** | 间接通过 inference |
| 5 | `runActionDispatcher` | **无** | 8 处 |
| 6 | `runPerceptionPipeline` | **无** | 1 处 |

方案 A 说"通过参数链传递 packId"但未展开这四步的深层调用链分析。以 `action_dispatcher_runner.ts` 为例，8 处 `getCurrentTick()` 调用分布在多个函数中，每层都要加 packId。方案文档将此类比于简单的参数追加，低估了改造深度。

### 盲点 4（严重）：调度器跨包时钟污染

所有调度器文件全部通过 `context.activePackRuntime!.getCurrentTick()` 获取 tick：

| 文件 | 调用点数 |
|------|---------|
| `scheduler_ownership.ts` | 6 |
| `agent_scheduler.ts` | 4 |
| `scheduler_lease.ts` | 2 |
| `scheduler_rebalance.ts` | 2（间接） |

多个 pack 的调度器并发运行时共享一个全局时钟，导致：
- Pack A 的租约过期判断可能基于 Pack B 的 tick
- 分区重平衡时间戳不属于当前正在重平衡的 pack
- 所有权心跳使用可能已跳变的 tick

方案 A 的"Scheduler 适配"段落（第 309-314 行）仅四句话，声称"Loop 将 `packId` 传入 scheduler 调用链"，未展开任何具体分析。

### 不诚实断言 1：文档自我矛盾 — "主包不可卸载的限制仍然存在"

第 221 行（方案 D 缺点）：**"主包不可卸载的限制仍然存在"**

代码审计确认：该限制**已在方案 D 实施中被删除**。`unload()` 方法（`pack_runtime_registry_service.ts:251`）中原来的以下代码已被移除：

```typescript
if (this.getActivePackId() === packId) {
  throw new Error('cannot unload active pack runtime from stable runtime host');
}
```

此限制的删除在方案 D 实施记录（第 202-203 行）中已正确描述。第 221 行的矛盾描述是 stale 文本，使方案 D 看起来比实际更不完整。

### 不诚实断言 2："较完善的多包生命周期管理"

第 44 行：*"`PackRuntimeRegistry`（内存注册表）和 `MultiPackLoopHost` 已有较完善的多包生命周期管理"*

"较完善"在以下事实面前站不住脚：
- Loop step 4/5/6 不接收 packId（见盲点 3）
- `PackSimulationLoop.clock` 是死代码（见盲点 2）
- 时钟投影不是 pack-scoped（见盲点 1）
- 调度器完全依赖全局 clock（见盲点 4）
- `expirePackIdentityBindings` 不为 identity binding 过期传递 packId

生命周期管理的基本操作（注册/注销/启停）是存在的，但运行时正确性（时钟隔离、调度器隔离）是不成立的。"较完善"应改为"骨架存在，运行时隔离未实现"。

### 不诚实断言 3：影响面估算系统偏低

方案 A 影响面表（第 67-74 行）：

| 文档估算 | 实际（基于代码审计） |
|----------|---------------------|
| `getCurrentTick()` 涉及 ~25 文件 | **50+ 调用点** 分布在 25+ 非测试源文件 |
| `getActivePack()` 涉及 ~15 文件 | **40+ 调用点**，包括 `context_builder.ts`（7 处）、`plugins/context.ts`（3 处） |
| 测试更新 ~19 文件 | 仅 `getCurrentTick` 的 mock 就在 19+ 测试文件中，加上 `getActivePack` 等远超此数 |

该表未说明数字的来源（是 grep 计数还是估算），呈现精度与实际不符。

### 不诚实断言 4：方案 A 端口设计存在遗漏

方案 A 的新 `PackRuntimePort` 接口（第 272-281 行）缺少两个现有 `ActivePackRuntimeFacade` 方法：
- **`getAllTimes()`**：用于日历格式化时间展示，被多处调用
- **`applyClockProjection()`**：世界引擎提交后的时钟投影入口（这正是盲点 1 的核心）

接口中也没有与 `init()` 等价的方法。`ActivePackRuntimeFacade.init()` 调用 `activateWorldPackRuntime()` 执行 DB bootstrap 和从最后 event 恢复时钟。方案 A 删除 facade 但未说明每个 pack 加载时谁承担等价的初始化——`PackRuntimeRegistryService.load()` 只做 materialize + clock 创建，不包含 DB 事件恢复逻辑。

### 不诚实断言 5："全量单元测试通过" 不等于多包正确

第 209 行：*"全量单元测试通过（96 files, 1001 tests, 0 failures）"*

单元测试使用 mocked `activePackRuntime`，不测试多包并发场景。时钟投影数据竞争（盲点 1）和调度器时钟污染（盲点 4）在单元测试中完全不可见。此断言被用作方案 D "已完成"的证据，但单元测试通过并不验证多包运行时的正确性。

### 不诚实断言 6：Rust sidecar `mode` 字段 — 已验证正确，但未经引用

第 42 行：*"`mode` 字段仅作标记用，不 gate 功能"*

经 Rust 源码审查（`session.rs`、`step.rs`、`models.rs`），此断言**属实**：`SessionState.mode` 被存储和返回在 status 响应中，但 Rust 代码中不存在 `if mode == "active"` 或其他基于 mode 的条件分支。`step.rs` 完全不引用 `mode`。

虽断言正确，但文档未提供源码引用路径，降低了可信度。建议补充引用：`apps/server/rust/world_engine_sidecar/src/session.rs:24,48,59,120,135`、`step.rs`（零引用）。

### 不诚实断言 7：idle state 未定义

方案 A 第 325 行：*"如果运行时没有任何 pack，系统进入 idle 状态（模拟循环停止，API 返回降级状态）"*

完全未定义：
- 哪些 endpoint 返回什么状态码和 body
- Prisma 连接是否保持（若不保持，如何加载新 pack？）
- 如何在 idle 状态下触发 pack 加载
- 从 idle 转换到正常运行需要什么条件

"idle state" 是架构中的新概念，不是现有状态机的扩展。

### 不诚实断言 8：方案 C 被轻易 dismiss

第 248 行：*"方案 C 的 PackContext 隔离是一个好思路，但可以和方案 A 结合（A 消除主包概念，C 提供上下文隔离机制）"*

方案 C 实际上直接解决了盲点 1（时钟投影数据竞争）：如果每个 pack 有独立的 `PackContext`，`applyClockProjection` 自然只影响本 pack。方案 A 需要显式修复投影路径，方案 C 通过上下文隔离隐式解决。文档未讨论这个维度的取舍，将 C 降级为 A 的可选附加项，但 C 在此维度上优于 A。

### 补充发现：时钟初始化仍不对称

方案 D 修复了 world engine session 的对称性，但时钟的初始种子仍不对称：
- 主包：`resolvePackClock()` 从 DB 的 `max(event.tick)` 恢复（`runtime_activation.ts:59-63`）
- 附加包：从 `runtimeConfig.initialTick` 创建（`pack_runtime_registry_service.ts:180`），忽略 DB 中已有的事件 tick

方案 A 说"所有 pack 通过统一路径加载"但未指定统一后的时钟初始化策略。如果一个 pack 先被加载、产生事件、再被卸载、再被加载，是否应从 DB 恢复时钟？文档未讨论。

### 补充发现：`PackRuntimeScopeMode` 移除的连锁反应未分析

方案 A 第 62 行说"移除 `PackRuntimeScopeMode = 'stable' | 'experimental'` 区分"，但 `pack_scope_resolver.ts` 中 `stable` 和 `experimental` 驱动两条不同的解析路径：
- `'stable'` → `resolvePackProjectionTarget()` 走 active pack projection guard
- `'experimental'` → 直接查 `PackRuntimeRegistry`

文档未指定移除后解析逻辑用什么替代（统一走 registry？保留 projection guard？新建第三条路径？）。

### 盲点 5（严重）：数据库核心表缺少 pack_id — 方案 A 的根本性障碍

Prisma schema 中以下核心表**没有** `pack_id` 字段：

| 表 | 影响 |
|----|------|
| `Agent` | Agent 查询（`listActiveSchedulerAgents` 等）不按包过滤，拉取所有包的 agent |
| `Event` | `resolvePackClock()` 查询 `max(event.tick)` 无法按包限定，per-pack 时钟恢复依赖此表 |
| `ActionIntent` | Action dispatcher 需按包分发，但无法过滤 |
| `InferenceTrace` | 推理审计无法按包隔离（`DecisionJob` 有 `pack_id` 但 trace 外键不在 `pack_id` 上） |
| `Relationship` / `RelationshipAdjustmentLog` | 关系数据全局混合 |
| `WorldVariable` | 全局 KV 存储 |
| `SNRAdjustmentLog` | 全局 |
| `Post` | 全局帖子 |
| `Circle` / `CircleMember` | 全局社交圈 |
| `Identity` / `Policy` | 全局身份 |

这不仅是"遗漏"——它是方案 A 的**前置阻塞项**。如果 `Event` 表不加 `pack_id`，per-pack 时钟初始化就不可能从 DB 恢复（见补充发现"时钟初始化仍不对称"）。如果 `Agent` 表不加 `pack_id`，scheduler 的 `listActiveSchedulerAgents()` 会返回所有包的 agent，调度器无法按包工作。

方案 A 的影响面估算完全未包含 DB schema migration 和数据回填的工作量。

### 盲点 6（严重）：Inference workflow 无包隔离 — scheduler signal 跨包混合

`apps/server/src/app/services/inference_workflow/` 全部使用 `context.clock.getCurrentTick()`（全局时钟）且无 `pack_id` 过滤：

- `workflow_job_repository.ts`：6 处 `context.clock.getCurrentTick()` 调用（claim、release、update、list 等）
- `scheduler_signal_repository.ts`：所有查询（latest signal tick、event followups、relationship followups 等）**不按 pack_id 过滤**，读取所有包的数据
- `claimDecisionJob`、`releaseDecisionJobLock`、`updateDecisionJobState`、`listRunnableDecisionJobs` 均不含 `packId` 参数

虽然 `DecisionJob` 表有 `pack_id` 列，但 scheduler signal 查询不走此过滤。多包运行时，Pack A 的推理 runner 会 claim Pack B 的 job，signal 查询会返回混合数据。

方案 A 的"改造所有 `getCurrentTick()` 调用为 `getCurrentTick(packId)`"仅覆盖了时钟问题，未覆盖 scheduler signal 的数据隔离问题。此处改造深度远超参数追加——需要为所有 signal 查询增加 `WHERE pack_id = ?` 条件，且需评估无 `pack_id` 的关联表（`Event`、`Relationship`）的 join 策略。

### 盲点 7：SimulationManager 的 pause / runtimeReady / spatialRuntime 也是全局单例

文档聚焦于 `clock` 和 `activePack` 的全局状态问题，但 `SimulationManager` 还有三个全局字段未被讨论：

- `paused: boolean` — 暂停是全局的，调用 `setPaused(true)` 会暂停**所有**包的模拟循环
- `runtimeReady: boolean` — `isRuntimeReady()` 返回单一布尔值，无法表达"Pack A ready、Pack B loading"的状态
- `spatialRuntime` — 从 active pack 获取的空间运行时，其他包不拥有自己的空间状态

方案 A 的 `SimulationManager` 拆分设计（`PackRuntimeCoordinator` + `PackRuntimePort` + `MultiPackRuntimePort`）中，这三个字段的归属未明确：

- `paused` 应是 per-pack（每个 pack 可独立暂停）还是全局（所有 pack 同步暂停）？
- `runtimeReady` 在拆分后是 `PackRuntimePort.isReady(packId)` 还是全局的？
- `spatialRuntime` 是否属于 per-pack 状态？如果是，远超 `PackRuntimePort` 的当前接口定义

### 盲点 8：PackRuntimePort 接口遗漏比文档自审更严重

文档"不诚实断言 4"识别了 `getAllTimes()` 和 `applyClockProjection()` 两个遗漏，但实际遗漏更多：

| `ActivePackRuntimeFacade` 方法 | 在 `PackRuntimePort` 中？ | 重要性 |
|-------------------------------|--------------------------|--------|
| `init(packFolderName, openingId?)` | **无** | 高 — 启动 DB bootstrap 和时钟恢复 |
| `getAllTimes()` | **无** | 中 — 日历格式化时间展示 |
| `applyClockProjection(snapshot)` | **无** | 关键 — world engine 时钟同步入口 |
| `getStepTicks()` | **无** | 中 — 返回当前步长 |
| `clearRuntimeSpeedOverride()` | **无** | 低 — 清除速度覆盖 |
| `getClock()` | **无** | 高 — 返回 ChronosEngine 实例 |
| `getPackSlotDeclarations()` | **无** | 中 — AI slot 配置 |

此外，`AppContext` 上通过 `SimulationManager` 暴露的端口（`context.ts:79-101`）还有：
- `getSpatialRuntime?()` — 空间运行时
- `isRuntimeReady?()` / `setRuntimeReady?()` — 运行时就绪状态
- `isPaused?()` / `setPaused?()` — 暂停控制
- `applyClockProjection?(snapshot)` — 全局时钟投影
- `worldEngineStepCoordinator?` — WE 步骤协调器

方案 A 的新接口仅覆盖了 `ActivePackRuntimeFacade` 上的 7 个方法中的 5 个，以及 `AppContext` 6+ 方法中的 0 个。这不是"小遗漏"而是**接口设计不完整**。

### 盲点 9：load/unload 竞态条件未设计

方案 A 说"所有 pack 均可卸载"，但不讨论竞态条件：

- Pack 的 `PackSimulationLoop` 正在 step 2（world engine commit）中收到 unload 请求时，如何 graceful shutdown？
- `unload()` 调用 `worldEngine.unloadPack()` 期间，如果 loop 的下一步开始执行，会产生什么错误？
- 当前 `MultiPackLoopHost.stopLoop()` 是否等待当前 iteration 完成再停止？

方案 D 日志中 `unload()` 的实现是 `await this.stopLoop(packId)` 后再 `worldEngine.unloadPack()`，但 `stopLoop` 的具体行为（是否等待当前 step 完成）未验证。如果 `stopLoop` 仅设置标志位而非 join，则存在 step 执行到一半时 world engine session 被销毁的风险。

### 盲点 10：两个 PackScopeResolver 的行为差异未识别

代码中存在**两个** `PackScopeResolver`：

1. **`app/services/pack_scope_resolver.ts`** — 路由级使用，`stable` 模式强制匹配 active pack（返回错误如果不匹配），`experimental` 模式直接查 registry
2. **`app/runtime/PackScopeResolver.ts`** — 核心运行时使用，只检查 registry 成员状态，**不做 stable/experimental 区分**

此外，`pack_runtime_registry_service.ts` 的 `resolveStablePackScope` 和 `resolveExperimentalPackScope` 都是恒等函数（返回原始 `packId`），实际不提供任何解析逻辑。

补充发现"移除 PackRuntimeScopeMode 的连锁反应未分析"只提了路由级 resolver，未意识到核心运行时有一条独立的、更简单的解析路径。移除 `stable/experimental` 区分时需要统一这两条路径，连同 registry 中的恒等函数也需处理。

### 盲点 11：方案 A 的实施步骤缺少 DB migration 前置

方案 A 第 257-263 行的实施顺序中，第 1 步是"定义新的 pack-scoped 接口替代 `ActivePackRuntimeFacade`"。但盲点 5 指出 `Event`、`Agent`、`ActionIntent` 等核心表缺少 `pack_id`。

如果在不修改 schema 的情况下实施接口改造，所有 `WHERE pack_id = ?` 查询都**不可能**写出来——数据层无法按包过滤。DB migration 必须在接口改造**之前**完成（或至少并行）。

数据库 migration 包括：
1. 为 `Event`、`Agent`、`ActionIntent`、`InferenceTrace`、`Relationship` 等表添加 `pack_id` 字段
2. 数据回填：为现有记录分配 `pack_id`（主包为 active pack ID）
3. 创建必要的复合索引
4. 更新 Prisma schema 及生成 migration

此项工作量未出现在任何影响面估算中。

### 不诚实断言 9：方案 D 实施验证域不足

方案 D 实施记录（第 189-209 行）声明"全量单元测试通过（96 files, 1001 tests, 0 failures）"，但文中已自行指出（不诚实断言 5）单元测试使用 mock，不验证多包并发。

补充一点：**方案 D 也没有任何集成测试或端到端测试验证多包同时运行时 world engine 的行为**。变更涉及 `worldEngine.loadPack()` 和 `worldEngine.unloadPack()` 的生命周期调用——这两个操作的正确性（时序、错误处理、session 管理）只能在实际 sidecar 交互中验证。方案 D 的验证域仅限于 mock 验证的"调用参数正确"，不覆盖真实 sidecar 交互。
