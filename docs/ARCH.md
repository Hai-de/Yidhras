# 系统架构 / System Architecture

本文档用于描述 Yidhras 的**系统分层、模块边界、宿主关系与职责划分**。

> 图形化总览与调用流见 `ARCH_DIAGRAM.md` · 公共 HTTP contract 见 `specs/API.md` · 业务执行语义见 `LOGIC.md` · 专题细节见 `docs/subsystems/`

## 核心术语

| 术语 | 含义 |
|------|------|
| 世界包 (world-pack) | 封装世界规则、实体、能力、媒介的数据包，作为模拟的内容单元 |
| 宿主 (host) | 运行编排、调度、持久化的 Node/TS 进程 |
| Sidecar (Rust sidecar) | 通过 stdio JSON-RPC 与宿主通信的 Rust 世界引擎进程，负责世界状态计算 |
| Kernel-side | 宿主持久化层（Prisma，支持 SQLite / PostgreSQL），存储 workflow、social、audit、memory 等 |
| Pack-local | 每个 world-pack 独有的运行时数据库（pack runtime DB，支持 SQLite / PostgreSQL adapter） |
| WorldEnginePort | TS 宿主持有的世界引擎控制面合约（step/commit/abort/query） |
| PackHostApi | TS 宿主对外提供的受控读面合约 |
| Inference workflow | 从上下文组装到模型推理到意图落地的完整链路 |
| Intent Grounder | 把模型开放语义映射为系统可执行结果的组件 |
| SimulationManager | 内部 wiring 类，实现多个运行时端口并注入 AppContext |

## 1. 顶层分层

系统分为以下几层：

- **Transport / App layer**
  - Express routes、HTTP envelope、query/body parsing、frontend API consumption
- **Frontend layer**
  - Shell（`apps/web`）：运营商登录、世界包管理（列表/加载/卸载）、包前端挂载入口
  - Default pack frontend：平台内置的通用 8 工作区前端（overview / scheduler / social / workflow / timeline / graph / plugins / agents），路由前缀 `/packs/:packId/...`
  - Custom pack frontend：包目录 `frontend/` 下的独立前端应用，Shell 通过 `createApp` 动态挂载。入口合约：`mount(target, context)` 接收 `ShellContext`（auth_token / pack_id（instance_id）/ api_base_url）并返回 Vue App 实例，`unmount(app)` 销毁
- **Application services / Read models**
  - orchestration、aggregation、operator-facing snapshots、workflow queries
- **Runtime / Domain execution**
  - scheduler、simulation loop、action dispatch、invocation / enforcement、inference orchestration
- **Pack runtime**
  - world entities、entity states、authority grants、mediator bindings、rule execution records
- **Kernel persistence / governance**
  - workflow persistence、social / audit evidence、plugin governance、memory overlay / memory blocks

## 2. 持久化宿主边界

### 2.1 Kernel-side Prisma（SQLite / PostgreSQL）

以下对象由 kernel-side 持久化宿主承载：

- `Agent`
- `Post`
- `Event`
- `InferenceTrace`
- `ActionIntent`
- `DecisionJob`
- `ContextOverlayEntry`
- `MemoryBlock / MemoryBlockBehavior / MemoryBlockRuntimeState / MemoryBlockDeletionAudit`
- `AiInvocationRecord`
- 插件治理记录：
  - `PluginArtifact`
  - `PluginInstallation`
  - `PluginActivationSession`
  - `PluginEnableAcknowledgement`

### 2.2 Pack-local runtime database

以下对象由 pack-local runtime DB 承载（默认 SQLite，支持 PostgreSQL adapter）：

- pack world entities
- pack entity states
- authority grants
- mediator bindings
- rule execution records
- scheduler lease / cursor / ownership / observability records (via `SchedulerStorageAdapter`)

### 2.3 边界含义

系统明确区分：

- **world governance core** -> pack runtime
- **workflow / social / audit / observability / plugin governance / memory working layer** -> kernel-side

`Event` 属于跨边界共享证据宿主：

- 产生端可来自 objective enforcement
- 消费端横跨 audit / memory / workflow / projection
- 它不是纯 pack-owned narrative source-of-truth

## 2.4 持久化抽象层

### 2.4.1 Repository 接口层（Kernel-side）

主应用 DB 访问通过 Repository 接口层收口，不直接依赖 `PrismaClient` 具体类型：

```
apps/server/src/app/services/repositories/
  types.ts                          # 共享领域类型
  bigint.ts                         # BigInt 序列化工具
  AgentRepository.ts                # Agent CRUD
  IdentityOperatorRepository.ts     # Identity / Operator / Session / Grant / Audit
  InferenceWorkflowRepository.ts    # DecisionJob / InferenceTrace / AiInvocationRecord
  MemoryRepository.ts               # MemoryBlock / MemoryCompactionState
  NarrativeEventRepository.ts       # Event / WorldVariable
  PluginRepository.ts               # PluginArtifact / PluginInstallation
  RelationshipGraphRepository.ts    # Post / Relationship
  SocialRepository.ts               # Post / Relationship 读面
  index.ts                          # Repositories 聚合类型 + createPrismaRepositories 工厂
```

