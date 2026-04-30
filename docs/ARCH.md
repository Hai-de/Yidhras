# 系统架构 / System Architecture

本文档用于描述 Yidhras 的**系统分层、模块边界、宿主关系与职责划分**。

> 图形化总览与调用流见 `ARCH_DIAGRAM.md` · 公共 HTTP contract 见 `API.md` · 业务执行语义见 `LOGIC.md` · 专题细节见 `docs/capabilities/`

## 核心术语

| 术语 | 含义 |
|------|------|
| 世界包 (world pack) | 封装世界规则、实体、能力、媒介的数据包，作为模拟的内容单元 |
| 宿主 (host) | 运行编排、调度、持久化的 Node/TS 进程 |
| Sidecar (Rust sidecar) | 通过 stdio JSON-RPC 与宿主通信的 Rust 世界引擎进程，负责世界状态计算 |
| Kernel-side | 宿主持久化层（Prisma，支持 SQLite / PostgreSQL），存储 workflow、social、audit、memory 等 |
| Pack-local | 每个 world pack 独有的运行时数据库（pack runtime DB，支持 SQLite / PostgreSQL adapter） |
| WorldEnginePort | TS 宿主持有的世界引擎控制面合约（step/commit/abort/query） |
| PackHostApi | TS 宿主对外提供的受控读面合约 |
| Inference workflow | 从上下文组装到模型推理到意图落地的完整链路 |
| Intent Grounder | 把模型开放语义映射为系统可执行结果的组件 |
| SimulationManager | 内部 wiring 类，实现多个运行时端口并注入 AppContext |

## 1. 顶层分层

当前系统可粗分为以下几层：

- **Transport / App layer**
  - Express routes、HTTP envelope、query/body parsing、frontend API consumption
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

以下对象当前由 kernel-side 持久化宿主承载：

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

以下对象当前由 pack-local runtime DB 承载（默认 SQLite，支持 PostgreSQL adapter）：

- pack world entities
- pack entity states
- authority grants
- mediator bindings
- rule execution records
- scheduler lease / cursor / ownership / observability records (via `SchedulerStorageAdapter`)

### 2.3 边界含义

这意味着当前系统明确区分：

- **world governance core** -> pack runtime
- **workflow / social / audit / observability / plugin governance / memory working layer** -> kernel side

`Event` 当前属于跨边界共享证据宿主：

- 产生端可来自 objective enforcement
- 消费端横跨 audit / memory / workflow / projection
- 它不是纯 pack-owned narrative source-of-truth

## 2.4 持久化抽象层

### 2.4.1 Repository 接口层（Kernel-side）

主应用 DB 访问已通过 Repository 接口层收口，不再直接依赖 `PrismaClient` 具体类型：

