# Yidhras Architecture / 架构文档

Version: v0.5.2-draft
Last Updated / 最后更新: 2026-03-27

## 1) Project Positioning / 项目定位

Yidhras is a narrative simulation platform with layered world modeling and agent-oriented runtime logic.
Yidhras 是一个具备分层世界建模与 Agent 运行逻辑的叙事模拟平台。

The current implementation focuses on a practical baseline: clock simulation, world-pack loading, resolver logic, value dynamics, and API exposure.
当前实现聚焦可运行基线：时钟模拟、世界包加载、解析器逻辑、价值动态与 API 暴露。

The next formal engineering route is no longer “temporary feature probing”. It is an explicit transition from a D-ready inference service layer (Phase B) to a persisted workflow architecture (Phase D).
下一阶段的正式工程路线不再是“临时功能试探”，而是从 D-ready 的推理服务层（Phase B）过渡到持久化工作流架构（Phase D）。

## 2) Repo Layout / 仓库结构

- `apps/server`: TypeScript + Express + Prisma + SQLite backend.
- `apps/web`: Nuxt 4 + Vue 3 + Pinia frontend.
- `data/world_packs`: YAML-driven world configuration packs.
- Root docs: `README.md`, `API.md`, `LOGIC.md`, `TODO.md`, `AGENTS.md`.

## 3) Layered Model / 四层模型

### L1 Social / 社交层

- **Current / 已实现:** post feed and post creation endpoints in backend API.
- **Planned / 规划中:** richer feed filtering, stronger social behavior simulation.

### L2 Relational / 关系层

- **Current / 已实现:** graph data API and Cytoscape-based visualization.
- **Planned / 规划中:** dynamic relationship evolution tied to simulation actions.

### L3 Narrative / 叙事层

- **Current / 已实现:** timeline endpoint and recursive narrative resolver with permission gating.
- **Planned / 规划中:** event-generation strategies from agent decisions.

### L4 Transmission / 传输层

- **Current / 已实现:** minimal runtime L4 semantics are now active through `ActionIntent` + dispatcher (`scheduled_for_tick` gating, delay/drop metadata, heuristic transmission policy, and `post_message` materialization).
- **Planned / 规划中:** richer network/system simulation (probabilistic reach, multi-hop propagation, attenuation/recovery) and broader world-action dispatch coverage.

## 4) Backend Runtime Architecture / 后端运行架构

### 4.1 Entry and API / 入口与接口

- `apps/server/src/index.ts` remains the startup entrypoint, but now acts as a composition root rather than a monolithic route file.
- Base Express registration lives in `apps/server/src/app/create_app.ts`.
- Route modules are grouped under `apps/server/src/app/routes/*.ts`:
  - `system.ts`
  - `clock.ts`
  - `social.ts`
  - `relational.ts`
  - `narrative.ts`
  - `agent.ts`
  - `identity.ts`
  - `policy.ts`
  - `inference.ts`
- Route handlers are expected to stay thin and delegate app-level orchestration to `apps/server/src/app/services/*.ts` or domain services under `apps/server/src/inference/*.ts`.
- Shared HTTP helpers are grouped under `apps/server/src/app/http/*.ts`.
- Shared middleware is grouped under `apps/server/src/app/middleware/*.ts`, including request-id propagation and the unified global error handler.
- Startup preflight and simulation-loop helpers are grouped under `apps/server/src/app/runtime/*.ts`.
- A global error middleware captures operational exceptions and pushes system notifications.
- Stable transport/runtime guarantees are preserved across the refactor:
  - unified error envelope `{ success: false, error: { code, message, request_id, timestamp, details? } }`
  - `X-Request-Id` generation/propagation via `requestIdMiddleware()`
  - centralized runtime gating via `AppContext.assertRuntimeReady(feature)` returning `503/WORLD_PACK_NOT_READY`
  - BigInt JSON serialization as strings
- Identity & policy APIs support field-level evaluation with explicit rule explanation for debugging (`/api/policy/evaluate`).
- Identity lifecycle APIs include bind/query/unbind/expire flow and atmosphere-node listing endpoint.
- Inference integration is now active through `apps/server/src/app/routes/inference.ts`, `apps/server/src/inference/service.ts`, and the startup wiring in `apps/server/src/index.ts`.

### 4.2 Simulation Core / 模拟核心

- `SimulationManager` (`apps/server/src/core/simulation.ts`) orchestrates:
  - world-pack loading,
  - clock engine,
  - narrative resolver,
  - value dynamics manager,
  - Prisma access.
