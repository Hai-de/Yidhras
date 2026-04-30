# Scheduler Docker 式容器隔离设计

> 目标：每个 world pack 拥有物理上完全独立的调度器运行时，类比 Docker/Podman 容器模型 — 每个"容器"内跑自己完整的 scheduler。

## 1. 现状分析

### 1.1 当前架构

```
simulation_loop.ts (全局单循环)
  └─ agent_scheduler.ts (全局单调度器)
       ├─ scheduler_lease.ts (lease/cursor 共享表)
       ├─ scheduler_ownership.ts (ownership 共享表)
       ├─ scheduler_partitioning.ts (partition 分配全局)
       └─ scheduler_decision_kernel_provider.ts (单 decision kernel)
```

- 所有 scheduler 数据（lease、cursor、ownership）存在主 Prisma DB，无 pack 维度隔离。
- `runtime_kernel_service.ts` 是全局单例，绑定唯一的 active pack。
- `experimental_scheduler_runtime.ts` 仅在 partition_id 字符串层面加 `packId::` 前缀，底层读同一份数据。
- simulation loop 只 tick active pack，实验性 pack 只能通过 API 手动 step。

### 1.2 关键文件

| 文件 | 角色 |
|------|------|
| `app/runtime/agent_scheduler.ts` | 调度主循环 |
| `app/runtime/scheduler_lease.ts` | lease 获取/释放/续约 |
| `app/runtime/scheduler_ownership.ts` | partition 所有权分配 |
| `app/runtime/scheduler_partitioning.ts` | partition 分片逻辑 |
| `app/runtime/scheduler_decision_kernel_provider.ts` | 决策内核提供者 |
| `app/runtime/runtime_kernel_service.ts` | 运行时内核外观（单例） |
| `app/runtime/simulation_loop.ts` | 全局模拟循环 |
| `app/services/experimental_scheduler_runtime.ts` | 多包 scheduler projection |

### 1.3 当前 pack scoping 机制

`multi_pack_scheduler_scope.ts` 提供的 `buildPackScopedPartitionId(packId, partitionId)` 输出 `"packId::partitionId"`，在 lease/cursor key 层面做了隔离。但底层 ownership assignments、workers、summary 等数据来自全局 kernel，不受 pack 影响。

**问题：** scoping 是键名前缀，不是数据隔离。两个 pack 的 scheduler 数据仍在同一张表、同一个 kernel 里混在一起。

---

## 2. 目标架构

### 2.1 容器模型

```
┌─────────────────────────────────────────────┐
│              Runtime Host                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Pack A   │  │ Pack B   │  │ Pack C   │  │
│  │ ┌──────┐ │  │ ┌──────┐ │  │ ┌──────┐ │  │
│  │ │ Loop │ │  │ │ Loop │ │  │ │ Loop │ │  │
│  │ │Sched │ │  │ │Sched │ │  │ │Sched │ │  │
│  │ │Worker │ │  │ │Worker │ │  │ │Worker │ │  │
│  │ │Part. │ │  │ │Part. │ │  │ │Part. │ │  │
│  │ └──────┘ │  │ └──────┘ │  │ └──────┘ │  │
│  │  Own DB  │  │  Own DB  │  │  Own DB  │  │
│  └──────────┘  └──────────┘  └──────────┘  │
└─────────────────────────────────────────────┘
```

每个 pack = 一个独立"容器"，内部包含：
- 独立的完整 simulation loop（5 步：expire → world engine → scheduler → decision jobs → action dispatcher）
- 独立的 worker 池
- 独立的 partition 分配
- 独立的 lease / cursor / ownership 存储（在 pack runtime SQLite 中）
- 独立的 Rust 决策内核 sidecar 进程

### 2.2 核心原则

1. **物理隔离：** scheduler 数据存入 pack 自己的 runtime SQLite，不共享主 DB 表。
2. **独立生命周期：** pack load → scheduler 初始化（含 sidecar 进程 fork）；pack unload → scheduler 完全拆除（含 sidecar 进程 kill）。
3. **独立配置：** 每个 pack 可配置自己的 partition 数量、worker 数量。
4. **Host 层仅做多路复用：** Host 只负责启动/停止各 pack 的 scheduler loop，不共享任何调度状态。

### 2.3 关键设计决策

