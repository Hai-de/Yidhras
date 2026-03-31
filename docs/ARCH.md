# Yidhras Architecture / 架构文档

Version: v0.5.3-draft
Last Updated / 最后更新: 2026-03-30

> 本文件只描述相对稳定的架构边界、模块职责与设计约束；当前阶段状态请看 `TODO.md`，历史验证请看 `记录.md`。

## 1) Project Positioning / 项目定位

Yidhras is a narrative simulation platform with layered world modeling and agent-oriented runtime logic.
Yidhras 是一个具备分层世界建模与 Agent 运行逻辑的叙事模拟平台。

The current implementation focuses on a practical baseline rather than speculative completeness.
当前实现聚焦可运行基线，而不是追求文档层面的“完整幻觉”。

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
- Business rules, permissions, state transitions, and persistence checks stayin service/domain layers.
- Shared contracts should prioritize API-boundary stability rather than covering all internal models.

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

## 5) Frontend Architecture / 前端架构

- Nuxt 4 app with Pinia stores and layered layout.
- `layouts/default.vue` provides shell and layer switcher.
- `components/L2Graph.vue` renders relation graph with Cytoscape.
- `stores/clock.ts` handles time sync and BigInt-string conversion on the client side.
- Frontend is still a product shell rather than a frozen final UI.

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
