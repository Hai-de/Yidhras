# Yidhras Architecture / 架构文档

Version: v0.4.0-draft
Last Updated / 最后更新: 2026-03-22

## 1) Project Positioning / 项目定位

Yidhras is a narrative simulation platform with layered world modeling and agent-oriented runtime logic.
Yidhras 是一个具备分层世界建模与 Agent 运行逻辑的叙事模拟平台。

The current implementation focuses on a practical baseline: clock simulation, world-pack loading, resolver logic, value dynamics, and API exposure.
当前实现聚焦可运行基线：时钟模拟、世界包加载、解析器逻辑、价值动态与 API 暴露。

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

- `apps/server/src/index.ts` is the HTTP entrypoint.
- It wires system, clock, social, relational, narrative, and agent-context APIs.
- A global error middleware captures operational exceptions and pushes system notifications.
- Identity & policy APIs support field-level evaluation with explicit rule explanation for debugging (`/api/policy/evaluate`).
- Identity lifecycle APIs include bind/query/unbind/expire flow and atmosphere-node listing endpoint.

### 4.2 Simulation Core / 模拟核心

- `SimulationManager` (`apps/server/src/core/simulation.ts`) orchestrates:
  - world-pack loading,
  - clock engine,
  - narrative resolver,
  - value dynamics manager,
  - Prisma access.
- Runtime step loop currently advances ticks and leaves deeper agent decision flow as future work.
- Runtime step loop also performs binding expiry scan (`expires_at`) before advancing simulation ticks.

### 4.3 Time System / 时间系统

- `ChronosEngine` supports absolute ticks via `BigInt`.
- Multi-calendar conversion is supported, including irregular ratios.
- API serializes `BigInt` values as strings for JSON transport.

### 4.4 World Packs / 世界包

- Loaded from folder-based YAML files using `WorldPackLoader`.
- Supports `config.yaml|yml` and `pack.yaml|yml` discovery.
- Includes metadata, variable pool, prompt snippets, and time system definitions.

### 4.5 Data Layer / 数据层

- Prisma schema: `apps/server/prisma/schema.prisma`.
- Database provider: SQLite via `DATABASE_URL`.
- Current models cover agents, circles, memberships, relationships, posts, events, world variables,
  and identity/policy entities.
- Identity bindings connect identities to active/atmosphere nodes with lifecycle status and expiry.

## 5) Frontend Architecture / 前端架构

- Nuxt 4 app with Pinia stores and layered layout.
- `layouts/default.vue` provides shell and layer switcher.
- `components/L2Graph.vue` renders relation graph with Cytoscape.
- `stores/clock.ts` syncs time from server and handles BigInt string conversion on client side.

## 6) Engineering Baseline / 工程基线

- **Current / 已实现:** ESLint + Prettier baseline for both apps.
- Scripts per app include `lint` and `typecheck`.
- Lint strategy is practical: warnings are allowed and tracked in `记录.md`.
- Rule intent now is safety-first rather than strict style enforcement.

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
- **Planned / 规划中:**
  - full agent inference pipeline, memory core, lifecycle policy expansion, robust L4 dispatcher, richer frontend plugin system.

## 9) Non-Goals for This Draft / 本版非目标

- This document does not define immutable long-term architecture contracts.
- It intentionally avoids over-specifying algorithmic details that may change soon.
- Detailed behavioral rules belong in `LOGIC.md`, milestone sequencing belongs in `TODO.md`.
