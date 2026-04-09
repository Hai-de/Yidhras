# 项目系统架构分析
- 日期: 2026-04-08
- 概述: 针对 Yidhras 项目的系统架构与模块关系进行只读审查，重点关注文档中的架构图、目录分层与前后端/共享包协作方式。
- 状态: 已完成
- 总体结论: 通过

## 评审范围

# 项目系统架构分析

- 日期：2025-02-14
- 范围：项目整体系统架构、前后端分层、共享契约、文档与实现的一致性
- 方法：阅读架构文档、根目录说明、关键目录结构与代表性实现文件，形成增量式审查结论。

## 评审摘要

- 当前状态: 已完成
- 已审模块: workspace, server, web, contracts, server-entry, http-app, runtime-facade, route-contract-boundary, pack-runtime, kernel-storage, projection-layer, ownership-matrix, web-shell, web-runtime-store, web-api-composables, shared-contracts
- 当前进度: 已记录 5 个里程碑；最新：M5
- 里程碑总数: 5
- 已完成里程碑: 5
- 问题总数: 0
- 问题严重级别分布: 高 0 / 中 0 / 低 0
- 最新结论: 该项目的系统架构可以概括为：一个基于 pnpm monorepo 的“前端操作台 + 后端模拟内核 + world-pack runtime + 共享契约”系统。后端以 Express 作为 API 壳层，但核心并非普通 CRUD，而是围绕 `SimulationManager`、scheduler、inference workflow、action dispatcher 形成持续运行的模拟宿主；同时通过 kernel Prisma 与 pack-local runtime SQLite 组成双层数据边界，其中 kernel 持有通用工作流与共享证据桥，pack runtime 持有世界治理核心实体与规则执行记录。前端则是 CSR-only 的 operator shell，通过共享 contracts 与后端 read model API 对接，消费 runtime/status、overview、workflow、timeline 等投影，从而形成清晰的读写职责分离。整体上，文档中的 kernel + world-pack runtime 分层与当前实现基本一致，适合继续沿‘后端运行时演化、前端读模型扩展、contracts 统一边界’这一方向推进。
- 下一步建议: 建议后续把这套分析沉淀为正式架构图（容器图 + 运行时时序图 + 数据所有权图）并补充多 pack/动态 pack 场景的未来演进路径。
- 总体结论: 通过

## 评审发现

<!-- no findings -->

## 评审里程碑

### M1 · 确认仓库级系统边界与工作区分层

- 状态: 已完成
- 记录时间: 2026-04-08T07:09:29.108Z
- 已审模块: workspace, server, web, contracts
- 摘要:

  基于根目录说明、工作区配置与各子包清单，确认该项目采用 pnpm monorepo 组织方式，核心由 `apps/server`、`apps/web`、`packages/contracts` 三层组成。后端为 Express + Prisma + SQLite 宿主运行时，前端为 Nuxt 4 + Vue 3 操作台，共享契约包负责 transport/contract 定义；`docs/ARCH.md` 进一步给出了 kernel + world-pack runtime 的核心架构分层。
- 结论:

  仓库级结构清晰：前端、后端与共享契约通过 monorepo 汇聚，文档已明确系统的核心分层模型。
- 证据:
  - `README.md`
  - `docs/ARCH.md`
  - `pnpm-workspace.yaml`
  - `package.json`
  - `apps/server/package.json`
  - `apps/web/package.json`
  - `packages/contracts/package.json`
- 下一步建议:

  继续检查服务端源码中的运行时激活、API 装配与 world-pack runtime 落点，确认文档架构与实现之间的映射关系。

### M2 · 确认服务端启动装配、运行时主循环与 API 边界

