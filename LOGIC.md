# Yidhras Logic / 业务逻辑说明

Version: v0.3.1-draft
Last Updated / 最后更新: 2026-03-28

本文件偏向业务规则表达，不绑定未来可能变化的算法细节。
This file focuses on business rules rather than unstable low-level algorithm details.

## 1) Core Behavior Loop / 核心行为闭环

### Currently Implemented / 当前已实现

- Agent context can be queried through backend API.
- Narrative variables are resolved with permission-aware filtering.
- Social post creation and retrieval are available through API.
- Simulation tick advances continuously with pause/resume controls.
- Phase B inference debug endpoints can build prompt/context snapshots and return normalized decisions on demand.
- Minimal Phase D persistence baseline now stores trace / intent / job records for preview/run flows and exposes read APIs for audit/debug.
- Minimal formal job submission path now supports `idempotency_key`-based replay for duplicate submissions.
- Failed jobs can now be retried through an explicit retry API with bounded attempts.
- Decision jobs are now enqueued as `pending` work and consumed by a loop-driven runner rather than always completing in the submit request path.
- A first-pass dispatcher now converts eligible `post_message` intents into real L1 social posts.
- Minimal L4 transmission semantics now influence dispatch timing and drop behavior for social posts.
- Transmission policy can now be derived from policy capability, actor role, and agent SNR rather than relying only on manual overrides.
- Workflow aggregate reads now expose `decision_stage`, `dispatch_stage`, `workflow_state`, `failure_stage`, and `failure_code` for the same persisted chain.
- Duplicate-submit replay now distinguishes between:
  - no decision result yet (`result_source = not_available`)
  - historical stored decision reuse (`result_source = stored_trace`)
  - fresh retry result (`result_source = fresh_run`)
- Memory Core v1 now injects short-term memory into the inference pipeline before final prompt assembly.
- Prompt construction is no longer a single direct string-concatenation path; it now passes through prompt fragments and processors.
- Current trace snapshots can expose both which memory entries were selected and how prompt fragments were processed.
- Prompt Pipeline Phase 2 baseline now adds:
  - policy-based fragment removal before finalize
  - summary/compaction over high-volume short-term memory
  - token-budget trimming over lower-priority fragments

### Planned / 规划中

- Full perception-decision-action loop for autonomous agents.
- Action planning tied to role prompts and world state.
- Richer delayed dispatch behavior aligned with fuller transmission-layer constraints beyond the current minimal scheduling/drop baseline.
- The formal delivery route is now layered as:
  - **Phase B baseline:** inference contracts and prompt/context composition are already stabilized enough to act as the service boundary.
  - **Phase D baseline:** persisted decision/intent/job workflow is already active, but richer replay/orchestration and broader world-action consumption are still in progress.

## 2) Information Boundary / 信息边界规则

### Currently Implemented / 当前已实现

- Variables can carry access metadata (`min_level`, optional `circle_id`).
- Resolver returns safe placeholders for restricted or missing values.
- Agent context API computes circle-based permission context.
- Inference context assembly already reuses identity/binding/policy results rather than bypassing them with separate hidden rules.

### Planned / 规划中

- Broader policy coverage across all L1/L2/L3 data reads.
- Unified authorization checks for future agent action APIs.

### Identity Binding Lifecycle / 身份绑定生命周期（当前已实现）

- Identity can bind to active/atmosphere nodes with explicit role and status fields.
- Bindings support manual unbind (inactive) and explicit expiration (expired + expires_at).
- Runtime loop auto-expires bindings when `expires_at` is reached.
- Active-binding uniqueness guard: same `identity_id + role` cannot have duplicate `active` bindings.
- Binding query supports optional node-target filters (`agent_id` or `atmosphere_node_id`).
- Phase B inference actor resolution supports:
  - `agent_id`
  - `identity_id`
  - `agent_id + identity_id` together when they resolve to the same actor semantic.
- Invalid or conflicting actor combinations return `INFERENCE_INPUT_INVALID` rather than silently guessing.

### Identity Policy Baseline / 身份策略基线（已实现）

- Field-level policy evaluation follows deny-first ordering (`deny > allow`) with priority tie-break.
- Field wildcard matching supports `*`, exact path, and `prefix.*`.
- Policy conditions support claims/attributes merged context for condition-aware matching.
- Policy evaluate API can return per-field rule explanation for debugging and observability.
- Phase B inference context currently derives a minimal policy summary for social-post read/write feasibility.

## 3) Time and Narrative Consistency / 时间与叙事一致性

### Currently Implemented / 当前已实现

- Absolute time is represented by `BigInt` ticks.
- Multiple calendar displays can be derived from one absolute timeline.
- API serializes tick values as strings for frontend compatibility.
- Inference preview/run transport also serializes tick-like values (such as `tick` and `delay_hint_ticks`) as strings.
- Current Phase D baseline already records `scheduled_after_ticks` and derived `scheduled_for_tick` on persisted intents.
- Loop-driven dispatch is now active for eligible `post_message` intents once `scheduled_for_tick` is reached.
- Current baseline additionally records `transmission_delay_ticks` and `transmission_drop_chance`.
- A dropped transmission currently halts post materialization and marks the intent as `dropped`.
- Current derivation can mark an intent as `blocked` / `fragile` / `best_effort` / `reliable` before dispatch.
- Current derived reasons include `policy_blocked`, `visibility_denied`, `low_signal_quality`, and `probabilistic_drop`.

