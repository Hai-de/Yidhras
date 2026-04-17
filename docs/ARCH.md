# 系统架构 / System Architecture

本文档用于描述 Yidhras 的**系统分层、模块边界、宿主关系与职责划分**。

> 不在这里展开：
> - 公共 HTTP contract：看 `API.md`
> - 业务执行语义：看 `LOGIC.md`
> - Prompt Workflow / Plugin Runtime / AI Gateway 的高耦合专题细节：看 `docs/capabilities/`

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
- `scheduler.automatic_rebalance.*`
- `scheduler.runners.decision_job.*`
- `scheduler.runners.action_dispatcher.*`
- `scheduler.agent.*`
- `scheduler.observability.*`

这意味着：

- 调度主循环节奏、lease 生命周期、自动 rebalance 阈值、runner 批量参数、operator 观测默认 limit
  都属于 **runtime host policy**，应通过 YAML / env 调整；
- 业务层不再把这些值继续内嵌为新的 ad-hoc 常量。

### 3.3 Core simulation 层

- `apps/server/src/core/simulation.ts`

负责：

- Prisma init
- SQLite pragmas
- world-pack loading
- clock
- narrative resolver
- dynamics
- runtime speed
- graph access

另外，SQLite runtime pragma 也已纳入 runtime host config：

- `sqlite.busy_timeout_ms`
- `sqlite.wal_autocheckpoint_pages`
- `sqlite.synchronous`

它们属于 **宿主运行时稳定性 / 部署调优参数**，不是业务语义的一部分；
修改方式应优先经 `configw` 或 env override，而不是直接改 `SimulationManager` / sqlite helper 内部常量。

约束：
- 不把 `SimulationManager` 继续扩张为通用 app-service bucket
- 新的 query / orchestration 逻辑应放进更聚焦的模块

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

### 6.1 Prompt Workflow Runtime

架构结论：

- 它是 inference pipeline 中的正式 runtime 外壳
- 负责 `ContextRun / ContextNode -> PromptBundle / request` 的组织层
- 仍是线性 runtime，不是通用 DAG engine
- 保留 compatibility bridges，但不再把 legacy path 视为 source-of-truth

当前 prompt workflow 中已经外置到 runtime config 的部分，是**适合部署者 / 运营调参的默认值**，例如：

- `prompt_workflow.profiles.agent_decision_default.*`
- `prompt_workflow.profiles.context_summary_default.*`
- `prompt_workflow.profiles.memory_compaction_default.*`

而 step graph / executor registry / orchestration 主体仍留在代码中，避免把整个 workflow runtime 直接变成自由形态配置系统。

### 6.2 Unified AI task / gateway

架构结论：

- 服务端已形成内部 AI 执行层：`AiTaskService -> RouteResolver -> ModelGateway -> provider adapters`
- 公开 inference contract 仍与内部 gateway path 分离
- world pack 对 AI 的影响是 declarative 的，而不是直接 provider control
- `AiInvocationRecord` 作为 kernel-side observability host 存在

### 6.3 Pack-local plugin runtime

架构结论：

- 插件治理记录宿主在 kernel side，而不是 pack runtime sqlite
- runtime manifest、同源 web 资产路由、route host 已形成受控承接边界
- 当前正式范围仍是 `pack_local`

## 7. Projection 与 read model 边界

当前后端已形成的主要 projection / read model：

- entity overview projection
- pack narrative timeline projection
- operator overview projection
- global projection index

### 7.1 Pack projection contract

在当前单 active-pack 模式下：

- `/api/packs/:packId/overview`
- `/api/packs/:packId/projections/timeline`

都要求：

- 请求的 `packId` 必须与当前 active pack 一致
- 不一致时返回 `409 / PACK_ROUTE_ACTIVE_PACK_MISMATCH`

### 7.2 Access-policy subsystem

- `/api/access-policy/*` 是独立 access / projection policy 子系统
- 它不属于 unified governance canonical API 的主线接口
- 它负责显式 policy 写入与评估

## 8. Operator handoff 边界

后端当前已具备以下高级视图所需证据面：

- authority inspector
- rule execution timeline
- perception diff

后端负责：

- authority / perception / mediator provenance / rule execution evidence 输出
- pack / entity / rule 相关 projection contract 稳定化
- handoff 字段与示例说明

前端负责：

- 页面 UI
- 布局与可视化
- 状态管理
- 导航与交互组织

## 9. 当前稳定边界结论

当前可视为稳定的系统边界包括：

1. world governance core 继续 pack-owned
2. workflow / social / audit / observability 继续 kernel-hosted
3. `Event` 作为跨 pack-governance 与 kernel observability 的共享证据宿主存在
4. Prompt Workflow、AI Gateway、Plugin Runtime 均已形成独立专题能力，但仍服务于更高层系统分层
5. 当前实现仍是受控演进体系，而不是完全开放式平台

## 10. 相关文档

- 公共接口：`API.md`
- 业务语义：`LOGIC.md`
- Prompt Workflow：`docs/capabilities/PROMPT_WORKFLOW.md`
- AI Gateway：`docs/capabilities/AI_GATEWAY.md`
- Plugin Runtime：`docs/capabilities/PLUGIN_RUNTIME.md`