Repository 调用方不直接持有 `PrismaClient`；`PrismaClient` 只注入到 Prisma 实现类中，并由 `createPrismaRepositories(prisma)` 工厂统一创建。接口以领域方法收口，但少量仓储方法仍使用 Prisma 生成的 where/select/include/orderBy 类型作为查询参数；这些 Prisma 适配边界必须限制在 repository 接口/实现层，不允许扩散到 service/runtime 层。

`AppInfrastructure.repos: Repositories` 在组合根注入。调用方通过 `context.repos.<domain>.method()` 访问。

### 2.4.2 Pack Storage Adapter 接口层（Pack-local）

Pack 运行时数据库通过 `PackStorageAdapter` 接口抽象。主要后端为 SQLite，另有实验性 PostgreSQL 实现：

| 实现 | 后端 | 状态 | 隔离策略 |
|------|------|------|----------|
| `SqlitePackStorageAdapter` | SQLite（`node:sqlite`） | 生产可用 | 每 pack 独立文件：`data/world_packs/<instance_id>/runtime.sqlite`（`<instance_id>` 默认 = 目录名） |
| `PostgresPackStorageAdapter` | PostgreSQL（Prisma raw SQL） | 实验性 | schema-per-pack：`pack_<id>.world_entities` 等 |

PostgreSQL adapter 的已知限制：
- 快照功能仅适用于 SQLite 后端，PostgreSQL 需使用 `pg_dump` / `pg_basebackup`
- schema-per-pack 策略在托管 PostgreSQL（AWS RDS、Cloud SQL）中可能需要超级用户权限
- `SchedulerStorageAdapter` 仅有 SQLite 实现

接口定义在 `packs/storage/PackStorageAdapter.ts`，覆盖 engine-owned schema 管理、动态 collection CRUD、快照 export/import、生命周期管理。

`PackStorageAdapter` 接口定义了 `exportPackData()` / `importPackData()` 方法，但世界包快照系统（`packs/snapshots/`）有意绕过该抽象层，直接复制原始 `runtime.sqlite` 文件以保留完整数据库物理状态（WAL、索引结构等）。因此快照功能**仅适用于 SQLite 后端**。PostgreSQL 部署者应使用数据库原生备份工具（`pg_dump`、`pg_basebackup`、WAL archiving）。详见 `snapshot_capture.ts` 顶部设计决策注释。

`AppInfrastructure.packStorageAdapter` 在组合根根据 `PRISMA_DB_PROVIDER` 环境变量选择实现，默认 `sqlite`。

### 2.4.2.1 Scheduler Storage Adapter（Pack-local）

Scheduler 运营数据（lease / cursor / ownership / rebalance / observability）通过 `SchedulerStorageAdapter` 接口迁入 pack-local runtime SQLite，不存储于 kernel-side Prisma。

| 实现 | 后端 | 隔离策略 |
|------|------|----------|
| `SqliteSchedulerStorageAdapter` | SQLite（`node:sqlite`） | 复用 `runtime.sqlite`，`open(packId)` 时执行 `CREATE TABLE IF NOT EXISTS` |

接口定义在 `packs/storage/SchedulerStorageAdapter.ts`，覆盖 lease、cursor、partition assignment、ownership migration、worker state、rebalance recommendation、scheduler run / candidate decision 的 CRUD，以及生命周期管理（`open`/`close`/`destroyPackSchedulerStorage`）。

`scheduler_lease.ts`、`scheduler_ownership.ts`、`scheduler_rebalance.ts`、`scheduler_observability.ts` 完全通过 adapter 读写，不依赖 Prisma。

### 2.4.3 双 Provider 数据库架构

Kernel-side 和 Pack-local 两层均支持通过环境变量切换数据库后端：

| 层级 | 环境变量 | 默认值 | 可选值 |
|------|----------|--------|--------|
| Kernel-side (Prisma) | `PRISMA_DB_PROVIDER` | `sqlite` | `sqlite` / `postgresql` |
| Pack-local (Adapter) | `PRISMA_DB_PROVIDER` | `sqlite` | `sqlite` / `postgresql` |

Kernel-side Prisma schema 已拆分为 `prisma/schema.sqlite.prisma` 和 `prisma/schema.pg.prisma`，两者仅 datasource provider 与 `generator` 输出路径不同，模型定义保持一致。`package.json` 脚本通过 `--schema` 参数化选择目标 schema。

> **注意**：Pack-local 层的 PostgreSQL 支持为实验性（见 "Pack Storage Adapter 接口层" 限制说明），`SchedulerStorageAdapter` 仅 SQLite 实现。生产环境建议从 SQLite 起步。

### 2.5 Runtime 配置边界

配置系统采用域拆分 + 多层合并架构，每个配置域独立管理 schema、默认值和模板。

### 2.5.1 域拆分结构

