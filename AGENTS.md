# AGENTS.md

Repository guidance for coding agents working in `Yidhras`.

## 1. Workspace

- `apps/server`: TypeScript + Express + Prisma + SQLite backend.
- `apps/web`: Nuxt 4 + Vue 3 + Pinia frontend.
- `packages/contracts`: shared transport schemas and envelope types.
- `docs/`: repository docs, stable references, and operation guides.
- `data/`: local runtime data area created at startup; do not treat it as the main Git source of truth.
- Package manager: `pnpm` workspace.

## 2. Tooling Baseline

- Node.js 18+ and `pnpm` 10+.
- Server TypeScript is strict and uses `NodeNext` ESM.
- In `apps/server`, keep `.js` extensions in relative TS imports.
- Frontend runs CSR-only (`apps/web/nuxt.config.ts`, `ssr: false`).
- Prisma schema lives at `apps/server/prisma/schema.prisma`.
- Shared transport-boundary contracts live in `packages/contracts`.

## 3. High-frequency Commands

Use these as entry points only. For the full command matrix, always check `docs/guides/COMMANDS.md`.

### Install / Dev

- `pnpm install`
- `pnpm prepare:runtime`
- `pnpm dev:server`
- `pnpm dev:web`
- `./start-dev.sh` or `start-dev.bat`

### Quality

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:unit`

### Common scoped checks

- `pnpm --filter yidhras-server test:integration`
- `pnpm --filter yidhras-server test:e2e`
- `pnpm --filter yidhras-server smoke`
- `pnpm --filter web test:unit`

### World-pack / plugin entry points

- `pnpm scaffold:world-pack -- --dir <pack-dir> --name "<Pack Name>" --author "<Author>"`
- `pnpm --filter yidhras-server plugin -- <command>`

For detailed CLI examples, testing entry points, and plugin operations:

- `docs/guides/COMMANDS.md`
- `docs/guides/PLUGIN_OPERATIONS.md`

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
- Split responsibilities across focused modules under `app/services/inference_workflow/`.
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
- Prefer keeping publish/release metadata in `metadata`.
- Recommended minimum contents for a pack directory: `config.yaml` + `README.md`.
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

Always prefer linking over duplicating the same facts.

### Entry documents

- `README.md`: repository entry page only.
- `docs/INDEX.md`: document navigation, taxonomy, and source-of-truth rules.
- `AGENTS.md`: agent collaboration rules and engineering constraints.
- `TODO.md`: current backlog and priorities only.

### Stable references

- `docs/API.md`: external/public API contracts and error codes.
- `docs/ARCH.md`: architecture boundaries, ownership, module responsibilities.
- `docs/LOGIC.md`: business rules, execution semantics, domain meaning.
- `docs/WORLD_PACK.md`: world-pack packaging, README baseline, release guidance.
- `docs/THEME.md`: frontend theme contract and authoring/debugging guidance.
- `apps/web/README.md`: frontend-specific scope and structure.

### Operation guides

- `docs/guides/COMMANDS.md`: full command matrix.
- `docs/guides/PLUGIN_OPERATIONS.md`: plugin governance operations.

### Process artifacts

- `.limcode/design/`, `.limcode/plans/`, `.limcode/review/`: process artifacts, not the primary stable source of truth.

## 7. Documentation Update Rule

When behavior changes, update the most appropriate primary doc in the same change:

- startup / entry flow -> `README.md`
- commands / test entry points -> `docs/guides/COMMANDS.md`
- public plugin operation flow -> `docs/guides/PLUGIN_OPERATIONS.md`
- API contract -> `docs/API.md`
- architecture boundary -> `docs/ARCH.md`
- business semantics -> `docs/LOGIC.md`
- current priorities -> `TODO.md`
- process reasoning / review / migration notes -> `.limcode/*`

If unsure, update the primary source first and add links elsewhere instead of copying the full content.
