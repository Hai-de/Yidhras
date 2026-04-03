# Yidhras Architecture / 架构文档

Version: v0.5.4-draft
Last Updated / 最后更新: 2026-04-04

> 本文件只描述相对稳定的架构边界、模块职责与设计约束；当前阶段状态请看 `TODO.md`，历史验证请看 `记录.md`。

## 1) Project Positioning / 项目定位

Yidhras is a narrative simulation platform with layered world modeling and agent-oriented runtime logic.
Yidhras 是一个具备分层世界建模与 Agent 运行逻辑的叙事模拟平台。

The current implementation focuses on a practical baseline rather than speculative completeness.
当前实现聚焦可运行基线，而不是追求脱离实现状态的表面完整性。

## 2) Repo Layout / 仓库结构

- `apps/server`: TypeScript + Express + Prisma + SQLite backend.
- `apps/web`: Nuxt 4 + Vue 3 + Pinia frontend.
- `packages/contracts`: shared contract schemas/types for transport boundaries.
- `data/world_packs`: YAML-driven world configuration packs.
- Root entry docs: `README.md`, `AGENTS.md`, `TODO.md`, `记录.md`.
- Detailed docs: `docs/INDEX.md`, `docs/API.md`, `docs/ARCH.md`, `docs/LOGIC.md`.

## 3) Layered Model / 四层模型

### L1 Social / 社交层

- Public feed / posting surface.
- 对外表现为信息流与动态发布层。

### L2 Relational / 关系层

- Graph structure, circles, bindings, and relationship-oriented reads.
- 对外表现为图谱、关系边与组织/圈层结构。

### L3 Narrative / 叙事层

- Timeline, resolver logic, and narrative-facing event projection.
- 对外表现为事件时间线、变量解析与叙事语义层。

### L4 Transmission / 传输层

- Runtime delivery constraints, delay/drop semantics, and action reachability concerns.
- 对外表现为动作传输、延迟、丢弃与可达性约束。

## 4) Backend Runtime Architecture / 后端运行架构

### 4.1 Entry and API / 入口与接口

- `apps/server/src/index.ts` acts as the composition root.
- Base Express registration lives in `apps/server/src/app/create_app.ts`.
- Route modules are grouped under `apps/server/src/app/routes/*.ts`.
- Route handlers should remain thin HTTP adapters.
- App-level orchestration belongs in `apps/server/src/app/services/*.ts`.
- Shared HTTP helpers live under `apps/server/src/app/http/*.ts`.
- Shared middleware lives under `apps/server/src/app/middleware/*.ts`.
- Startup preflight and runtime loop helpers live under `apps/server/src/app/runtime/*.ts`.

### 4.1.1 Stable Transport Guarantees / 稳定传输约束

The following guarantees should remain stable across refactors:

- unified success envelope: `{ success: true, data, meta? }`
- unified error envelope: `{ success: false, error: { code, message, request_id, timestamp, details? } }`
- `X-Request-Id` generation/propagation via `requestIdMiddleware()`
- centralized runtime gating via `AppContext.assertRuntimeReady(feature)`
- BigInt JSON serialization as strings

### 4.1.2 Contract / Validation Boundary / 契约与校验边界

- `packages/contracts` is the shared contract package for transport-boundary schemas and types.
- `apps/server/src/app/http/zod.ts` provides server-side boundary parsing helpers.
- Zod schemas validate request/response boundary shape and basic formats.
- Business rules, permissions, state transitions, and persistence checks stay in service/domain layers.
- Shared contracts should prioritize API-boundary stability rather than covering all internal models.
- `agent / relational / scheduler / graph / social / audit / inference / policy / system` current transport boundary now all follow the shared contracts + route parse helper path.
- 当前 `agent / relational / scheduler / graph / social / audit / inference / policy / system` 传输边界已统一走 shared contracts + route parse helper 路径，不再鼓励 route 层零散手写 query/params 解析。
- `policy.conditions` transport shape is now owned by `packages/contracts`, while service 层只保留业务语义与持久化层约束。
- `/api/status` now also executes runtime response schema validation before returning, so system status is no longer a “schema declared but not enforced” surface.