```
apps/server/src/config/
  domains/                         # 按域拆分的配置模块（每域: Schema + DEFAULTS）
    index.ts                       # 组装 RuntimeConfigSchema + BUILTIN_DEFAULTS
    app.ts / paths.ts / operator.ts / plugins.ts / world.ts
    startup.ts / database.ts / logging.ts / clock.ts
    world_engine.ts / scheduler.ts / prompt_workflow.ts
    runtime.ts / features.ts
  schema.ts                        # 从 domains/ 重导出（保持旧导入兼容）
  runtime_config.ts                # 加载链、缓存、env 解析
  tiers.ts                         # 安全分级定义
  watcher.ts                       # conf.d/ 文件变更监听与热重载


```

scaffold 模板位于：`apps/server/templates/configw/conf.d/*.yaml`（拆分后的域模板）。
工作区实际配置位于：`data/configw/conf.d/*.yaml`。

### 2.5.2 合并优先级

1. code builtin defaults（`domains/` 中各域的 `*_DEFAULTS`）
2. `data/configw/conf.d/*.yaml`
3. `data/configw/<APP_ENV>.yaml`
4. `data/configw/local.yaml`
5. env overrides

也即：**env > yaml > code default**。

### 2.5.3 配置安全分级

每个配置域映射到四级安全 tier，控制修改行为：

| Tier | 含义 | 热重载 | 修改行为 |
|------|------|--------|----------|
| `safe` | 可热重载 | 是 | 即时生效（如 logging, features） |
| `caution` | 需确认 | 否 | 写入文件，运行时生效但记录告警（如 scheduler agent limit） |
| `dangerous` | 需重启 | 否 | 写入文件，重启后生效（如 sqlite, world_engine） |
| `critical` | 需操作员确认 | 否 | 显式操作 + 重启（如 operator jwt/密码） |

Tier 定义和查询见 `apps/server/src/config/tiers.ts`。Safe tier 配置支持 `conf.d/` 文件变更时的热重载（`watcher.ts`），非 safe tier 变更需重启服务。

### 2.5.4 边界说明

- `data/configw/`
  - 承载 **宿主级 / 部署级 / runtime 行为级** 配置
  - 如端口、路径、bootstrap、sqlite pragma、scheduler runtime/lease/rebalance/runner/observability、prompt workflow defaults
- `apps/server/config/ai_models.yaml`
  - 承载 **AI provider / model registry / route policy** 配置
  - 不与 `configw` 混为一体，避免 runtime host config 与 AI registry config 混杂

## 3. 组合根与应用层

### 3.1 Server 组合根

- `apps/server/src/index.ts`：composition root
- `apps/server/src/app/create_app.ts`：Express middleware 与 route registration 装配入口
- `apps/server/src/app/routes/*.ts`：transport-level routes，保持薄层
- `apps/server/src/app/services/*.ts`：应用服务、聚合、read-model assembly

### 3.1.1 HTTP 安全中间件栈

请求经过以下中间件链（按顺序），实现安全加固 + 三层递进权限过滤：

```
HTTP Request
  → helmet()                      // 11 个安全 HTTP 头 (CSP, HSTS, X-Frame-Options, etc.)
  → CORS
  → globalRateLimiter             // 全局限流: 1000 req / 15 min / IP
  → authRateLimiter               // 认证路由限流: 20 req / 15 min / IP (仅 /api/auth/login, /api/auth/refresh)
  → express.json({ limit: 1mb })  // 请求体大小限制
  → operatorAuthMiddleware        // Authorization: Bearer → JWT 验证 → req.operator
  → identityInjector              // x-m2-identity → req.identity
  → requestIdMiddleware           // X-Request-Id
  → PackAccessGuard               // L1: Operator↔Pack 绑定检查
  → CapabilityGuard               // L2: Subject↔Capability 判定
  → EnforcementEngine             // 执行 mutation / invocation
  → PolicyFilter                  // L3: 字段级 ABAC
  → 响应
```

| 层级 | 中间件/模块 | 判定依据 |
|------|------------|----------|
| HTTP 安全 | `helmet`, `rate_limit.ts`, `express.json` | 标准 HTTP 安全头 + 速率限制 + 请求体大小限制 |
| L1: Pack Access | `operator/guard/pack_access.ts` | `OperatorPackBinding` 显式绑定 |
| L2: Capability | `app/middleware/capability.ts` | `OperatorGrant` + pack authority |
| L3: Policy | `access_policy/` | `Policy` 字段级 allow/deny |

关键约束：
- Session 不绑定特定 pack；operator 登录后可访问所有已加载 pack
- root 操作员也必须有显式 `OperatorPackBinding` 才能访问 Pack，确保审计可追溯
- 三层是递进过滤：L1 拒绝 → 403 直接返回，不查 L2/L3
- Agent 自主行为通过 `resolveSubjectForAgentAction()` 解析控制 Operator 后再校验 capability

### 3.2 Runtime / scheduler 层

