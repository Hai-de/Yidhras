# 系统架构图分析
- 日期: 2026-04-09
- 概述: 针对项目系统架构文档与代码目录进行一致性审查，评估架构分层、模块职责与调用关系。
- 状态: 已完成
- 总体结论: 通过

## 评审范围

# 系统架构图分析

- 日期：2025-08-27
- 范围：系统架构文档、根工作区模块划分、前后端与共享契约结构
- 方法：先核对架构文档，再与实际目录与关键配置进行交叉验证，按模块记录里程碑。

## 评审摘要

- 当前状态: 已完成
- 已审模块: docs/ARCH.md, apps/server, apps/web, packages/contracts, apps/server/src/index.ts, apps/server/src/core/simulation.ts, apps/server/src/core/runtime_activation.ts, apps/server/src/kernel/install/install_pack.ts, apps/server/src/packs/storage/pack_storage_engine.ts, apps/server/src/app/runtime/simulation_loop.ts, packages/contracts/src/envelope.ts, packages/contracts/src/system.ts, packages/contracts/src/projections.ts, apps/server/src/app/routes/system.ts, apps/server/src/app/routes/overview.ts, apps/server/src/app/routes/scheduler.ts, apps/server/src/app/services/scheduler_observability.ts, apps/web/lib/http/client.ts, apps/web/composables/app/useOperatorBootstrap.ts, apps/web/composables/api/useOverviewApi.ts, apps/web/composables/api/useSystemApi.ts, apps/web/composables/api/useSchedulerApi.ts, apps/web/features/overview/composables/useOverviewPage.ts, apps/web/pages/overview.vue, apps/server/src/inference/context_builder.ts, apps/server/src/context/service.ts, apps/server/src/context/workflow/orchestrator.ts, apps/server/src/inference/service.ts, apps/server/src/ai/task_service.ts, apps/server/src/ai/route_resolver.ts, apps/server/src/ai/gateway.ts, apps/server/src/packs/runtime/projections/active_pack_projection_guard.ts, apps/server/src/kernel/projections/operator_overview_service.ts, apps/server/src/packs/runtime/projections/entity_overview_service.ts, apps/server/src/packs/runtime/projections/narrative_projection_service.ts, apps/server/src/packs/storage/pack_db_locator.ts, apps/server/src/app/services/operator_contracts.ts
- 当前进度: 已记录 4 个里程碑；最新：M4
- 里程碑总数: 4
- 已完成里程碑: 4
- 问题总数: 2
- 问题严重级别分布: 高 0 / 中 0 / 低 2
- 最新结论: 该项目的系统架构整体是清晰且一致的：仓库层面采用 `apps/web + apps/server + packages/contracts` 的 monorepo 组织，运行时层面采用 `kernel + world-pack runtime` 双层后端模型。若用图来表达，建议采用五层：1) Nuxt 前端操作台；2) Express API 与 AppContext 宿主层；3) Inference / Scheduler / AI / Context 等 Kernel 能力层；4) Pack Runtime 与 Projection 只读投影层；5) Kernel Prisma 与按 pack 切分的 SQLite 存储层。主数据流是“前端通过共享 envelope 调用 API → API 聚合 kernel/service read model → kernel 驱动 simulation/inference/scheduler → pack runtime 产出世界状态与规则执行记录 → projection 与 event bridge 再回流到前端读面”。需要注意的一点是，前端编译期类型仍未完全收敛到共享 contracts，属于低风险可维护性问题，但不影响当前架构图的主干成立。
- 下一步建议: 后续若要补画正式架构图，建议按五层图 + 两条主链路（启动链路、读面链路） + 一条执行链路（inference/AI/context）来表现。
- 总体结论: 通过

## 评审发现

### 前端特性类型与共享 contracts 仍有局部镜像

- ID: F-前端特性类型与共享-contracts-仍有局部镜像
- 严重级别: 低
- 分类: 可维护性
- 跟踪状态: 开放
- 相关里程碑: M3
- 说明:

  虽然仓库有 `@yidhras/contracts` 作为统一接口层，且服务端路由也用其 schema 做响应校验，但前端在 `useOverviewApi`、`useSystemApi`、`useSchedulerApi` 等位置仍保留了不少本地接口定义与局部字段镜像。这样会让共享 contracts 在运行时边界上统一、但在前端编译期仍存在手工同步成本；一旦后端 read model 增删字段，前端未直接复用共享类型的部分更容易产生静态漂移。
- 建议:

  如果希望系统架构图中的 `packages/contracts` 真正成为端到端单一事实源，可逐步把前端本地接口收敛到共享 schema 推导类型或共享 DTO 定义上。
- 证据:
  - `packages/contracts/src/system.ts:44-61#runtimeStatusDataSchema`
  - `packages/contracts/src/projections.ts:51-66#overviewSummaryDataSchema`
  - `apps/web/composables/api/useOverviewApi.ts:17-35#OverviewSummarySnapshot`
  - `apps/web/composables/api/useSystemApi.ts:39-48#RuntimeStatusSnapshot`
  - `apps/web/composables/api/useSchedulerApi.ts:386-424#SchedulerOperatorProjection`
  - `packages/contracts/src/system.ts`
  - `packages/contracts/src/projections.ts`
  - `apps/web/composables/api/useOverviewApi.ts`
  - `apps/web/composables/api/useSystemApi.ts`
  - `apps/web/composables/api/useSchedulerApi.ts`

### 前端特性类型与共享 contracts 仍有局部镜像

