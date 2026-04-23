# Rust Migration Status Matrix and Exit Criteria

## Scope

This matrix consolidates the current migration state for:

- scheduler decision kernel
- memory trigger engine
- world engine

It is derived from:

- `.limcode/review/rust-module-migration-gap-review.md`
- `.limcode/design/rust-ts-host-runtime-kernel-boundary-and-clock-projection-design.md`
- implemented host projection work in `apps/server/src/app/runtime/runtime_clock_projection.ts`

---

## 1. Module status matrix

| Module | Rust-owned core | TS-host-owned responsibilities | Why TS still cannot be removed | Current status |
|---|---|---|---|---|
| Scheduler decision kernel | `scheduler.kernel.evaluate` core: candidate merge, cooldown/recovery suppression, sorting, job draft generation | lease, ownership, partition cursor, idempotency dedupe, DB job materialization, run snapshot, observability | `rust_primary` fallback still drops to TS; `rust_shadow` still uses TS as parity baseline; scheduler runtime side effects still live in TS | **Partially migrated: Rust core + TS runtime ownership** |
| Memory trigger engine | trigger evaluation, activation score, status resolve, runtime-state transition calculation, source evaluate result assembly | evaluation context assembly, candidate block fetch, runtime-state persistence writeback, context-node materialization | `rust_primary` fallback still drops to TS evaluator; `rust_shadow` still uses TS as parity baseline; upstream/downstream context seam still lives in TS | **Partially migrated: Rust evaluator + TS orchestration/materialization** |
| World engine | pack session load/unload, session query handling, prepare/commit/abort core, objective rule execution skeleton | host persistence, observable clock projection, runtime loop orchestration, plugin contributor registry, query host seam, invocation side effects | plugin system remains TS-host-owned; host persistence remains TS-owned; query/invocation bridges remain TS-owned; external observable clock is now explicitly TS-host-projected | **Least complete: Rust session core + TS host runtime kernel** |

---

## 2. Detailed ownership seams

### 2.1 Scheduler decision kernel

#### Rust-owned today
- `apps/server/rust/scheduler_decision_sidecar/src/kernel.rs`
- `apps/server/rust/scheduler_decision_sidecar/src/policy.rs`
- `apps/server/rust/scheduler_decision_sidecar/src/models.rs`
- `apps/server/rust/scheduler_decision_sidecar/src/main.rs`

#### TS-owned today
- `apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts`
- `apps/server/src/app/runtime/scheduler_decision_kernel.ts`
- `apps/server/src/app/runtime/agent_scheduler.ts`

#### Ownership interpretation
Rust owns the pure decision kernel.
TS still owns runtime consequences and production safety rails.

#### Exit criteria before TS reference can be removed
- Rust kernel parity diff remains stable for a sustained window.
- `rust_shadow` no longer depends on TS as the mandatory baseline.
- `rust_primary` no longer requires production fallback to TS for expected failure classes.
- Team decides whether scheduler runtime ownership itself remains in TS permanently or migrates further.

---

### 2.2 Memory trigger engine

#### Rust-owned today
- `apps/server/rust/memory_trigger_sidecar/src/engine.rs`
- `apps/server/rust/memory_trigger_sidecar/src/source.rs`
- `apps/server/rust/memory_trigger_sidecar/src/trigger.rs`
- `apps/server/rust/memory_trigger_sidecar/src/logic_dsl.rs`
- `apps/server/rust/memory_trigger_sidecar/src/models.rs`
- `apps/server/rust/memory_trigger_sidecar/src/main.rs`

#### TS-owned today
- `apps/server/src/memory/blocks/provider.ts`
- `apps/server/src/memory/blocks/trigger_engine.ts`
- `apps/server/src/context/sources/memory_blocks.ts`

#### Ownership interpretation
Rust owns evaluator logic.
TS still owns input assembly and output application.

#### Exit criteria before TS reference can be removed
- Rust evaluator parity diff remains stable for a sustained window.
- `rust_shadow` no longer requires TS evaluator as baseline.
- `rust_primary` fallback can be reduced or removed.
- Input preparation seam is either explicitly declared permanently TS-owned or migrated behind a stable contract.
- Result application/materialization seam is either explicitly declared permanently TS-owned or migrated behind a stable contract.

---

### 2.3 World engine

#### Rust-owned today
- `apps/server/rust/world_engine_sidecar/src/session.rs`
- `apps/server/rust/world_engine_sidecar/src/state.rs`
- `apps/server/rust/world_engine_sidecar/src/step.rs`
- `apps/server/rust/world_engine_sidecar/src/objective.rs`
- `apps/server/rust/world_engine_sidecar/src/main.rs`

#### TS-owned today
- `apps/server/src/app/runtime/world_engine_persistence.ts`
- `apps/server/src/app/runtime/simulation_loop.ts`
- `apps/server/src/app/runtime/world_engine_ports.ts`
- `apps/server/src/app/runtime/world_engine_contributors.ts`
- `apps/server/src/plugins/runtime.ts`
- `apps/server/src/domain/rule/enforcement_engine.ts`
- `apps/server/src/app/runtime/runtime_clock_projection.ts`
- `apps/server/src/app/routes/clock.ts`
- `apps/server/src/app/services/overview.ts`

#### Ownership interpretation
Rust owns session semantics and commit results.
TS owns the externally visible runtime kernel.