- `apps/server/src/app/runtime/*.ts`
  - `MultiPackLoopHost.ts` — 统一管理所有 per-pack loop 的启停/暂停/恢复。所有已加载 pack 通过同一入口启动
  - `PackSimulationLoop.ts` — 每个 pack 独立的 7 步模拟循环（expire → world engine → scheduler → decision jobs → action dispatcher → perception pipeline → projection pipeline）
  - `perception_pipeline.ts` — 感知管线（agent 感知范围计算与事件过滤）
  - `projection_pipeline.ts` — 投影管线（projection 规则评估与结果持久化）
  - `scheduler_sidecar_pool.ts` — Rust 决策内核 sidecar 进程池，`max_processes` 上限
  - `agent_scheduler.ts` — 调度主逻辑（partition-aware，per-pack 调用）
  - `job_runner.ts` / `action_dispatcher_runner.ts` — 决策执行与动作分发
  - `scheduler_lease.ts` / `scheduler_ownership.ts` / `scheduler_rebalance.ts` — lease/ownership/rebalance 逻辑
  - `scheduler_partitioning.ts` — 分区 ID 解析、哈希映射、worker ↔ partition 分配（支持 `SCHEDULER_WORKER_INDEX` / `SCHEDULER_WORKER_TOTAL` 环境变量和 `--worker-index` / `--worker-total` CLI 参数）

关键约束：

- scheduler 是 partition-aware。单机单进程时所有分区由同一 worker 处理；多 worker 模式下每个 worker 仅处理自己拥有的分区（通过 `resolveOwnedSchedulerPartitionIds` 分配）
- lease 与 cursor state 以 partition 为作用域，存储于 pack-local SQLite（via `SchedulerStorageAdapter`）。多 worker 通过数据库层协调 partition 所有权
- 每个 pack 拥有独立的 `PackSimulationLoop` 实例，由 `MultiPackLoopHost` 统一管理生命周期
- pack load 时自动启动 loop，pack unload 时停止 loop 并优雅关闭 sidecar 进程（stdin EOF → 自然退出 → 3s 后 SIGKILL 兜底）
- runtime readiness 通过 `AppContext.assertRuntimeReady(feature)` 统一门控
- 多 worker 模式下每个 worker 独立 spawn 自己的世界引擎 sidecar 进程，实现故障隔离
- 世界引擎 step 在 Rust 侧通过 `(packId, tick)` 缓存实现幂等，多 worker 重复调用同一 tick 不会导致双重变更

scheduler 相关的宿主级运行参数已收口进 runtime config，而不是继续散落为局部常量：

- `scheduler.runtime.simulation_loop_interval_ms`
- `scheduler.lease_ticks`
- `scheduler.entity_concurrency.*`
- `scheduler.tick_budget.*`
- `scheduler.automatic_rebalance.*`
- `scheduler.runners.decision_job.*`
- `scheduler.runners.action_dispatcher.*`
- `scheduler.agent.*`
- `scheduler.observability.*`

这意味着：

- 调度主循环节奏、lease 生命周期、实体级 single-flight / activation budget、tick 级吞吐预算、
  runner 批量与并发参数、operator 观测默认 limit
  都属于 **runtime host policy**，应通过 YAML / env 调整；
- 业务层不再把这些值继续内嵌为新的 ad-hoc 常量。

### 3.2.1 Runtime Kernel 正式边界

runtime kernel 通过以下正式 port 收口：

- `RuntimeKernelFacade`
  - runtime pause/resume、loop diagnostics、kernel health snapshot
- `SchedulerObservationPort`
  - ownership / workers / summary / operator projection 等读面
- `SchedulerControlPort`
  - bootstrap ownership reconcile 等控制面
- `createRuntimeKernelService(context, packId)`
  - Node/TS 宿主内的 runtime kernel service 实现，`packId` 为必填参数，所有操作绑定到该 pack

这意味着：

- system status、scheduler routes 不应继续直接依赖底层 scheduler helper；
- 上层应优先通过 runtime kernel service / port 访问 runtime kernel 与 scheduler 观察面；
- scheduler 的运营数据属于 pack-local（via `SchedulerStorageAdapter`），调度器运行时编排属于 **runtime kernel**。

### 3.3 Core simulation 层

- `apps/server/src/core/simulation.ts`

职责：

- 作为 **兼容 facade / thin facade**
- 组合 runtime bootstrap、pack catalog、pack runtime registry service
- 对旧调用面继续暴露稳定兼容入口

不建议把它视为新的职责承载中心。

已拆出的职责包括：

- `PrismaRuntimeDatabaseBootstrap`
  - provider-aware 数据库 bootstrap（SQLite pragma apply / snapshot 或 PostgreSQL 连接校验）
- `DefaultPackCatalogService`
  - world-pack catalog、pack id / folder 解析
- `PackRuntimePort` / `DefaultPackRuntimePort`（`app/services/pack_runtime_ports.ts`, `packs/orchestration/default_pack_runtime_port.ts`）
  - 每个已加载 pack 的 per-pack 运行时端口。提供 `getCurrentTick()`、`getCurrentRevision()`、`getPack()`、`step()` 等方法
- `pack_runtime_resolution.ts`（`app/services/pack_runtime_resolution.ts`）
  - 统一 tick 解析入口。从传入的 `packRuntime` 参数获取
- `DefaultPackRuntimeRegistryService`（`packs/orchestration/pack_runtime_registry_service.ts`）
  - 统一的 pack runtime registry、status/load/unload、host register/unregister
  - 内部使用 `InMemoryPackRuntimeRegistry`（`core/pack_runtime_registry.ts`）作为存储实现