- ID: F-前端特性类型与共享-contracts-仍有局部镜像-2
- 严重级别: 低
- 分类: 可维护性
- 跟踪状态: 开放
- 相关里程碑: M4
- 说明:

  仓库已经用 `@yidhras/contracts` 统一了很多 API schema 与 envelope，但前端在 `useOverviewApi`、`useSystemApi`、`useSchedulerApi` 等位置仍保留了较多本地接口定义和字段镜像。运行时边界是统一的，编译期类型却并未完全共用，这会增加后端读模型演进时的同步成本。
- 建议:

  若希望 `packages/contracts` 真正成为端到端单一事实源，可逐步让前端更多使用共享 schema 推导类型，减少本地 DTO 镜像。
- 证据:
  - `packages/contracts/src/system.ts:44-61#runtimeStatusDataSchema`
  - `packages/contracts/src/projections.ts:51-66#overviewSummaryDataSchema`
  - `apps/web/composables/api/useOverviewApi.ts:17-35#OverviewSummarySnapshot`
  - `apps/web/composables/api/useSystemApi.ts:39-48#RuntimeStatusSnapshot`
  - `apps/web/composables/api/useSchedulerApi.ts:386-424#SchedulerOperatorProjection`
  - `packages/contracts/src/system.ts`
  - `packages/contracts/src/projections.ts`
  - `apps/web/composables/api/useOverviewApi.ts`
  - `apps/web/composables/api/useSystemApi.ts`
  - `apps/web/composables/api/useSchedulerApi.ts`

## 评审里程碑

### M1 · 总体分层与仓库拓扑核对

- 状态: 已完成
- 记录时间: 2026-04-09T06:31:47.466Z
- 已审模块: docs/ARCH.md, apps/server, apps/web, packages/contracts
- 摘要:

  已先对 `docs/ARCH.md`、根 `README.md` 与三端 package 清单进行交叉核对。文档声明的总体架构为 **kernel + world-pack runtime** 双层后端结构，仓库则以 `apps/server`、`apps/web`、`packages/contracts` 三段式 monorepo 落地。当前文档与目录结构在高层边界上是一致的：后端承载 runtime / workflow / scheduler / inference / projection，前端承载 operator console，contracts 提供共享 transport/contract 定义。
- 结论:

  项目的系统架构图可以先抽象为“前端操作台 → 服务端 Kernel/API → World-Pack Runtime/Pack DB”，并由 `packages/contracts` 作为前后端共享接口层。
- 证据:
  - `docs/ARCH.md:5-10#总览`
  - `README.md:7-15#仓库结构`
  - `README.md:101-108#当前实现概览`
  - `apps/server/package.json:5-33`
  - `apps/web/package.json:5-16`
  - `packages/contracts/package.json:1-15`
- 下一步建议:

  继续抽查后端启动入口、运行时装配与共享 contracts 的实际实现，确认文档中的层次关系在代码中如何落地。

### M2 · 后端启动链路与运行时装配核对

- 状态: 已完成
- 记录时间: 2026-04-09T06:36:27.979Z
- 已审模块: apps/server/src/index.ts, apps/server/src/core/simulation.ts, apps/server/src/core/runtime_activation.ts, apps/server/src/kernel/install/install_pack.ts, apps/server/src/packs/storage/pack_storage_engine.ts, apps/server/src/app/runtime/simulation_loop.ts
- 摘要:

  已核对服务端启动入口与 runtime 装配链路。实际启动顺序为：`src/index.ts` 先构造 `AppContext` 与 Express 应用，再执行数据库预处理、启动前健康检查、选择 world pack、调用 `SimulationManager.init()`，随后进入 `activateWorldPackRuntime()`。在该激活阶段，系统会加载 pack manifest、安装 pack runtime、materialize pack 核心模型与时钟，再把 active pack / clock 回填给 `SimulationManager`。初始化成功后，`startSimulationLoop()` 进入固定周期循环，按 **tick → scheduler → decision job runner → action dispatcher** 的顺序推进模拟。
- 结论:

  如果把系统架构图细化到运行时层，可以画成“HTTP/API 宿主层 + AppContext → SimulationManager → World-Pack Activation → Simulation Loop” 的纵向启动链；其中真正承载世界初始化与数据库落地的是 `runtime_activation` 与 pack storage/install 子系统，而不是 Express 路由本身。
- 证据:
  - `apps/server/src/index.ts:89-161#appContext`
  - `apps/server/src/index.ts:223-279#start`
  - `apps/server/src/app/create_app.ts:13-24#createApp`
  - `apps/server/src/core/simulation.ts:15-69#SimulationManager`
  - `apps/server/src/core/runtime_activation.ts:76-103#activateWorldPackRuntime`
  - `apps/server/src/kernel/install/install_pack.ts:13-26#installPackRuntime`
  - `apps/server/src/packs/storage/pack_storage_engine.ts:84-107#PackStorageEngine.materializeStoragePlan`
  - `apps/server/src/app/runtime/simulation_loop.ts:148-190#runIteration`
- 下一步建议:

  继续核对 API 合同、共享 contracts 与前端页面消费链路，确认架构图中的“前端 ⇄ API ⇄ shared contracts”是否在代码中闭合。

### M3 · API 合同、共享 contracts 与前端消费链路核对

