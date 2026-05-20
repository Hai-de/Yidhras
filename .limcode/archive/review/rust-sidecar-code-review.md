# Rust Sidecar Code Review — Critical Findings

**Scope**: `apps/server/rust/` — world-engine, memory-trigger, scheduler-decision
**Reviewed**: 2026-05-20, all source files, ~3500 lines of Rust
**Refactored**: 2026-05-21 — see `.limcode/plans/rust-sidecar-refactor-plan.md`

## Resolution Status

| # | Issue | Status |
|---|-------|--------|
| 1 | Duplicated protocol layer | **FIXED** — unified in `sidecar-common` crate (shared `protocol.rs` + `transport.rs` + `types.rs`) |
| 2 | `serde_json::Value` as universal data type | **PARTIAL** — typed domain model structs added in `world-engine/src/models/`, engine/handlers separation improves testability. Internal JSON manipulation still uses `Value` for complex nested templates |
| 3 | Monolithic handler functions | **FIXED** — handlers split into `engine/` (pure logic) + `handlers/` (thin param extraction); `evaluate` in scheduler-decision decomposed with `determine_skip_reason`, `build_skip_decision`, `build_accept_decision` |
| 4 | Dead and nonsensical code | **FIXED** — `get_str_nullable` dead null-check removed, `#[allow(dead_code)]` → `#[cfg(test)]`, `or_insert(0)` after pre-populated HashMap removed, `let _ = &mut state` hack removed |
| 5 | Silent error swallowing | **IMPROVED** — `Tick` newtype with explicit `TickParseError`; `unwrap_or(0)` on tick parse retained at protocol boundary with `eprintln!` warning path available |
| 6 | Type inconsistency (u64/i64/i128) | **FIXED** — unified `Tick(u64)` newtype in `sidecar-common/src/types.rs`, used across all three sidecars |
| 7 | Clone abuse | **PARTIAL** — `CommittedTickCache` separation avoids some double-borrows; clone-heavy JSON manipulation in world-engine engine layer retained |
| 8 | Magic numbers | **UNCHANGED** — `mutated_entity_count: 2`, `delta_operation_count: 3` still hardcoded in `world-engine/src/engine/step.rs` |
| 9 | Borrow-checker workaround | **FIXED** — `CommittedTickCache` extracted as independent struct with own methods; no more explicit scope block |
| 10 | Enum-to-enum conversion duplicated 7+ times | **FIXED** — `From<EventDrivenSchedulerReason> for SchedulerReason` in `scheduler-decision/src/conversion.rs`; exhaustive `is_event_driven_reason`; all conversions via `.into()` |
| 11 | String-based dispatch key using Debug | **FIXED** — `Display` impls for `SchedulerKind` and `SchedulerReason`; `build_candidate_key` uses `{}` formatting |
| 12 | No Cargo workspace | **FIXED** — workspace `Cargo.toml` at `apps/server/rust/` with shared deps, `[workspace.lints]`, `rustfmt.toml` |
| 13 | Template engine naive | **FIXED** — `RenderStats` counts actual `{{...}}` substitutions; `needs_template()` fast path; 8 unit tests added |
| 14 | Test coverage gaps | **IMPROVED** — world-engine template.rs now has 8 tests; scheduler-decision still needs tests |

---

## 1. Duplicated protocol layer across all three sidecars (CRITICAL)

`protocol.rs` is copy-pasted three times with identical `RpcRequest`, `RpcResponse`, `RpcError`, `rpc_result`, and `rpc_error`. The only difference is that `world-engine` adds `get_required_string` / `get_optional_string` helpers. No shared internal crate. Any bug fix or protocol change requires editing three files. This is not "three small files" — this is the beginning of a maintenance nightmare where drift is guaranteed.

Further, the `main.rs` JSON-RPC loop is structurally identical across all three sidecars: `stdin.lock().lines()`, parse, dispatch, serialize, `writeln!`. Extracting a shared `sidecar-stdio` crate would eliminate ~150 duplicated lines across the three sidecars immediately.

Inconsistencies between the copies:
- `world-engine`: `RpcError.data` has **no** `skip_serializing_if` — emits `"data": null` in JSON.
- `memory-trigger` and `scheduler-decision`: `RpcError.data` does have `skip_serializing_if` — omits null data.
- `world-engine` uses `.expect()` on I/O writes → panics on broken pipe.
- `memory-trigger` and `scheduler-decision` use `let _ = writeln!(...)` → silently drops I/O errors.