另外，数据库 runtime pragma 已通过 provider-aware 配置纳入 runtime host config：

- `database.sqlite.busy_timeout_ms`
- `database.sqlite.wal_autocheckpoint_pages`
- `database.sqlite.synchronous`

它们属于 **宿主运行时稳定性 / 部署调优参数**，不是业务语义的一部分；
修改方式应优先经 `configw` 或 env override。SQLite 特有参数嵌套在 `database.sqlite` 下，PostgreSQL 连接参数在 `database.postgresql` 下。

约束：
- 不把 `SimulationManager` 继续扩张为通用 app-service bucket
- `MultiPackLoopHost` 已承担多 pack loop 容器职责，`SimulationManager` 通过 `setMultiPackLoopHost()` 注入
- 新的 query / orchestration 逻辑应放进更聚焦的模块

### 3.3.1 Multi-pack runtime registry boundary

多 pack 调度为默认架构。**所有 pack 对等** — 不存在主包/附加包的架构区分。

**对等架构原则：**

- 每个已加载 pack 拥有独立的 `ChronosEngine` 时钟实例、`PackSimulationLoop`（完整 7 步循环）、`RuntimeSpeedPolicy` 速度策略
- 每个 pack 通过 `world-engine` 以 `mode: 'active'` 加载，享有完整的 Rust 世界引擎会话
- 所有 pack 共享相同的状态机（`loading → ready → degraded → unloading → gone`）、路由前缀、观测接口
- 所有 pack 完全对等，不存在主包/附加包的架构区分

对等架构下的路由分层：
- 所有 pack-scoped 路由通过统一的 `/:packId` 前缀访问（`packId` = `instance_id`）
- `packScopeMiddleware` 从 URL param 解析 packId（`instance_id`），通过 `PackScopeResolver` 做状态门控

职责分层：

- `PackRuntimeRegistry`
  - 负责 loaded pack runtime 集合、lookup、capacity limit、load/unload 生命周期、5 态状态机
- `PackRuntimeHandle`
  - 对外暴露 pack-local clock / runtime speed / health 等只读句柄
- `PackRuntimeHost`
  - 作为 pack-local runtime 宿主，暴露完整读写能力（`getCurrentTick()`, `step()`, `applyClockProjection()` 等）
- `PackRuntimePort`（`app/services/pack_runtime_ports.ts`）
  - Per-pack 服务端口，统一 tick/revision/speed/variable_resolve 访问；`DefaultPackRuntimePort` 包装 `PackRuntimeHost`
- `pack_runtime_resolution.ts`
  - 服务层统一解析入口：`resolvePackTick(context, packRuntime?)`
- `PackScopeResolver`
  - 从 URL param 解析 packId，查 registry 状态，返回 pack scope 或抛 404/503
- `MultiPackLoopHost`
  - 管理所有 per-pack loop 的启停/暂停/恢复

实现事实：

- pack-scoped 路由统一在 `routes/packs/index.ts` 聚合，挂载至 `/:packId`
- global 路由（health、admin、config、operator 等）保留原有路径
- `PackScopeResolver` + `packScopeMiddleware` 实现请求级 pack 状态校验
- `DefaultPackRuntimeRegistryService`（`packs/orchestration/pack_runtime_registry_service.ts`）`load/unload` 自动启停 per-pack loop
- `PackSimulationLoop` 内维护 crash 计数器，连续失败达阈值自动切 `degraded`

### 3.3.2 Rust world engine 与 sidecar 边界

世界推进的 step 计算在 Rust sidecar 执行，运行编排、AI 推理、prompt 构建与持久化仍由 Node/TS host 持有：

- `WorldEnginePort`：TS host 持有的 control / compute plane contract
  - world-pack load/unload、step prepare/commit/abort、state query、health
- `PackHostApi`：TS host kernel 持有的 host-mediated read contract
  - 只暴露受控读面（pack summary、current tick、world state query），不暴露内核控制能力
  - 长期语义是 host-accepted / host-projected truth，不是 sidecar internal truth
- `WorldEngineSidecarClient`：本地 stdio + JSON-RPC transport implementation，不是公开 contract
  - 基于 `StdioJsonRpcTransport` 共享基类，提供心跳检测、进程 crash 自动重连（指数退避）、stdin 背压处理、优雅关闭（stdin EOF → SIGKILL 兜底）
  - 同基类同时服务于 `scheduler-decision` 和 `memory-trigger`，消除三处 IPC 实现重复

边界结论：

- runtime loop 的世界推进主路径走 `WorldEnginePort`
- `SimulationManager` 作为内部 wiring 类，实现多个运行时端口供 `index.ts` 注入 `AppContext`
- objective enforcement 是 Rust/TS 协作执行路径：sidecar 负责规则匹配/模板渲染/mutation 规划，host 负责权限校验/持久化/事件桥接
- plugin host / workflow host 读取世界态应消费 `PackHostApi`，不直接依赖 sidecar protocol
- Rust sidecar 负责 step 计算（objective 匹配、mutation 规划）；runtime orchestration、scheduler 编排、plugin host、workflow host、AI gateway、context assembly、prompt workflow、Host-managed persistence 仍由 Node/TS host 持有
- `PackHostApi` 是 TS control plane 的正式读合同，repository-backed / projection-backed / host-mediated sidecar-assisted reads 均属其可接受实现策略