### 4.2 Simulation Core / 模拟核心

- `SimulationManager` (`apps/server/src/core/simulation.ts`) orchestrates world-pack loading, clock engine, narrative resolver, value dynamics, and Prisma access.
- Runtime step loop is the place where tick advancement and runtime-side workflow consumption happen.
- Future agent behavior should continue to consume formal workflow state rather than embedding ad-hoc route logic directly into the loop.

### 4.3 Time System / 时间系统

- `ChronosEngine` supports absolute ticks via `BigInt`.
- Multi-calendar conversion is supported.
- API transport keeps tick-like values string-based.

### 4.4 World Packs / 世界包

- Loaded from YAML files through `WorldPackLoader`.
- Supports metadata, variable pool, prompt snippets, and time definitions.
- `WorldPack.prompts` is the current prompt-fragment carrier.

### 4.5 Data Layer / 数据层

- Prisma schema lives in `apps/server/prisma/schema.prisma`.
- Database provider is SQLite via `DATABASE_URL`.
- Core data model covers agents, circles, relationships, posts, events, variables, identity/policy entities, and workflow-related records.
- Identity bindings connect identities to active/atmosphere nodes with lifecycle state.
- Persisted workflow records provide a formal bridge between inference and runtime-side dispatch.
- `DecisionJob.intent_class` now serves as the stable top-level workflow intent classification layer across direct submit, scheduler, replay, and retry paths.
- `DecisionJob.intent_class` 现已作为 direct submit / scheduler / replay / retry 路径上的稳定顶层工作流意图分类层。
- Scheduler observability is built around persisted `SchedulerRun` and `SchedulerCandidateDecision` read models, with summary/trend style projections for operator-facing and analytics scenarios.
- 调度器观测当前围绕持久化的 `SchedulerRun` 与 `SchedulerCandidateDecision` 读模型组织，并提供面向 operator 与分析场景的 summary / trend 类投影。
- Scheduler policy includes replay/retry recovery-window suppression and priority-aware handling for periodic and event-driven candidates.
- 调度器策略包含 replay / retry recovery-window suppression，以及对 periodic / event-driven candidate 的 priority-aware 处理。
- Scheduler execution is partition-aware: lease/cursor are partition-scoped, and related run/decision read models expose partition metadata.
- 调度器执行语义具备 partition-aware 能力：lease/cursor 为 partition-scoped，相关 run/decision 读模型会暴露 partition 元信息。
- Runtime status and persistence surfaces include scheduler ownership, migration, and worker runtime snapshots for operator diagnostics.
- 运行态状态面与持久化观测面包含 scheduler ownership、migration 与 worker runtime 快照，用于 operator 诊断。

### 4.6 Agent Runtime Route / Agent 运行路线

- Inference should remain a distinct concern from world-side execution.
- API handlers should not collapse decision generation and action execution into one opaque flow.
- Prompt construction, decision normalization, workflow persistence, and action dispatch are separate architectural concerns.
- HTTP payloads should expose stable transport contracts rather than internal draft artifacts.

### 4.7 Memory Boundary / 记忆模块边界

- `apps/server/src/memory/` is the current memory module boundary.
- `InferenceContext` may consume memory-related context.
- Prompt construction is fragment-oriented rather than relying on one monolithic concatenation step.
- Long-term retrieval/storage remains an implementation concern, not an API-boundary contract.

### 4.8 Scheduler Observability / 调度器观测