## 2. `serde_json::Value` used as universal data type (CRITICAL)

The entire world-engine treats `serde_json::Value` as its domain model. `SessionState` holds `Vec<Value>` for world_entities, entity_states, authority_grants, mediator_bindings, rule_execution_records. Every operation is `item.get("field").and_then(Value::as_str).map(|v| v.to_string())`. There are zero properly typed structs for any of these domain concepts.

Consequences:
- **Zero compile-time safety**: a typo in a field name like `"entitiy_kind"` compiles fine and silently returns `None` at runtime.
- **No IDE support**: no autocompletion, no refactoring, no "find all references" for domain fields.
- **Every access is fallible**: the `.and_then().and_then().unwrap_or()` chains are the only thing preventing crashes, and they silently swallow structural mismatches.
- **Clone-hell**: `serde_json::Value` cloning is deep and expensive. `session.world_entities.clone()` clones the entire entity array even when a single field is needed.
- **No documentation of shape**: the schema of each `Vec<Value>` is implicit in the string literals scattered across the codebase. A new developer has no way to discover the expected structure short of reading every `.get("...")` call.

## 3. Monolithic handler functions (HIGH)

| Function | File | Lines |
|---|---|---|
| `handle_execute_objective` | `objective.rs` | ~290 |
| `handle_step_prepare` | `step.rs` | ~240 |
| `handle_state_query` | `session.rs` | ~145 |
| `evaluate` | `kernel.rs` | ~220 |

These functions do everything: parameter extraction, validation, business logic, and response construction in a single scope. `handle_execute_objective` contains inline closures (`get_str`, `get_str_nullable`, `get_record`, `get_number`, `get_bool`) defined mid-function that are each used exactly once.

The rule matching loop in `handle_execute_objective` (lines 179-383) iterates rules, checks 4-5 filter conditions per rule, builds mutations for 5 different mutation kinds, builds emitted events, and then returns on the first match. There is no way to unit-test the matching logic, the mutation building, or the event construction independently.

## 4. Dead and nonsensical code (HIGH)

**`world-engine/src/objective.rs:277-279`** — `get_str_nullable`:
```rust
let get_str_nullable = |key: &str| -> Option<String> {
    rendered_obj.and_then(|o| o.get(key))
        .and_then(|v| if v.is_null() { None } else { v.as_str().map(|s| s.to_string()) })
};
```
`Value::as_str()` already returns `None` for `Value::Null`. The `if v.is_null()` check is dead code.

**`memory-trigger/src/engine.rs:231-232`** — dead assignment:
```rust
next.last_inserted_tick = Some(current_tick.to_string());       // line 231
next.delayed_until_tick = if behavior.retention.delay_rounds_before_insert > 0 {
    Some((now + behavior.retention.delay_rounds_before_insert as i128).to_string()) // line 232
} else { None };
```
Line 231 assigns `last_inserted_tick`, then line 246's `MemoryActivationStatusDto::Active` branch already sets both `last_triggered_tick` and `last_inserted_tick`. The line 231 assignment is between two other assignments in a struct literal and overridden by nothing — but wait, actually `next.delayed_until_tick` is assigned on 231. No — line 231 is `next.last_inserted_tick = Some(current_tick.to_string());`. Line 232 is `next.delayed_until_tick = ...`. These are different fields. But line 230 already sets `next.last_inserted_tick = Some(current_tick.to_string());`. So line 231 IS a dead assignment because line 230 already set it. Wait, let me re-read — line 230: `next.last_inserted_tick = Some(current_tick.to_string());` and line 231: `next.delayed_until_tick = ...`. These are different fields. OK, line 230 sets `last_inserted_tick` and line 231 sets `delayed_until_tick`. But wait — in the `Delayed` branch (line 247-257), `last_inserted_tick` is never set. So for the `Active` branch, `last_inserted_tick` is set correctly. Not dead code.

Actually let me re-read more carefully. I made an error. Line 230 is `next.last_inserted_tick = Some(current_tick.to_string());` — sets last_inserted_tick. Line 231 is `next.delayed_until_tick = if ...` — sets delayed_until_tick. These are different fields. No dead code here. My initial read was wrong on this one.

Let me correct — the real dead code is:
**`scheduler-decision/src/main.rs:103`** — `let _ = &mut state;` suppresses an "unused mut" warning. The variable is declared `mut` but never mutated. This is a lint suppression hack, not a fix; the correct fix is removing `mut`.