| 决策 | 结论 | 理由 |
|------|------|------|
| Scheduler 存储适配器 | 新建 `SchedulerStorageAdapter`，底层复用 `runtime.sqlite` | 与 `PackStorageAdapter` 职责分离（世界数据 vs 调度运营数据），避免接口膨胀；共享 SQLite 文件减少文件句柄 |
| Per-pack loop 边界 | 整个 5 步循环 per-pack | expire / world engine / scheduler / decision jobs / action dispatcher 全部按 pack 隔离，不是只拆 scheduler |
| Pack scope 解析 | URL param + 全局路由前缀：`/:packId/api/...` | 符合"以 pack 为隔离单元"的资源模型，调试和权限控制更直观 |
| 迁移兼容策略 | 双写 + 读取优先 pack SQLite，Prisma 读回退 | 写入同时写 pack SQLite 和 Prisma；读取先查 pack SQLite，miss 回退 Prisma；回退路径用 `@deprecated` 标记 |
| Decision kernel sidecar | 每 pack 独立 fork 一个 sidecar 进程 | 进程级隔离；通过配置文件 `scheduler_sidecar.max_processes` 设置进程池上限 |
| 路由结构调整 | `apps/server/src/app/routes/` 下新增 `packs/` 子目录，pack-scoped 路由统一挂载到 `/:packId/` 前缀 | 与全局路由（health、admin 等）物理分层 |
| Scheduler DDL 迁移时机 | `SchedulerStorageAdapter.open(packId)` 首次获取连接时执行 `CREATE TABLE IF NOT EXISTS` | 与现有 `sqlite_engine_owned_store.ts` 的建表方式一致；利用 SQLite 单文件特性，无需外部 migration runner |
| Per-pack loop 时钟来源 | `PackSimulationLoop` 构造函数接受 `clock: ChronosEngine`，直接调用 `clock.getCurrentTick()` | 每个 pack 的 `PackRuntimeInstance` 已有自己的 `ChronosEngine`；不经过 `runtime_clock_projection.ts` 间接层 |
| Pack 状态机 | `PackRuntimeRegistry` 内实现五态状态机：`loading → ready → degraded → unloading → gone` | API 中间件检查状态：loading/unloading 返回 503 + Retry-After；gone 返回 404；degraded 返回 503 + degraded_reason；unload 先切 unloading，等 loop 结束后再销毁资源 |
| Per-pack partition 数量 | 扩展 pack manifest schema 增加 `scheduler.partition_count` 可选字段 | 未设置时回退全局常量 `SCHEDULER_DEFAULT_PARTITION_COUNT`；pack `config.yaml` 内自描述，符合容器隔离模型 |
| 测试 SQLite 辅助 | `tests/helpers/runtime.ts` 新增 `createTestPackSQLite(): Promise<{path: string, storage: SchedulerStorageAdapter}>` | 在创建 `PackRuntimeInstance` 的测试辅助函数中注入该适配器；替代仅靠 `DATABASE_URL` override 的方式 |
| Scheduler 可观测性 | `recordSchedulerRunSnapshot` 拆分为 `writeDetailedSnapshot`（per-pack SQLite）和 `emitAggregatedMetrics`（跨 pack 仪表板） | 单 pack 调试数据存本地 SQLite；跨 pack 聚合指标走独立通道供运维面板使用 |
| Sidecar 崩溃恢复 | `PackSimulationLoop` 维护连续失败计数器，每次内核调用失败 +1，成功后清零；连续失败达 `SCHEDULER_CRASH_THRESHOLD`（默认 3）时自动暂停 loop，pack 状态切为 `degraded`，等待外部指令恢复 | 避免崩溃重启循环耗尽资源；degraded 状态保留 pack 数据但停止调度，允许人工介入诊断 |
| Rebalance 改造范围 | `scheduler_rebalance.ts` 纳入 Phase 1 变更清单 | `evaluateSchedulerAutomaticRebalance` 和 `applySchedulerAutomaticRebalanceForWorker` 改为通过本 pack 的 `SchedulerStorageAdapter` 操作 ownership，不再依赖全局表 |

### 2.4 Pack 状态机

```
  load()
    │
    ▼
┌─────────┐  初始化完成   ┌───────┐  连续崩溃达阈值  ┌──────────┐
│ loading │──────────────▶│ ready │────────────────▶│ degraded │
└─────────┘               └───┬───┘                 └─────┬────┘
    │                         │                          │
    │ unload()                │ unload()          resume()
    │ (loading 超时/失败)      │                    │
    │                         ▼                    ▼
    │                  ┌──────────┐  销毁完成   ┌──────┐
    └─────────────────▶│ unloading │───────────▶│ gone │
                       └──────────┘            └──────┘
```