Sidecar 协议覆盖：handshake、health、pack load/unload、state query、objective execution、status、step prepare/commit/abort。

Host-managed persistence 覆盖：pack runtime core snapshot hydrate → Rust session → prepare/commit/abort → failure recovery 闭环，包括 entity state upsert、rule execution append、clock delta、tainted session 恢复。

### 3.3.3 Rust Sidecar 定位

三个 Rust sidecar 通过 stdio JSON-RPC（NDJSON 帧分隔）与宿主通信，承担有限的计算密集型任务。共享 `sidecar-common` crate 提供统一的 protocol/transport/Tick 类型。总量约 4,500 行 Rust 代码，均作为 **执行器** 而非完整引擎。

**传输层**（`StdioJsonRpcTransport`，`apps/server/src/app/runtime/sidecar/stdio_jsonrpc_transport.ts`）提供统一的 IPC 基础设施：

- **NDJSON 帧解析**：换行分隔 JSON，与 LSP/Docker API 等生态一致
- **请求/响应映射**：JSON-RPC id 关联，支持并发交错响应
- **心跳检测**：可配置间隔（world engine 10s，scheduler/memory trigger 5s），连续失败达到阈值后 emit `unhealthy` 事件
- **自动重连**：进程 crash 后指数退避自动重连（默认最多 3 次，基数 500ms），成功后 emit `restarted` 事件
- **背压处理**：`stdin.write()` 返回 false 时等待 `drain` 事件
- **优雅关闭**：先关闭 stdin（Rust 侧 EOF 自然退出），3 秒超时后 SIGKILL 兜底
- **事件通知**：`unhealthy` / `restarted` 事件供上层 client 触发 pack 重载或状态恢复

| Sidecar | 职责 | 行数 | 心跳间隔 | 请求超时 |
|---------|------|------|---------|---------|
| `world-engine` | step prepare/commit/abort、objective 匹配与执行、state query | ~1,700 | 10s | 5s |
| `scheduler-decision` | 决策内核运算 | ~800 | 5s | 500ms |
| `memory-trigger` | memory trigger 匹配与触发判定 | ~2,000 | 5s | 500ms |

执行路径：

- World engine step prepare/commit/abort 经 Rust sidecar 执行
- Objective enforcement（规则匹配、模板渲染、mutation 规划）在 Rust 侧，权限校验与持久化在 TS 侧。Mutations 为判别联合类型（`kind: 'entity_state' | 'authority_grant'`），Rust 侧车产出后由 TS host 按 kind 路由到对应的持久化适配器。模板上下文包含 world pack variables（`variables.*`），规则 `then` 中的 `{{variables.xxx}}` 可在 sidecar 侧直接渲染
- Scheduler decision kernel 计算在 Rust 侧，调度编排在 TS 侧
- Memory trigger 匹配在 Rust 侧，memory block 管理与 context materialization 在 TS 侧
- 以下能力完全由 Node/TS host 持有：HTTP API、runtime orchestration、调度器生命周期、plugin host、workflow host、AI gateway、context assembly、prompt workflow、权限校验、审计日志、前端服务

## 4. Workflow / inference 边界

### 4.1 Inference workflow facade

- `apps/server/src/app/services/inference_workflow.ts`

进一步职责拆分到：

- `inference_workflow/parsers.ts`
- `inference_workflow/workflow_job_repository.ts`
- `inference_workflow/scheduler_signal_repository.ts`
- `inference_workflow/snapshots.ts`
- `inference_workflow/results.ts`
- `inference_workflow/workflow_query.ts`
- `inference_workflow/ai_invocations.ts`
- `inference_workflow/types.ts`

### 4.2 边界约束

保持以下分离：

- decision generation
- workflow persistence
- action dispatch
- inference observability

`ActionIntent` / `InferenceTrace` / `DecisionJob` 仍宿主于 kernel-side Prisma，而不是 pack runtime。


### 4.3 声明式 Agent Workflow Engine

声明式 agent workflow 运行在 `apps/server/src/app/services/workflow/**`，runtime glue 位于 `apps/server/src/app/runtime/workflow_decision_step.ts`。

`PackSimulationLoop` 的 step4 统一通过 `runWorkflowDecisionStep()` 进入：

1. `WorkflowEngine.recoverExpiredRuns()` 回收过期 run / step lock。
2. `WorkflowEngine.advance()` 推进 active workflow run。
3. `runDecisionJobRunner()` 处理普通 DecisionJob。

边界约束：

