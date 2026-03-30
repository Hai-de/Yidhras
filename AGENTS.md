# AGENTS.md

Repository guidance for coding agents working in `Yidhras`.
This file is intentionally specific to the current repo layout and conventions.

## 1) Workspace Overview

- Monorepo-like layout with two Node.js apps:
- `apps/server`: TypeScript + Express + Prisma + SQLite backend.
- `apps/web`: Nuxt 4 + Vue 3 + Pinia frontend.
- Shared domain/data docs at repo root: `README.md`, `ARCH.md`, `API.md`, `LOGIC.md`.
- World-pack data under `data/world_packs` and loaded by server runtime.

## 2) Rule Files Check (Cursor/Copilot)

- No `.cursorrules` file found.
- No `.cursor/rules/` directory found.
- No `.github/copilot-instructions.md` file found.
- If any of these are added later, treat them as high-priority constraints.

## 3) Tooling and Runtime Baseline

- Node.js 18+ expected (Nuxt 4 and modern TS/ESM usage).
- Package manager: `npm` (lockfiles are `package-lock.json` in each app).
- Backend uses Prisma with SQLite (`apps/server/prisma/schema.prisma`).
- Server TypeScript config is strict (`"strict": true`).
- Module system in server is `NodeNext` ESM; runtime imports include `.js` extensions.
- M0 engineering baseline is completed; future server work should assume lint/typecheck cleanliness is already a hard expectation rather than an open milestone.

## 4) Install Commands

- Install backend deps:
- `npm install --prefix apps/server`
- Install frontend deps:
- `npm install --prefix apps/web`
- Optional full setup from root:
- `npm install --prefix apps/server && npm install --prefix apps/web`

## 5) Build / Dev / Start Commands

- Backend dev server (watch mode):
- `npm run dev --prefix apps/server`
- Backend build:
- `npm run build --prefix apps/server`
- Backend production start (after build):
- `npm run start --prefix apps/server`
- Frontend dev server:
- `npm run dev --prefix apps/web`
- Frontend build:
- `npm run build --prefix apps/web`
- Frontend preview (built app):
- `npm run preview --prefix apps/web`

## 5.1) Quality Commands (Lint / Typecheck)

- Backend lint:
- `npm run lint --prefix apps/server`
- Backend typecheck:
- `npm run typecheck --prefix apps/server`
- Frontend lint:
- `npm run lint --prefix apps/web`
- Frontend typecheck:
- `npm run typecheck --prefix apps/web`
- `lint:fix` is intentionally not provided in this stage.

## 6) Lint / Format Status

- ESLint is enabled in both apps:
- `apps/server/.eslintrc.cjs`
- `apps/web/.eslintrc.cjs`
- Prettier is enabled at repo root:
- `.prettierrc.json`
- Current strategy is safety-first with selected rule hardening (practical over style maximalism).
- Ignored paths are explicitly configured, including:
- `**/node_modules/**`, `**/dist/**`, `**/.nuxt/**`, `**/.output/**`, `**/coverage/**`.
- Existing lint debt should be tracked in `记录.md`, not silently fixed in broad sweeps.
- Hardened-as-error rules include:
- `@typescript-eslint/no-explicit-any`
- `@typescript-eslint/no-unused-vars`
- `simple-import-sort/imports`
- `simple-import-sort/exports`
- `prefer-const` (server)
- `no-case-declarations` (server)

## 7) Test Commands (Current State)

- No formal test runner (Jest/Vitest) is configured yet.
- Existing "test" files in `apps/server/src/**/test*.ts` are executable TS scripts.
- Current backend verification scripts include:
- `npm run smoke --prefix apps/server`
- `npm run test:workflow-locking --prefix apps/server`
- `npm run test:workflow-replay --prefix apps/server`
- `npm run test:action-intent-locking --prefix apps/server`
- `npm run test:adjust-relationship --prefix apps/server`
- `npm run test:adjust-snr --prefix apps/server`
- `npm run test:trigger-event --prefix apps/server`
- `npm run test:audit-feed --prefix apps/server`
- `npm run test:audit-workflow-lineage --prefix apps/server`
- Legacy executable TS scripts still exist in `apps/server/src/**/test*.ts` and can be run manually with `tsx` when needed.

## 8) Single-Test Execution (Important)

- Since there is no centralized test framework, "single test" means running one script file.
- Preferred pattern (from repo root):
- `npm --prefix apps/server exec tsx src/clock/test.ts`
- Equivalent pattern (inside `apps/server`):
- `npx tsx src/clock/test.ts`
- For any new test file, keep the same approach:
- `npm --prefix apps/server exec tsx <path-to-test-file>.ts`

## 9) Database and Prisma Commands

- Generate Prisma client:
- `npm --prefix apps/server exec prisma generate`
- Create/apply local migration:
- `npm --prefix apps/server exec prisma migrate dev --name <migration_name>`
- Schema is in `apps/server/prisma/schema.prisma`.
- DB URL comes from `apps/server/.env` (`DATABASE_URL`).
- Never commit secrets from `.env`.

## 10) Architecture-Aware Coding Notes

- Server entry starts in `apps/server/src/index.ts`, but Express assembly is now split across:
  - `apps/server/src/app/create_app.ts`
  - `apps/server/src/app/routes/*.ts`
  - `apps/server/src/app/services/*.ts`
  - `apps/server/src/app/http/*.ts`
  - `apps/server/src/app/middleware/*.ts`
  - `apps/server/src/app/runtime/*.ts`
