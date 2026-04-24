# 系统架构 / System Architecture

本文档用于描述 Yidhras 的**系统分层、模块边界、宿主关系与职责划分**。

> 图形化总览与调用流见 `ARCH_DIAGRAM.md` · 公共 HTTP contract 见 `API.md` · 业务执行语义见 `LOGIC.md` · 专题细节见 `docs/capabilities/`

## 核心术语

| 术语 | 含义 |
|------|------|
| 世界包 (world pack) | 封装世界规则、实体、能力、媒介的数据包，作为模拟的内容单元 |
| 宿主 (host) | 运行编排、调度、持久化的 Node/TS 进程 |
| Sidecar (Rust sidecar) | 通过 stdio JSON-RPC 与宿主通信的 Rust 世界引擎进程，负责世界状态计算 |
| Kernel-side | 宿主持久化层（Prisma/SQLite），存储 workflow、social、audit、memory 等 |
| Pack-local | 每个 world pack 独有的运行时数据库（runtime SQLite） |
| WorldEnginePort | TS 宿主持有的世界引擎控制面合约（step/commit/abort/query） |
| PackHostApi | TS 宿主对外提供的受控读面合约 |
| Inference workflow | 从上下文组装到模型推理到意图落地的完整链路 |
| Intent Grounder | 把模型开放语义映射为系统可执行结果的组件 |
| SimulationManager | 兼容 facade，聚合 runtime bootstrap、pack catalog、active-pack runtime |

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

### 2.1 Kernel-side Prisma / SQLite

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

### 2.2 Pack-local runtime SQLite

以下对象当前由 pack-local runtime sqlite 承载：

- pack world entities
- pack entity states
- authority grants
- mediator bindings
- rule execution records

### 2.3 边界含义

这意味着当前系统明确区分：

- **world governance core** -> pack runtime
- **workflow / social / audit / observability / plugin governance / memory working layer** -> kernel side

`Event` 当前属于跨边界共享证据宿主：

- 产生端可来自 objective enforcement
- 消费端横跨 audit / memory / workflow / projection
- 它不是纯 pack-owned narrative source-of-truth

## 2.4 Runtime 配置边界

当前运行时配置继续沿用既有 `data/configw` scaffold：

- 内建 defaults 定义于：`apps/server/src/config/runtime_config.ts`
- schema 定义于：`apps/server/src/config/schema.ts`
- YAML 读取 / 合并入口位于：`apps/server/src/config/runtime_config.ts`
- scaffold 模板位于：`apps/server/templates/configw/*.yaml`
- 工作区实际配置位于：`data/configw/*.yaml`

明确边界如下：

- `data/configw/*.yaml`
  - 承载 **宿主级 / 部署级 / runtime 行为级** 配置
  - 如端口、路径、bootstrap、sqlite pragma、scheduler runtime/lease/rebalance/runner/observability、prompt workflow defaults
- `apps/server/config/ai_models.yaml`
  - 承载 **AI provider / model registry / route policy** 配置
  - 不与 `configw` 混为一体，避免 runtime host config 与 AI registry config 混杂

当前优先级：

1. code builtin defaults
2. `data/configw/default.yaml`
3. `data/configw/<APP_ENV>.yaml`
4. `data/configw/local.yaml`
5. env overrides

也即：**env > yaml > code default**。

## 3. 组合根与应用层

### 3.1 Server 组合根

- `apps/server/src/index.ts`：composition root
- `apps/server/src/app/create_app.ts`：Express middleware 与 route registration 装配入口
- `apps/server/src/app/routes/*.ts`：transport-level routes，保持薄层
- `apps/server/src/app/services/*.ts`：应用服务、聚合、read-model assembly

### 3.2 Runtime / scheduler 层

- `apps/server/src/app/runtime/*.ts`
  - runtime loop
  - scheduler
  - job runner
  - action dispatcher runner
  - lease / ownership / rebalance

关键约束：

- scheduler 是 partition-aware / multi-worker
- lease 与 cursor state 以 partition 为作用域
- runtime loop 在 `simulation_loop.ts` 中串行化
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
- `createRuntimeKernelService(context)`
  - 当前 Node/TS 宿主内的 runtime kernel service 实现

这意味着：

- system status、scheduler routes、experimental scheduler runtime 不应继续直接依赖底层 scheduler helper；
- 上层应优先通过 runtime kernel service / port 访问 runtime kernel 与 scheduler 观察面；
- scheduler 的所有权依旧明确属于 **runtime kernel**，而不是 pack runtime。

### 3.3 Core simulation 层

- `apps/server/src/core/simulation.ts`

负责：

- 作为 **兼容 facade / thin facade**
- 组合 runtime bootstrap、pack catalog、active-pack runtime、pack runtime registry service
- 对旧调用面继续暴露稳定兼容入口

不再建议把它视为新的职责承载中心。

当前已拆出的职责包括：

- `PrismaRuntimeDatabaseBootstrap`
  - SQLite pragma apply / snapshot、数据库 bootstrap
- `DefaultPackCatalogService`
  - world pack catalog、pack id / folder 解析