- 状态: 已完成
- 记录时间: 2026-04-08T07:10:55.058Z
- 已审模块: server-entry, http-app, runtime-facade, route-contract-boundary
- 摘要:

  通过 `apps/server/src/index.ts`、`create_app.ts`、`context.ts`、`simulation.ts`、`runtime_activation.ts` 与代表性路由文件可以确认：服务端以 Express 为 HTTP 宿主，以 `SimulationManager` 为 runtime facade，在启动阶段完成数据库准备、world-pack 选择、runtime activation、scheduler 引导与模拟主循环启动。路由层统一通过 `AppContext` 访问运行时、通知和健康状态；各 API 在边界处直接使用 `@yidhras/contracts` 的 Zod schema 校验输入/输出。
- 结论:

  后端不是传统 CRUD 服务，而是“HTTP 外壳 + 模拟运行时 + 调度/推理工作流”的宿主系统；入口清晰，运行态控制集中在启动器与 `SimulationManager` façade 上。
- 证据:
  - `apps/server/src/index.ts:43-279`
  - `apps/server/src/app/create_app.ts:13-23`
  - `apps/server/src/app/context.ts:43-58`
  - `apps/server/src/core/simulation.ts:15-125#SimulationManager`
  - `apps/server/src/core/runtime_activation.ts:76-103#activateWorldPackRuntime`
  - `apps/server/src/app/routes/system.ts:18-50#registerSystemRoutes`
  - `apps/server/src/app/routes/overview.ts:19-44#registerOverviewRoutes`
- 下一步建议:

  继续下钻 pack runtime 的安装/物化路径与内核数据库所有权矩阵，补全双层存储与治理边界图。

### M3 · 确认服务端启动装配、运行时主循环与 API 边界

- 状态: 已完成
- 记录时间: 2026-04-08T07:11:20.701Z
- 已审模块: server-entry, http-app, runtime-facade, route-contract-boundary
- 摘要:

  通过 `apps/server/src/index.ts`、`create_app.ts`、`context.ts`、`simulation.ts`、`runtime_activation.ts` 与代表性路由文件可以确认：服务端以 Express 为 HTTP 宿主，以 `SimulationManager` 为 runtime facade，在启动阶段完成数据库准备、world-pack 选择、runtime activation、scheduler 引导与模拟主循环启动。路由层统一通过 `AppContext` 访问运行时、通知和健康状态；各 API 在边界处直接使用共享 contracts 包中的 Zod schema 做输入/输出校验。
- 结论:

  后端不是传统 CRUD 服务，而是“HTTP 外壳 + 模拟运行时 + 调度/推理工作流”的宿主系统；入口清晰，运行态控制集中在启动器与 `SimulationManager` facade 上。
- 证据:
  - `apps/server/src/index.ts:43-279`
  - `apps/server/src/app/create_app.ts:13-23`
  - `apps/server/src/app/context.ts:43-58`
  - `apps/server/src/core/simulation.ts:15-125#SimulationManager`
  - `apps/server/src/core/runtime_activation.ts:76-103#activateWorldPackRuntime`
  - `apps/server/src/app/routes/system.ts:18-50#registerSystemRoutes`
  - `apps/server/src/app/routes/overview.ts:19-44#registerOverviewRoutes`
- 下一步建议:

  继续下钻 pack runtime 的安装与投影路径，以及前端如何经共享 contracts 消费这些 read model。

### M4 · 确认 kernel 与 world-pack runtime 的双层存储/投影边界

- 状态: 已完成
- 记录时间: 2026-04-08T07:12:33.399Z
- 已审模块: pack-runtime, kernel-storage, projection-layer, ownership-matrix
- 摘要:

  结合架构文档与实现可确认：项目采用 kernel Prisma + pack-local runtime SQLite 的双层运行时。启动激活时先解析 pack manifest，再安装 pack runtime 存储计划、物化 engine-owned 世界治理表，并在投影阶段通过 active-pack guard 将 pack 级 overview / timeline 约束到当前激活的单一 pack。Prisma schema 中的 `Post / Event / ActionIntent / InferenceTrace / DecisionJob / scheduler*` 等仍由 kernel 持有，而 pack runtime 侧承载世界实体、状态、authority、mediator 与 rule execution 记录。