- `apps/server/src/index.ts` should remain a composition root for startup, runtime bootstrap, and route assembly rather than growing back into an all-in-one route file.
- Simulation entrypoint is `SimulationManager` in `apps/server/src/core/simulation.ts`.
- World-pack loading is file-driven via YAML in `apps/server/src/world/loader.ts`.
- Narrative templating and permission gating are in `apps/server/src/narrative/resolver.ts`.
- Frontend state uses Pinia stores in `apps/web/stores/*.ts`.
- L2 graph visualization is Cytoscape in `apps/web/components/L2Graph.vue`.
- Keep the stable request tracing path intact: `requestIdMiddleware()` sets `X-Request-Id` and keeps `res.locals.requestId` aligned with the unified error envelope.
- Keep runtime gating centralized through `AppContext.assertRuntimeReady(feature)` so world-pack-dependent endpoints continue to return `503/WORLD_PACK_NOT_READY` with stable details.
- Inference integration is intentionally reserved at `apps/server/src/app/routes/inference.ts` and `apps/server/src/inference/service.ts`; do not bypass these locations with ad-hoc route-level prompt logic.
- Audit / observability integration is now also active through `apps/server/src/app/routes/audit.ts` and `apps/server/src/app/services/audit.ts`; prefer extending the unified audit model instead of adding one-off debug endpoints.

### 10.1) Current Strategic Direction for Agents / 当前 Agent 工程方向

- The official route is now **Phase B → Phase D**, not a disposable prototype path.
- Phase B is already delivered as a **D-ready inference service layer**:
  - unified service entry
  - context builder
  - prompt builder
  - provider abstraction
  - normalized decision contract
  - trace metadata
  - pluggable sink
- Phase D is already partially delivered as the minimal **persisted workflow complexity** baseline:
  - `InferenceTrace`
  - `ActionIntent`
  - `DecisionJob` or equivalent runtime workflow state
  - idempotency / retry / audit / replay
- The current shipped world-action set is no longer only `post_message`; it now also includes:
  - `adjust_relationship`
  - `adjust_snr`
  - `trigger_event`
- Unified audit reads (`/api/audit/feed`, `/api/audit/entries/:kind/:id`) should be treated as part of the current Phase D observability surface.
- Treat the remaining work as expansion of the current Phase D baseline, not as a future-from-scratch rewrite.
- When implementing inference-related code, do **not** collapse decision generation and action execution into one opaque function.
- API handlers should remain thin shells; domain assembly belongs in service modules.

## 11) Code Style: General

- Prefer TypeScript for all new backend/frontend logic.
- Match local style first; avoid repo-wide reformatting.
- Keep functions small and intent-revealing.
- Avoid dead abstractions; follow existing structure.
- Prefer explicit data contracts for API I/O.

## 12) Code Style: Imports and Modules

- Server (NodeNext ESM): use relative imports with `.js` extension in TS source.
- Example pattern: `import { X } from './module.js';`
- Keep imports grouped: external packages first, local modules second.
- Prefer named imports unless there is a clear default-export convention.
- Remove unused imports as part of each change.

## 13) Code Style: Formatting and Syntax

- In `apps/server`: semicolons are standard; keep them.
- In `apps/web` Vue/Pinia files: semicolons are often omitted; follow local file style.
- Prefer single quotes in TS/JS unless file already uses another style.
- Preserve existing whitespace rhythm; do not churn formatting-only diffs.
- Keep comments only when they clarify non-obvious behavior.

## 14) Code Style: Types and Data Modeling

- Respect strict TypeScript in server; avoid `any` unless unavoidable.
- If `any` is unavoidable, add an inline comment explaining why and planned refinement.
- Prefer interfaces/types for structured payloads and store state.
- Use narrow unions for finite state (`'idle' | 'running' | ...`) as in stores.
- For BigInt fields crossing API boundaries, serialize as strings over JSON.
- Validate assumptions when converting string -> BigInt on the client.
- For inference/workflow code, define domain contracts before writing route payload types.
- Prefer explicit intermediate models such as `DecisionResult` / `ActionIntentDraft` over untyped freeform JSON.

## 15) Code Style: Naming

- `camelCase` for variables/functions, `PascalCase` for classes/types/components.
- Keep API field names consistent with existing payloads (snake_case appears in API responses).
- Keep domain naming aligned with docs: L1/L2/L3/L4, Chronos, Narrative, World Pack.
- Use descriptive names over short abbreviations unless domain-standard (`snr`, `id`).

## 16) Error Handling and Logging

- Wrap risky API handlers with `try/catch` and return stable error responses.
- Push operational errors into notifications queue when relevant.
- Avoid exposing sensitive internals in HTTP responses.
- Keep server logs actionable and scoped (include subsystem context).
- Fail closed for permission-gated or missing-variable resolver paths.
- Future inference/workflow failures should remain distinguishable by stage (provider / normalization / persistence / dispatch).

## 17) Change Discipline for Agents

- Make focused, minimal diffs that solve the requested task.
- Do not rewrite unrelated files or rename broadly without need.
- Update docs when behavior or commands change.
- If adding scripts (lint/test), also update this file and `README.md`.
- Prefer validating changed paths locally (build or targeted script run) before handoff.
- If introducing Phase B inference modules, ensure they are D-ready by design rather than temporary glue code.
- If introducing Phase D persistence, update `ARCH.md`, `API.md`, `LOGIC.md`, `TODO.md`, and `记录.md` together.

## 18) Quick Command Cheat Sheet

- Start both services (Linux/macOS): `./start-dev.sh`
- Start both services (Windows): `start-dev.bat`
- Backend build: `npm run build --prefix apps/server`
- Frontend build: `npm run build --prefix apps/web`
- Backend lint: `npm run lint --prefix apps/server`
- Frontend lint: `npm run lint --prefix apps/web`
- Run one backend test script: `npm --prefix apps/server exec tsx src/clock/test.ts`
