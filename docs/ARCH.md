# Architecture Overview / 架构概览

This document summarizes the current high-level architecture and the most important module boundaries for Yidhras.

## 1. Runtime Layers / 运行时层次

### 1.1 Server App Layer / 服务端应用层

- `apps/server/src/index.ts` is the composition root.
- `apps/server/src/app/create_app.ts` wires Express routes, middleware, and application services.
- `apps/server/src/app/routes/*.ts` define transport-level endpoints and should remain thin.
- `apps/server/src/app/services/*.ts` host read-model assembly and operator-facing orchestration.

### 1.2 Web App Layer / 前端应用层

- `apps/web/pages/*.vue` compose page-level views.
- `apps/web/features/**` contain route-state, adapters, composables, and page widgets.
- URL-backed state should prefer `route.ts` as the authoritative source; stores should primarily keep fetch state or ephemeral UI state.

### 1.3 Contracts / 契约层

- `packages/contracts` currently focuses on query/input schemas and shared envelope types.
- High-value response schemas are a future direction, not a requirement for every current service refactor.

---

## 2. Workflow / 推理工作流

### 2.1 Current Structure / 当前结构

- `apps/server/src/app/services/inference_workflow.ts` is now a facade/export surface.
- `apps/server/src/app/services/inference_workflow/parsers.ts` owns parse/normalize responsibilities.
- `apps/server/src/app/services/inference_workflow/repository.ts` owns persistence reads/writes and lock semantics.
- `apps/server/src/app/services/inference_workflow/snapshots.ts` owns pure snapshot derivation.
- `apps/server/src/app/services/inference_workflow/results.ts` owns submit/retry/replay result assembly.
- `apps/server/src/app/services/inference_workflow/workflow_query.ts` owns workflow query assembly and list/detail snapshot composition.

### 2.2 Current Guardrails / 当前护栏

- Parser-layer Zod usage is intentionally limited to high-risk parse/normalize boundaries.
- Result shapes are kept stable while internal responsibilities are being separated.
- Query assembly should continue to live outside the facade file.

### 2.3 Workflow Semantics Layer / 工作流语义分层

- `DecisionJob.intent_class` 现已作为 workflow semantics 的稳定顶层分类层，用于区分：
  - `direct_inference`
  - `scheduler_periodic`
  - `scheduler_event_followup`
  - `replay_recovery`
  - `retry_recovery`
- `request_input.attributes.job_intent_class` / `job_source` 继续保留为原始工作流上下文字段，适合 trace / audit / debug 场景直接消费。
- 两层语义应保持分工：`intent_class` 用于正式过滤、索引、read model 投影；`job_source` 与 `job_intent_class` 用于保留入口上下文与原始 source label。
- 当前 retry 采用“复用同一 `DecisionJob` 记录”的实现模型，而不是新建 retry child job；reset 后会刷新顶层 `intent_class` 与 `request_input.attributes.job_intent_class / job_source`，并重新 claim 执行。

---

## 3. Relational Read Models / 关系图读模型

- `relational.ts` is now a thin export surface.
- `relational/graph_filters.ts`, `graph_traversal.ts`, `graph_projection.ts`, `queries.ts`, and `types.ts` hold distinct graph/query responsibilities.
- Graph remains the route-first frontend pilot for URL state vs snapshot state separation.

---

## 4. Simulation Core / 模拟核心

### 4.1 Current Boundary / 当前边界

- `SimulationManager` (`apps/server/src/core/simulation.ts`) still orchestrates:
  - Prisma initialization
  - world-pack loading
  - clock initialization and tick advancement
  - narrative resolver setup
  - dynamics manager setup
  - runtime speed access
  - graph data access
- Runtime step loop remains the entry for tick advancement and runtime-side workflow consumption.

### 4.2 Stop-Growth Rule / 止血规则

`SimulationManager` is **not** the default place for new runtime-side responsibilities anymore.

Do not add new responsibilities there for:

- operator read-model assembly
- new service orchestration logic
- new graph/query-specific aggregation
- unrelated app-layer convenience APIs

### 4.3 Preferred Extension Points / 优先扩展落点

When new runtime or graph functionality is needed, prefer:

- dedicated provider/service modules under `apps/server/src/core/` or `apps/server/src/app/services/`
- pure read-model helpers for query assembly
- existing focused modules such as:
  - `runtime_speed.ts`
  - `graph_data.ts`
  - app-level service/query modules

### 4.4 Practical Rule for Ongoing Refactors / 本轮重构的实际约束

During ongoing workflow/relational hardening:

- if a feature only needs graph snapshot data, extend graph-focused providers/helpers rather than `SimulationManager`
- if a feature only needs operator-facing query composition, keep it in app service/query modules
- if a feature only needs speed/tick policy access, prefer focused policy/service wrappers instead of broadening `SimulationManager`

