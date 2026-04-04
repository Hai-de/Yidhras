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
- `event_coalesced` 仍保留为 summary-side taxonomy / aggregate counter，不被伪装成 candidate-level `skipped_reason`；candidate explainability 由 `candidate_reasons` 与派生 coalescing 字段承接。

---

## 7. World Packs / 世界包

- World packs are file-driven and loaded through `apps/server/src/world/loader.ts`.
- Runtime config is derived from world-pack metadata through `core/world_pack_runtime.ts`.
- Bootstrap resources are prepared by `apps/server/src/world/bootstrap.ts`.

---

## 8. Architecture Notes / 架构备注

- Future large refactors should continue to favor small, verifiable extractions over new all-in-one modules.
- Query-layer decomposition and route-first frontend state should remain the default direction for similar modules.