```
apps/server/src/app/services/repositories/
  types.ts                          # 共享领域类型
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

每个接口返回领域类型，不暴露 `PrismaClient` 类型。Prisma 实现类通过构造函数注入 `PrismaClient`，由 `createPrismaRepositories(prisma)` 工厂统一创建。

`AppInfrastructure.repos: Repositories` 在组合根注入。调用方通过 `context.repos.<domain>.method()` 访问。

### 2.4.2 Pack Storage Adapter 接口层（Pack-local）

Pack 运行时数据库已通过 `PackStorageAdapter` 接口抽象，当前提供两种后端实现：

| 实现 | 后端 | 隔离策略 |
|------|------|----------|
| `SqlitePackStorageAdapter` | SQLite（`node:sqlite`） | 每 pack 独立文件：`data/world_packs/<packId>/runtime.sqlite` |
| `PostgresPackStorageAdapter` | PostgreSQL（Prisma raw SQL） | schema-per-pack：`pack_<id>.world_entities` 等 |

接口定义在 `packs/storage/PackStorageAdapter.ts`，覆盖 engine-owned schema 管理、动态 collection CRUD、快照 export/import、生命周期管理。

> **快照功能的 SQLite-only 限制**：虽然 `PackStorageAdapter` 接口定义了 `exportPackData()` / `importPackData()` 方法，但世界包快照系统（`packs/snapshots/`）有意绕过该抽象层，直接复制原始 `runtime.sqlite` 文件以保留完整数据库物理状态（WAL、索引结构等）。因此快照功能**仅适用于 SQLite 后端**。PostgreSQL 部署者应使用数据库原生备份工具（`pg_dump`、`pg_basebackup`、WAL archiving）。详见 `snapshot_capture.ts` 顶部设计决策注释。

`AppInfrastructure.packStorageAdapter` 在组合根根据 `PRISMA_DB_PROVIDER` 环境变量选择实现，默认 `sqlite`。

### 2.4.2.1 Scheduler Storage Adapter（Pack-local）

Scheduler 运营数据（lease / cursor / ownership / rebalance / observability）已通过 `SchedulerStorageAdapter` 接口迁入 pack-local runtime SQLite，不再存储于 kernel-side Prisma。

| 实现 | 后端 | 隔离策略 |
|------|------|----------|
| `SqliteSchedulerStorageAdapter` | SQLite（`node:sqlite`） | 复用 `runtime.sqlite`，`open(packId)` 时执行 `CREATE TABLE IF NOT EXISTS` |

接口定义在 `packs/storage/SchedulerStorageAdapter.ts`，覆盖 lease、cursor、partition assignment、ownership migration、worker state、rebalance recommendation、scheduler run / candidate decision 的 CRUD，以及生命周期管理（`open`/`close`/`destroyPackSchedulerStorage`）。

当前 `scheduler_lease.ts`、`scheduler_ownership.ts`、`scheduler_rebalance.ts`、`scheduler_observability.ts` 已完全通过 adapter 读写，不再依赖 Prisma。

### 2.4.3 双 Provider 数据库架构

Kernel-side 和 Pack-local 两层均支持通过环境变量切换数据库后端：

| 层级 | 环境变量 | 默认值 | 可选值 |
|------|----------|--------|--------|
| Kernel-side (Prisma) | `PRISMA_DB_PROVIDER` | `sqlite` | `sqlite` / `postgresql` |
| Pack-local (Adapter) | `PRISMA_DB_PROVIDER` | `sqlite` | `sqlite` / `postgresql` |

Kernel-side Prisma schema 已拆分为 `prisma/schema.sqlite.prisma` 和 `prisma/schema.pg.prisma`，两者仅 datasource provider 与 `generator` 输出路径不同，模型定义保持一致。`package.json` 脚本通过 `--schema` 参数化选择目标 schema。

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

### 3.1.1 Operator-Subject 权限中间件链

请求经过以下中间件链，实现三层递进权限过滤：

```
HTTP Request
  → CORS / JSON parse
  → identityInjector（x-m2-identity → req.identity）
  → operatorAuthMiddleware（Authorization: Bearer → JWT 验证 → req.operator）
  → PackAccessGuard（L1: Operator↔Pack 绑定检查）
  → CapabilityGuard（L2: Subject↔Capability 判定）
  → EnforcementEngine（执行 mutation / invocation）
  → PolicyFilter（L3: 字段级 ABAC）
  → 响应