- API 中间件在每个 pack-scoped 请求上检查状态：`loading` / `unloading` → 503 + `Retry-After`；`gone` → 404；`degraded` → 503，body 中携带 `degraded_reason`
- `degraded` 状态下 loop 已暂停但 sidecar 和资源未释放，等待外部 `resume()` 指令
- `gone` 状态的 pack 可被重新 `load()`，回到 `loading`
- 超时保护：`loading` 和 `unloading` 状态有最大等待时间，超时后强制推进

---

## 3. 分阶段实施

### Phase 1: 数据层隔离（存储迁移）

将 scheduler lease / cursor / ownership 从主 Prisma DB 迁移到各 pack 的 runtime SQLite。

**变更：**

- 新建 `SchedulerStorageAdapter` 接口及 `SqliteSchedulerStorageAdapter` 实现，复用 pack `runtime.sqlite` 文件
- `SqliteSchedulerStorageAdapter.open(packId)` 首次获取连接时执行 `CREATE TABLE IF NOT EXISTS`，建 3 张表：
  - `scheduler_lease` — partition lease 记录
  - `scheduler_cursor` — partition cursor 记录
  - `scheduler_ownership` — partition ownership assignments
- 建表方式与 `sqlite_engine_owned_store.ts` 一致，利用 SQLite 单文件特性，无需外部 migration runner
- `scheduler_lease.ts` — lease/cursor 读写改为通过 `SchedulerStorageAdapter`
- `scheduler_ownership.ts` — ownership assignments 存入 pack SQLite
- `scheduler_rebalance.ts` — `evaluateSchedulerAutomaticRebalance` 和 `applySchedulerAutomaticRebalanceForWorker` 改为通过本 pack 的 `SchedulerStorageAdapter` 操作 ownership，不再依赖全局表
- `scheduler_lease_repository.ts` / `scheduler_ownership_repository.ts` — repository 接口增加 packId 参数，实现改为 per-pack SQLite
- 双写：每次写入同时写 pack SQLite 和主 Prisma；读取优先 pack SQLite，miss 回退 Prisma
- 回退路径用 JSDoc `@deprecated` 标记，注明 "Phase 1 compatibility fallback — remove after Phase 4"
- 主 Prisma schema 标记旧 scheduler 表为 `@deprecated`，Phase 4 完成后删除
- 扩展 `tests/helpers/runtime.ts`：新增 `createTestPackSQLite()` 辅助函数，返回 `{path, storage: SchedulerStorageAdapter}`；在 `PackRuntimeInstance` 测试辅助中注入该适配器

**不在此 Phase 变更：**
- `multi_pack_scheduler_scope.ts` 和 `::` 前缀逻辑暂时保留，确保双写期间 key 格式一致
- `experimental_scheduler_runtime.ts` 保留，Phase 2 移除

### Phase 2: 内核实例化（per-pack kernel + sidecar）

将 `runtime_kernel_service.ts` 从全局单例改为 per-pack 工厂，每个 pack 独立 fork sidecar 进程。

**变更：**

- 扩展 pack manifest schema（`constitution_schema.ts`），新增 `scheduler` 可选节：
  ```yaml
  scheduler:
    partition_count: 8  # 可选，默认 SCHEDULER_DEFAULT_PARTITION_COUNT
  ```
- `PackRuntimeInstance` 初始化时读取 `scheduler.partition_count`，未设置则回退全局常量
- `createRuntimeKernelService(context, packId)` — 接受 packId，内部所有操作绑定到该 pack
- `scheduler_decision_kernel_provider.ts` — 改为 per-pack 独立实例，每个 pack fork 独立 sidecar 进程
- 新增 `scheduler_sidecar_pool.ts` — sidecar 进程池管理，通过配置 `scheduler_sidecar.max_processes` 限制并发进程数
- `experimental_scheduler_runtime.ts` — 删除，不再需要字符串前缀 hack，直接读对应 pack 的 kernel
- `multi_pack_scheduler_scope.ts` — 删除 `::` 前缀逻辑
- 移除 Phase 1 的 Prisma 双写回退路径

### Phase 3: 调度循环多路复用（per-pack loop）