- 结论:

  `docs/ARCH.md` 描述的 ownership matrix 与源码实现基本一致：内核负责通用工作流与共享证据桥，pack runtime 负责世界治理核心数据，并通过 projection 服务回流到 API 面。
- 证据:
  - `docs/ARCH.md:12-70`
  - `apps/server/src/kernel/install/install_pack.ts:13-25#installPackRuntime`
  - `apps/server/src/packs/storage/pack_storage_engine.ts:84-107#PackStorageEngine`
  - `apps/server/src/packs/runtime/materializer.ts:58-223#materializePackRuntimeCoreModels`
  - `apps/server/src/packs/runtime/projections/active_pack_projection_guard.ts:10-52#resolvePackProjectionTarget`
  - `apps/server/src/packs/runtime/projections/entity_overview_service.ts:67-148#getPackEntityOverviewProjection`
  - `apps/server/src/packs/runtime/projections/narrative_projection_service.ts:42-126#listPackNarrativeTimelineProjection`
  - `apps/server/prisma/schema.prisma:134-171`
  - `apps/server/prisma/schema.prisma:237-467`
- 下一步建议:

  最后检查前端 operator 壳层如何消费 runtime/status、overview、workflow 与 timeline 投影，以便补全完整的系统交互图。

### M5 · 确认前端 operator 壳层与后端 read model 的对接方式

- 状态: 已完成
- 记录时间: 2026-04-08T07:12:55.612Z
- 已审模块: web-shell, web-runtime-store, web-api-composables, shared-contracts
- 摘要:

  前端 `apps/web` 是一个 CSR-only 的操作台应用，入口为 `app.vue -> default layout -> AppShell`。启动后通过 `useOperatorBootstrap` 轮询 `/api/status`、`/api/clock/formatted` 与通知接口，将运行态装入 Pinia store；业务页面再经 composables 读取 overview、workflow、timeline 等 API。共享 contracts 在前后端同时参与 envelope/schema/时间字段等语义约束，因此形成了“contracts -> server routes -> web composables/store -> shell/workspace UI”的完整读模型链路。
- 结论:

  前端并非直接耦合数据库或服务内部模型，而是围绕 operator shell 消费后端投影与运行态快照；这使系统整体呈现出清晰的‘模拟内核/pack runtime 在后端，操作台读模型在前端’的分离结构。
- 证据:
  - `apps/web/README.md:3-22`
  - `apps/web/nuxt.config.ts:21-39`
  - `apps/web/app.vue:1-13`
  - `apps/web/layouts/default.vue:1-11`
  - `apps/web/features/shell/components/AppShell.vue:18-23`
  - `apps/web/features/shell/components/AppShell.vue:595-801`
  - `apps/web/composables/app/useOperatorBootstrap.ts:10-88`
  - `apps/web/stores/runtime.ts:26-89`
  - `apps/web/composables/api/useSystemApi.ts:86-99`
  - `apps/web/composables/api/useOverviewApi.ts:32-35`
  - `apps/web/composables/api/useWorkflowApi.ts:219-236`
  - `apps/web/composables/api/useTimelineApi.ts:24-28`
  - `packages/contracts/src/system.ts:44-87`
  - `packages/contracts/src/projections.ts:51-149`
- 下一步建议:

  收束整体结论，输出适合阅读的系统架构图说明与建议。

## 最终结论

该项目的系统架构可以概括为：一个基于 pnpm monorepo 的“前端操作台 + 后端模拟内核 + world-pack runtime + 共享契约”系统。后端以 Express 作为 API 壳层，但核心并非普通 CRUD，而是围绕 `SimulationManager`、scheduler、inference workflow、action dispatcher 形成持续运行的模拟宿主；同时通过 kernel Prisma 与 pack-local runtime SQLite 组成双层数据边界，其中 kernel 持有通用工作流与共享证据桥，pack runtime 持有世界治理核心实体与规则执行记录。前端则是 CSR-only 的 operator shell，通过共享 contracts 与后端 read model API 对接，消费 runtime/status、overview、workflow、timeline 等投影，从而形成清晰的读写职责分离。整体上，文档中的 kernel + world-pack runtime 分层与当前实现基本一致，适合继续沿‘后端运行时演化、前端读模型扩展、contracts 统一边界’这一方向推进。