**`scheduler-decision/src/kernel.rs:28-39`** — `create_initial_skip_counts()` pre-populates all keys with 0, then later code does `*skip_counts.entry(reason).or_insert(0) += 1`. The `or_insert(0)` is dead code — all keys already exist. Either remove the pre-population or remove `or_insert(0)`.

**`memory-trigger/src/logic_dsl.rs:143`** — `#[allow(dead_code)]` on `debug_resolve_memory_logic_path`. The function is used in tests. Should be `#[cfg(test)]` instead. `#[allow(dead_code)]` permanently suppresses the warning even if the tests are deleted.

## 5. Silent error swallowing (HIGH)

- `parse_u64_or_default("abc", 0)` → `0`. Used for tick parsing in `state.rs`. A corrupted tick string silently becomes tick 0, potentially breaking simulation state.
- `parse::<i128>().unwrap_or(0)` in `memory-trigger/src/engine.rs` — same pattern. A corrupt tick string silently becomes 0.
- `parse::<u64>().unwrap_or(0)` in `models.rs:79` for `prune_committed_ticks` — unparseable tick strings are silently treated as 0 and potentially pruned or retained incorrectly.
- `memory-trigger` and `scheduler-decision` main loops silently ignore I/O write failures (`let _ = writeln!(...)`). If stdout is broken, the sidecar continues processing lines as if nothing happened.

## 6. Type inconsistency (MEDIUM)

Ticks are parsed as `u64`, `i64`, and `i128` in different places:
- `state.rs`: `parse_u64_or_default` → `u64`
- `engine.rs` (memory_trigger): `parse::<i128>()` → `i128`
- `models.rs` (memory_trigger): `trigger_count: i64`, `retain_rounds_after_trigger: i64`
- `kernel.rs` (scheduler): `parse_tick` → `u64`
- `step.rs` (world_engine): `parse::<u64>()`

There is no single tick type. Ticks flow between sidecars as strings (`"10"`, `"100"`) and get reparsed at every call site with different integer widths.

## 7. Clone abuse causing performance issues (MEDIUM)

- `world-engine/src/session.rs:44-66`: `handle_pack_load` — the `or_insert` creates a default session with all fields cloned, then immediately overwrites every field. The initial clone is wasted work.
- `world-engine/src/step.rs`: `prepared_state.clone()` clones the entire `PreparedSessionState` including all vectors and `Value` trees. This is done in `handle_step_commit` where the prepared state is consumed.
- `world-engine/src/state.rs:116`: `upsert_entity_state` does `entity_states.to_vec()` — clones the entire vector even when updating an existing entry (no new allocation needed).
- `world-engine/src/state.rs:176-179`: `get_selector_id_set` clones every string into a HashSet — the strings already exist in the JSON value.
- `world-engine/src/objective.rs:112-113`: `params.get("invocation").cloned().unwrap_or_else(|| json!({}))` — deep clones the invocation object, then later accesses individual fields from it again.

## 8. Magic numbers and hardcoded values (MEDIUM)

- `world-engine/src/step.rs:335-336`: `mutated_entity_count: 2` and `delta_operation_count: 3` — hardcoded literal integers in `build_prepared_step_summary` and `handle_step_prepare`. These values represent the number of operations being performed (upsert_entity_state + append_rule_execution + set_clock) but are not derived from the actual operations. If a new operation is added, these must be updated manually in multiple places.
- `world-engine/src/main.rs:29`: `engine_instance_id: "world-engine-sidecar"` — hardcoded string identifier. Same pattern in all three sidecars.
- `scheduler-decision/src/kernel.rs:315`: `input.entity_single_flight_limit <= 1` — magic number 1 used as threshold.
- `world-engine/src/models.rs:77`: `retain_ticks: 5` — hardcoded cache retention parameter with no explanation of why 5.

## 9. Borrow-checker workaround indicating design flaw (MEDIUM)

`world-engine/src/step.rs:199-255` uses an explicit scope block `{ }` to work around a borrow conflict between `state.sessions` (immutable for cache lookup) and `state.sessions` (mutable for modification). The `committed_ticks` HashMap lives on `AppState` alongside `sessions`, forcing the entire `AppState` to be borrowed when only `committed_ticks` is needed. Separating `committed_ticks` into its own struct behind a `RefCell` or moving the idempotency cache outside `AppState` would eliminate the scope hack and the conceptual confusion it represents.

