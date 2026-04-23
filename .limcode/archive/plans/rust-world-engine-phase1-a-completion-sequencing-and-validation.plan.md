<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/rust-world-engine-phase1-boundary-and-sidecar-design.md","contentHash":"sha256:e170764bf3aecc538807217a26077064ec6720af1266315217ee47ba1eb8af90"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] Decide and freeze the completion target for A: objective_enforcement becomes the Phase-1-complete Rust-owned real rule execution path, while Host retains persistence, authority validation, mediator validation, event bridging, and execution recording.  `#rust-a-plan-p1-scope-decision`
- [x] Audit the remaining semantic gaps between Rust sidecar objective execution and the TS objective_rule_resolver / enforcement path, including template rendering, target/artifact/world context shaping, condition matching, failure semantics, and event shaping.  `#rust-a-plan-p2-parity-audit`
- [x] Implement the parity fixes in the shared contract, Node request/result bridge, and Rust sidecar objective execution handler, while preserving the existing Host-managed persistence boundary.  `#rust-a-plan-p3-parity-implementation`
- [x] Expand coverage to representative real rule shapes, remove accidental split behavior, define explicit fallback policy, and clean up interface mismatches such as test-side lifecycle typing around worldEngine stop semantics.  `#rust-a-plan-p4-breadth-boundary-hardening`
- [x] Add structured diagnostics for sidecar objective execution so future regressions can be attributed to rule matching/rendering/sidecar behavior without being confused with scheduler baseline issues.  `#rust-a-plan-p5-observability-and-failure-attribution`
- [x] Run the full A validation matrix, decide whether A can close at objective_enforcement parity within Phase 1, and record non-blocking follow-up enhancement candidates in docs/ENHANCEMENTS.md during implementation close-out.  `#rust-a-plan-p6-validation-and-closeout`
<!-- LIMCODE_TODO_LIST_END -->

# Rust world engine Phase 1 - A completion sequencing and validation plan

> Source design document: `.limcode/design/rust-world-engine-phase1-boundary-and-sidecar-design.md`

## 1. Purpose

This follow-up plan defines how to complete **A: gradually migrate real world rule execution from `TsWorldEngineAdapter` into the Rust sidecar** within the already confirmed Phase 1 boundary.

The immediate goal is **not** to widen Rust into scheduler, workflow host, plugin host, AI gateway, or direct persistence ownership. Instead, the goal is to finish A in a controlled way by taking the currently started objective-rule path from **minimal real migration foothold** to a **closure-grade, verified execution boundary**.

## 2. Current baseline

The project already has the following in place:

- world engine contracts, TS adapter, Host-managed persistence, sidecar transport, and PackHostApi read surface
- a new `world.rule.execute_objective` contract and a first Rust-side objective execution handler
- a Node bridge that can build sidecar requests and translate sidecar results back into the current enforcement plan shape
- one real invocation -> enforcement -> host-persisted mutation / rule-execution-record path already routed through the sidecar

That means A is no longer at the design-only stage. However, the current migration is still incomplete because it does **not yet provide semantic parity, representative breadth, stable fallback policy, or closure-grade validation**.

## 3. Decision: what counts as "A complete"

This plan freezes the recommended completion target for A as follows:

### 3.1 Recommended completion target

A should be considered complete when:

1. `objective_enforcement` becomes the **Phase-1-complete Rust-owned real rule execution path** for the intended invocation/enforcement flow;
2. Host remains the owner of:
   - authority validation
   - mediator binding validation
   - persistence writes
   - event bridge / Prisma event creation
   - rule execution record persistence
3. the Rust sidecar is trusted to produce the execution plan semantics for representative real rule shapes;
4. parity and validation coverage are strong enough that the system does not rely on ambiguous dual-logic behavior.

### 3.2 What is intentionally *not* required for A completion

The following are explicitly out of scope for closing A in this plan:

- scheduler migration or scheduler fixes
- plugin/runtime/workflow host migration
- decision runner / action dispatcher migration
- an unbounded migration of every possible rule family before objective-rule parity is complete

### 3.3 Scope gate for any further widening

Only after `objective_enforcement` reaches parity and strong validation should the team decide whether Phase 1 truly requires any additional rule family beyond objective enforcement. Unless the audit shows a concrete gap in real active-pack behavior, the recommended end-state is to **close A at objective-rule completion**, not to expand into an open-ended rewrite.

## 4. Recommended implementation order

