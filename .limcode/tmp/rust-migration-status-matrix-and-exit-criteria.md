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
- Persistence ownership is explicitly decided:
  - either permanently TS host-apply delta
  - or fully Rust-owned storage write path
- Plugin contributor seam is explicitly decided:
  - either permanently TS-host-owned
  - or bridged into a Rust-consumable extension protocol
- Query host seam is explicitly decided:
  - either permanently TS repository-backed
  - or migrated behind a Rust-owned contract
- Invocation side-effect seam is explicitly decided:
  - either permanently TS enforcement/apply bridge
  - or migrated behind a Rust-owned contract
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

- world engine persistence ownership depth
- query seam ownership depth
- invocation side-effect ownership depth
- fallback/parity retirement criteria

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
- World engine: partially Rust-owned session core + multiple TS-host-owned seams + undecided ownership seams

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
2. Document which seams are **phase2/phase3 Rust migration candidates**.
3. Retire parity/fallback dependencies module by module only after explicit acceptance criteria are met.
4. Do not describe future work as “remove TS” unless the specific seam owner has been chosen.
