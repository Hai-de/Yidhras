# AGENTS.md

Repository guidance for coding agents working in `Yidhras`.

## 1. Workspace

- `apps/server`: TypeScript + Express + Prisma + SQLite backend.
- `apps/web`: Nuxt 4 + Vue 3 + Pinia frontend.
- `packages/contracts`: shared transport schemas and envelope types.
- `docs/`: stable reference docs.
- `data/`: runtime data area created locally at startup; do not treat it as the main source of truth in Git.
- Package manager: `pnpm` workspace.

## 2. Tooling Baseline

- Node.js 18+ and `pnpm` 10+.
- Server TypeScript is strict and uses `NodeNext` ESM.
- In `apps/server`, keep `.js` extensions in relative TS imports.
- Frontend runs CSR-only (`apps/web/nuxt.config.ts`, `ssr: false`).
- Prisma schema lives at `apps/server/prisma/schema.prisma`.
- Shared transport-boundary contracts live in `packages/contracts`.

## 3. Commands

### Install

- `pnpm install`
- `pnpm --filter yidhras-server install`
- `pnpm --filter web install`

### Dev / Build / Start

- `pnpm --filter yidhras-server dev`
- `pnpm --filter yidhras-server build`
- `pnpm --filter yidhras-server start`
- `pnpm --filter web dev`
- `pnpm --filter web build`
- `pnpm --filter web preview`
- `./start-dev.sh` or `start-dev.bat`

### Quality

- `pnpm lint`
- `pnpm typecheck`
- `pnpm --filter yidhras-server lint`
- `pnpm --filter yidhras-server typecheck`
- `pnpm --filter web lint`
- `pnpm --filter web typecheck`

### Tests

- Workspace:
  - `pnpm test`
  - `pnpm test:unit`
  - `pnpm test:integration`
  - `pnpm test:e2e`
- Server:
  - `pnpm --filter yidhras-server test:unit`
  - `pnpm --filter yidhras-server test:integration`
  - `pnpm --filter yidhras-server test:e2e`
  - `pnpm --filter yidhras-server test:watch`
  - `pnpm --filter yidhras-server smoke`
- Web:
  - `pnpm --filter web test:unit`
  - `pnpm --filter web test:watch`

### Single-spec examples

- `pnpm --filter yidhras-server exec vitest run --config vitest.integration.config.ts tests/integration/<file>.spec.ts`
- `pnpm --filter yidhras-server exec vitest run --config vitest.e2e.config.ts tests/e2e/<file>.spec.ts`
- `pnpm --filter web exec vitest run --config vitest.config.ts tests/unit/<file>.spec.ts`

### Runtime setup

- `pnpm --filter yidhras-server prepare:runtime`
- `pnpm --filter yidhras-server reset:dev-db`
- Manual/demo scripts live under `apps/server/scripts/manual/*`.

## 4. Architecture Anchors

### Server

- `apps/server/src/index.ts` is the composition root.
- `apps/server/src/app/create_app.ts` wires Express middleware and route registration.
- `apps/server/src/app/routes/*.ts` should remain transport-level and thin.
- `apps/server/src/app/services/*.ts` hold orchestration and read-model assembly.
- `apps/server/src/app/runtime/*.ts` holds runtime loop, scheduler, job runner, dispatcher, lease, ownership, and rebalance logic.
- `apps/server/src/core/simulation.ts` owns runtime core concerns: Prisma init, SQLite pragmas, world-pack loading, clock, narrative resolver, dynamics, runtime speed, and graph access.
- Do not turn `SimulationManager` into a generic app-service bucket; put new query/orchestration logic in focused modules.

### Workflow / Inference

- `apps/server/src/app/services/inference_workflow.ts` is a facade/export surface.
- Split responsibilities across:
  - `inference_workflow/parsers.ts`
  - `inference_workflow/repository.ts`
  - `inference_workflow/snapshots.ts`
  - `inference_workflow/results.ts`
  - `inference_workflow/workflow_query.ts`
