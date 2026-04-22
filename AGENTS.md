# AGENTS.md

Repository guidance for coding agents working in `Yidhras`.

## 1. Workspace

- `apps/server`: TypeScript + Express + Prisma + SQLite backend.
- `apps/web`: Nuxt 4 + Vue 3 + Pinia frontend (CSR-only, `ssr: false`).
- `packages/contracts`: shared transport schemas and envelope types. **No build step** — exports `.ts` source directly via `package.json` `exports`. Always use `.js` extensions in re-exports.
- `docs/`: stable references and operation guides.
- `data/`: runtime data area created at startup; gitignored. Not a Git source of truth.
- Package manager: `pnpm` workspace (`pnpm@10.33.0`). Node.js 18+.

## 2. Style & Lint Rules (non-obvious)

### Prettier — different semicolon policy per app

- **server**: semicolons **required** (`semi: true`).
- **web**: semicolons **forbidden** (`semi: false`).

Both use `singleQuote: true`, `trailingComma: "none"`, `printWidth: 100`.

### ESLint — enforced across both apps

- `simple-import-sort/imports` and `simple-import-sort/exports` are **errors** — imports and exports are auto-sorted.
- `@typescript-eslint/no-explicit-any` is **error** — do not use `any` unless unavoidable; if so, explain inline.
- `@typescript-eslint/no-unused-vars` allows prefixing with `_` (`argsIgnorePattern: '^_'`).
- **Server-only**: `no-restricted-syntax` enforces `.js` extensions on all relative imports/exports. Missing `.js` is a lint error.
- **Web-only**: Nuxt `#imports` and `~/` are exempted from import resolution; `vue/multi-word-component-names` is off.

### Type system

- Server: `strict: true`, `module: NodeNext`, `moduleResolution: NodeNext`.
- Web: `strict: true`, type-checking via `nuxt typecheck`.
- BigInt over HTTP must remain string-based; convert to `BigInt` only for computation.
- Keep Zod schemas at the transport boundary; business rules go in services/domain.

## 3. Commands

### Dev

```
pnpm install
pnpm prepare:runtime          # migrate DB + init runtime + seed identity
pnpm dev                       # concurrently starts server + web
pnpm dev:server                # server only
pnpm dev:web                   # web only
./start-dev.sh [--reset-db]    # wrapper: prepare:runtime + reset DB optionally + start both
```

- Default ports: Web `:3000`, Server `:3001`.
- `DATABASE_URL` in `apps/server/.env` defaults to `file:../../../data/yidhras.sqlite` (relative to server package root).

### Quality

```
pnpm lint
pnpm typecheck
pnpm test                       # runs server unit + integration + e2e, plus web unit
pnpm test:unit                  # web unit + server unit
pnpm test:unit:watch
```

### Server-only tests

```
pnpm --filter yidhras-server test              # unit → integration → e2e sequentially
pnpm --filter yidhras-server test:unit
pnpm --filter yidhras-server test:integration
pnpm --filter yidhras-server test:e2e
pnpm --filter yidhras-server test:integration:watch
pnpm --filter yidhras-server smoke             # startup + key endpoint e2e only
```

### Single test file (non-obvious — must specify config)

```bash
pnpm --filter yidhras-server exec vitest run --config vitest.integration.config.ts tests/integration/<file>.spec.ts
pnpm --filter yidhras-server exec vitest run --config vitest.e2e.config.ts tests/e2e/<file>.spec.ts
```

### Other

```
pnpm --filter yidhras-server reset:dev-db        # wipe and re-seed local dev DB
pnpm scaffold:world-pack -- --dir <dir> --name "<Name>" --author "<Author>"
pnpm --filter yidhras-server plugin -- <command>
```

### CI baseline

- `server-tests.yml`: runs `test:integration` on push/PR touching `apps/server/**` or `packages/contracts/**`.
- `server-smoke.yml`: runs `prepare:runtime` then e2e smoke tests (startup + endpoints), same trigger paths.
- `test:e2e` is not in the default CI gate; it's for local/manual verification.

## 4. Test Isolation

