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

`docs/` 下的文档是**稳定事实源**，不是项目周报、过程记录或里程碑汇报。任何修改 `docs/` 的变更必须遵守以下铁律：

1. **去时间化** — 禁止一切将事实锚定在时间轴上的描述。禁用：`当前`、`目前`、`现已`、`已完全移除`、`Phase X 已完成`、`本阶段`、`尚未激活`、`将在...实现`、`当前缺失`、`当前实现状态` 等。文档只描述 timeless 的事实。

2. **去过程化** — `docs/` 与 `.limcode/` 完全隔离。稳定文档中不得出现 `.limcode/` 路径引用、不得出现 `Phase X`、`组件化重构` 等项目过程术语、不得引用设计草案或实施计划。

3. **去汇报化** — 禁止周报语气。禁用 `**当前实现状态**：...`、`**当前缺失**：...`、`**已完成**：...`、`系统始终：` 等格式。禁止解释"我们为什么这样设计"，只陈述"系统是这样工作的"。

4. **符号与格式净化** — 禁止 `§` 符号（改用标准 Markdown 锚点或标题引用）。禁止冗余括号注释（如 `（V1 已完全移除）`、`（含 Phase X...）`）。禁止用 `>` 引用块包裹核心定义。

5. **术语统一** — 同一篇文档内术语必须一致（如 `world-pack` / `世界包` 不得混用）。文档开头必须明确"本文档说明什么"和"本文档不说明什么"。

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