## 10. Enum-to-enum conversion duplicated 7+ times (MEDIUM)

The mapping `EventDrivenSchedulerReason → SchedulerReason` appears:
- In `kernel.rs:117-129` (primary reasons in `merge_event_driven_signals`)
- In `kernel.rs:132-147` (secondary reasons in `merge_event_driven_signals`)
- In `policy.rs:52-61` (in `should_suppress_for_recovery_window`)

These are identical match blocks. If a new variant is added, three places must be updated. This should be a `From` implementation or a dedicated conversion function.

Additionally, `is_event_driven_reason` in `policy.rs:10-12` is defined as `!is_periodic_reason(reason)` — if a new `SchedulerReason` variant is added, it will silently be classified as event-driven. This should exhaustively list all variants.

## 11. String-based dispatch key using Debug formatting (MEDIUM)

`scheduler-decision/src/kernel.rs:41-42`:
```rust
fn build_candidate_key(agent_id: &str, kind: &SchedulerKind, reason: &SchedulerReason) -> String {
    format!("{}:{:?}:{:?}", agent_id, kind, reason)
}
```
Uses `Debug` formatting (`{:?}`) for enum variants in a hash key. Rust's `Debug` output is explicitly not guaranteed to be stable across compiler versions. This key is compared against `pending_job_keys` from the host. If the host uses Display formatting or stable string representations, the keys won't match. Use `serde_json::to_string` or explicit Display implementations.

## 12. No Cargo workspace (LOW)

The three sidecars are independent crates under `apps/server/rust/` with no shared workspace `Cargo.toml`. This prevents sharing the protocol layer and common utilities. A workspace-level `Cargo.toml` at `apps/server/rust/Cargo.toml` would enable a `sidecar-common` crate and unified `cargo build/test/clippy`.

## 13. Template engine is naive and untested for edge cases (LOW)

`world-engine/src/template.rs`:
- No handling of `{{` or `}}` literal escaping.
- `render_template_value` recursively traverses the entire JSON tree even when no template markers exist. A simple `contains("{{")` check before recursion would avoid unnecessary allocation.
- `rendered_template_count` in `objective.rs` uses `.len()` on JSON objects — counts keys, not template substitutions. A template with 3 keys but 0 `{{...}}` markers would report 3 template renders.
- The template engine is untested — zero unit tests for `template.rs`.

## 14. Test coverage gaps (LOW)

- `world-engine`: tests exist only for `memory-trigger` (engine, logic_dsl, sampling, trigger). Zero tests for `world-engine` itself (objective, session, state, step, template).
- `scheduler-decision`: zero tests.
- `world-engine` tests: none.
- The `template.rs` module with its custom `{{path.to.value}}` resolution has no tests at all.

## 15. Minor issues

- `protocol.rs` in `world-engine` has `RpcResponse.jsonrpc: &'static str` hardcoded to `"2.0"`. If the JSON-RPC version changes, every response builder must be updated.
- `get_required_string` returns `Result<&str, String>` — `String` as error type is unidiomatic. Use a proper error enum.
- `memory-trigger/src/models.rs:200` — `MemoryTriggerDto::Keyword { r#match, ... }` uses a raw identifier because `match` is a Rust keyword. The field should be renamed to `match_mode` or the serde rename should handle the mapping.
- `session_or_error` and `session_or_error_mut` in `state.rs` are near-duplicates differing only in `get` vs `get_mut`. A macro or generic would eliminate the duplication.

---

## Summary

The code has three structural problems that will make maintenance increasingly painful as the codebase grows:

1. **Zero type safety in the world_engine's domain model** — `serde_json::Value` for everything means every field access is a runtime gamble. This is the single biggest risk to correctness and maintainability.

2. **Code duplication at every layer** — protocol, main loop, enum conversions, error handling patterns — all copy-pasted. Three sidecars with no shared code.

3. **Functions are too large to test or reason about** — 200-300 line handler functions mix parameter parsing, business logic, and response formatting. No seams for unit testing.

The memory-trigger is in the best shape (reasonable model types, decent test coverage for engine/logic/trigger/sampling). The world-engine is in the worst shape (everything is `Value`, zero tests, 300-line functions). The scheduler-decision sits in between (proper types but zero tests, duplicated enum conversions).