- `packs` 只加载和校验 `workflows` YAML，不依赖 workflow engine。
- `inference` 只接收 `workflow_source` 与 `previous_agent_output` 输入，不依赖 workflow engine。
- Workflow run / step run 持久化在 kernel-side Prisma：`WorkflowRun` / `WorkflowStepRun`。
- ActionIntent 继续统一进入 step5 dispatch；workflow action 通过 `source_workflow_run_id`、`source_workflow_step_id`、`source_step_attempt` 追踪来源。
- single-flight 同时覆盖普通 DecisionJob、pending/dispatching ActionIntent、running WorkflowStepRun。

## 5. Context / memory / overlay 边界

### 5.1 Context Module

inference runtime 包含 Context Module，相关实现位于：

- `apps/server/src/context/types.ts`
- `apps/server/src/context/service.ts`
- `apps/server/src/context/source_registry.ts`
- `apps/server/src/context/workflow/*`

它的系统职责是：

- 从多源 materialize `ContextNode`
- 产出 `ContextRun`
- 为既有 prompt 消费方暴露 compatibility `memory_context`
- 将 context selection / orchestration evidence 写入 `InferenceTrace.context_snapshot`

### 5.1.1 Context / Memory 正式接口

context / memory 通过以下正式 port 接入：

- `ContextAssemblyPort`
  - `buildContextRun(...)`
- `MemoryRuntimePort`
  - `buildMemoryContext(...)`
- `createContextAssemblyPort(context)`
- `createMemoryRuntimePort(context)`

inference context builder、memory compaction、memory block 删除审计等路径优先通过：

- `context.contextAssembly`
- `context.memoryRuntime`

不应通过 `context.sim` 访问。

### 5.2 Template Engine 宏扩展点

world-pack 在物化阶段（`materializer.ts`）展开 `bootstrap.initial_states[].state_json` 及 entity state（actor/artifact/domain/institution 的 `state` 字段）中的宏模板，将随机性展开为确定性状态值写入 runtime DB。展开后的值保留原始类型。宏参数中的点分路径通过 `resolveMacroArgs` 在调用 handler 前解析为 `RenderScope.variables` 中的实际值，支持 `pick`/`roll`/`int`/`float` 等宏的参数引用 pack 变量池。

| 已实现 | 位置 | 说明 |
|--------|------|------|
| `MacroHandlerFn` 类型 | `template_engine/core/types.ts` | 宏处理器函数签名 `(name, args, scope) => MacroValue`，args 为 `Record<string, MacroValue>` |
| `MacroValue` 类型 | `template_engine/core/types.ts` | `string \| number \| boolean \| null \| MacroValue[] \| { [key: string]: MacroValue }` |
| `macroHandlers` 注册表 | `RenderScope`（可选字段） | 宏名到处理器的映射，无处理器时宏展开为空字符串 |
| `BUILTIN_MACRO_HANDLERS` | `template_engine/defaults.ts` | 内置宏：roll/int/float 返回 number，pick 返回 string（单元素）或 string[]（多元素），seed 返回 string |
| `case 'macro'` 分支 | `core/renderer.ts` | 调用 `scope.macroHandlers[name]`，未命中回退空字符串 |
| 叙事前端回退 | `frontends/narrative/resolver.ts` | 先查 `macroHandlers`，未命中回退到变量解析路径 |
| PRNG 可重现性 | `template_engine/core/prng.ts` | mulberry32 实现，种子由 `variables.seed` 提供或自动生成 |
| 物化集成 | `packs/runtime/materializer.ts` | 创建 expandScope（注入 `pack.variables` + PRNG）→ entity state 和 bootstrap state 递归展开（类型保留）→ 种子写入 meta state |
| 类型保留展开 | `packs/runtime/template_expander.ts` | 单宏模板返回非 string 时替换 JSON 值类型；混合文本 toString() 内联 |
| 宏参数变量解析 | `packs/runtime/template_expander.ts` + `core/renderer.ts` | `resolveMacroArgs` 将宏参数中的点分路径字符串解析为 `scope.variables` 中的实际值，单宏快捷路径和 `renderAst` 均覆盖 |

宏只允许在 `state_json`（最终存储的事实）中展开。运行时推理模板（`PROMPT_WORKFLOW.md` 的"变量上下文与宏系统"一节）使用独立的变量解析系统，不走宏处理器。

### 5.3 Overlay / Memory Block

- overlay 是 **kernel-side working-layer object**
- `ContextOverlayEntry` 持久化在 kernel Prisma，再 re-materialize 为 `ContextNode`
- overlay 不作为 pack runtime source-of-truth
- Memory Block Runtime 也属于 kernel-side memory subsystem

这意味着：

- pack runtime 管世界治理状态
- kernel memory subsystem 管工作层上下文与长期记忆物化

### 5.4 Perception Pipeline / Spatial Predicates

空间感知管线是 sim loop 的第 6 步，位于 action dispatcher 之后。核心接口与模块：

| 组件 | 位置 | 说明 |
|------|------|------|
| `PerceptionResolver` 接口 | `perception/types.ts` | `resolve(event, observer, spatialRuntime) → PerceptionRuleOutput` |
| `createSpatialProximityResolver()` | `perception/default_resolver.ts` | 默认 A 层实现：同 location + public → full；private 仅 actor 可见 |
| `runPerceptionPipeline()` | `app/runtime/perception_pipeline.ts` | 每 tick 收集空间事件 → 枚举 agent → 逐对解析 → 写入 overlay entry |
| `spatialPredicateMatches()` | `domain/rule/enforcement_engine.ts` | `when.location.in` / `adjacent_to` 预过滤，在调用世界引擎侧车前执行 |