- `apps/server/src/app/routes/scheduler.ts` provides the current minimal scheduler observability read surface.
- `apps/server/src/app/services/scheduler_observability.ts` persists `SchedulerRun` and `SchedulerCandidateDecision` snapshots and exposes filtered/paginated scheduler query helpers.
- `apps/server/src/app/runtime/scheduler_lease.ts` provides the current partition-scoped lease + cursor baseline for scheduler execution semantics.
- `apps/server/src/app/runtime/scheduler_partitioning.ts` provides the current stable hash/bucket partition mapping helper.
- `apps/server/src/app/services/system.ts` includes scheduler ownership snapshot in the runtime status payload, and `apps/server/src/index.ts` resolves worker-owned partitions at startup.
- Worker-owned partition selection is currently supported through explicit `partitionIds` input and environment-driven assignment (`SCHEDULER_WORKER_PARTITIONS` or `SCHEDULER_WORKER_TOTAL` + `SCHEDULER_WORKER_INDEX`).
- 当前已支持 worker-owned partition selection：可通过显式 `partitionIds` 输入或环境变量分配（`SCHEDULER_WORKER_PARTITIONS` 或 `SCHEDULER_WORKER_TOTAL` + `SCHEDULER_WORKER_INDEX`）控制 worker 责任边界。
- Scheduler observability includes partition / worker aware summary, trend, recent-run, and recent-decision projections for overview/operator consumption.
- 调度器观测层包含面向 overview/operator 的 partition / worker aware summary、trend、recent-run 与 recent-decision 投影。
- Read-only ownership assignment, migration history, worker runtime state, and rebalance recommendation surfaces are part of the current operator diagnostics model.
- 当前 operator 诊断模型包含只读 ownership assignment、migration history、worker runtime state 与 rebalance recommendation 读面。
- Ownership migration and rebalance apply follow the existing lease-expiry handoff contract rather than preempting an active lease.
- ownership migration 与 rebalance apply 遵循既有 lease-expiry handoff contract，不会直接抢占 active lease。

## 5) Frontend Architecture / 前端架构

- Nuxt 4 app with Pinia stores and layered layout.
- `layouts/default.vue` is the default layout entry and delegates the main operator shell to `features/shell/components/AppShell.vue`.
- Graph rendering now lives under `features/graph/components/*` and uses Cytoscape through `GraphCanvas.vue`.
- `stores/runtime.ts` is the current runtime/clock aggregation entry on the client side.
- Frontend is still a product shell rather than a frozen final UI.
- Theme ownership rule: platform maintains the official default theme and minimal fallback/diagnostics only; world-pack providers own their custom visual identity.
- 前端主题 ownership 规则：平台只维护官方默认主题与最小 fallback/diagnostics；world-pack provider 拥有自己的自定义视觉身份。
- Recommended provider-owned runtime theme payload is `world_pack.presentation.theme`.
- 推荐的 provider-owned runtime 主题载荷入口是 `world_pack.presentation.theme`。

## 6) Engineering Baseline / 工程基线

- ESLint + Prettier are enabled for both apps.
- Scripts include `lint` and `typecheck`.
- Validation commands and historical results should be tracked in `记录.md` rather than repeated here.

## 7) Configuration and Conventions / 配置与约定

- Server uses NodeNext ESM and `.js` runtime extension in relative imports.
- Web follows Vue/Nuxt conventions with Nuxt TypeScript tooling.
- BigInt over HTTP remains string-based.
- No centralized test runner yet; executable scripts are still part of the current verification model.

## 8) Explicit Scope Markers / 范围标记

### Current Architectural Commitments / 当前架构承诺

- Keep transport contracts stable before broadening internal complexity.
- Keep route handlers thin.
- Keep business/state rules in service and domain layers.
- Keep workflow persistence as the formal bridge between inference and execution.
- Keep aggregated read models where frontend/operator usage would otherwise require high-fanout stitching.

### Non-Goals for This Document / 本文档非目标

- This file is not a milestone board.
- This file is not a historical change log.
- This file does not try to freeze every low-level implementation detail.
- Highly dynamic status belongs in `TODO.md`; verification evidence belongs in `记录.md`.