- `DefaultActivePackRuntimeFacade`
  - stable single active-pack runtime、tick / runtime speed / variable resolve
- `DefaultPackRuntimeRegistryService`
  - experimental runtime registry、status/load/unload、host register/unregister

另外，SQLite runtime pragma 也已纳入 runtime host config：

- `sqlite.busy_timeout_ms`
- `sqlite.wal_autocheckpoint_pages`
- `sqlite.synchronous`

它们属于 **宿主运行时稳定性 / 部署调优参数**，不是业务语义的一部分；
修改方式应优先经 `configw` 或 env override，而不是直接改 `SimulationManager` / sqlite helper 内部常量。

约束：
- 不把 `SimulationManager` 继续扩张为通用 app-service bucket
- 不把它改造成新的“大一统多 pack 容器”
- 新的 query / orchestration 逻辑应放进更聚焦的模块

### 3.3.1 Experimental multi-pack runtime registry boundary

当前 Phase 5 已引入 **experimental multi-pack runtime registry**，但它的定位是保守的：

- **default off**
- **experimental**
- **operator / test-only**

当前推荐的职责分层是：

- `PackRuntimeRegistry`
  - 负责 loaded pack runtime 集合、lookup、capacity limit、load/unload 生命周期
- `PackRuntimeHandle`
  - 对外暴露 pack-local clock / runtime speed / health 等只读句柄
- `PackRuntimeHost`
  - 作为 pack-local runtime 宿主
- `PackRuntimeLookupPort` / `PackScopeResolver`
  - 负责 pack scope lookup、stable/experimental 作用域校验与 Host API 预留面
- `SimulationManager`
  - 仅作为兼容 facade，而不是 registry implementation owner

这意味着：

- multi-pack 不是当前默认 runtime model
- stable `/api/status` 不会立即变成多 pack 数组形态
- stable canonical pack routes 也不会因为 experimental mode 自动解除 active-pack guard

当前本轮已进一步收口的实现事实：

- projection 读面已开始采用 **pack-scoped core service + stable/experimental scope adapter** 分层：
  - `pack_projection_metadata_resolver.ts`
  - `pack_projection_scope_adapter.ts`
  - `pack_narrative_projection_service.ts`
  - `pack_entity_overview_projection_service.ts`
- experimental runtime `/api/experimental/runtime/packs` 已增强为 **control-plane snapshot**，可同时表达 active/loaded pack、health、clock、runtime speed 与 scheduler/plugin availability 摘要
- plugin runtime web/read surface 已统一进入 `PackScopedPluginRuntimeService`，stable 与 experimental 路径共享 pack-scoped service，而不再依赖零散的 active-pack 反推
- inference/context 当前仍保持 stable active-pack 默认行为，但已预留 `buildInferenceContextForPack(...)` internal contract 作为下一轮 pack-scoped execution 扩展入口

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
- `SimulationManager` 保留为兼容 facade，不再是 runtime loop 的世界推进主入口
- objective enforcement 是 Rust-owned 真实规则执行路径：sidecar 负责匹配/模板渲染/mutation 规划，host 负责权限校验/持久化/事件桥接
- plugin host / workflow host 读取世界态应消费 `PackHostApi`，不直接依赖 sidecar protocol
- Rust sidecar 负责 world engine 内核计算；runtime orchestration、scheduler、plugin host、workflow host、AI gateway、Host-managed persistence 仍由 Node/TS host 持有
- `PackHostApi` 是 TS control plane 的正式读合同，不是迁移期桥接壳；repository-backed / projection-backed / host-mediated sidecar-assisted reads 均属其可接受实现策略

Sidecar 协议覆盖：handshake、health、pack load/unload、state query、objective execution、status、step prepare/commit/abort。

Host-managed persistence 覆盖：pack runtime core snapshot hydrate → Rust session → prepare/commit/abort → failure recovery 闭环，包括 entity state upsert、rule execution append、clock delta、tainted session 恢复。

### 3.3.3 Rust 迁移状态

各模块当前默认执行路径与兼容层状态详见 `.limcode/design/rust-migration-status-matrix-and-exit-criteria.md`。

简要结论：

- World engine：已完成 sidecar-only 收口
- Objective enforcement：已切到 Rust-owned 真实执行路径
- Scheduler decision kernel：Rust sidecar 唯一执行路径；TS 参考实现已标记为 @deprecated，仅在 Rust sidecar 不可用时触发 fallback 并打印 deprecation warning
- Memory trigger engine：Rust sidecar 唯一执行路径；TS 参考实现已标记为 @deprecated，仅在 Rust sidecar 不可用时触发 fallback 并打印 deprecation warning
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

访问，而不是继续直接依赖 `context.sim`。

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
- Rust world engine 若引入，不承接 AI gateway 本体

### 6.3 Plugin Runtime

- plugin host 当前继续留在 Node/TS
- plugin runtime scope 已通过 `PackRuntimeLookupPort` / `PackScopeResolver` 收口
- stable active-pack plugin runtime surface 不因 experimental multi-pack 自动放宽
- 后续若引入 Rust world engine，plugin host 通过 Host API / lookup port 与其交互，而不是直接持有内核对象