感知结果以 overlay entry（`overlay_type: system_summary`）形式持久化，现有 overlay context source 自动消费。

空间谓词 `when.location.in` / `when.location.adjacent_to` 在 TS 端 enforcement engine 做预过滤，不依赖 Rust 侧车修改。满足条件的规则才会被发送到侧车求值。

## 6. Prompt Workflow / AI Gateway / Plugin Runtime 的专题化边界

以下主题从 ARCH 主体中抽离为 capability 文档减少与 LOGIC / API 的重叠：

- Prompt Workflow Runtime -> `docs/subsystems/PROMPT_WORKFLOW.md`
- AI Gateway / Invocation Observability -> `docs/subsystems/AI_GATEWAY.md`
- Behavior Tree InferenceProvider -> `docs/subsystems/BEHAVIOR_TREE.md`
- Pack-local Plugin Runtime -> `docs/subsystems/PLUGIN_RUNTIME.md`

在 ARCH 中只保留它们的边界性结论：

### 6.1 Prompt Workflow

- workflow persistence 留在 kernel-side
- runtime step execution 不应穿透 pack runtime internal object
- workflow orchestration 应消费 inference/context/runtime host contracts，而不是直接依赖世界内核实现细节
- `buildWorkflowPromptBundle()` 是服务端正式 prompt 组装入口；旧 `inference/prompt_builder.ts` 已删除
- `PromptBundleV2` 是 AI task 强制 prompt 输入结构，`AiTaskRequest.prompt_context` 不再支持直接传 `messages` 绕过 workflow
- profile selection 不做静默 fallback；`intent_grounding_assist`、多轮对话 chat profiles 均有显式 profile 语义

### 6.2 AI Gateway

- model/provider routing 属于 host-side orchestration，内置 4 个真实 provider adapter（OpenAI、Anthropic、DeepSeek、Ollama）
- 多 provider fallback 链：OpenAI → Anthropic → DeepSeek（可通过 `ai_models.yaml` 配置）
- invocation observability、audit、retry/recovery 仍留在 Node/TS host
- elasticity（circuit breaker — 状态跨请求保持、rate limiter — 含 429 动态校准、exponential backoff）挂载在 gateway 层，对 adapter 透明
- tool calling（cross_agent_tool、tool_executor、tool_loop_runner、tool_permissions）属于 host-side 受控执行能力；tool loop 含 token 预算管理（`tiktoken` 精确计数 + Anthropic 字符估算）
- response caching：LRU 内存缓存 + per-task-type TTL，减少确定性推理重复调用成本
- streaming：provider adapter 支持流式响应（Chat Completions SSE / Anthropic Messages SSE），gateway 层透传；SSE endpoint 待前端接入
- provider templates：`ai_models.yaml` 的 `provider_templates` 段支持零代码添加 OpenAI-compatible 渠道（OpenRouter、SiliconFlow 等），`adapter_registry.ts` 动态构建 adapter 列表
- registry 支持 fs.watch 热加载（`registry_watcher.ts`），ai_models.yaml 与 prompt_slots.yaml 变更后自动校验重载（provider_templates 变更同受热加载覆盖）
- Rust world engine 若引入，不承接 AI gateway 本体

**目录边界**：

| 目录 | 职责 |
|------|------|
| `ai/` | AI 网关层：gateway、task_service、task_definitions、task_decoder、task_prompt_builder、prompt_bundle_from_messages、route_resolver、registry、registry_watcher、observability、providers、token_counter、cache |
| `ai/elasticity/` | 网关弹性层：circuit_breaker、rate_limiter、backoff、config_resolver |
| `ai/tool_*.ts` | Tool Calling 系统：cross_agent_tool、tool_executor、tool_loop_runner、tool_permissions |
| `inference/` | 推理流水线：context_builder、PromptBundleV2 / PromptTree 渲染类型、processors、tokenizers、types（inference 专用） |
| `packages/contracts/src/ai_shared.ts` | AI/inference 共享类型契约：PromptBundleMetadata、PromptWorkflowSnapshot 等 |

### 6.3 Behavior Tree

- behavior_tree 是确定性 InferenceProvider，不依赖 Prompt Workflow bundle，不直接调用 AI Gateway
- world-pack 通过顶层 `behavior_trees` 和 actor 级 `inference.provider: behavior_tree` 绑定树定义
- TreeRegistry / evaluator / decorators 的具体语义收口在 `docs/subsystems/BEHAVIOR_TREE.md`

### 6.4 Plugin Runtime

- plugin host 继续留在 Node/TS
- Plugin runtime surface（`/api/packs/:packId/plugins/runtime/web`）对所有已加载 pack 统一可用
- 后续若引入 Rust world engine，plugin host 通过 Host API / lookup port 与其交互，而不是直接持有内核对象