- 状态: 已完成
- 记录时间: 2026-04-09T06:38:50.797Z
- 已审模块: packages/contracts/src/envelope.ts, packages/contracts/src/system.ts, packages/contracts/src/projections.ts, apps/server/src/app/routes/system.ts, apps/server/src/app/routes/overview.ts, apps/server/src/app/routes/scheduler.ts, apps/server/src/app/services/scheduler_observability.ts, apps/web/lib/http/client.ts, apps/web/composables/app/useOperatorBootstrap.ts, apps/web/composables/api/useOverviewApi.ts, apps/web/composables/api/useSystemApi.ts, apps/web/composables/api/useSchedulerApi.ts, apps/web/features/overview/composables/useOverviewPage.ts, apps/web/pages/overview.vue
- 摘要:

  已核对服务端路由、`packages/contracts` 与前端 API/composable 的闭环关系。当前后端在 `system`、`overview`、`scheduler` 等入口上，会先调用服务层生成 read model，再用 `@yidhras/contracts` 中的 Zod schema 做响应校验；前端则通过统一的 `requestApiData()` / `ApiEnvelope` 客户端访问这些接口，并在 `overview` 页面把 overview summary、scheduler operator projection、runtime status、clock、notifications 组合成操作台读模型。说明系统架构图中的“Web → API → Contracts”主干是成立的。
- 结论:

  该项目的前后端连接方式不是页面直接拼装原始数据库对象，而是 **共享 envelope + 服务端 read model + 前端 composable 聚合** 的三段式读面架构；这也是系统架构图中最稳定的交互主轴。
- 证据:
  - `packages/contracts/src/envelope.ts:32-49`
  - `packages/contracts/src/system.ts:44-87#runtimeStatusDataSchema`
  - `packages/contracts/src/projections.ts:51-66#overviewSummaryDataSchema`
  - `apps/server/src/app/routes/system.ts:18-49#registerSystemRoutes`
  - `apps/server/src/app/routes/overview.ts:19-44#registerOverviewRoutes`
  - `apps/server/src/app/routes/scheduler.ts:39-223#registerSchedulerRoutes`
  - `apps/server/src/app/services/scheduler_observability.ts:1730-1807#getSchedulerOperatorProjection`
  - `apps/web/lib/http/client.ts:129-197#requestApiData`
  - `apps/web/composables/app/useOperatorBootstrap.ts:10-88#useOperatorBootstrap`
  - `apps/web/composables/api/useOverviewApi.ts:17-35#OverviewSummarySnapshot`
  - `apps/web/composables/api/useSystemApi.ts:86-99#useSystemApi`
  - `apps/web/composables/api/useSchedulerApi.ts:487-577#useSchedulerApi`
  - `apps/web/features/overview/composables/useOverviewPage.ts:15-114#useOverviewPage`
  - `apps/web/pages/overview.vue:167-262#overviewPage`
- 下一步建议:

  继续收束对 inference/context/AI 子系统与 pack projection 约束的分析，给出更完整的系统架构图解释。
- 问题:
  - [低] 可维护性: 前端特性类型与共享 contracts 仍有局部镜像

### M4 · 交互读面与智能执行子系统核对

- 状态: 已完成
- 记录时间: 2026-04-09T06:40:14.337Z
- 已审模块: apps/web/lib/http/client.ts, apps/web/composables/app/useOperatorBootstrap.ts, apps/web/features/overview/composables/useOverviewPage.ts, apps/web/pages/overview.vue, apps/server/src/inference/context_builder.ts, apps/server/src/context/service.ts, apps/server/src/context/workflow/orchestrator.ts, apps/server/src/inference/service.ts, apps/server/src/ai/task_service.ts, apps/server/src/ai/route_resolver.ts, apps/server/src/ai/gateway.ts, apps/server/src/packs/runtime/projections/active_pack_projection_guard.ts, apps/server/src/kernel/projections/operator_overview_service.ts, apps/server/src/packs/runtime/projections/entity_overview_service.ts, apps/server/src/packs/runtime/projections/narrative_projection_service.ts, apps/server/src/packs/storage/pack_db_locator.ts, apps/server/src/app/services/operator_contracts.ts
- 摘要:

  继续沿系统架构主干核对了两部分：一是 **前端读面链路**，二是 **Inference / Context / AI / Pack Projection** 子系统。前端通过统一的 `requestApiData()` + composables 拉取 `system`、`overview`、`scheduler` 等 read model，`overview` 页面再把 runtime status、notifications、overview summary、scheduler operator projection 聚合为工作台视图。后端侧则把 inference 组织为 `buildInferenceContext -> buildPromptBundle -> provider/gateway -> trace/job/action intent` 的执行链，其中 Context Service 负责从 memory/runtime/overlay 汇总 `ContextRun`，Orchestrator 负责线性片段编排；AI 执行链明确分为 `AiTaskService -> RouteResolver -> ModelGateway -> provider adapters`。与此同时，pack projection 通过 active-pack guard 保证 `/api/packs/:packId/*` 只访问当前 active pack，并将 pack runtime 数据与 kernel event bridge 聚合成 entity overview、timeline、operator overview 等只读投影。
- 结论:

  综合来看，这个项目的系统架构图最适合画成五层：`Nuxt Operator UI` → `Express API / AppContext` → `Inference & Scheduler Kernel` → `World-Pack Runtime / Projection Layer` → `Kernel Prisma + Pack SQLite`。其中 AI、Context、Scheduler 都属于 kernel 内核能力；pack runtime 则负责世界实体、规则执行与投影素材，二者通过 event bridge 与 projection contract 汇合。