The recommended order for completing A is:

1. **Freeze A completion scope and parity target**
2. **Audit semantic gaps against the current TS resolver/enforcement path**
3. **Implement parity fixes in Rust + shared bridge/contract layers**
4. **Expand to representative real rule shapes and harden boundary/fallback policy**
5. **Add observability and structured failure attribution**
6. **Run the full validation matrix and decide closure**
7. **During implementation close-out, append non-blocking future improvements to `docs/ENHANCEMENTS.md`**

This order is intentional:

- parity must come before breadth, or test breadth will certify the wrong semantics;
- breadth must come before closure, or the migration remains a single-path demo;
- fallback and observability must be made explicit before calling the path production-trustworthy;
- enhancement capture should happen only after the main engineering completion shape is clear, so `docs/ENHANCEMENTS.md` stays focused on genuinely deferred items rather than active work.

## 5. Execution phases

## Phase A-P1 - Freeze the completion target for A

### Goal

Turn the current partially migrated state into an explicit closure target, so the implementation does not drift into an unlimited Rust expansion.

### Work

1. Confirm that `objective_enforcement` is the primary real rule execution path to complete in Phase 1.
2. Confirm that Host-managed persistence remains unchanged.
3. Confirm that Host continues to own authority and mediator validation.
4. Confirm whether TS fallback remains:
   - temporary implementation fallback,
   - feature-flagged emergency fallback, or
   - test-only compatibility fallback.
5. Confirm the expected closure rule: whether A can close at objective-rule parity, or whether one more rule family must be nominated.

### Deliverable

- a frozen A completion target with no ambiguity about what “done” means

---

## Phase A-P2 - Semantic parity audit

### Goal

Enumerate the remaining semantic differences between the Rust sidecar path and the current TS path.

### Audit targets

Compare the Rust sidecar handler and Node bridge against:

- `apps/server/src/domain/rule/objective_rule_resolver.ts`
- `apps/server/src/domain/rule/enforcement_engine.ts`
- the existing objective enforcement tests

### Audit dimensions

1. **Rule matching parity**
   - `invocation_type`
   - `capability`
   - `mediator`
   - `target.kind`
   - missing / nullable field behavior

2. **Context construction parity**
   - subject context
   - target context
   - artifact context
   - world context
   - fallback ordering for `target_entity_id` vs `artifact_id`

3. **Template rendering parity**
   - supported placeholders
   - nested paths
   - null / empty rendering behavior
   - mixed primitive rendering behavior

4. **Mutation planning parity**
   - subject state mutation
   - target state mutation
   - world state mutation
   - entity namespace selection

5. **Event shaping parity**
   - event type/title/description
   - impact_data rendering behavior
   - artifact linkage behavior

6. **Failure behavior parity**
   - no-match behavior
   - invalid-input behavior
   - sidecar error mapping into Host `ApiError`

### Deliverable

- a parity checklist with explicit “already matched / missing / intentionally deferred” annotations

---

## Phase A-P3 - Parity implementation

### Goal

Close the semantic gaps identified in A-P2 without breaking the current boundary model.

### Work

1. Update the Rust sidecar objective execution handler to match the supported TS semantics.
2. Tighten or extend the shared contracts only where needed to support stable semantics.
3. Keep the Node bridge as the single translation layer for:
   - invocation -> sidecar request
   - sidecar result -> host-side execution plan
4. Ensure Host persistence orchestration remains unchanged.
5. Avoid reintroducing direct rule-planning logic into unrelated host layers.

### Non-goals in this phase

- no scheduler work
- no direct sidecar persistence
- no premature widening into unrelated rule families

### Deliverable

- a semantically trustworthy Rust-owned objective execution planner

---

## Phase A-P4 - Breadth coverage and boundary hardening

### Goal

Prove that the migrated path works across representative real rule shapes and eliminate accidental ambiguity in runtime behavior.

### Representative scenarios to cover

At minimum, add or adapt tests for:

1. invocation-type-only rule
2. capability + mediator constrained rule
3. `target.kind` constrained rule
4. artifact-only target fallback path
5. subject + target + world combined mutation path
6. emitted-events path
7. no-match / failed execution recording path

### Boundary hardening tasks

1. Make fallback policy explicit:
   - when sidecar is unavailable,
   - when sidecar returns no-match,
   - when sidecar returns an invalid result
