# Yidhras Logic / 业务逻辑说明

Version: v0.3.0-draft
Last Updated / 最后更新: 2026-03-23

本文件偏向业务规则表达，不绑定未来可能变化的算法细节。
This file focuses on business rules rather than unstable low-level algorithm details.

## 1) Core Behavior Loop / 核心行为闭环

### Currently Implemented / 当前已实现

- Agent context can be queried through backend API.
- Narrative variables are resolved with permission-aware filtering.
- Social post creation and retrieval are available through API.
- Simulation tick advances continuously with pause/resume controls.

### Planned / 规划中

- Full perception-decision-action loop for autonomous agents.
- Action planning tied to role prompts and world state.
- Delayed dispatch behavior aligned with transmission-layer constraints.
- The formal delivery route is now split into:
  - **Phase B:** stabilize inference contracts and prompt/context composition.
  - **Phase D:** persist decisions/intents as workflow state before execution.

## 2) Information Boundary / 信息边界规则

### Currently Implemented / 当前已实现

- Variables can carry access metadata (`min_level`, optional `circle_id`).
- Resolver returns safe placeholders for restricted or missing values.
- Agent context API computes circle-based permission context.

### Planned / 规划中

- Broader policy coverage across all L1/L2/L3 data reads.
- Unified authorization checks for future agent action APIs.
- Inference context assembly should reuse identity/binding/policy results rather than bypassing them with separate hidden rules.

### Identity Binding Lifecycle / 身份绑定生命周期（当前已实现）

- Identity can bind to active/atmosphere nodes with explicit role and status fields.
- Bindings support manual unbind (inactive) and explicit expiration (expired + expires_at).
- Runtime loop auto-expires bindings when `expires_at` is reached.
- Active-binding uniqueness guard: same `identity_id + role` cannot have duplicate `active` bindings.
- Binding query supports optional node-target filters (`agent_id` or `atmosphere_node_id`).

### Identity Policy Baseline / 身份策略基线（已实现）

- Field-level policy evaluation follows deny-first ordering (`deny > allow`) with priority tie-break.
- Field wildcard matching supports `*`, exact path, and `prefix.*`.
- Policy conditions support claims/attributes merged context for condition-aware matching.
- Policy evaluate API can return per-field rule explanation for debugging and observability.

## 3) Time and Narrative Consistency / 时间与叙事一致性

### Currently Implemented / 当前已实现

- Absolute time is represented by `BigInt` ticks.
- Multiple calendar displays can be derived from one absolute timeline.
- API serializes tick values as strings for frontend compatibility.

### Planned / 规划中

- More explicit timeline impact tracking per action/event.
- Clearer reconciliation rules when actions compete at similar ticks.
- In Phase D, persisted `ActionIntent`-style objects should make timeline insertion and delayed execution auditable.

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

### Planned / 规划中

- Frontend global notification panel fully wired to backend queue.
- Stronger categorization for operational vs business-level alerts.
- Inference and workflow failures should eventually distinguish between:
  - provider failure
  - normalization failure
  - persistence failure
  - dispatch failure

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

### Planned Core Modules / 规划模块

- Identity Layer: active node and atmosphere node binding/lifecycle.
- Inference Interface: policy injection, stable prompt channels, normalized decision schema, and trace metadata.
- Workflow Persistence: persisted traces/intents/jobs with idempotency, retry, and replay support.
- Memory Core: short-term context plus long-term memory retrieval.
- Action Dispatcher: convert persisted decisions/intents into delayed executable actions.

### Current Delivery Principle / 当前交付原则

- Prioritize stable interfaces before deep behavior expansion.
- Keep logic contracts explicit in docs to support agentic coding tools.
- Treat Phase B as a D-ready service layer rather than a throwaway prototype.
- Treat Phase D as the point where inference enters formal software engineering complexity (state, audit, retry, replay) instead of remaining a temporary synchronous call.

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