### Planned / 规划中

- More explicit timeline impact tracking per action/event.
- Clearer reconciliation rules when actions compete at similar ticks.
- On top of the current Phase D baseline, persisted `ActionIntent`-style objects should eventually support richer timeline insertion and delayed execution beyond the current first-pass `post_message` path.

## 4) Node Value Dynamics / 节点价值动态

### Currently Implemented / 当前已实现

- Node value (SNR) supports increase/decrease updates.
- Pinned nodes can resist depreciation according to current manager logic.
- Dynamics algorithms are pluggable by reason type.

### Planned / 规划中

- Tie value changes to broader narrative and social outcomes.
- Add balancing strategy for native noise and high-authority nodes.

## 5) Notification and Fault Feedback / 通知与故障反馈

### Currently Implemented / 当前已实现

- Backend has a system notification queue.
- API endpoints support fetch and clear notification operations.
- Runtime errors push structured notifications with level and code.
- Inference debug endpoints already distinguish input/provider/normalization/runtime-not-ready failure classes through explicit error codes.
- Workflow snapshots and persisted state now distinguish decision-side (`provider` / `normalization` / `persistence`) failures, dispatch-side failures, and intentional drops.

### Planned / 规划中

- Frontend global notification panel fully wired to backend queue.
- Stronger categorization and routing for operational vs business-level alerts in frontend/operator views.
- Broader alert aggregation/reporting across inference workflow history, not just per-request/per-job snapshots; a minimal backend unified audit feed is now available as the current observability baseline.

## 6) Layer Coupling Rules / 层级联动规则

### Business Intention / 业务意图

- L1 signals should influence L2 relation weight over time.
- L2 relation shifts should affect L1 visibility and influence.
- L3 narrative events should alter what actions are feasible next.
- L4 transmission limits should shape action timing and reach.

### Current State / 当前状态

- Partially represented in data structures and API surfaces.
- Full cross-layer enforcement is still under phased implementation.

## 7) Agent System Scope / Agent 系统边界

### Core Modules / 核心模块（当前状态）

- Identity Layer: active node and atmosphere node binding/lifecycle baseline is landed.
- Inference Interface: policy injection, stable prompt channels, normalized decision schema, and trace metadata baseline is landed.
- Workflow Persistence: persisted traces/intents/jobs baseline is now landed; minimal idempotency replay, failed-job retry, loop-driven async execution, and first-pass intent dispatch are available, while richer audit/replay and state progression remain in progress.
- Memory Core: short-term context is now partially landed through `memory_context` + prompt fragment injection, while long-term retrieval/storage and richer summarization remain in progress.
- Action Dispatcher: first-pass delayed executable actions are now landed for `post_message`, and dispatcher-produced posts now record `Post.source_action_intent_id` provenance; the current second path `adjust_relationship` is available under a constrained MVP (`active actor`, `target_ref.agent_id`, single-direction edge, `operation=set`, `[0,1]` clamp) with `RelationshipAdjustmentLog` auditability and read API; the current third path `adjust_snr` is available under a constrained MVP (`active actor`, `target_ref.agent_id`, `operation=set`, absolute-value write with `[0,1]` clamp) with `SNRAdjustmentLog` auditability and read API; and the current fourth path `trigger_event` is now available as an append-only event action (`history|interaction|system`, active/system actor, current tick only). Broader world-action mapping remains future work.

### Current Delivery Principle / 当前交付原则

- Prioritize stable interfaces before deep behavior expansion.
- Keep logic contracts explicit in docs to support agentic coding tools.
- Treat Phase B as a D-ready service layer rather than a throwaway prototype.
- Treat Phase D as the point where inference enters formal software engineering complexity (state, audit, retry, replay) instead of remaining a temporary synchronous call.
- Keep `ActionIntentDraft` as an internal compatibility artifact; persisted workflow and dispatcher now consume the persisted `ActionIntent`, while HTTP still does not expose the draft directly.
- Current Phase D baseline should be treated as persistence-first, not dispatcher-complete.
- Current idempotency support now includes aggregate workflow replay semantics and stored-trace result reuse, but is still not full replay orchestration.
- Current retry support is manual API-driven retry, not background scheduling.
- Current async runner is single-process loop-driven execution, not a durable multi-worker job system.
- Current dispatcher now handles `post_message`, `adjust_relationship`, `adjust_snr`, and `trigger_event`; broader world-action mapping remains future work.
- Current L4 semantics are intentionally minimal and do not yet model probabilistic reach, multi-hop propagation, or loss recovery.
- Current L4 policy derivation is heuristic and local; it is not yet a full network/system simulation.
- Current failure observation now distinguishes:
  - decision-side failure (`provider` / `normalization` / `persistence`)
  - dispatch-side failure (`dispatch`)
  - intentional drop (`dropped`, not equal to `failed`)

## 8) Product Rules for Contributors / 贡献者规则

- Mark business statements as `Currently Implemented` or `Planned`.
- Avoid presenting speculative behavior as already available.
- Keep logic docs synced with API and architecture docs.
- Put implementation debt and lint debt into dedicated tracking files.
- When adding inference-related rules, explicitly state whether they belong to:
  - prompt construction,
  - decision normalization,
  - workflow persistence,
  - action dispatch.