- Runtime step loop currently advances ticks, performs binding expiry scan (`expires_at`), runs runnable decision jobs, and dispatches eligible action intents.
- Deeper autonomous agent perception/planning remains future work.
- The planned integration point for future agent behavior remains the simulation step path, but it should continue consuming formal inference/action workflow state instead of embedding ad-hoc prompt logic directly into the loop.

### 4.3 Time System / 时间系统

- `ChronosEngine` supports absolute ticks via `BigInt`.
- Multi-calendar conversion is supported, including irregular ratios.
- API serializes `BigInt` values as strings for JSON transport.

### 4.4 World Packs / 世界包

- Loaded from folder-based YAML files using `WorldPackLoader`.
- Supports `config.yaml|yml` and `pack.yaml|yml` discovery.
- Includes metadata, variable pool, prompt snippets, and time system definitions.
- `WorldPack.prompts` is the current prompt-fragment carrier and is already consumed by the Phase B inference prompt builder.

### 4.5 Data Layer / 数据层

- Prisma schema: `apps/server/prisma/schema.prisma`.
- Database provider: SQLite via `DATABASE_URL`.
- Current models cover agents, circles, memberships, relationships, posts, events, world variables,
  and identity/policy entities.
- Identity bindings connect identities to active/atmosphere nodes with lifecycle status and expiry.
- A minimal persisted inference workflow baseline now exists with `InferenceTrace`, `ActionIntent`, and `DecisionJob`.
- Current delivered workflow additions already include idempotency-key replay, failed-job retry, aggregate workflow reads, loop-driven job execution, and first-pass dispatcher consumption for `post_message`.
- Current gap: richer replay orchestration beyond aggregate reads/stored-trace reuse, broader dispatcher/runtime consumption beyond the current `post_message` path, and durable job locking/multi-worker scheduler semantics.

### 4.6 Planned Agent Runtime Route / 规划中的 Agent 运行路线

#### Phase B / 阶段 B（当前稳定基线）
- Introduce a D-ready inference service layer rather than direct runtime automation.
- Current implemented core modules:
  - `InferenceContext` builder
  - `PromptBundle` / prompt builder
  - provider abstraction with strategy injection
  - normalized `DecisionResult`
  - internal `ActionIntentDraft`
  - trace metadata + pluggable sink
- Current built-in strategies:
  - `mock`
  - `rule_based`
- API role in this phase:
  - preview prompt composition
  - manually run decision generation
  - validate stable contracts before persistence
- Current boundary note:
  - `ActionIntentDraft` is intentionally kept as an internal service-layer artifact for now and is not yet exposed through HTTP payloads.

#### Phase D / 阶段 D（已进入最小落地）
- Minimal delivered baseline:
  - persisted `InferenceTrace`
  - persisted `ActionIntent`
  - persisted `DecisionJob`
  - Prisma-backed trace sink wired into `apps/server/src/index.ts`
  - minimal `POST /api/inference/jobs` entry with `idempotency_key` replay
  - read APIs for trace / intent / job inspection
  - aggregate workflow read APIs for `trace -> job -> intent` inspection
  - retry API for failed jobs with bounded attempts
  - minimal loop-driven decision-job runner under `apps/server/src/app/runtime/job_runner.ts`
  - minimal action dispatcher runner under `apps/server/src/app/runtime/action_dispatcher_runner.ts`
- Current state-transition baseline:
  - `preview` persists trace snapshot only
  - `run` persists trace, intent, and job in one transaction-like workflow write path
  - `jobs` now enqueue `pending` work and reuse existing `DecisionJob` when `idempotency_key` matches
  - loop runner consumes `pending/running` jobs and executes inference asynchronously from the submit request
  - retry path uses `failed -> running -> completed|failed`
  - `DecisionJob.status='completed'` still marks inference workflow completion, not full world-side completion
  - aggregate workflow snapshots now derive:
    - `decision_stage`
    - `dispatch_stage`
    - `workflow_state`
    - `failure_stage`
    - `failure_code`
  - dispatcher consumes eligible `ActionIntent` records and currently materializes `post_message` into L1 social posts
  - minimal L4 semantics are carried on `ActionIntent` via:
    - `transmission_delay_ticks`
    - `transmission_policy`
    - `transmission_drop_chance`
    - `drop_reason`
  - dispatcher may mark an intent as `dropped` without creating a post
  - dispatcher failures and drops are now separated more explicitly via:
    - `ActionIntent.dispatch_error_code`
    - `ActionIntent.dispatch_error_message`
  - current transmission policy derivation can already consult:
    - policy capability (`social_post_write_allowed`)
    - actor role (`active` / `atmosphere`)
    - agent SNR snapshot
