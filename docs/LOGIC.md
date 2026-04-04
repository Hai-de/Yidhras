# Yidhras Logic / 业务逻辑说明

Version: v0.3.2-draft
Last Updated / 最后更新: 2026-03-30

本文件偏向业务规则表达，不绑定未来可能变化的算法细节。
This file focuses on business rules and domain semantics rather than unstable implementation storytelling.

> 当前阶段状态请看 `TODO.md`；历史验证与验收记录请看 `记录.md`。

## 1) Core Behavior Loop / 核心行为闭环

### Current Logic Baseline / 当前逻辑基线

- Agent context can be queried through backend API.
- Narrative variables are resolved with permission-aware filtering.
- Social post creation and retrieval are available through API.
- Simulation tick advances continuously with pause/resume controls.
- Inference and execution are treated as related but distinct concerns.
- Workflow records act as the formal bridge between decision generation and runtime-side dispatch.
- Product-facing backend success responses follow the unified envelope rule `{ success: true, data, meta? }`.

### Contract / Validation Boundary Note / 契约与校验边界说明

- Shared contracts live in `packages/contracts` and cover transport-boundary schemas.
- Zod-driven validation serves boundary shape and basic format checks.
- Business rules such as permission checks, state transitions, replay semantics, and mutation safety remain in service/domain logic.

### Planned Direction / 规划方向

- Full autonomous perception-decision-action loop for agents.
- Richer delayed dispatch behavior aligned with fuller transmission-layer constraints.
- Continued expansion on top of the current workflow baseline rather than replacing it with a second temporary path.

## 2) Information Boundary / 信息边界规则

### Current Rules / 当前规则

- Variables can carry access metadata (`min_level`, optional `circle_id`).
- Resolver returns safe placeholders for restricted or missing values.
- Agent context API computes circle-based permission context.
- Inference context assembly should reuse identity/binding/policy results rather than bypassing them.

### Identity Binding Lifecycle / 身份绑定生命周期

- Identity can bind to active/atmosphere nodes with explicit role and status.
- Bindings support manual unbind and explicit expiration.
- Runtime loop may auto-expire bindings when `expires_at` is reached.
- Same `identity_id + role` cannot have duplicate `active` bindings.
- Invalid actor combinations should return explicit input errors rather than silently guessing.

### Identity Policy Baseline / 身份策略基线

- Field-level policy evaluation follows deny-first ordering (`deny > allow`) with priority tie-break.
- Field wildcard matching supports `*`, exact path, and `prefix.*`.
- Policy conditions may use merged claims/attributes context.
- Policy evaluation should be explainable enough for debugging.

## 3) Time and Narrative Consistency / 时间与叙事一致性

### Current Rules / 当前规则

- Absolute time is represented by `BigInt` ticks.
- Multiple calendar displays can be derived from one absolute timeline.
- API serializes tick values as strings for frontend compatibility.
- Tick-like fields should remain string-based across transport boundaries.
- Runtime-side delayed execution must be expressed through explicit workflow/time fields rather than implicit in-memory assumptions.

### BigInt Transport Rule / BigInt 传输规则

- BigInt must remain string-based over HTTP payloads.
- Frontend consumers should keep tick-like values as strings by default and only convert with `BigInt(...)` when actual comparison or computation is needed.

### Planned / 规划中

-More explicit timeline impact tracking per action/event.
- Clearer reconciliation rules when actions compete at similar ticks.
- Richer delayed execution semantics on top of the current workflow/time baseline.

## 4) Node Value Dynamics / 节点价值动态

### Current Rules / 当前规则

- Node value (SNR) supports increase/decrease style updates.
- Pinned nodes can resist depreciation according to current manager logic.
- Dynamics algorithms are pluggable by reason type.

### Planned / 规划中

- Tie value changes to broader narrative and social outcomes.
- Add balancing strategy for native noise and high-authority nodes.

## 5) Notification and Fault Feedback / 通知与故障反馈

### Current Rules / 当前规则

- Backend has a system notification queue.
- API endpoints support fetch and clear notification operations.
- Runtime errors push structured notifications with level and code.
- Failure classes should remain distinguishable enough for operator/debug usage.

### Planned / 规划中

- Frontend global notification panel fully wired to backend queue.
- Stronger categorization for operational vs business-level alerts.
- Broader alert aggregation/reporting across workflow history.

## 6) Layer Coupling Rules / 层级联动规则

### Business Intention / 业务意图

- L1 signals should influence L2 relation weight over time.
- L2 relation shifts should affect L1 visibility and influence.
- L3 narrative events should alter what actions are feasible next.
- L4 transmission limits should shape action timing and reach.

### Current State / 当前状态

- Cross-layer coupling is only partially formalized.
- Some couplings are represented in data structures and APIs, but full enforcement remains phased.

## 7) Scheduler Logic Notes / Scheduler 逻辑说明

- Scheduler 当前会为 agent 形成 `periodic` 与 `event_driven` 两类 candidate，并通过 signal weighting + merge 形成单个 event-driven decision。
- 一个 merged event-driven candidate 会保留 `chosen_reason + candidate_reasons[]`；secondary reasons 不会伪装成真正独立的 skipped candidate。
- `event_coalesced` 当前代表“secondary reasons 被合并进主决策”的 summary-side taxonomy，用于 run summary / skipped_by_reason 聚合，而不是 candidate-level `skipped_reason`。
- closure pass 后，candidate evaluation 已收敛为更清晰的 readiness 顺序：`limit -> pending_workflow -> replay/retry suppression -> periodic cooldown -> existing idempotency / create`。
- replay / retry recovery window 仍会继续 suppress periodic cadence；高优先级 event-driven followup 可在未被 pending/idempotency 阻断时继续存活。
- scheduler read model 现在会从 `candidate_reasons` 派生 `coalesced_secondary_reason_count` 与 `has_coalesced_signals`，用于解释 merged event-driven decision 的 coalescing 行为。
- closure pass 后，`last_signal_tick` 表示“本 partition 最近真正观测到的 signal / recovery watermark”，而不再只是“这轮调度运行结束时的 now”。

## 8) Agent System Scope / Agent 系统边界

### Core Modules / 核心模块

- Identity Layer：身份、绑定、生命周期与权限上下文。
- Inference Interface：prompt/context assembly、decision normalization、provider boundary。
- Workflow Persistence：decision/intent/job style formal records and state bridge。
- Memory Core：memory context and prompt-fragment-oriented integration boundary。
- Action Dispatcher：runtime-side consumption of executable intents。

### Current Delivery Principle / 当前交付原则

- Prioritize stable interfaces before deep behavior expansion.
- Keep logic contracts explicit, but avoid freezing implementation noise as permanent rules.
- Treat workflow state as first-class instead of hiding execution semantics in temporary synchronous flows.
- Keep internal draft artifacts separate from formal external contracts.
- Keep current L4 semantics intentionally minimal until richer simulation rules are truly needed.

## 9) Product Rules for Contributors / 贡献者规则

- Mark business statements clearly as current rules or planned direction.
- Avoid presenting speculative behavior as already available.
- Keep logic docs synced with API and architecture docs at the boundary level, not by duplicating every implementation detail.
- Put implementation debt and lint debt into the right tracking files.
- When adding inference-related rules, explicitly state whether they belong to:
  - prompt construction,
  - decision normalization,
  - workflow persistence,
  - action dispatch.