PackHostApi should be treated as a long-term TS-host-owned read contract rather than a migration-only bridge.

#### Important change already implemented
The clock seam is now explicitly host-projected:

- world engine commit returns `committed_tick` / `clock_delta`
- TS host applies projection through `runtime_clock_projection.ts`
- `/api/clock`
- `/api/clock/formatted`
- `packHostApi.getCurrentTick()`
- `overview.world_time`

now prefer host projection instead of stale local-only reads

#### Exit criteria before “world engine migrated” can be claimed
- Persistence ownership is explicitly documented as host-owned or separately re-designed; it must not remain ambiguous.
- Plugin contributor seam is explicitly classified; if it stays TS-host-owned, it should no longer be described as an unfinished migration gap.
- Query host seam is explicitly classified; `PackHostApi` should be documented as the long-term host-mediated read contract for upper-layer consumers.
- Invocation side-effect seam is explicitly classified as host-owned or separately re-designed under a bounded contract.
- Observable clock ownership remains single-source and documented.
- No external route/UI path reads a second clock truth.

---

## 3. Permanent architecture vs temporary debt

### Likely permanent TS-host-owned capabilities
These should not be treated as accidental leftovers unless a separate design says otherwise:

- plugin runtime capability host
- contributor registry
- route/API exposure layer
- some repository-backed query seams
- operator-facing runtime projection surfaces

### Likely temporary migration debt or undecided seams
These still need explicit decision:

- whether any part of world engine persistence should ever move beyond the accepted host-owned delta-apply model
- whether any query path needs deeper Rust participation beyond the PackHostApi host contract
- whether any invocation side-effect path deserves bounded Rust deepening for clear safety/performance reasons
- fallback/parity retirement criteria

Plugin contributor lifecycle is not listed here because the default planning assumption should now be TS-host-owned unless a future design explicitly overrides it.

---

## 4. Recommended classification language

Use these labels when discussing migration status:

- **Fully Rust-owned core**: pure computation/session core is already in Rust.
- **TS-host-owned seam**: runtime ownership remains in TS by architecture.
- **Reference/fallback debt**: TS still exists because Rust rollout safety policy requires it.
- **Undecided ownership seam**: no explicit long-term owner has been chosen yet.

Applied now:

- Scheduler: fully Rust-owned core + TS-host-owned seam + reference/fallback debt
- Memory trigger: fully Rust-owned evaluator core + TS-host-owned seam + reference/fallback debt
- World engine: partially Rust-owned session core + multiple TS-host-owned seams + a small set of explicitly undecided or optional deepening seams

---

## 5. Immediate conclusion

The project should not be described as “almost done migrating to Rust except for a few TS leftovers”.
That description is false.

The accurate description is:

> The project currently operates as **Rust sidecar core + TS host runtime kernel**.

Within that architecture:

- scheduler and memory trigger have already migrated their pure cores
- world engine still depends heavily on TS host runtime ownership
- plugin capability is a structural reason TS remains necessary
- host clock projection is now an explicit part of the TS runtime kernel, not an accidental compatibility shim

---

## 6. Recommended next follow-up after this matrix

1. Document which seams are **permanently TS-host-owned**.
2. Document which seams are merely **optional Rust deepening candidates** rather than default migration obligations.
3. Retire parity/fallback dependencies module by module only after explicit acceptance criteria are met.
4. Do not describe future work as “remove TS” unless the specific seam owner has been chosen.

---

## 7. Proposed seam decisions

### 7.1 Seams that should currently be treated as TS-host-owned by default

Unless a new design explicitly overrides them, the following should be treated as TS-host-owned runtime seams rather than accidental leftovers:

- plugin runtime registration and contributor lifecycle
- route/API exposure and operator-facing response shaping
- host runtime projection surfaces such as clock/status/overview
- repository-backed query aggregation that depends on existing server persistence layout

This matters because these seams are where pack/plugin capability and external observability currently live.

### 7.2 Seams that remain valid Rust phase2/phase3 candidates

These are still reasonable migration candidates, but only after explicit ownership decisions and contracts:

- deeper world engine persistence ownership
- query host seam narrowing or Rust-facing query protocol beyond the long-term PackHostApi host contract
- invocation side-effect bridge narrowing or Rust-facing apply protocol
- retirement of TS reference/fallback implementations for scheduler and memory trigger

These should be treated as optional deepening opportunities, not as proof that the current TS-host-owned seam is incomplete by default.

---

## 8. Exit-criteria checklist by class

### 8.1 Reference / fallback retirement checklist

Before removing a TS reference implementation used for fallback/parity:

- parity diff must remain acceptably low over a defined stability window
- operational diagnostics must be sufficient to replace TS-side comparison confidence
- rollback strategy must not require restoring production traffic to the deleted TS path immediately

### 8.2 Host-seam migration checklist

Before migrating a TS host seam into Rust:

- the seam owner must be explicitly chosen
- input/output contract must be written down
- restart/recovery semantics must be defined
- operator/API observability impact must be defined
- plugin integration impact must be defined

### 8.3 World-engine-specific closure checklist

Before claiming world engine ownership migration is complete:

- external observable clock must stay single-source
- persistence ownership must be settled
- plugin contributor ownership must be settled
- query host seam ownership must be settled
- invocation side-effect seam ownership must be settled
- route/overview/status surfaces must not bypass host projection