This keeps `SimulationManager` as a runtime composition object rather than allowing it to become a new all-purpose service hub.

---

## 5. Time System / 时间系统

- `ChronosEngine` supports absolute ticks via `BigInt`.
- Multi-calendar conversion is supported.
- API transport keeps tick-like values string-based.

---

## 6. Scheduler Runtime Notes / Scheduler 运行时说明

- Scheduler 现已进入 partition-aware、多 worker baseline：`SchedulerLease` / `SchedulerCursor` 按 partition 持久化，ownership / migration / automatic rebalance 继续在其上演进。
- `apps/server/src/app/runtime/agent_scheduler.ts` 负责 candidate assembly、actor readiness evaluation、lease/ownership guard 与 scheduler run snapshot 写入。
- `apps/server/src/app/runtime/scheduler_lease.ts` 负责 partition-scoped lease / cursor 读写，并对竞争 create/update 场景做了最小容错处理。
- `apps/server/src/app/services/inference_workflow/repository.ts` 现会为 scheduler followup/recovery 查询返回带 tick 的 signal/recovery 数据，以支撑更真实的 cursor watermark 推进语义。
- 当前 closure pass 后，`last_signal_tick` 不再无条件推进到 `now`，而是优先推进到该 partition 本轮真正观测到的最新 signal / recovery watermark。
- 当前 replay/retry recovery-window suppression 已升级为细粒度、按优先级生效：periodic candidate 会继续被 suppress，低优先级 event-driven candidate（如 relationship / snr followup）也会在恢复窗口内被 suppress，而高优先级 `event_followup` 默认可穿透 suppression。
- scheduler skip taxonomy 已显式区分 `replay_window_periodic_suppressed` / `replay_window_event_suppressed` / `retry_window_periodic_suppressed` / `retry_window_event_suppressed`，summary/read-model/trends 可直接暴露这些细粒度 suppression 统计。
- `event_coalesced` 仍保留为 summary-side taxonomy / aggregate counter，不被伪装成 candidate-level `skipped_reason`；candidate explainability 由 `candidate_reasons` 与派生 coalescing 字段承接。

---

## 7. World Packs / 世界包

- World packs are file-driven and loaded through `apps/server/src/world/loader.ts`.
- World pack runtime metadata is still derived from pack content through `apps/server/src/core/world_pack_runtime.ts`.
- Project-level runtime configuration is generated into `data/configw/**` on first startup and loaded through `apps/server/src/config/runtime_config.ts`.
- The version-managed seeds for runtime config and world pack templates live under `apps/server/templates/**`, then get materialized into `data/` for each deployment.
- Runtime initialization has been explicitly split into scaffold and bootstrap stages under `apps/server/src/init/**`.
- `runtime_scaffold.ts` is responsible for materializing configw seed templates into `data/configw/**`.
- `world_pack_bootstrap.ts` is responsible for creating or refreshing the configured default world pack in `data/world_packs/**`.
- `prepare_runtime.ts` is the composition entry for runtime initialization, and script-level commands (`init:configw`, `init:world-pack`, `init:runtime`) map to these focused responsibilities.
- 当前 world-pack contract 已开始从“静态背景配置”扩展为“scenario-driven runtime declaration”：`apps/server/src/world/schema.ts` 会校验 `scenario / event_templates / actions / decision_rules` 等结构化字段。
- `apps/server/src/world/materializer.ts` 负责把 active world-pack 中声明的 scenario agents / identities / bindings / relationships / artifact/world state 幂等 materialize 到数据库。
- `ScenarioEntityState` 现作为最小通用状态承载层，用于保存 pack-driven actor / artifact / world state，而不强行把所有剧情状态塞进 event 文本或变量池。
- `apps/server/src/inference/context_builder.ts` 会把 `pack_state + pack_runtime` 注入 inference context；`apps/server/src/inference/providers/rule_based.ts` 再通过 `apps/server/src/inference/pack_rules.ts` 优先评估 pack decision rules。
- `apps/server/src/app/services/action_dispatcher.ts` 现支持 pack action registry：若 `ActionIntent.intent_type` 命中 pack action，则按引擎内置 executor（当前为 `claim_artifact / set_actor_state / emit_event`）执行；若未命中才回退到既有内置 intent。
- 这条扩展路径的目标是让 world-pack 声明 demo 级剧情实体与规则，而不是把 Death Note 场景硬编码进 runtime 主干。

---

## 8. Architecture Notes / 架构备注

- Future large refactors should continue to favor small, verifiable extractions over new all-in-one modules.
- Query-layer decomposition and route-first frontend state should remain the default direction for similar modules.