- 证据:
  - `apps/web/lib/http/client.ts:129-197#requestApiData`
  - `apps/web/composables/app/useOperatorBootstrap.ts:10-88#useOperatorBootstrap`
  - `apps/web/features/overview/composables/useOverviewPage.ts:15-114#useOverviewPage`
  - `apps/web/pages/overview.vue:167-262#overviewPage`
  - `apps/server/src/inference/context_builder.ts:527-596#buildInferenceContext`
  - `apps/server/src/context/service.ts:49-147#createContextService`
  - `apps/server/src/context/workflow/orchestrator.ts:118-176#runContextOrchestrator`
  - `apps/server/src/inference/service.ts:396-625#createInferenceService`
  - `apps/server/src/ai/task_service.ts:91-142#createAiTaskService`
  - `apps/server/src/ai/route_resolver.ts:196-227#resolveAiRoute`
  - `apps/server/src/ai/gateway.ts:220-408#createModelGateway`
  - `apps/server/src/packs/runtime/projections/active_pack_projection_guard.ts:10-52#resolvePackProjectionTarget`
  - `apps/server/src/kernel/projections/operator_overview_service.ts:32-85#getOperatorOverviewProjection`
  - `apps/server/src/packs/runtime/projections/entity_overview_service.ts:67-148#getPackEntityOverviewProjection`
  - `apps/server/src/packs/runtime/projections/narrative_projection_service.ts:42-126#listPackNarrativeTimelineProjection`
  - `apps/server/src/packs/storage/pack_db_locator.ts:22-52#resolvePackRuntimeDatabaseLocation`
  - `apps/server/src/app/services/operator_contracts.ts:61-104#getOperatorAdvancedContracts`
- 下一步建议:

  整理为用户可读的系统架构图说明，明确五层结构、主数据流与边界约束。
- 问题:
  - [低] 可维护性: 前端特性类型与共享 contracts 仍有局部镜像

## 最终结论

该项目的系统架构整体是清晰且一致的：仓库层面采用 `apps/web + apps/server + packages/contracts` 的 monorepo 组织，运行时层面采用 `kernel + world-pack runtime` 双层后端模型。若用图来表达，建议采用五层：1) Nuxt 前端操作台；2) Express API 与 AppContext 宿主层；3) Inference / Scheduler / AI / Context 等 Kernel 能力层；4) Pack Runtime 与 Projection 只读投影层；5) Kernel Prisma 与按 pack 切分的 SQLite 存储层。主数据流是“前端通过共享 envelope 调用 API → API 聚合 kernel/service read model → kernel 驱动 simulation/inference/scheduler → pack runtime 产出世界状态与规则执行记录 → projection 与 event bridge 再回流到前端读面”。需要注意的一点是，前端编译期类型仍未完全收敛到共享 contracts，属于低风险可维护性问题，但不影响当前架构图的主干成立。

## 评审快照