- Keep decision generation, workflow persistence, and action dispatch as separate concerns.
- Keep API handlers thin; domain assembly belongs in services.
- Keep inference route/service boundaries centralized at:
  - `apps/server/src/app/routes/inference.ts`
  - `apps/server/src/inference/service.ts`

### Scheduler / Runtime constraints

- Scheduler is partition-aware and multi-worker.
- Lease and cursor state are partition-scoped.
- Runtime loop is serialized in `apps/server/src/app/runtime/simulation_loop.ts`.
- Runtime readiness is gated through `AppContext.assertRuntimeReady(feature)`.
- Request tracing is provided by `requestIdMiddleware()` and `X-Request-Id`.

### World packs

- World packs are file-driven and loaded through `apps/server/src/packs/manifest/loader.ts`.
- World-pack schema lives in `apps/server/src/packs/schema/constitution_schema.ts` and `apps/server/src/packs/manifest/constitution_loader.ts`.
- Pack runtime materialization lives in `apps/server/src/packs/runtime/materializer.ts`.
- Pack-specific decision rules and actions should flow through existing world-pack modules, not ad-hoc route logic.
- Treat a publishable world pack as a small project, not only a YAML file.
- Prefer keeping publish/release metadata in `metadata` (for example: `authors`, `license`, `homepage`, `repository`, `tags`, `compatibility`).
- Recommended minimum contents for a pack directory: `config.yaml` + `README.md`.
- Use `pnpm scaffold:world-pack -- --dir <pack-dir> --name "<Pack Name>" --author "<Author>" [--set-preferred] [--set-bootstrap-template] [--disable-bootstrap] [--dry-run]` to create a new pack project skeleton.
- See `docs/WORLD_PACK.md` for packaging and release guidance.

### Frontend

- `apps/web/pages/*.vue` define page-level routes.
- `apps/web/features/**` contain feature UI, adapters, composables, and route-state helpers.
- Prefer route-backed state for page location/filter context; stores should mainly hold fetch state or ephemeral UI state.
- Graph rendering stays in `features/graph/*` and uses `ClientOnly + GraphCanvas + Cytoscape`.
- Theme application lives in `apps/web/plugins/theme.ts`; shared semantic UI lives in `apps/web/components/ui/*`.

## 5. Coding Rules

### General

- Prefer TypeScript for new backend/frontend logic.
- Match local style before introducing new style.
- Keep functions small and intent-revealing.
- Avoid dead abstractions and broad rewrites.
- Make focused, minimal diffs.

### Types / API contracts

- Avoid `any` unless unavoidable; if used, explain why inline.
- Prefer explicit types for payloads and store state.
- BigInt over HTTP must remain string-based.
- Convert string → `BigInt` only where computation is required.
- Keep Zod/contracts at the transport boundary; keep business rules in services/domain logic.

### Imports / formatting

- In `apps/server`, use relative imports with `.js` extension.
- Remove unused imports.
- Avoid formatting-only churn.
- Keep comments only when they explain non-obvious behavior.

### Error handling

- Keep success/error envelopes stable.
- Do not expose sensitive internals in HTTP responses.
- Keep logs actionable and scoped.
- Preserve stage-specific failure information for workflow/inference paths.

## 6. Documentation Boundaries

- `README.md`: entry page only.
- `TODO.md`: current status and priorities.
- `记录.md`: verification evidence and acceptance notes.
- `docs/API.md`: external API contracts and error codes.
- `docs/ARCH.md`: architecture boundaries and module responsibilities.
- `docs/LOGIC.md`: business rules and domain semantics.
- `docs/WORLD_PACK.md`: world-pack packaging, README baseline, and release guidance.
- `docs/INDEX.md`: document navigation.
- `apps/web/README.md`: frontend-specific structure and guardrails.
- `.limcode/design/`, `.limcode/plans/`, `.limcode/review/`: process artifacts, not the primary source of truth.

Prefer linking over duplicating the same status/details across multiple markdown files.
If behavior or commands change, update the relevant docs in the same change.