- **unit**: default parallelism.
- **integration**: `fileParallelism: false` (serial).
- **e2e**: `fileParallelism: false`; uses `tests/helpers/runtime.ts` to spin up isolated temp DBs per session via `DATABASE_URL` override. Do not promote integration/e2e to parallel until temp-db isolation is universal.
- Test directories: `tests/unit/`, `tests/integration/`, `tests/e2e/`. Support modules in `tests/support/`, helpers in `tests/helpers/`, fixtures in `tests/fixtures/`.
- Vitest workspace config at repo root (`vitest.workspace.ts`) merges all sub-configs.

## 5. Architecture Anchors

### Server entrypoints

- Composition root: `apps/server/src/index.ts`.
- Express wiring: `apps/server/src/app/create_app.ts`.
- Routes in `src/app/routes/*.ts` — transport-level and thin; domain logic belongs in services.
- Services in `src/app/services/*.ts` — orchestration and read-model assembly.

### Runtime / simulation

- `src/core/simulation.ts` owns: Prisma init, SQLite pragmas, world-pack loading, clock, narrative resolver, dynamics, runtime speed, graph access. **Do not turn `SimulationManager` into a generic bucket.**
- Runtime loop: `src/app/runtime/simulation_loop.ts` — serialized.
- Runtime readiness: `AppContext.assertRuntimeReady(feature)`.
- `src/app/context.ts` defines `AppContext` — the shared runtime state shell.

### Inference / workflow

- `src/app/services/inference_workflow.ts` is a facade; actual logic is split into focused modules under `src/app/services/inference_workflow/`.
- Route boundary: `src/app/routes/inference.ts` → `src/inference/service.ts`.

### Config

- Runtime config is YAML-layered: built-in defaults → `data/configw/default.yaml` → `data/configw/local.yaml` (gitignored). See `src/config/runtime_config.ts`.

### Scheduler

- Partition-aware, multi-worker. Lease and cursor state are partition-scoped.

### World packs

- Loaded through `src/packs/manifest/loader.ts`.
- Schema: `src/packs/schema/constitution_schema.ts`, `src/packs/manifest/constitution_loader.ts`.
- Runtime materialization: `src/packs/runtime/materializer.ts`.
- Pack-specific logic must flow through world-pack modules, not ad-hoc route logic.
- Minimum pack contents: `config.yaml` + `README.md`.

### Frontend

- Pages: `apps/web/pages/*.vue`.
- Features: `apps/web/features/**` — UI, adapters, composables, route-state helpers.
- Prefer route-backed state for page context; stores hold fetch state or ephemeral UI state.
- Graph rendering: `features/graph/*`, uses `ClientOnly + GraphCanvas + Cytoscape`.
- Theme: `apps/web/plugins/theme.ts`; semantic UI in `components/ui/*`.

## 6. Coding Conventions

- In `apps/server`, use relative imports **with `.js` extension**. Enforced by ESLint `no-restricted-syntax`.
- Remove unused imports; avoid formatting-only churn.
- Keep comments only when they explain non-obvious behavior.
- Keep success/error HTTP envelopes stable; don't expose internals.
- Preserve inference/workflow stage-specific failure info in logs.

## 7. Documentation Boundaries

Prefer linking over duplicating.

- `README.md` — repository entry, startup, high-frequency commands.
- `docs/INDEX.md` — doc navigation and source-of-truth rules.
- `AGENTS.md` — this file.
- `docs/API.md` — public API contracts and error codes.
- `docs/ARCH.md` — architecture boundaries and module ownership.
- `docs/LOGIC.md` — business rules and domain semantics.
- `docs/WORLD_PACK.md` — world-pack packaging and release guidance.
- `docs/ENHANCEMENTS.md` — redirect stub; actual backlog at `.limcode/enhancements-backlog.md`.
- `docs/THEME.md` — frontend theme contract.
- `docs/guides/COMMANDS.md` — full command matrix.
- `docs/guides/DB_OPERATIONS.md` — DB migration, init, path changes.
- `docs/guides/PLUGIN_OPERATIONS.md` — plugin governance operations.

When behavior changes, update the most appropriate primary doc in the same change.