# Architecture Overview / 架构概览

本文件记录当前稳定的模块边界与实现约束，不记录阶段叙事。

## 1. Application Layers / 应用层次

### Server / 服务端

- `apps/server/src/index.ts` 是组合根，负责启动流程、运行时装配与路由注册。
- `apps/server/src/app/create_app.ts` 负责组装 Express、中间件与路由注册。
- `apps/server/src/app/routes/*.ts` 负责 transport 层，保持轻量。
- `apps/server/src/app/services/*.ts` 负责读模型组装与应用层编排。
- `apps/server/src/app/runtime/*.ts` 负责 runtime loop、scheduler、job runner、dispatcher、lease、ownership 与 rebalance。

### Web / 前端

- `apps/web/pages/*.vue` 负责页面级入口。
- `apps/web/features/**` 负责功能模块、适配器、composable 与页面组件。
- 页面定位与过滤状态优先使用 route-backed state；store 主要承载 fetch state 和临时 UI state。

### Contracts / 契约层

- `packages/contracts` 负责共享 envelope 类型与 transport-boundary schema。
- 共享契约面向接口边界稳定性，而不是覆盖所有内部领域模型。

## 2. Backend Composition / 后端组合方式

### Runtime core

- `SimulationManager`（`apps/server/src/core/simulation.ts`）负责：
  - Prisma 初始化
  - SQLite runtime pragma 初始化
  - world-pack 加载
  - 时钟初始化与推进
  - narrative resolver 初始化
  - dynamics manager 初始化
  - runtime speed 访问
  - graph 数据访问
- `SimulationManager` 是 runtime 组合对象，不应继续承担无关的查询编排或应用层便捷逻辑。
- 新的查询/编排逻辑优先放到 `app/services/` 或聚焦的 `core/` 模块中。

### Stable app-level constraints

- `requestIdMiddleware()` 负责 `X-Request-Id` 与统一错误包络的 request id 对齐。
- `AppContext.assertRuntimeReady(feature)` 负责 world-pack 依赖接口的 readiness gate。
- inference 与 audit 相关扩展应继续沿现有 route/service 边界演进，而不是在路由内直接堆叠临时逻辑。

## 3. Workflow / Inference Structure / 工作流与推理结构

- `apps/server/src/app/services/inference_workflow.ts` 是 facade / export surface。
- 子模块职责如下：
  - `parsers.ts`：输入解析与归一化
  - `repository.ts`：持久化读写、锁语义、调度信号查询
  - `snapshots.ts`：纯快照推导
  - `results.ts`：submit / retry / replay 结果组装
  - `workflow_query.ts`：列表、详情与聚合工作流查询
- 设计约束：
  - decision generation、workflow persistence、action dispatch 保持分层
  - route handler 保持轻量
  - 结果形状对外保持稳定

### Workflow semantics

- `DecisionJob.intent_class` 作为顶层工作流分类，当前包含：
  - `direct_inference`
  - `scheduler_periodic`
  - `scheduler_event_followup`
  - `replay_recovery`
  - `retry_recovery`
- `request_input.attributes.job_intent_class` 与 `job_source` 保留原始入口上下文，适合 trace / audit / debug。
- retry 当前复用同一条 `DecisionJob` 记录；reset 后会刷新 `intent_class` 与 `job_source` 相关字段，再重新 claim 执行。

## 4. Scheduler Runtime / 调度运行时

- Scheduler 是 partition-aware、多 worker 的运行时结构。
- `SchedulerLease` 与 `SchedulerCursor` 按 partition 持久化。
- `apps/server/src/app/runtime/agent_scheduler.ts` 负责 candidate 组装、actor readiness 判断、lease / ownership guard 与 run snapshot 写入。
- `apps/server/src/app/runtime/scheduler_lease.ts` 负责 partition-scoped lease / cursor 的读写与竞争处理。
- `apps/server/src/app/services/inference_workflow/repository.ts` 为调度器提供带 tick 的 signal / recovery 查询。

### Scheduler semantics

- `last_signal_tick` 表示该 partition 最近观测到的 signal / recovery watermark，而不是简单等于当前调度时刻。
- recovery window suppression 会区分 periodic 与 event-driven 候选。
- `event_followup` 为高优先级 followup；relationship / snr followup 属于较低优先级 followup。
- skip taxonomy 显式区分：
  - `replay_window_periodic_suppressed`
  - `replay_window_event_suppressed`
  - `retry_window_periodic_suppressed`
  - `retry_window_event_suppressed`
- `event_coalesced` 仅用于 summary/read-model 聚合，不伪装成 candidate-level `skipped_reason`。

## 5. Runtime Stability / 运行稳定性约束

- `apps/server/src/app/runtime/simulation_loop.ts` 使用串行 `setTimeout` 调度，而不是可重入的 `setInterval(async ...)`。
- runtime loop diagnostics 通过 `AppContext` 保持，并可由 `/api/status` 读取。
- SQLite runtime pragmas 在 `SimulationManager.prepareDatabase()` 中统一应用。
- development 启动时可通过 `resetDevelopmentRuntimeState()` 清理易膨胀的 runtime 表。

## 6. Runtime Config / 运行时配置

- 运行时配置由 `apps/server/src/config/runtime_config.ts` 统一加载。
- 版本管理中的模板位于 `apps/server/templates/**`，启动时 materialize 到 `data/configw/**`。
- 配置覆盖顺序为：
  1. 代码内置默认值
  2. `data/configw/default.yaml`
  3. `data/configw/{APP_ENV}.yaml`
  4. `data/configw/local.yaml`
  5. 环境变量
- 初始化职责拆分为：
  - `init:configw`：配置模板 scaffold
  - `init:world-pack`：默认 world pack bootstrap
  - `init:runtime`：组合初始化入口

## 7. World Packs / 世界包

- World pack 通过 `apps/server/src/world/loader.ts` 进行文件驱动加载。
- World pack schema 位于 `apps/server/src/world/schema.ts`，当前支持：
  - `scenario`
  - `event_templates`
  - `actions`
  - `decision_rules`
- `apps/server/src/world/materializer.ts` 负责将 scenario 中的 agents / identities / bindings / relationships / artifacts / world state 幂等写入数据库。
- `apps/server/src/inference/context_builder.ts` 会注入 pack runtime/state；`apps/server/src/inference/pack_rules.ts` 负责 pack decision rule 的评估。
- `apps/server/src/app/services/action_dispatcher.ts` 支持 pack action registry；当前内置 executor 包含：
  - `claim_artifact`
  - `set_actor_state`
  - `emit_event`

## 8. Frontend Structure / 前端结构

- Graph 页面位于 `apps/web/features/graph/*`，渲染路径为 `ClientOnly + GraphCanvas + Cytoscape`。
- 主题解析与应用位于 `apps/web/plugins/theme.ts` 与 `apps/web/lib/theme/*`。
- 共享语义 UI 位于 `apps/web/components/ui/*`。
- Shell 与工作区骨架位于 `apps/web/features/shell/*` 与 `apps/web/features/shared/*`。
