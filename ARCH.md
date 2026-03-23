# Yidhras Architecture / 架构文档

Version: v0.5.0-draft
Last Updated / 最后更新: 2026-03-23

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

- **Current / 已实现:** concept represented in docs and action intent, not fully modeled in runtime.
- **Planned / 规划中:** delay/loss simulation and action dispatch integration.

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
  - `inference.ts` (reserved placeholder)
- Route handlers are expected to stay thin and delegate app-level orchestration to `apps/server/src/app/services/*.ts`.
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
- Inference integration is intentionally reserved through `apps/server/src/app/routes/inference.ts`, `apps/server/src/inference/service.ts`, and the startup wiring in `apps/server/src/index.ts`.

### 4.2 Simulation Core / 模拟核心

- `SimulationManager` (`apps/server/src/core/simulation.ts`) orchestrates:
  - world-pack loading,
  - clock engine,
  - narrative resolver,
  - value dynamics manager,
  - Prisma access.
- Runtime step loop currently advances ticks and leaves deeper agent decision flow as future work.
- Runtime step loop also performs binding expiry scan (`expires_at`) before advancing simulation ticks.
- The planned integration point for future agent behavior remains the simulation step path, but it should consume a formal inference/action workflow instead of embedding ad-hoc prompt logic directly into the loop.

### 4.3 Time System / 时间系统

- `ChronosEngine` supports absolute ticks via `BigInt`.
- Multi-calendar conversion is supported, including irregular ratios.
- API serializes `BigInt` values as strings for JSON transport.

### 4.4 World Packs / 世界包

- Loaded from folder-based YAML files using `WorldPackLoader`.
- Supports `config.yaml|yml` and `pack.yaml|yml` discovery.
- Includes metadata, variable pool, prompt snippets, and time system definitions.
- `WorldPack.prompts` is the current prompt-fragment carrier and will be reused by the future inference service layer.

### 4.5 Data Layer / 数据层

- Prisma schema: `apps/server/prisma/schema.prisma`.
- Database provider: SQLite via `DATABASE_URL`.
- Current models cover agents, circles, memberships, relationships, posts, events, world variables,
  and identity/policy entities.
- Identity bindings connect identities to active/atmosphere nodes with lifecycle status and expiry.
- Current gap: there is not yet a persisted inference workflow model such as `InferenceTrace`, `ActionIntent`, or `DecisionJob`.

### 4.6 Planned Agent Runtime Route / 规划中的 Agent 运行路线

#### Phase B / 阶段 B（当前规划）
- Introduce a D-ready inference service layer rather than direct runtime automation.
- Core planned modules:
  - `InferenceContext` builder
  - `PromptBundle` / prompt builder
  - provider abstraction with strategy injection
  - normalized `DecisionResult`
  - `ActionIntentDraft`
  - trace metadata + pluggable sink
- API role in this phase:
  - preview prompt composition
  - manually run decision generation
  - validate stable contracts before persistence

#### Phase D / 阶段 D（后续规划）
- Introduce persisted workflow entities and state transitions.
- Candidate persisted objects:
  - `InferenceTrace`
  - `ActionIntent`
  - `DecisionJob` / equivalent runtime job record
- Core capabilities:
  - idempotency
  - retry handling
  - audit trail
  - replay
  - separation between decision generation and action execution
- Expected runtime outcome:
  - simulation loop consumes workflow state rather than directly executing ad-hoc decisions.

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
- **Planned / 规划中:**
  - D-ready inference service layer.
  - Persisted inference/action workflow.
  - memory core on top of stable trace/decision schema.
  - robust L4 dispatcher and richer frontend plugin system.

## 9) Non-Goals for This Draft / 本版非目标

- This document does not define immutable long-term architecture contracts.
- It intentionally avoids over-specifying low-level algorithms that may evolve during Phase B.
- Detailed behavioral rules belong in `LOGIC.md`, milestone sequencing belongs in `TODO.md`, and historical debt/verification belongs in `记录.md`.