## 评审快照

```json
{
  "formatVersion": 4,
  "kind": "limcode.review",
  "reviewRunId": "review-mnppiwxy-q4lhg2",
  "createdAt": "2026-04-08T00:00:00.000Z",
  "updatedAt": "2026-04-08T07:13:12.339Z",
  "finalizedAt": "2026-04-08T07:13:12.339Z",
  "status": "completed",
  "overallDecision": "accepted",
  "header": {
    "title": "项目系统架构分析",
    "date": "2026-04-08",
    "overview": "针对 Yidhras 项目的系统架构与模块关系进行只读审查，重点关注文档中的架构图、目录分层与前后端/共享包协作方式。"
  },
  "scope": {
    "markdown": "# 项目系统架构分析\n\n- 日期：2025-02-14\n- 范围：项目整体系统架构、前后端分层、共享契约、文档与实现的一致性\n- 方法：阅读架构文档、根目录说明、关键目录结构与代表性实现文件，形成增量式审查结论。"
  },
  "summary": {
    "latestConclusion": "该项目的系统架构可以概括为：一个基于 pnpm monorepo 的“前端操作台 + 后端模拟内核 + world-pack runtime + 共享契约”系统。后端以 Express 作为 API 壳层，但核心并非普通 CRUD，而是围绕 `SimulationManager`、scheduler、inference workflow、action dispatcher 形成持续运行的模拟宿主；同时通过 kernel Prisma 与 pack-local runtime SQLite 组成双层数据边界，其中 kernel 持有通用工作流与共享证据桥，pack runtime 持有世界治理核心实体与规则执行记录。前端则是 CSR-only 的 operator shell，通过共享 contracts 与后端 read model API 对接，消费 runtime/status、overview、workflow、timeline 等投影，从而形成清晰的读写职责分离。整体上，文档中的 kernel + world-pack runtime 分层与当前实现基本一致，适合继续沿‘后端运行时演化、前端读模型扩展、contracts 统一边界’这一方向推进。",
    "recommendedNextAction": "建议后续把这套分析沉淀为正式架构图（容器图 + 运行时时序图 + 数据所有权图）并补充多 pack/动态 pack 场景的未来演进路径。",
    "reviewedModules": [
      "workspace",
      "server",
      "web",
      "contracts",
      "server-entry",
      "http-app",
      "runtime-facade",
      "route-contract-boundary",
      "pack-runtime",
      "kernel-storage",
      "projection-layer",
      "ownership-matrix",
      "web-shell",
      "web-runtime-store",
      "web-api-composables",
      "shared-contracts"
    ]
  },
  "stats": {
    "totalMilestones": 5,
    "completedMilestones": 5,
    "totalFindings": 0,
    "severity": {
      "high": 0,
      "medium": 0,
      "low": 0
    }
  },
  "milestones": [
    {
      "id": "M1",
      "title": "确认仓库级系统边界与工作区分层",
      "status": "completed",
      "recordedAt": "2026-04-08T07:09:29.108Z",
      "summaryMarkdown": "基于根目录说明、工作区配置与各子包清单，确认该项目采用 pnpm monorepo 组织方式，核心由 `apps/server`、`apps/web`、`packages/contracts` 三层组成。后端为 Express + Prisma + SQLite 宿主运行时，前端为 Nuxt 4 + Vue 3 操作台，共享契约包负责 transport/contract 定义；`docs/ARCH.md` 进一步给出了 kernel + world-pack runtime 的核心架构分层。",
      "conclusionMarkdown": "仓库级结构清晰：前端、后端与共享契约通过 monorepo 汇聚，文档已明确系统的核心分层模型。",
      "evidence": [
        {
          "path": "README.md"
        },
        {
          "path": "docs/ARCH.md"
        },
        {
          "path": "pnpm-workspace.yaml"
        },
        {
          "path": "package.json"
        },
        {
          "path": "apps/server/package.json"
        },
        {
          "path": "apps/web/package.json"
        },
        {
          "path": "packages/contracts/package.json"
        }
      ],
      "reviewedModules": [
        "workspace",
        "server",
        "web",
        "contracts"
      ],
      "recommendedNextAction": "继续检查服务端源码中的运行时激活、API 装配与 world-pack runtime 落点，确认文档架构与实现之间的映射关系。",
      "findingIds": []
    },
    {
      "id": "M2",
      "title": "确认服务端启动装配、运行时主循环与 API 边界",
      "status": "completed",
      "recordedAt": "2026-04-08T07:10:55.058Z",
      "summaryMarkdown": "通过 `apps/server/src/index.ts`、`create_app.ts`、`context.ts`、`simulation.ts`、`runtime_activation.ts` 与代表性路由文件可以确认：服务端以 Express 为 HTTP 宿主，以 `SimulationManager` 为 runtime facade，在启动阶段完成数据库准备、world-pack 选择、runtime activation、scheduler 引导与模拟主循环启动。路由层统一通过 `AppContext` 访问运行时、通知和健康状态；各 API 在边界处直接使用 `@yidhras/contracts` 的 Zod schema 校验输入/输出。",
      "conclusionMarkdown": "后端不是传统 CRUD 服务，而是“HTTP 外壳 + 模拟运行时 + 调度/推理工作流”的宿主系统；入口清晰，运行态控制集中在启动器与 `SimulationManager` façade 上。",
      "evidence": [
        {
          "path": "apps/server/src/index.ts",
          "lineStart": 43,
          "lineEnd": 279
        },
        {
          "path": "apps/server/src/app/create_app.ts",
          "lineStart": 13,
          "lineEnd": 23
        },
        {
          "path": "apps/server/src/app/context.ts",
          "lineStart": 43,
          "lineEnd": 58
        },
        {
          "path": "apps/server/src/core/simulation.ts",
          "lineStart": 15,
          "lineEnd": 125,
          "symbol": "SimulationManager"
        },
        {
          "path": "apps/server/src/core/runtime_activation.ts",
          "lineStart": 76,
          "lineEnd": 103,
          "symbol": "activateWorldPackRuntime"
        },
        {
          "path": "apps/server/src/app/routes/system.ts",
          "lineStart": 18,
          "lineEnd": 50,
          "symbol": "registerSystemRoutes"
        },
        {
          "path": "apps/server/src/app/routes/overview.ts",
          "lineStart": 19,
          "lineEnd": 44,
          "symbol": "registerOverviewRoutes"
        }
      ],
      "reviewedModules": [
        "server-entry",
        "http-app",
        "runtime-facade",
        "route-contract-boundary"
      ],
      "recommendedNextAction": "继续下钻 pack runtime 的安装/物化路径与内核数据库所有权矩阵，补全双层存储与治理边界图。",
      "findingIds": []
    },
    {
      "id": "M3",
      "title": "确认服务端启动装配、运行时主循环与 API 边界",
      "status": "completed",
      "recordedAt": "2026-04-08T07:11:20.701Z",
      "summaryMarkdown": "通过 `apps/server/src/index.ts`、`create_app.ts`、`context.ts`、`simulation.ts`、`runtime_activation.ts` 与代表性路由文件可以确认：服务端以 Express 为 HTTP 宿主，以 `SimulationManager` 为 runtime facade，在启动阶段完成数据库准备、world-pack 选择、runtime activation、scheduler 引导与模拟主循环启动。路由层统一通过 `AppContext` 访问运行时、通知和健康状态；各 API 在边界处直接使用共享 contracts 包中的 Zod schema 做输入/输出校验。",
      "conclusionMarkdown": "后端不是传统 CRUD 服务，而是“HTTP 外壳 + 模拟运行时 + 调度/推理工作流”的宿主系统；入口清晰，运行态控制集中在启动器与 `SimulationManager` facade 上。",
      "evidence": [
        {
          "path": "apps/server/src/index.ts",
          "lineStart": 43,
          "lineEnd": 279
        },
        {
          "path": "apps/server/src/app/create_app.ts",
          "lineStart": 13,
          "lineEnd": 23
        },
        {
          "path": "apps/server/src/app/context.ts",
          "lineStart": 43,
          "lineEnd": 58
        },
        {
          "path": "apps/server/src/core/simulation.ts",
          "lineStart": 15,
          "lineEnd": 125,
          "symbol": "SimulationManager"
        },
        {
          "path": "apps/server/src/core/runtime_activation.ts",
          "lineStart": 76,
          "lineEnd": 103,
          "symbol": "activateWorldPackRuntime"
        },
        {
          "path": "apps/server/src/app/routes/system.ts",
          "lineStart": 18,
          "lineEnd": 50,
          "symbol": "registerSystemRoutes"
        },
        {
          "path": "apps/server/src/app/routes/overview.ts",
          "lineStart": 19,
          "lineEnd": 44,
          "symbol": "registerOverviewRoutes"
        }
      ],
      "reviewedModules": [
        "server-entry",
        "http-app",
        "runtime-facade",
        "route-contract-boundary"
      ],
      "recommendedNextAction": "继续下钻 pack runtime 的安装与投影路径，以及前端如何经共享 contracts 消费这些 read model。",
      "findingIds": []
    },
    {
      "id": "M4",
      "title": "确认 kernel 与 world-pack runtime 的双层存储/投影边界",
      "status": "completed",
      "recordedAt": "2026-04-08T07:12:33.399Z",
      "summaryMarkdown": "结合架构文档与实现可确认：项目采用 kernel Prisma + pack-local runtime SQLite 的双层运行时。启动激活时先解析 pack manifest，再安装 pack runtime 存储计划、物化 engine-owned 世界治理表，并在投影阶段通过 active-pack guard 将 pack 级 overview / timeline 约束到当前激活的单一 pack。Prisma schema 中的 `Post / Event / ActionIntent / InferenceTrace / DecisionJob / scheduler*` 等仍由 kernel 持有，而 pack runtime 侧承载世界实体、状态、authority、mediator 与 rule execution 记录。",
      "conclusionMarkdown": "`docs/ARCH.md` 描述的 ownership matrix 与源码实现基本一致：内核负责通用工作流与共享证据桥，pack runtime 负责世界治理核心数据，并通过 projection 服务回流到 API 面。",
      "evidence": [
        {
          "path": "docs/ARCH.md",
          "lineStart": 12,
          "lineEnd": 70
        },
        {
          "path": "apps/server/src/kernel/install/install_pack.ts",
          "lineStart": 13,
          "lineEnd": 25,
          "symbol": "installPackRuntime"
        },
        {
          "path": "apps/server/src/packs/storage/pack_storage_engine.ts",
          "lineStart": 84,
          "lineEnd": 107,
          "symbol": "PackStorageEngine"
        },
        {
          "path": "apps/server/src/packs/runtime/materializer.ts",
          "lineStart": 58,
          "lineEnd": 223,
          "symbol": "materializePackRuntimeCoreModels"
        },
        {
          "path": "apps/server/src/packs/runtime/projections/active_pack_projection_guard.ts",
          "lineStart": 10,
          "lineEnd": 52,
          "symbol": "resolvePackProjectionTarget"
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
          "path": "apps/server/prisma/schema.prisma",
          "lineStart": 134,
          "lineEnd": 171
        },
        {
          "path": "apps/server/prisma/schema.prisma",
          "lineStart": 237,
          "lineEnd": 467
        }
      ],
      "reviewedModules": [
        "pack-runtime",
        "kernel-storage",
        "projection-layer",
        "ownership-matrix"
      ],
      "recommendedNextAction": "最后检查前端 operator 壳层如何消费 runtime/status、overview、workflow 与 timeline 投影，以便补全完整的系统交互图。",
      "findingIds": []
    },
    {
      "id": "M5",
      "title": "确认前端 operator 壳层与后端 read model 的对接方式",
      "status": "completed",
      "recordedAt": "2026-04-08T07:12:55.612Z",
      "summaryMarkdown": "前端 `apps/web` 是一个 CSR-only 的操作台应用，入口为 `app.vue -> default layout -> AppShell`。启动后通过 `useOperatorBootstrap` 轮询 `/api/status`、`/api/clock/formatted` 与通知接口，将运行态装入 Pinia store；业务页面再经 composables 读取 overview、workflow、timeline 等 API。共享 contracts 在前后端同时参与 envelope/schema/时间字段等语义约束，因此形成了“contracts -> server routes -> web composables/store -> shell/workspace UI”的完整读模型链路。",
      "conclusionMarkdown": "前端并非直接耦合数据库或服务内部模型，而是围绕 operator shell 消费后端投影与运行态快照；这使系统整体呈现出清晰的‘模拟内核/pack runtime 在后端，操作台读模型在前端’的分离结构。",
      "evidence": [
        {
          "path": "apps/web/README.md",
          "lineStart": 3,
          "lineEnd": 22
        },
        {
          "path": "apps/web/nuxt.config.ts",
          "lineStart": 21,
          "lineEnd": 39
        },
        {
          "path": "apps/web/app.vue",
          "lineStart": 1,
          "lineEnd": 13
        },
        {
          "path": "apps/web/layouts/default.vue",
          "lineStart": 1,
          "lineEnd": 11
        },
        {
          "path": "apps/web/features/shell/components/AppShell.vue",
          "lineStart": 18,
          "lineEnd": 23
        },
        {
          "path": "apps/web/features/shell/components/AppShell.vue",
          "lineStart": 595,
          "lineEnd": 801
        },
        {
          "path": "apps/web/composables/app/useOperatorBootstrap.ts",
          "lineStart": 10,
          "lineEnd": 88
        },
        {
          "path": "apps/web/stores/runtime.ts",
          "lineStart": 26,
          "lineEnd": 89
        },
        {
          "path": "apps/web/composables/api/useSystemApi.ts",
          "lineStart": 86,
          "lineEnd": 99
        },
        {
          "path": "apps/web/composables/api/useOverviewApi.ts",
          "lineStart": 32,
          "lineEnd": 35
        },
        {
          "path": "apps/web/composables/api/useWorkflowApi.ts",
          "lineStart": 219,
          "lineEnd": 236
        },
        {
          "path": "apps/web/composables/api/useTimelineApi.ts",
          "lineStart": 24,
          "lineEnd": 28
        },
        {
          "path": "packages/contracts/src/system.ts",
          "lineStart": 44,
          "lineEnd": 87
        },
        {
          "path": "packages/contracts/src/projections.ts",
          "lineStart": 51,
          "lineEnd": 149
        }
      ],
      "reviewedModules": [
        "web-shell",
        "web-runtime-store",
        "web-api-composables",
        "shared-contracts"
      ],
      "recommendedNextAction": "收束整体结论，输出适合阅读的系统架构图说明与建议。",
      "findingIds": []
    }
  ],
  "findings": [],
  "render": {
    "rendererVersion": 4,
    "bodyHash": "sha256:3faa0364d957d38842bfa1dbc8e647afcea3dbea6013ccbde4f890b80bb19e71",
    "generatedAt": "2026-04-08T07:13:12.339Z",
    "locale": "zh-CN"
  }
}
```