`simulation_loop.ts` 改为管理多个 per-pack loop，每个 loop 跑完整的 5 步。

**变更：**

- `simulation_loop.ts` 拆分为：
  - `PackSimulationLoop` 类 — 单个 pack 的完整 5 步循环（expire → world engine → scheduler → decision jobs → action dispatcher），每个 pack 一个实例。构造函数接受 `clock: ChronosEngine`，直接调用 `clock.getCurrentTick()`
  - `MultiPackLoopHost` — 管理所有 loop 的启停，负责 load/unload 时创建/销毁 loop
- 每个 loop 独立的 interval、pause/resume 状态
- 每 pack 独立的 worker ID（`scheduler:${packId}:${process.pid}`）
- `PackSimulationLoop` 内维护连续失败计数器：每次内核调用失败 +1，成功后清零；连续失败达 `SCHEDULER_CRASH_THRESHOLD`（默认 3）时自动暂停 loop，pack 状态切为 `degraded`，等待外部 `resume()` 指令恢复
- `recordSchedulerRunSnapshot` 拆分为 `writeDetailedSnapshot`（写入 pack SQLite，用于单 pack 调试）和 `emitAggregatedMetrics`（跨 pack 仪表板聚合）
- Pack load 时自动启动 loop；pack unload 时停止 loop 并 kill sidecar 进程
- `runtime_clock_projection.ts` 中与 scheduler 相关的路径标记 deprecated，收尾时清理

### Phase 4: 移除全局 active pack 依赖

清理所有假定单一 activePack 的代码路径。

**已完成：**

- 路由结构调整：新增 `/:packId/` 全局前缀，pack-scoped 路由挂载到 `apps/server/src/app/routes/packs/` 下
- 全局路由（health、admin、config、operator 等）保留在原有路径，不挂 pack 前缀
- 实现 pack 状态机（2.4 节）于 `InMemoryPackRuntimeRegistry`：`loading → ready → degraded → unloading → gone`
- API 中间件 `packScopeMiddleware`：检查 `/:packId/` 前缀路由的目标 pack 状态，非 ready 抛对应 HTTP 错误
- `PackScopeResolver` — 从请求 URL param 解析 packId，查 `PackRuntimeRegistry` 返回 pack scope 或抛 404/503
- `AppContext` 新增 `packScope?: PackScopeResolver` 字段（渐进式，旧字段 `activePack`、`clock`、`paused` 标记 `@deprecated` 保留兼容）
- `SimulationManager` 新增 `setMultiPackLoopHost()` 方法
- `scheduler_ownership.ts` / `scheduler_rebalance.ts` 完全迁移至 `SchedulerStorageAdapter`，移除 Prisma 依赖
- `scheduler_observability.ts` 中 `recordSchedulerRunSnapshot` Prisma 写入回退已移除
- 3 个低层 Prisma repo 文件已删除（`scheduler_lease_repository.ts`、`scheduler_ownership_repository.ts`、`scheduler_rebalance_repository.ts`）
- `SchedulerRepository` / `PrismaSchedulerRepository` 已删除
- `releaseAllPackSchedulerLeases` 函数已删除 — per-pack SQLite 随 unload 直接删除，无需 Prisma 清理
- Prisma schema 8 个 deprecated scheduler 模型已删除（migration `20260430120000_drop_deprecated_scheduler_tables`）
- `AppContext` 旧单例字段（`activePack`、`clock`、`paused`、`activePackRuntime`）标记 `@deprecated` 保留兼容；`getRuntimeReady` / `setRuntimeReady` / `getPaused` / `setPaused` 四方法已迁移至 `SimulationManager`

---

## 4. 风险与约束

| 风险 | 缓解 |
|------|------|
| 迁移期间单包模式可用性 | Phase 1 双写 + Prisma 回退；active pack 先迁移 |
| scheduler 表 schema 变更 | 通过 Prisma migration 标记 deprecated，保留旧表直至 Phase 4 验证完成 |
| 多 loop 并发资源竞争 | per-pack loop 完全独立，共享的只有 Host 层启停信令 |
| worker 数量膨胀 | `max_loaded_packs` × `SCHEDULER_DEFAULT_PARTITION_COUNT` 需配置上限 |
| sidecar 进程数膨胀 | `scheduler_sidecar.max_processes` 配置硬上限，超出时排队等待 |
| 双写期间数据不一致 | 读取优先 pack SQLite；Prisma 回退仅在 pack SQLite miss 时触发；Phase 2 移除双写后统一走 pack SQLite |
| pack load 期间请求涌入 | 状态机 + 中间件保证 loading 状态返回 503 + Retry-After |
| 已有 pack runtime.sqlite 无 scheduler 表 | `CREATE TABLE IF NOT EXISTS` 在 `open()` 时自动回填，无需外部迁移 |
| sidecar 进程反复崩溃 | 连续失败计数器 + `SCHEDULER_CRASH_THRESHOLD` 熔断，自动切 `degraded` 防止资源泄漏和崩溃循环 |