```

| 层级 | 中间件/模块 | 判定依据 |
|------|------------|----------|
| L1: Pack Access | `operator/guard/pack_access.ts` | `OperatorPackBinding` 显式绑定 |
| L2: Capability | `app/middleware/capability.ts` | `OperatorGrant` + pack authority |
| L3: Policy | `access_policy/` | `Policy` 字段级 allow/deny |

关键约束：
- root 操作员也必须有显式 `OperatorPackBinding` 才能访问 Pack，确保审计可追溯
- 三层是递进过滤：L1 拒绝 → 403 直接返回，不查 L2/L3
- Agent 自主行为通过 `resolveSubjectForAgentAction()` 解析控制 Operator 后再校验 capability

### 3.2 Runtime / scheduler 层

- `apps/server/src/app/runtime/*.ts`
  - `PackSimulationLoop.ts` — 每个 pack 独立的 5 步模拟循环（expire → world engine → scheduler → decision jobs → action dispatcher）
  - `MultiPackLoopHost.ts` — 管理所有 per-pack loop 的启停/暂停/恢复
  - `scheduler_sidecar_pool.ts` — Rust 决策内核 sidecar 进程池，`max_processes` 上限
  - `agent_scheduler.ts` — 调度主逻辑（partition-aware / multi-worker，per-pack 调用）
  - `job_runner.ts` / `action_dispatcher_runner.ts` — 决策执行与动作分发
  - `scheduler_lease.ts` / `scheduler_ownership.ts` / `scheduler_rebalance.ts` — lease/ownership/rebalance 逻辑
  - `simulation_loop.ts` — active pack 全局单循环，与 `MultiPackLoopHost` 并存

关键约束：

- scheduler 是 partition-aware / multi-worker
- lease 与 cursor state 以 partition 为作用域，存储于 pack-local SQLite（via `SchedulerStorageAdapter`）
- 每个 pack 拥有独立的 `PackSimulationLoop` 实例，由 `MultiPackLoopHost` 统一管理生命周期
- pack load 时自动启动 loop，pack unload 时停止 loop 并 kill sidecar 进程
- runtime readiness 通过 `AppContext.assertRuntimeReady(feature)` 统一门控

当前 scheduler 相关的宿主级运行参数已收口进 runtime config，而不是继续散落为局部常量：

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

在“模块化优先 / Modularization First”阶段之后，runtime kernel 已开始以正式 port 收口：

- `RuntimeKernelFacade`
  - runtime pause/resume、loop diagnostics、kernel health snapshot
- `SchedulerObservationPort`
  - ownership / workers / summary / operator projection 等读面
- `SchedulerControlPort`
  - bootstrap ownership reconcile 等控制面
- `createRuntimeKernelService(context, packId)`
  - 当前 Node/TS 宿主内的 runtime kernel service 实现，`packId` 为必填参数，所有操作绑定到该 pack

这意味着：

- system status、scheduler routes 不应继续直接依赖底层 scheduler helper；
- 上层应优先通过 runtime kernel service / port 访问 runtime kernel 与 scheduler 观察面；
- scheduler 的运营数据属于 pack-local（via `SchedulerStorageAdapter`），调度器运行时编排属于 **runtime kernel**。

### 3.3 Core simulation 层

- `apps/server/src/core/simulation.ts`

负责：

- 作为 **兼容 facade / thin facade**
- 组合 runtime bootstrap、pack catalog、active-pack runtime、pack runtime registry service
- 对旧调用面继续暴露稳定兼容入口

不再建议把它视为新的职责承载中心。

当前已拆出的职责包括：

- `PrismaRuntimeDatabaseBootstrap`
  - provider-aware 数据库 bootstrap（SQLite pragma apply / snapshot 或 PostgreSQL 连接校验）
- `DefaultPackCatalogService`
  - world pack catalog、pack id / folder 解析
- `DefaultActivePackRuntimeFacade`
  - stable single active-pack runtime、tick / runtime speed / variable resolve
- `DefaultPackRuntimeRegistryService`
  - experimental runtime registry、status/load/unload、host register/unregister

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

多 pack 调度为默认架构。

**主包（stable / active）与附加包（experimental）的区分：**

系统始终存在唯一的主包，通过 `activePackRuntime` 端口驱动。主包在启动时由 world engine sidecar 以 `mode: 'active'` 加载，享有完整的 Rust 世界引擎会话。附加包通过 `packRuntimeControl.load()` 动态加载，运行于 TS 进程内的本地时钟和速度策略，不接入 world engine sidecar。

此区分反映在以下概念中：
- `PackRuntimeScopeMode = 'stable' | 'experimental'` — 主包的 scope 为 `stable`，附加包为 `experimental`
- `/api/experimental/` 路由前缀已移除；附加包的路由通过统一的 `/:packId/` 前缀访问，scope mode 由 `PackScopeResolver` 内部判断
- 主包与附加包共享相同的 pack 状态机、路由和观测接口，仅在 world engine 接入方式和初始加载路径上有区别

- 每个 pack 拥有独立的 `PackSimulationLoop`（完整 5 步循环）
- pack-scoped 路由通过 `/:packId/` 前缀挂载，由 `packScopeMiddleware` 做状态门控
- pack 状态机：`loading → ready → degraded → unloading → gone`

当前职责分层：

- `PackRuntimeRegistry`
  - 负责 loaded pack runtime 集合、lookup、capacity limit、load/unload 生命周期、5 态状态机
- `PackRuntimeHandle`
  - 对外暴露 pack-local clock / runtime speed / health 等只读句柄
- `PackRuntimeHost`
  - 作为 pack-local runtime 宿主
- `PackScopeResolver`
  - 从 URL param 解析 packId，查 registry 状态，返回 pack scope 或抛 404/503
- `MultiPackLoopHost`
  - 管理所有 per-pack loop 的启停/暂停/恢复
- `SimulationManager`
  - 内部 wiring 类，通过 `setMultiPackLoopHost()` 注入 loop host

当前已收口的实现事实：

- pack-scoped 路由统一在 `routes/packs/index.ts` 聚合，挂载至 `/:packId`
- global 路由（health、admin、config、operator 等）保留原有路径
- `PackScopeResolver` + `packScopeMiddleware` 实现请求级 pack 状态校验
- `DefaultPackRuntimeRegistryService.load/unload` 自动启停 per-pack loop
- `PackSimulationLoop` 内维护 crash 计数器，连续失败达阈值自动切 `degraded`

### 3.3.2 Rust world engine 与 sidecar 边界

世界推进通过 Rust sidecar 执行，Node/TS host 保留运行编排权：

- `WorldEnginePort`：TS host 持有的 control / compute plane contract
  - world pack load/unload、step prepare/commit/abort、state query、health
- `PackHostApi`：TS host kernel 持有的 host-mediated read contract
  - 只暴露受控读面（pack summary、current tick、world state query），不暴露内核控制能力
  - 长期语义是 host-accepted / host-projected truth，不是 sidecar internal truth
- `WorldEngineSidecarClient`：本地 stdio + JSON-RPC transport implementation，不是公开 contract

边界结论：

- runtime loop 的世界推进主路径走 `WorldEnginePort`
- `SimulationManager` 作为内部 wiring 类，实现多个运行时端口供 `index.ts` 注入 `AppContext`
- objective enforcement 是 Rust-owned 真实规则执行路径：sidecar 负责匹配/模板渲染/mutation 规划，host 负责权限校验/持久化/事件桥接
- plugin host / workflow host 读取世界态应消费 `PackHostApi`，不直接依赖 sidecar protocol
- Rust sidecar 负责 world engine 内核计算；runtime orchestration、scheduler、plugin host、workflow host、AI gateway、Host-managed persistence 仍由 Node/TS host 持有
- `PackHostApi` 是 TS control plane 的正式读合同，repository-backed / projection-backed / host-mediated sidecar-assisted reads 均属其可接受实现策略

Sidecar 协议覆盖：handshake、health、pack load/unload、state query、objective execution、status、step prepare/commit/abort。

Host-managed persistence 覆盖：pack runtime core snapshot hydrate → Rust session → prepare/commit/abort → failure recovery 闭环，包括 entity state upsert、rule execution append、clock delta、tainted session 恢复。

### 3.3.3 Rust 迁移状态

各模块当前默认执行路径与兼容层状态详见 `.limcode/design/rust-migration-status-matrix-and-exit-criteria.md`。

简要结论：

- World engine：已完成 sidecar-only 收口
- Objective enforcement：已切到 Rust-owned 真实执行路径
	- Scheduler decision kernel：Rust sidecar 唯一执行路径；TS 参考实现已物理删除
	- Memory trigger engine：Rust sidecar 唯一执行路径；TS 参考实现已物理删除
- 仍由 Node/TS host 持有的能力：runtime orchestration、scheduler runtime、plugin host、workflow host、AI gateway、Host-managed persistence

## 4. Workflow / inference 边界

### 4.1 Inference workflow facade

- `apps/server/src/app/services/inference_workflow.ts`

进一步职责拆分到：

- `inference_workflow/parsers.ts`
- `inference_workflow/repository.ts`
- `inference_workflow/snapshots.ts`
- `inference_workflow/results.ts`
- `inference_workflow/workflow_query.ts`
- `inference_workflow/ai_invocations.ts`

### 4.2 边界约束

当前保持以下分离：

- decision generation
- workflow persistence
- action dispatch
- inference observability

`ActionIntent` / `InferenceTrace` / `DecisionJob` 仍宿主于 kernel-side Prisma，而不是 pack runtime。

## 5. Context / memory / overlay 边界

### 5.1 Context Module

当前 inference runtime 包含 Context Module，相关实现位于：

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

在模块化收口后，context / memory 已开始通过正式 port 接入：

- `ContextAssemblyPort`
  - `buildContextRun(...)`
- `MemoryRuntimePort`
  - `buildMemoryContext(...)`
- `createContextAssemblyPort(context)`
- `createMemoryRuntimePort(context)`

当前 inference context builder、memory compaction、memory block 删除审计等路径已开始优先通过：

- `context.contextAssembly`
- `context.memoryRuntime`
- `context.activePackRuntime`

访问。`context.sim` 已移除，不再作为公共访问路径。

### 5.2 Overlay / Memory Block

- overlay 是 **kernel-side working-layer object**
- `ContextOverlayEntry` 持久化在 kernel Prisma，再 re-materialize 为 `ContextNode`
- overlay 不作为 pack runtime source-of-truth
- Memory Block Runtime 也属于 kernel-side memory subsystem

这意味着：

- pack runtime 管世界治理状态
- kernel memory subsystem 管工作层上下文与长期记忆物化

## 6. Prompt Workflow / AI Gateway / Plugin Runtime 的专题化边界

以下主题已从 ARCH 主体中抽离为 capability 文档，以减少与 LOGIC / API 的重叠：

- Prompt Workflow Runtime -> `docs/capabilities/PROMPT_WORKFLOW.md`
- AI Gateway / Invocation Observability -> `docs/capabilities/AI_GATEWAY.md`
- Pack-local Plugin Runtime -> `docs/capabilities/PLUGIN_RUNTIME.md`

在 ARCH 中只保留它们的边界性结论：

### 6.1 Prompt Workflow

- workflow persistence 留在 kernel side
- runtime step execution 不应穿透 pack runtime internal object
- workflow orchestration 应消费 inference/context/runtime host contracts，而不是直接依赖世界内核实现细节

### 6.2 AI Gateway

- model/provider routing 属于 host-side orchestration
- invocation observability、audit、retry/recovery 仍留在 Node/TS host
- elasticity（circuit breaker、rate limiter、exponential backoff）挂载在 gateway 层，对 adapter 透明
- tool calling（cross_agent_tool、tool_executor、tool_loop_runner、tool_permissions）属于 host-side 受控执行能力
- registry 支持 fs.watch 热加载（`registry_watcher.ts`），ai_models.yaml 与 prompt_slots.yaml 变更后自动校验重载
- Rust world engine 若引入，不承接 AI gateway 本体

**目录边界**：

| 目录 | 职责 |
|------|------|
| `ai/` | AI 网关层：gateway、task_service、task_definitions、task_decoder、task_prompt_builder、route_resolver、registry、registry_watcher、observability、providers（含 gateway_backed）、adapters、schemas |
| `ai/elasticity/` | 网关弹性层：circuit_breaker、rate_limiter、backoff、config_resolver |
| `ai/tool_*.ts` | Tool Calling 系统：cross_agent_tool、tool_executor、tool_loop_runner、tool_permissions |
| `inference/` | 推理流水线：context_builder、prompt builders、processors、tokenizers、types（inference 专用） |
| `packages/contracts/src/ai_shared.ts` | AI/inference 共享类型契约：PromptBundleMetadata、PromptWorkflowSnapshot 等 |

`ai/` 和 `inference/` 之间不再有物理循环依赖：共享类型通过 contracts 包中介，`gateway_backed` 已移至 `ai/providers/`。

### 6.3 Plugin Runtime

- plugin host 当前继续留在 Node/TS
- plugin runtime scope 已通过 `PackRuntimeLookupPort` / `PackScopeResolver` 收口
- 主包（stable）plugin runtime surface 不因多包运行时自动放宽
- 后续若引入 Rust world engine，plugin host 通过 Host API / lookup port 与其交互，而不是直接持有内核对象