```json
{
  "formatVersion": 4,
  "kind": "limcode.review",
  "reviewRunId": "review-mnr3ma1m-mc5t3c",
  "createdAt": "2026-04-09T00:00:00.000Z",
  "updatedAt": "2026-04-09T06:40:41.340Z",
  "finalizedAt": "2026-04-09T06:40:41.340Z",
  "status": "completed",
  "overallDecision": "accepted",
  "header": {
    "title": "系统架构图分析",
    "date": "2026-04-09",
    "overview": "针对项目系统架构文档与代码目录进行一致性审查，评估架构分层、模块职责与调用关系。"
  },
  "scope": {
    "markdown": "# 系统架构图分析\n\n- 日期：2025-08-27\n- 范围：系统架构文档、根工作区模块划分、前后端与共享契约结构\n- 方法：先核对架构文档，再与实际目录与关键配置进行交叉验证，按模块记录里程碑。"
  },
  "summary": {
    "latestConclusion": "该项目的系统架构整体是清晰且一致的：仓库层面采用 `apps/web + apps/server + packages/contracts` 的 monorepo 组织，运行时层面采用 `kernel + world-pack runtime` 双层后端模型。若用图来表达，建议采用五层：1) Nuxt 前端操作台；2) Express API 与 AppContext 宿主层；3) Inference / Scheduler / AI / Context 等 Kernel 能力层；4) Pack Runtime 与 Projection 只读投影层；5) Kernel Prisma 与按 pack 切分的 SQLite 存储层。主数据流是“前端通过共享 envelope 调用 API → API 聚合 kernel/service read model → kernel 驱动 simulation/inference/scheduler → pack runtime 产出世界状态与规则执行记录 → projection 与 event bridge 再回流到前端读面”。需要注意的一点是，前端编译期类型仍未完全收敛到共享 contracts，属于低风险可维护性问题，但不影响当前架构图的主干成立。",
    "recommendedNextAction": "后续若要补画正式架构图，建议按五层图 + 两条主链路（启动链路、读面链路） + 一条执行链路（inference/AI/context）来表现。",
    "reviewedModules": [
      "docs/ARCH.md",
      "apps/server",
      "apps/web",
      "packages/contracts",
      "apps/server/src/index.ts",
      "apps/server/src/core/simulation.ts",
      "apps/server/src/core/runtime_activation.ts",
      "apps/server/src/kernel/install/install_pack.ts",
      "apps/server/src/packs/storage/pack_storage_engine.ts",
      "apps/server/src/app/runtime/simulation_loop.ts",
      "packages/contracts/src/envelope.ts",
      "packages/contracts/src/system.ts",
      "packages/contracts/src/projections.ts",
      "apps/server/src/app/routes/system.ts",
      "apps/server/src/app/routes/overview.ts",
      "apps/server/src/app/routes/scheduler.ts",
      "apps/server/src/app/services/scheduler_observability.ts",
      "apps/web/lib/http/client.ts",
      "apps/web/composables/app/useOperatorBootstrap.ts",
      "apps/web/composables/api/useOverviewApi.ts",
      "apps/web/composables/api/useSystemApi.ts",
      "apps/web/composables/api/useSchedulerApi.ts",
      "apps/web/features/overview/composables/useOverviewPage.ts",
      "apps/web/pages/overview.vue",
      "apps/server/src/inference/context_builder.ts",
      "apps/server/src/context/service.ts",
      "apps/server/src/context/workflow/orchestrator.ts",
      "apps/server/src/inference/service.ts",
      "apps/server/src/ai/task_service.ts",
      "apps/server/src/ai/route_resolver.ts",
      "apps/server/src/ai/gateway.ts",
      "apps/server/src/packs/runtime/projections/active_pack_projection_guard.ts",
      "apps/server/src/kernel/projections/operator_overview_service.ts",
      "apps/server/src/packs/runtime/projections/entity_overview_service.ts",
      "apps/server/src/packs/runtime/projections/narrative_projection_service.ts",
      "apps/server/src/packs/storage/pack_db_locator.ts",
      "apps/server/src/app/services/operator_contracts.ts"
    ]
  },
  "stats": {
    "totalMilestones": 4,
    "completedMilestones": 4,
    "totalFindings": 2,
    "severity": {
      "high": 0,
      "medium": 0,
      "low": 2
    }
  },
  "milestones": [
    {
      "id": "M1",
      "title": "总体分层与仓库拓扑核对",
      "status": "completed",
      "recordedAt": "2026-04-09T06:31:47.466Z",
      "summaryMarkdown": "已先对 `docs/ARCH.md`、根 `README.md` 与三端 package 清单进行交叉核对。文档声明的总体架构为 **kernel + world-pack runtime** 双层后端结构，仓库则以 `apps/server`、`apps/web`、`packages/contracts` 三段式 monorepo 落地。当前文档与目录结构在高层边界上是一致的：后端承载 runtime / workflow / scheduler / inference / projection，前端承载 operator console，contracts 提供共享 transport/contract 定义。",
      "conclusionMarkdown": "项目的系统架构图可以先抽象为“前端操作台 → 服务端 Kernel/API → World-Pack Runtime/Pack DB”，并由 `packages/contracts` 作为前后端共享接口层。",
      "evidence": [
        {
          "path": "docs/ARCH.md",
          "lineStart": 5,
          "lineEnd": 10,
          "symbol": "总览"
        },
        {
          "path": "README.md",
          "lineStart": 7,
          "lineEnd": 15,
          "symbol": "仓库结构"
        },
        {
          "path": "README.md",
          "lineStart": 101,
          "lineEnd": 108,
          "symbol": "当前实现概览"
        },
        {
          "path": "apps/server/package.json",
          "lineStart": 5,
          "lineEnd": 33
        },
        {
          "path": "apps/web/package.json",
          "lineStart": 5,
          "lineEnd": 16
        },
        {
          "path": "packages/contracts/package.json",
          "lineStart": 1,
          "lineEnd": 15
        }
      ],
      "reviewedModules": [
        "docs/ARCH.md",
        "apps/server",
        "apps/web",
        "packages/contracts"
      ],
      "recommendedNextAction": "继续抽查后端启动入口、运行时装配与共享 contracts 的实际实现，确认文档中的层次关系在代码中如何落地。",
      "findingIds": []
    },
    {
      "id": "M2",
      "title": "后端启动链路与运行时装配核对",
      "status": "completed",
      "recordedAt": "2026-04-09T06:36:27.979Z",
      "summaryMarkdown": "已核对服务端启动入口与 runtime 装配链路。实际启动顺序为：`src/index.ts` 先构造 `AppContext` 与 Express 应用，再执行数据库预处理、启动前健康检查、选择 world pack、调用 `SimulationManager.init()`，随后进入 `activateWorldPackRuntime()`。在该激活阶段，系统会加载 pack manifest、安装 pack runtime、materialize pack 核心模型与时钟，再把 active pack / clock 回填给 `SimulationManager`。初始化成功后，`startSimulationLoop()` 进入固定周期循环，按 **tick → scheduler → decision job runner → action dispatcher** 的顺序推进模拟。",
      "conclusionMarkdown": "如果把系统架构图细化到运行时层，可以画成“HTTP/API 宿主层 + AppContext → SimulationManager → World-Pack Activation → Simulation Loop” 的纵向启动链；其中真正承载世界初始化与数据库落地的是 `runtime_activation` 与 pack storage/install 子系统，而不是 Express 路由本身。",
      "evidence": [
        {
          "path": "apps/server/src/index.ts",
          "lineStart": 89,
          "lineEnd": 161,
          "symbol": "appContext"
        },
        {
          "path": "apps/server/src/index.ts",
          "lineStart": 223,
          "lineEnd": 279,
          "symbol": "start"
        },
        {
          "path": "apps/server/src/app/create_app.ts",
          "lineStart": 13,
          "lineEnd": 24,
          "symbol": "createApp"
        },
        {
          "path": "apps/server/src/core/simulation.ts",
          "lineStart": 15,
          "lineEnd": 69,
          "symbol": "SimulationManager"
        },
        {
          "path": "apps/server/src/core/runtime_activation.ts",
          "lineStart": 76,
          "lineEnd": 103,
          "symbol": "activateWorldPackRuntime"
        },
        {
          "path": "apps/server/src/kernel/install/install_pack.ts",
          "lineStart": 13,
          "lineEnd": 26,
          "symbol": "installPackRuntime"
        },
        {
          "path": "apps/server/src/packs/storage/pack_storage_engine.ts",
          "lineStart": 84,
          "lineEnd": 107,
          "symbol": "PackStorageEngine.materializeStoragePlan"
        },
        {
          "path": "apps/server/src/app/runtime/simulation_loop.ts",
          "lineStart": 148,
          "lineEnd": 190,
          "symbol": "runIteration"
        }
      ],
      "reviewedModules": [
        "apps/server/src/index.ts",
        "apps/server/src/core/simulation.ts",
        "apps/server/src/core/runtime_activation.ts",
        "apps/server/src/kernel/install/install_pack.ts",
        "apps/server/src/packs/storage/pack_storage_engine.ts",
        "apps/server/src/app/runtime/simulation_loop.ts"
      ],
      "recommendedNextAction": "继续核对 API 合同、共享 contracts 与前端页面消费链路，确认架构图中的“前端 ⇄ API ⇄ shared contracts”是否在代码中闭合。",
      "findingIds": []
    },
    {
      "id": "M3",
      "title": "API 合同、共享 contracts 与前端消费链路核对",
      "status": "completed",
      "recordedAt": "2026-04-09T06:38:50.797Z",
      "summaryMarkdown": "已核对服务端路由、`packages/contracts` 与前端 API/composable 的闭环关系。当前后端在 `system`、`overview`、`scheduler` 等入口上，会先调用服务层生成 read model，再用 `@yidhras/contracts` 中的 Zod schema 做响应校验；前端则通过统一的 `requestApiData()` / `ApiEnvelope` 客户端访问这些接口，并在 `overview` 页面把 overview summary、scheduler operator projection、runtime status、clock、notifications 组合成操作台读模型。说明系统架构图中的“Web → API → Contracts”主干是成立的。",
      "conclusionMarkdown": "该项目的前后端连接方式不是页面直接拼装原始数据库对象，而是 **共享 envelope + 服务端 read model + 前端 composable 聚合** 的三段式读面架构；这也是系统架构图中最稳定的交互主轴。",
      "evidence": [
        {
          "path": "packages/contracts/src/envelope.ts",
          "lineStart": 32,
          "lineEnd": 49
        },
        {
          "path": "packages/contracts/src/system.ts",
          "lineStart": 44,
          "lineEnd": 87,
          "symbol": "runtimeStatusDataSchema"
        },
        {
          "path": "packages/contracts/src/projections.ts",
          "lineStart": 51,
          "lineEnd": 66,
          "symbol": "overviewSummaryDataSchema"
        },
        {
          "path": "apps/server/src/app/routes/system.ts",
          "lineStart": 18,
          "lineEnd": 49,
          "symbol": "registerSystemRoutes"
        },
        {
          "path": "apps/server/src/app/routes/overview.ts",
          "lineStart": 19,
          "lineEnd": 44,
          "symbol": "registerOverviewRoutes"
        },
        {
          "path": "apps/server/src/app/routes/scheduler.ts",
          "lineStart": 39,
          "lineEnd": 223,
          "symbol": "registerSchedulerRoutes"
        },
        {
          "path": "apps/server/src/app/services/scheduler_observability.ts",
          "lineStart": 1730,
          "lineEnd": 1807,
          "symbol": "getSchedulerOperatorProjection"
        },
        {
          "path": "apps/web/lib/http/client.ts",
          "lineStart": 129,
          "lineEnd": 197,
          "symbol": "requestApiData"
        },
        {
          "path": "apps/web/composables/app/useOperatorBootstrap.ts",
          "lineStart": 10,
          "lineEnd": 88,
          "symbol": "useOperatorBootstrap"
        },
        {
          "path": "apps/web/composables/api/useOverviewApi.ts",
          "lineStart": 17,
          "lineEnd": 35,
          "symbol": "OverviewSummarySnapshot"
        },
        {
          "path": "apps/web/composables/api/useSystemApi.ts",
          "lineStart": 86,
          "lineEnd": 99,
          "symbol": "useSystemApi"
        },
        {
          "path": "apps/web/composables/api/useSchedulerApi.ts",
          "lineStart": 487,
          "lineEnd": 577,
          "symbol": "useSchedulerApi"
        },
        {
          "path": "apps/web/features/overview/composables/useOverviewPage.ts",
          "lineStart": 15,
          "lineEnd": 114,
          "symbol": "useOverviewPage"
        },
        {
          "path": "apps/web/pages/overview.vue",
          "lineStart": 167,
          "lineEnd": 262,
          "symbol": "overviewPage"
        }
      ],
      "reviewedModules": [
        "packages/contracts/src/envelope.ts",
        "packages/contracts/src/system.ts",
        "packages/contracts/src/projections.ts",
        "apps/server/src/app/routes/system.ts",
        "apps/server/src/app/routes/overview.ts",
        "apps/server/src/app/routes/scheduler.ts",
        "apps/server/src/app/services/scheduler_observability.ts",
        "apps/web/lib/http/client.ts",
        "apps/web/composables/app/useOperatorBootstrap.ts",
        "apps/web/composables/api/useOverviewApi.ts",
        "apps/web/composables/api/useSystemApi.ts",
        "apps/web/composables/api/useSchedulerApi.ts",
        "apps/web/features/overview/composables/useOverviewPage.ts",
        "apps/web/pages/overview.vue"
      ],
      "recommendedNextAction": "继续收束对 inference/context/AI 子系统与 pack projection 约束的分析，给出更完整的系统架构图解释。",
      "findingIds": [
        "F-前端特性类型与共享-contracts-仍有局部镜像"
      ]
    },
    {
      "id": "M4",
      "title": "交互读面与智能执行子系统核对",
      "status": "completed",
      "recordedAt": "2026-04-09T06:40:14.337Z",
      "summaryMarkdown": "继续沿系统架构主干核对了两部分：一是 **前端读面链路**，二是 **Inference / Context / AI / Pack Projection** 子系统。前端通过统一的 `requestApiData()` + composables 拉取 `system`、`overview`、`scheduler` 等 read model，`overview` 页面再把 runtime status、notifications、overview summary、scheduler operator projection 聚合为工作台视图。后端侧则把 inference 组织为 `buildInferenceContext -> buildPromptBundle -> provider/gateway -> trace/job/action intent` 的执行链，其中 Context Service 负责从 memory/runtime/overlay 汇总 `ContextRun`，Orchestrator 负责线性片段编排；AI 执行链明确分为 `AiTaskService -> RouteResolver -> ModelGateway -> provider adapters`。与此同时，pack projection 通过 active-pack guard 保证 `/api/packs/:packId/*` 只访问当前 active pack，并将 pack runtime 数据与 kernel event bridge 聚合成 entity overview、timeline、operator overview 等只读投影。",
      "conclusionMarkdown": "综合来看，这个项目的系统架构图最适合画成五层：`Nuxt Operator UI` → `Express API / AppContext` → `Inference & Scheduler Kernel` → `World-Pack Runtime / Projection Layer` → `Kernel Prisma + Pack SQLite`。其中 AI、Context、Scheduler 都属于 kernel 内核能力；pack runtime 则负责世界实体、规则执行与投影素材，二者通过 event bridge 与 projection contract 汇合。",
      "evidence": [
        {
          "path": "apps/web/lib/http/client.ts",
          "lineStart": 129,
          "lineEnd": 197,
          "symbol": "requestApiData"
        },
        {
          "path": "apps/web/composables/app/useOperatorBootstrap.ts",
          "lineStart": 10,
          "lineEnd": 88,
          "symbol": "useOperatorBootstrap"
        },
        {
          "path": "apps/web/features/overview/composables/useOverviewPage.ts",
          "lineStart": 15,
          "lineEnd": 114,
          "symbol": "useOverviewPage"
        },
        {
          "path": "apps/web/pages/overview.vue",
          "lineStart": 167,
          "lineEnd": 262,
          "symbol": "overviewPage"
        },
        {
          "path": "apps/server/src/inference/context_builder.ts",
          "lineStart": 527,
          "lineEnd": 596,
          "symbol": "buildInferenceContext"
        },
        {
          "path": "apps/server/src/context/service.ts",
          "lineStart": 49,
          "lineEnd": 147,
          "symbol": "createContextService"
        },
        {
          "path": "apps/server/src/context/workflow/orchestrator.ts",
          "lineStart": 118,
          "lineEnd": 176,
          "symbol": "runContextOrchestrator"
        },
        {
          "path": "apps/server/src/inference/service.ts",
          "lineStart": 396,
          "lineEnd": 625,
          "symbol": "createInferenceService"
        },
        {
          "path": "apps/server/src/ai/task_service.ts",
          "lineStart": 91,
          "lineEnd": 142,
          "symbol": "createAiTaskService"
        },
        {
          "path": "apps/server/src/ai/route_resolver.ts",
          "lineStart": 196,
          "lineEnd": 227,
          "symbol": "resolveAiRoute"
        },
        {
          "path": "apps/server/src/ai/gateway.ts",
          "lineStart": 220,
          "lineEnd": 408,
          "symbol": "createModelGateway"
        },
        {
          "path": "apps/server/src/packs/runtime/projections/active_pack_projection_guard.ts",
          "lineStart": 10,
          "lineEnd": 52,
          "symbol": "resolvePackProjectionTarget"
        },
        {
          "path": "apps/server/src/kernel/projections/operator_overview_service.ts",
          "lineStart": 32,
          "lineEnd": 85,
          "symbol": "getOperatorOverviewProjection"
        },
        {
          "path": "apps/server/src/packs/runtime/projections/entity_overview_service.ts",
          "lineStart": 67,
          "lineEnd": 148,
          "symbol": "getPackEntityOverviewProjection"
        },
        {
          "path": "apps/server/src/packs/runtime/projections/narrative_projection_service.ts",
          "lineStart": 42,
          "lineEnd": 126,
          "symbol": "listPackNarrativeTimelineProjection"
        },
        {
          "path": "apps/server/src/packs/storage/pack_db_locator.ts",
          "lineStart": 22,
          "lineEnd": 52,
          "symbol": "resolvePackRuntimeDatabaseLocation"
        },
        {
          "path": "apps/server/src/app/services/operator_contracts.ts",
          "lineStart": 61,
          "lineEnd": 104,
          "symbol": "getOperatorAdvancedContracts"
        }
      ],
      "reviewedModules": [
        "apps/web/lib/http/client.ts",
        "apps/web/composables/app/useOperatorBootstrap.ts",
        "apps/web/features/overview/composables/useOverviewPage.ts",
        "apps/web/pages/overview.vue",
        "apps/server/src/inference/context_builder.ts",
        "apps/server/src/context/service.ts",
        "apps/server/src/context/workflow/orchestrator.ts",
        "apps/server/src/inference/service.ts",
        "apps/server/src/ai/task_service.ts",
        "apps/server/src/ai/route_resolver.ts",
        "apps/server/src/ai/gateway.ts",
        "apps/server/src/packs/runtime/projections/active_pack_projection_guard.ts",
        "apps/server/src/kernel/projections/operator_overview_service.ts",
        "apps/server/src/packs/runtime/projections/entity_overview_service.ts",
        "apps/server/src/packs/runtime/projections/narrative_projection_service.ts",
        "apps/server/src/packs/storage/pack_db_locator.ts",
        "apps/server/src/app/services/operator_contracts.ts"
      ],
      "recommendedNextAction": "整理为用户可读的系统架构图说明，明确五层结构、主数据流与边界约束。",
      "findingIds": [
        "F-前端特性类型与共享-contracts-仍有局部镜像-2"
      ]
    }
  ],
  "findings": [
    {
      "id": "F-前端特性类型与共享-contracts-仍有局部镜像",
      "severity": "low",
      "category": "maintainability",
      "title": "前端特性类型与共享 contracts 仍有局部镜像",
      "descriptionMarkdown": "虽然仓库有 `@yidhras/contracts` 作为统一接口层，且服务端路由也用其 schema 做响应校验，但前端在 `useOverviewApi`、`useSystemApi`、`useSchedulerApi` 等位置仍保留了不少本地接口定义与局部字段镜像。这样会让共享 contracts 在运行时边界上统一、但在前端编译期仍存在手工同步成本；一旦后端 read model 增删字段，前端未直接复用共享类型的部分更容易产生静态漂移。",
      "recommendationMarkdown": "如果希望系统架构图中的 `packages/contracts` 真正成为端到端单一事实源，可逐步把前端本地接口收敛到共享 schema 推导类型或共享 DTO 定义上。",
      "evidence": [
        {
          "path": "packages/contracts/src/system.ts",
          "lineStart": 44,
          "lineEnd": 61,
          "symbol": "runtimeStatusDataSchema"
        },
        {
          "path": "packages/contracts/src/projections.ts",
          "lineStart": 51,
          "lineEnd": 66,
          "symbol": "overviewSummaryDataSchema"
        },
        {
          "path": "apps/web/composables/api/useOverviewApi.ts",
          "lineStart": 17,
          "lineEnd": 35,
          "symbol": "OverviewSummarySnapshot"
        },
        {
          "path": "apps/web/composables/api/useSystemApi.ts",
          "lineStart": 39,
          "lineEnd": 48,
          "symbol": "RuntimeStatusSnapshot"
        },
        {
          "path": "apps/web/composables/api/useSchedulerApi.ts",
          "lineStart": 386,
          "lineEnd": 424,
          "symbol": "SchedulerOperatorProjection"
        },
        {
          "path": "packages/contracts/src/system.ts"
        },
        {
          "path": "packages/contracts/src/projections.ts"
        },
        {
          "path": "apps/web/composables/api/useOverviewApi.ts"
        },
        {
          "path": "apps/web/composables/api/useSystemApi.ts"
        },
        {
          "path": "apps/web/composables/api/useSchedulerApi.ts"
        }
      ],
      "relatedMilestoneIds": [
        "M3"
      ],
      "trackingStatus": "open"
    },
    {
      "id": "F-前端特性类型与共享-contracts-仍有局部镜像-2",
      "severity": "low",
      "category": "maintainability",
      "title": "前端特性类型与共享 contracts 仍有局部镜像",
      "descriptionMarkdown": "仓库已经用 `@yidhras/contracts` 统一了很多 API schema 与 envelope，但前端在 `useOverviewApi`、`useSystemApi`、`useSchedulerApi` 等位置仍保留了较多本地接口定义和字段镜像。运行时边界是统一的，编译期类型却并未完全共用，这会增加后端读模型演进时的同步成本。",
      "recommendationMarkdown": "若希望 `packages/contracts` 真正成为端到端单一事实源，可逐步让前端更多使用共享 schema 推导类型，减少本地 DTO 镜像。",
      "evidence": [
        {
          "path": "packages/contracts/src/system.ts",
          "lineStart": 44,
          "lineEnd": 61,
          "symbol": "runtimeStatusDataSchema"
        },
        {
          "path": "packages/contracts/src/projections.ts",
          "lineStart": 51,
          "lineEnd": 66,
          "symbol": "overviewSummaryDataSchema"
        },
        {
          "path": "apps/web/composables/api/useOverviewApi.ts",
          "lineStart": 17,
          "lineEnd": 35,
          "symbol": "OverviewSummarySnapshot"
        },
        {
          "path": "apps/web/composables/api/useSystemApi.ts",
          "lineStart": 39,
          "lineEnd": 48,
          "symbol": "RuntimeStatusSnapshot"
        },
        {
          "path": "apps/web/composables/api/useSchedulerApi.ts",
          "lineStart": 386,
          "lineEnd": 424,
          "symbol": "SchedulerOperatorProjection"
        },
        {
          "path": "packages/contracts/src/system.ts"
        },
        {
          "path": "packages/contracts/src/projections.ts"
        },
        {
          "path": "apps/web/composables/api/useOverviewApi.ts"
        },
        {
          "path": "apps/web/composables/api/useSystemApi.ts"
        },
        {
          "path": "apps/web/composables/api/useSchedulerApi.ts"
        }
      ],
      "relatedMilestoneIds": [
        "M4"
      ],
      "trackingStatus": "open"
    }
  ],
  "render": {
    "rendererVersion": 4,
    "bodyHash": "sha256:862343ae545882da833dbcdf25822ef4bf8022a8bb8468c07f176cfeff25c6a4",
    "generatedAt": "2026-04-09T06:40:41.340Z",
    "locale": "zh-CN"
  }
}
```