2. Eliminate silent split behavior where some objective execution paths use sidecar and others quietly stay on TS logic without policy.
3. Resolve typing and lifecycle mismatches around world engine test fixtures, including the currently observed test-side `stop` lifecycle mismatch against the `WorldEnginePort` interface.
4. Confirm there is still no plugin/workflow raw sidecar dependency.

### Deliverable

- representative real-path confidence rather than a single-path demo

---

## Phase A-P5 - Observability and failure attribution

### Goal

Make future regressions explainable without mixing them with unrelated scheduler baseline concerns.

### Work

1. Add structured objective execution diagnostics, ideally including:
   - matched rule id
   - no-match classification
   - condition mismatch reason category
   - template render summary / diagnostics
   - mutation count / event count
2. Ensure Host can distinguish:
   - sidecar transport failure
   - sidecar semantic no-match
   - invalid sidecar response
   - host persistence failure after valid plan creation
3. Keep scheduler baseline attribution separate in test reporting and progress tracking.

### Deliverable

- structured execution diagnostics sufficient for parity debugging and later review

---

## Phase A-P6 - Validation, closure decision, and enhancement capture

### Goal

Decide whether A can formally close and ensure deferred non-blocking learnings are preserved.

### Validation matrix

#### 1. Contract / schema validation

- contract parse coverage for `world.rule.execute_objective`
- request/result schema validation
- TypeScript compile safety across contracts and server

#### 2. Sidecar client / bridge validation

- Node client roundtrip tests
- request-building tests
- result-translation tests
- error mapping tests

#### 3. Semantic parity validation

For representative fixtures, confirm equivalence or intentionally documented differences between:

- TS resolver/enforcement path
- Rust sidecar objective execution path

Compare at least:

- selected rule id
- planned mutations
- emitted events
- host-persisted final state
- rule execution record shape
- failed/no-match behavior

#### 4. Boundary validation

Confirm that:

- Host still performs persistence
- sidecar still does not write Prisma / SQLite directly
- PackHostApi remains read-only
- runtime loop does not revert to direct `context.sim.step(...)`

#### 5. Regression validation

Run and review:

- targeted unit tests for sidecar objective execution
- existing objective enforcement unit tests
- sidecar client tests
- relevant world engine / pack runtime integration tests
- selected scheduler baseline test separately, without mixing failure attribution

### Closure decision

A may be closed if:

1. objective-rule execution parity is sufficiently strong,
2. representative rule-shape breadth is covered,
3. Host/sidecar boundary is stable,
4. validation matrix passes,
5. no mandatory additional Phase-1 rule family is left unaddressed.

If an additional rule family is still required, that family must be explicitly nominated as a **new, bounded continuation step**, not implicitly folded into the current milestone.

### Enhancement capture requirement

During implementation close-out, any **non-blocking** improvements discovered while finishing A must be appended to `docs/ENHANCEMENTS.md`, for example:

- richer sidecar execution diagnostics beyond the minimum required for closure
- cargo/binary resolution and local developer ergonomics improvements
- broader parity-fixture reuse infrastructure
- stronger feature-flag / fallback governance for sidecar execution modes
- future extension ideas for non-objective rule families after Phase 1

Only genuinely deferred items should be recorded there; items required to close A must remain in the implementation path, not be pushed into the backlog.

## 6. Risks and controls

### Risk 1 - A expands into an unbounded Rust rewrite

**Control:** Freeze A completion at objective-rule parity unless a concrete extra rule family is proven necessary.

### Risk 2 - Parity tests certify the wrong semantics

**Control:** Perform the explicit parity audit before adding broad coverage.

### Risk 3 - Sidecar fallback remains ambiguous

**Control:** Define one explicit fallback policy in A-P4 and encode it in tests.

### Risk 4 - Future regressions get misattributed to scheduler

**Control:** Keep structured sidecar diagnostics and separate scheduler baseline reporting.

### Risk 5 - Boundary erosion reintroduces host-side rule duplication

**Control:** Keep all sidecar request/result translation centralized in the bridge layer and avoid scattering duplicated planning logic.

## 7. Done definition for this follow-up plan

This follow-up plan is complete when:

1. the A completion target is frozen and implemented;
2. the Rust sidecar objective execution path reaches strong semantic parity with the supported TS path;
3. representative real rule shapes are covered;
4. fallback/boundary behavior is explicit and tested;
5. validation passes;
6. a closure decision for A is recorded;
7. deferred non-blocking learnings are added to `docs/ENHANCEMENTS.md` during implementation close-out.