- Remaining Phase D work:
  - audit/replay tooling beyond raw record reads
  - richer replay orchestration beyond current aggregate read + stored-trace reuse
  - richer simulation loop consumption of persisted workflow state beyond current post-message path
  - job locking / multi-worker safety / real scheduler semantics

### 4.7 Memory Core v1 (Partially Landed)
- `apps/server/src/memory/` is now introduced as the initial memory module boundary.
- Current landed v1 building blocks:
  - `memory/types.ts`
  - `short_term_adapter.ts`
  - `selector.ts`
  - `service.ts`
  - noop `long_term_store.ts`
  - noop `summarizer.ts`
- `InferenceContext` now includes `memory_context`.
- Prompt construction is now fragment-friendly through `buildPromptFragments(...)`, `runPromptProcessors(...)`, and `buildPromptBundleFromFragments(...)`.
- Active prompt processors are now chained in this order:
  - `memory-injector`
  - `policy-filter`
  - `memory-summary`
  - `token-budget-trimmer`
- `memory-injector` maps short-term / long-term / summary memory into dedicated prompt fragment slots.
- `policy-filter` can remove memory fragments before finalize when visibility / policy gate blocks them.
- `memory-summary` can compact multiple short-term fragments into a summary fragment.
- `token-budget-trimmer` can drop lower-priority fragments when prompt budget is exceeded.
- Trace persistence now records `memory_selection` and `prompt_processing_trace` inside `context_snapshot`, and prompt metadata includes `processing_trace`.

## 5) Frontend Architecture / 前端架构

- Nuxt 4 app with Pinia stores and layered layout.
- `layouts/default.vue` provides shell and layer switcher.
- `components/L2Graph.vue` renders relation graph with Cytoscape.
- `stores/clock.ts` syncs time from server and handles BigInt string conversion on client side.
- Frontend UI is still considered non-final; backend contract stability remains higher priority than interface polishing.

## 6) Engineering Baseline / 工程基线

- **Current / 已实现:** ESLint + Prettier baseline for both apps.
- Scripts per app include `lint` and `typecheck`.
- Lint and typecheck currently pass in both apps.
- Rule intent remains safety-first rather than strict style maximalism.
- M0 is considered completed; subsequent work should prioritize agent runtime architecture rather than additional baseline polishing.

## 7) Configuration and Conventions / 配置与约定

- Server uses NodeNext ESM and keeps `.js` runtime extension in relative imports.
- Web follows Vue/Nuxt conventions and TypeScript support through Nuxt toolchain.
- No centralized test runner yet; executable TS test scripts are used in backend.

## 8) Explicit Scope Markers / 范围标记

To avoid ambiguity for agentic contributors:
为避免后续 agent 误解，明确以下边界：

- **Currently Implemented / 当前已实现:**
  - API baseline, simulation bootstrap, clock/resolver/dynamics modules, graph visualization.
  - Identity policy strategy baseline: deny-first ordering, wildcard field matching, and conditions-ready evaluation.
  - Identity binding lifecycle APIs and runtime expiry handling.
  - Phase B inference debug endpoints with structured prompt/context composition and normalized decision output.
  - Minimal Phase D persistence baseline: persisted trace/intent/job records, aggregate workflow reads, idempotency replay, failed-job retry, loop-driven execution, and first-pass `post_message` dispatch.
  - Memory Core v1 baseline: fragment-oriented prompt construction, memory injection/selection observability, and the current processor chain.
  - Minimal L4 dispatcher semantics: delay/drop/policy baseline for the current `post_message` path.
- **Planned / 规划中:**
  - richer replay orchestration and durable scheduler/job-locking semantics.
  - real long-term memory plus stronger summarization/policy-aware trimming.
  - broader world-action mapping, richer L4 simulation, and richer frontend plugin system.

## 9) Non-Goals for This Draft / 本版非目标

- This document does not define immutable long-term architecture contracts.
- It intentionally avoids over-specifying low-level algorithms that may evolve during Phase B.
- Detailed behavioral rules belong in `LOGIC.md`, milestone sequencing belongs in `TODO.md`, and historical debt/verification belongs in `记录.md`.
