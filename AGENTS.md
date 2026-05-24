# AGENTS.md

Repository guidance for coding agents working in `Yidhras`.

- Base every statement on the actual code, diffs, error logs, or explicit user requirements. Never invent behavior, APIs, or library features that are not present in the provided context or standard documentation.
- If the user's request is ambiguous, incomplete, or self-contradictory, stop immediately and ask targeted clarifying questions. Do not guess.
- If a requested feature is impossible given the current codebase, runtime, or constraints, state that clearly and terminate that approach. Do not offer alternatives unless asked.
- When correcting a user's code or assumption, state the correction plainly. Do not soften or preface with "You're right, but..." — just state the discrepancy and the fix.
- Prioritize correctness and safety over conversational flow. If the user's language or previous context leads away from the code, steer back to the code.
- Do not echo or expand on incorrect user assertions to be agreeable. If the code says otherwise, cite the code.
- Provide pros and cons of engineering choices only when they follow directly from the code or constraints. Do not add generic advice.
- Output only the response content needed to solve the problem. No greetings, no closings, no meta-commentary.


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

- `simple-import-sort/imports` and `simple-import-sort/exports` are **errors** in `src/` — imports and exports are auto-sorted.
- `@typescript-eslint/no-explicit-any` is **error** — do not use `any` unless unavoidable; if so, explain inline.
- `@typescript-eslint/no-unused-vars` allows prefixing with `_` (`argsIgnorePattern: '^_'`).
- `@typescript-eslint/no-non-null-assertion` is **warn** — pre-existing usages exist; avoid new ones.
- `@typescript-eslint/no-unsafe-type-assertion` is **error** — unsafe type assertions (`as` without runtime guard) are forbidden. Use `eslint-disable-next-line` with a justification for unavoidable boundary assertions (Express params, Prisma columns, JSON.parse, etc.), or use `boundaryCast<T>()` from `src/utils/type_guards.js` for `unknown` boundary casts.
- **Server-only**: `no-restricted-syntax` enforces `.js` extensions on all relative imports/exports. Missing `.js` is a lint error.
- **Server coverage**: `src/` (full rules + type-checked), `tests/` (warn-level quality rules, no boundaries), `scripts/` (warn-level quality rules, no boundaries), `builtin/` (full rules for plugin source, no boundaries).
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