---

## 5. 不在此设计范围内的内容

- 跨 pack scheduler 通信 / 事件广播
- 多 pack 共享 worker 池
- Pack 间 partition 迁移 / 负载均衡
- 非 scheduler 表（world_entities 等）的迁移 — 已由 `PackStorageAdapter` 处理

---

## 6. 实施完成状态

### Phase 1 — 数据层隔离 ✅

| 项目 | 状态 |
|------|------|
| `SchedulerStorageAdapter` 接口 | 已完成 |
| `SqliteSchedulerStorageAdapter` 实现（8 张表 DDL + CRUD） | 已完成 |
| `scheduler_lease.ts` 双写 + packId | 已完成 |
| Prisma schema 8 模型标记 `@deprecated` | 已完成 |
| 测试辅助 `createTestPackSQLite()` | 已完成 |

### Phase 2 — 内核实例化 ✅

| 项目 | 状态 |
|------|------|
| Pack manifest `scheduler.partition_count` 字段 | 已完成 |
| Per-pack sidecar `--pack-id` CLI 参数 | 已完成 |
| `scheduler_sidecar_pool.ts` 进程池 | 已完成 |
| 删除 `experimental_scheduler_runtime.ts` / `multi_pack_scheduler_scope.ts` | 已完成 |
| `scheduler_lease.ts` Prisma 双写移除，完全走 adapter | 已完成 |

### Phase 3 — 调度循环多路复用 ✅

| 项目 | 状态 |
|------|------|
| `PackSimulationLoop` per-pack 5 步循环 + crash 熔断 | 已完成 |
| `MultiPackLoopHost` loop 生命周期管理 | 已完成 |
| `recordSchedulerRunSnapshot` 拆分为 `writeDetailedSnapshot` + `emitAggregatedMetrics` | 已完成 |
| Pack load/unload 自动启停 loop | 已完成 |

### Phase 4 — 移除全局 active pack 依赖 ✅

| 项目 | 状态 |
|------|------|
| 5 态 pack 状态机 | 已完成 |
| `PackScopeResolver` + `packScopeMiddleware` | 已完成 |
| `/:packId/` 路由前缀 + `routes/packs/` 聚合 | 已完成 |
| `AppContext.packScope` 新增 | 已完成 |
| `scheduler_ownership.ts` / `scheduler_rebalance.ts` 迁移至 adapter | 已完成 |
| Prisma 低层 repo 文件删除 | 已完成 |
| `recordSchedulerRunSnapshot` Prisma 回退移除 | 已完成 |

### 延后项 — 全部收尾完成 ✅

| 项目 | 状态 | 说明 |
|------|------|------|
| Prisma 8 个 deprecated 模型删除 | ✅ | `scheduler_observability.ts` 读路径迁移至 `SchedulerStorageAdapter` 跨包聚合；Prisma 模型、`SchedulerRepository` 已删除；19 个集成测试迁移至 adapter |
| `AppContext` 旧单例字段物理移除 | ✅ | `getRuntimeReady`/`setRuntimeReady`/`getPaused`/`setPaused` 迁移至 `SimulationManager`，`AppContext` deprecated 方法已删除 |
| `runtime_clock_projection.ts` deprecated scheduler 路径 | ✅ | 无遗留 |
| `refreshSchedulerWorkerRuntimeState` liveness 覆盖 bug | ✅ | `status: 'active'` 硬编码改为继承现有 `stale`/`suspected_dead` 状态 |
| 集成测试 Prisma scheduler 模型引用 | ✅ | 19 个测试文件全部迁移，新建 `MemSchedulerStorage` 测试辅助 |
| `ARCH_DIAGRAM.md` 图更新 | ✅ | 视觉改动，单独处理 |