# CLI tools (see docs/guides/COMMANDS.md for full reference)
pnpm --filter yidhras-server db status|migrate|integrity|tables
pnpm --filter yidhras-server validate:pack <dir>|--all
pnpm --filter yidhras-server sim status|pause|resume|speed|login
pnpm --filter yidhras-server ai models|test
pnpm --filter yidhras-server diag
pnpm --filter yidhras-server operator create|list|show|update|delete
pnpm --filter yidhras-server plugin list|confirm|enable|disable
pnpm --filter yidhras-server snapshot list|show|delete
pnpm --filter yidhras-server pack:export <dir> [--output <path>] [--force]
pnpm --filter yidhras-server pack:import <archive> [--force]
pnpm --filter yidhras-server sim:dump <packId> [--type agent|relation|memory|all]
pnpm --filter yidhras-server db:migrate-pack <packId> [--target-version <n>]
```

### CI baseline

- `server-tests.yml`: runs `pnpm lint` → `test:unit` (+ coverage) → `test:integration` on push/PR touching `apps/server/**` or `packages/contracts/**`. Web lint + unit tests run in a separate job.
- `server-smoke.yml`: runs `pnpm lint` → `prepare:runtime` → e2e smoke tests (startup + endpoints) → CLI smoke tests, same trigger paths.
- `test:e2e` is not in the default CI gate; it's for local/manual verification.
- Pre-commit hook via `simple-git-hooks` + `lint-staged` auto-fixes staged files on commit. Run `pnpm prepare` after first clone to install hooks.

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

- `src/core/simulation.ts` owns: Prisma init, SQLite pragmas, world-pack loading, pack catalog, registry wiring. **Do not turn `SimulationManager` into a generic bucket.**
- Clock 和 runtime speed 是 per-pack 资源 — 通过 `PackRuntimeHost` / `PackRuntimePort` 接口访问，不再作为全局单例。
- Runtime loop: `src/app/runtime/PackSimulationLoop.ts` — per-pack 6-step serialized loop, managed by `MultiPackLoopHost.ts`.
- Pack runtime resolution: `src/app/services/pack_runtime_resolution.ts` — 统一解析入口，优先使用 per-pack runtime，回退兼容旧接口。
- Runtime readiness: `AppContext.assertRuntimeReady(feature)`.
- `src/app/context.ts` defines `AppContext` — the shared runtime state shell.

### Inference / workflow

- `src/app/services/inference_workflow.ts` is a facade; actual logic is split into focused modules under `src/app/services/inference_workflow/`.
- Route boundary: `src/app/routes/inference.ts` → `src/inference/service.ts`.

### Config

- Runtime config is YAML-layered: built-in defaults → `data/configw/default.yaml` → `data/configw/local.yaml` (gitignored). See `src/config/runtime_config.ts`.

### Scheduler

- Partition-aware scheduler. Lease and cursor state are partition-scoped, all workers run within a single Node process.

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
- `docs/INDEX.md` — doc navigation and layer descriptions.
- `AGENTS.md` — this file.
- `docs/specs/API.md` — public API contracts and error codes.
- `docs/ARCH.md` — architecture boundaries and module ownership.
- `docs/ARCH_DIAGRAM.md` — system structure and call-flow diagrams.
- `docs/LOGIC.md` — business rules and domain semantics.
- `docs/specs/WORLD_PACK.md` — world-pack packaging and release guidance.
- `docs/ENHANCEMENTS.md` — redirect stub; backlog 不在稳定文档中维护。
- `docs/specs/THEME.md` — frontend theme contract.
- `docs/subsystems/PROMPT_WORKFLOW.md` — prompt workflow runtime details.
- `docs/subsystems/AI_GATEWAY.md` — AI gateway and invocation observability.
- `docs/subsystems/PLUGIN_RUNTIME.md` — pack-local plugin runtime and governance.
- `docs/guides/COMMANDS.md` — full command matrix.
- `docs/guides/DB_OPERATIONS.md` — DB migration, init, path changes.
- `docs/guides/PLUGIN_OPERATIONS.md` — plugin governance operations.

When behavior changes, update the most appropriate primary doc in the same change.

### Stable reference doc iron rules

Documents under docs/ are the stable source of truth, not project weekly reports, process records, or milestone reports. Any changes to docs/ must obey the following iron rules:

1.  No time anchoring — Prohibit any description that anchors facts to a timeline. Forbidden terms: current, currently, now, has been completely removed, Phase X is complete, this phase, not yet active, will be implemented..., currently missing, current implementation status, etc. Documents describe only timeless facts.

2. No process references — docs/ is completely isolated from .limcode/. Stable documents must not contain path references to .limcode/, must not use project process terms such as Phase X or component refactoring, and must not refer to design drafts or implementation plans.

3. No status reporting — Prohibit a weekly report tone. Forbidden: **Current implementation status**: ..., **Currently missing**: ..., **Completed**: ..., The system always: , and similar formats. Do not explain “why we designed it this way”; only state “the system works this way”.

3. Symbol and formatting cleanup — Prohibit the § symbol (use standard Markdown anchors or heading references instead). Prohibit redundant parenthetical annotations (e.g., (V1 has been completely removed), (includes Phase X...)). Prohibit wrapping core definitions in > blockquotes.

4. Terminology consistency — Within a single document, terminology must be consistent (e.g., do not mix world-pack and 世界包). The document's beginning must clearly state what it explains and what it does not explain.

### Source-of-truth rules

1. **One primary source per topic.** Each topic has exactly one document that owns the definitive statement. Other documents only summarise and link, never copy large passages.

2. **Entry docs link, reference docs state facts, process docs record changes.**
   - Entry docs (`README.md`, `INDEX.md`) answer "where do I look?"
   - Reference docs (`ARCH.md`, `LOGIC.md`, `API.md`, `capabilities/*`) answer "what is the stable truth?"
   - Process docs (`.limcode/plans|design|review/`) answer "why did we change this and where are we in the change?"
   - Historical archives (`.limcode/archive/`, `docs/history/`) answer "how did we get here?"

3. **Separate state from facts.** Stable reference docs should not contain terms like "currently", "this phase", "to be migrated". Content that depends on such temporal framing belongs in `.limcode/` process assets.

4. **Command docs maintained centrally.** High-density command references, CLI examples, and test matrices live in `docs/guides/`, not in `README.md`.

### Governance conclusions (resolution order)

When multiple docs disagree:

1. Code and `packages/contracts` + `API.md` — interface contracts
2. `ARCH_DIAGRAM.md` — system structure and call flows
3. `ARCH.md` — architecture boundaries
4. `LOGIC.md` — business semantics
5. `subsystems/*` — subsystem-specific detail
6. `guides/DB_OPERATIONS.md` — deployment and DB operations
7. Latest `.limcode/review/` / `.limcode/plans/` / `.limcode/progress.md` — in-progress conclusions
8. `docs/history/` — historical migration and archival records