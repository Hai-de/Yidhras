# Yidhras API 接口规范 (v0.1.10)

> 本文件只负责当前对外接口契约、错误码与调用约束；阶段状态与优先级请看根目录 `TODO.md`。

## 0. 通用约定

### 0.1 Success Envelope

- 所有成功响应统一返回：`{ success: true, data: ... }`
- 可选附带：`meta?: { pagination?, warnings?, schema_version? }`
- 不再将 raw object / raw array / `{ success: true, xxx: ... }` 视为正式 success contract

### 0.2 Unified Error Envelope

- 所有 API 错误统一返回：`{ success: false, error: { code, message, request_id, timestamp, details? } }`
- 每个请求会携带响应头 `X-Request-Id`，与 `error.request_id` 一致
- 错误分层：
  - `4xx`：业务/请求错误（可预期）
  - `5xx`：系统内部错误（需排查服务端日志）

### 0.3 Identity Header (开发/内置)

- `x-m2-identity`: JSON 字符串，注入身份上下文
- 示例：`{"id":"user-001","type":"user","name":"Operator"}`
- 若不提供，默认使用 `system` 身份

### 0.4 Query / Params 校验约定

- `agent / graph / relational / scheduler / social / audit / inference` 相关接口现均已走共享 contracts + Zod 边界解析
- 若 query / params 不满足约束（非法数字、非法枚举、空白必填 params 等），当前实现会优先返回 `400`，而不是静默回退
- `limit / sample_runs / recent_limit / depth` 等参数若被声明为正整数，则非法值（如 `abc`、`0`、负数）应视为请求错误

## 1. 基础信息 (System)

- **GET `/api/status`**
  - 说明：获取系统运行状态、健康级别、当前加载的 World Pack 元数据
  - 返回：`{ success: true, data: { status: "running"|"paused", runtime_ready: boolean, runtime_speed: { mode: "fixed", source: "default"|"world_pack"|"override", configured_step_ticks: string|null, override_step_ticks: string|null, override_since: number|null, effective_step_ticks: string }, scheduler: { worker_id: string, partition_count: number, owned_partition_ids: string[], assignment_source: "persisted"|"bootstrap"|"fallback", migration_in_progress_count: number, worker_runtime_status: string, last_heartbeat_at: string|null, automatic_rebalance_enabled: boolean }, health_level: "ok"|"degraded"|"fail", world_pack: { id, name, version }|null, has_error: boolean, startup_errors: string[] } }`
  - 备注：当前服务端在返回前会执行 `runtimeStatusDataSchema` 运行时校验
- **POST `/api/runtime/speed`**
  - 说明：覆盖或清除运行时步进速度
  - 参数：`{ action: "override", step_ticks: string|number }` 或 `{ action: "clear" }`
  - 返回：`{ success: true, data: { runtime_speed: RuntimeSpeedSnapshot } }`
  - 备注：运行时未就绪时返回 `503` + `WORLD_PACK_NOT_READY`
- **GET `/api/health`**
  - 说明：启动与运行健康检查结果
  - 返回：`{ success: true, data: { healthy: boolean, level: "ok"|"degraded"|"fail", runtime_ready: boolean, checks: { db, world_pack_dir, world_pack_available }, available_world_packs: string[], errors: string[] } }`
  - 备注：HTTP status 可为 `200 | 503`；`success=true` 仅表示 envelope 合法，不表示服务健康

## 2. 虚拟时间轴 (Chronos Layer)

- **GET `/api/clock`**
  - 说明：获取原始虚拟时钟
  - 返回：`{ success: true, data: { absolute_ticks: string, calendars: [] } }`
- **GET `/api/clock/formatted`**
  - 说明：获取包含历法格式化结果的时钟数据
  - 返回：`{ success: true, data: { absolute_ticks: string, calendars: CalendarFormatted[] } }`
  - 运行时未就绪：返回 `503` + `WORLD_PACK_NOT_READY`
- **POST `/api/clock/control`**
  - 说明：控制模拟时钟
  - 参数：`{ action: "pause" | "resume" }`
  - 返回：`{ success: true, data: { acknowledged: true, status: "paused"|"running" } }`

## 3. 社交层 (L1: Social Layer)

- **GET `/api/social/feed`**
  - 说明：获取公共舆论场信息流；返回结果会经过当前 identity 上下文的字段可读性过滤
  - 参数：`?limit=20&author_id=<agent_id>&agent_id=<agent_id>&circle_id=<circle_id>&source_action_intent_id=<intent_id>&from_tick=<tick>&to_tick=<tick>&keyword=<text>&signal_min=<0..1>&signal_max=<0..1>&cursor=<opaque_cursor>&sort=latest|signal`
  - 返回：`{ success: true, data: Post[], meta?: { pagination: { has_next_page, next_cursor } } }`
  - 约束：
    - `author_id` / `agent_id` 当前等价；若同时提供且不一致则返回 `400 SOCIAL_FEED_QUERY_INVALID`
    - 非法 `limit`、非法 `sort`、非法 `cursor`、`signal_min > signal_max` 等均返回 `400 SOCIAL_FEED_QUERY_INVALID`
- **POST `/api/social/post`**
  - 说明：以当前 identity 上下文发布动态
  - 参数：`{ content: string }`
  - 返回：`{ success: true, data: Post }`
  - 备注：`author_id` 由当前 identity 上下文注入

## 4. 关系层 (L2: Relational Layer)

- **GET `/api/relational/graph`**
  - 说明：获取 Cytoscape.js 格式的图谱数据
  - 返回：`{ success: true, data: { nodes: Node[], edges: Edge[] } }`
- **GET `/api/relational/circles`**
  - 说明：获取所有组织/圈子列表
  - 返回：`{ success: true, data: Circle[] }`
- **GET `/api/relationships/:from_id/:to_id/:type/logs`**
  - 说明：查询指定单向关系边的调整日志
  - 参数：`?limit=20`
  - 返回：`{ success: true, data: RelationshipAdjustmentLog[] }`
  - 备注：非法 `limit` 或空白 `from_id / to_id / type` 返回 `400 RELATIONSHIP_LOG_QUERY_INVALID`
- **GET `/api/atmosphere/nodes`**
  - 说明：查询 atmosphere nodes
  - 参数：`?owner_id=<agent_id>&include_expired=true|false`
  - 默认：`include_expired=false`
  - 返回：`{ success: true, data: AtmosphereNode[] }`
  - 备注：非法 `include_expired` 返回 `400 RELATIONAL_QUERY_INVALID`

## 4.1 Graph V2

- **GET `/api/graph/view`**
  - 说明：Graph V2 的最小只读 projection 接口
  - 参数：`?view=mesh|tree&root_id=<node_id>&depth=<0..3>&kinds=agent&kinds=atmosphere&kinds=relay&kinds=container&include_inactive=true|false&include_unresolved=true|false&search=<keyword>&q=<keyword>`
  - 返回：`{ success: true, data: { schema_version: "graph-v2", view: "mesh"|"tree", nodes: GraphNodeView[], edges: GraphEdgeView[], summary: { counts_by_kind, active_root_ids, returned_node_count, returned_edge_count, applied_filters } }, meta: { schema_version: "graph-v2" } }`
  - 备注：非法 `depth` 或非法 `kinds` 返回 `400 GRAPH_VIEW_QUERY_INVALID`；`q` 当前作为 `search` 的别名

## 4.2 审计视图 (Audit / Observability)

- **GET `/api/audit/feed`**
  - 说明：统一查询 workflow / post / relationship adjustment / snr adjustment / event 的最小审计时间线
  - 参数：`?limit=20&kinds=workflow,post,relationship_adjustment,snr_adjustment,event&from_tick=<tick>&to_tick=<tick>&job_id=<job_id>&inference_id=<inference_id>&agent_id=<agent_id>&action_intent_id=<action_intent_id>&cursor=<opaque_cursor>`
  - 返回：`{ success: true, data: { entries: AuditViewEntry[], summary: { returned, limit, applied_kinds, page_info: { has_next_page, next_cursor }, counts_by_kind, filters: { from_tick, to_tick, job_id, inference_id, agent_id, action_intent_id, cursor } } }, meta: { pagination } }`
- **GET `/api/audit/entries/:kind/:id`**
  - 说明：查询单条 unified audit entry 详情
  - `kind` 当前支持：`workflow | post | relationship_adjustment | snr_adjustment | event`
  - 返回：`{ success: true, data: AuditViewEntry }`

## 5. 叙事层 (L3: Narrative Layer)

- **GET `/api/narrative/timeline`**
  - 说明：获取历史事件时间线（按 Tick 倒序）
  - 返回：`{ success: true, data: Event[] }`

## 6. Agent 与变量 (Identity & Variables)

- **GET `/api/agent/:id/context`**
  - 说明：获取特定 Agent 的认知上下文
  - 返回：`{ success: true, data: { identity: Agent, variables: ResolvedVariablePool } }`
  - 备注：空白/非法 `id` 返回 `400 AGENT_QUERY_INVALID`
- **GET `/api/agent/:id/overview`**
  - 说明：获取特定 Agent 的聚合总览 read model
  - 参数：`?limit=10`
  - 返回：`{ success: true, data: { profile, binding_summary, relationship_summary, recent_activity, recent_posts, recent_workflows, recent_events, recent_inference_results, snr, memory } }`
  - 备注：非法 `limit` 返回 `400 AGENT_QUERY_INVALID`
- **GET `/api/agent/:id/snr/logs`**
  - 说明：查询指定 Agent 的 SNR 调整日志
  - 参数：`?limit=20`
  - 返回：`{ success: true, data: SNRAdjustmentLog[] }`
  - 备注：非法 `limit` 返回 `400 SNR_LOG_QUERY_INVALID`
- **GET `/api/agent/:id/scheduler/projection`**
  - 说明：读取指定 agent 的 scheduler actor-centric projection
  - 参数：`?limit=20`
  - 备注：非法 `limit` 返回 `400 AGENT_QUERY_INVALID`

## 7. 身份与策略 (Identity & Policy)

- **POST `/api/identity/register`**
  - 说明：注册身份
  - 参数：`{ id: string, type: "user"|"agent"|"system"|"plugin_reserved"|"external_reserved", name?: string, claims?: object, metadata?: object }`
  - 返回：`{ success: true, data: Identity }`
- **POST `/api/identity/bind`**
  - 说明：绑定 Identity 到 active/atmosphere 节点
  - 参数：`{ identity_id: string, agent_id?: string, atmosphere_node_id?: string, role: "active"|"atmosphere", status?: "active"|"inactive"|"expired", expires_at?: string|number }`
  - 约束：`agent_id` 与 `atmosphere_node_id` 必须二选一
  - 返回：`{ success: true, data: IdentityNodeBinding }`
- **POST `/api/identity/bindings/query`**
  - 说明：查询 Identity 绑定记录
  - 返回：`{ success: true, data: IdentityNodeBinding[] }`
- **POST `/api/identity/bindings/unbind`**
  - 说明：解绑绑定记录
  - 参数：`{ binding_id: string, status?: "active"|"inactive"|"expired" }`
  - 返回：`{ success: true, data: IdentityNodeBinding }`
- **POST `/api/identity/bindings/expire`**
  - 说明：立即过期绑定记录
  - 参数：`{ binding_id: string }`
  - 返回：`{ success: true, data: IdentityNodeBinding }`
- **POST `/api/policy`**
  - 说明：创建策略规则
  - 参数：`{ effect: "allow"|"deny", subject_id?: string, subject_type?: string, resource: string, action: string, field: string, conditions?: Record<string, string | number | boolean | null | Array<string | number | boolean | null>>, priority?: number }`
  - 返回：`{ success: true, data: Policy }`
  - 备注：`conditions` 当前已纳入 shared contracts；primitive、嵌套 object、非法 key/value 会返回 `400 POLICY_INVALID`
- **POST `/api/policy/evaluate`**
  - 说明：评估字段级访问结果
  - 参数：`{ resource: string, action: string, fields: string[], attributes?: Record<string, unknown> }`
  - 返回：`{ success: true, data: { allowed_fields: string[], denied_fields: string[], has_wildcard_allow: boolean, details: { field: string, allow: boolean, reason: string, rule_id?: string, matched_pattern?: string }[] } }`

## 8. Overview 聚合接口

- **GET `/api/overview/summary`**
  - 说明：为 operator / overview 首屏提供聚合摘要
  - 返回：`{ success: true, data: { runtime, world_time: { tick, calendars }, active_agent_count, recent_events, latest_posts, latest_propagation, failed_jobs, dropped_intents, notifications } }`

## 8.1 Scheduler Observability

- **GET `/api/runtime/scheduler/runs`**
  - 说明：分页查询 scheduler run 列表
  - 参数：`?limit=20&cursor=<opaque_cursor>&from_tick=<tick>&to_tick=<tick>&worker_id=<worker_id>&partition_id=<partition_id>`
  - 返回：`{ success: true, data: { items: SchedulerRunSummary[], page_info: { has_next_page, next_cursor }, summary: { returned, limit, filters: { cursor, from_tick, to_tick, worker_id, partition_id } } }, meta: { pagination } }`，其中 `items[*]` 当前会带 `partition_id`、`lease_holder`、`lease_expires_at_snapshot` 与 `cross_link_summary`
  - 备注：非法 `limit`、非法 `cursor`、非法 tick range 返回 `400 SCHEDULER_QUERY_INVALID`
- **GET `/api/runtime/scheduler/summary`**
  - 说明：读取 scheduler 聚合 summary projection
  - 参数：`?sample_runs=20`
  - 返回：`{ success: true, data: { latest_run, run_totals, top_reasons, top_skipped_reasons, top_actors, top_partitions, top_workers, intent_class_breakdown } }`
  - 备注：非法 `sample_runs` 返回 `400 SCHEDULER_QUERY_INVALID`
- **GET `/api/runtime/scheduler/trends`**
  - 说明：读取最近 scheduler runs 的趋势点集合
  - 参数：`?sample_runs=20`
  - 返回：`{ success: true, data: { points: { tick, run_id, partition_id, worker_id, created_count, created_periodic_count, created_event_driven_count, signals_detected_count, skipped_by_reason }[] } }`
  - 备注：非法 `sample_runs` 返回 `400 SCHEDULER_QUERY_INVALID`
- **GET `/api/runtime/scheduler/operator`**
  - 说明：读取面向 overview / operator 的 scheduler 聚合 projection，聚合 latest run、summary、trends、recent runs、recent decisions 与 highlights
  - 参数：`?sample_runs=20&recent_limit=5`
  - 返回：`{ success: true, data: { latest_run, summary, trends, recent_runs, recent_decisions, ownership: { assignments, recent_migrations, summary }, workers: { items, summary }, rebalance: { recommendations, summary }, highlights: { latest_partition_id, latest_created_workflow_count, latest_skipped_count, latest_top_reason, latest_top_intent_type, latest_top_workflow_state, latest_top_skipped_reason, latest_top_failure_code, latest_failed_workflow_count, latest_pending_workflow_count, latest_completed_workflow_count, latest_top_actor, migration_in_progress_count, latest_migration_partition_id, latest_migration_to_worker_id, top_owner_worker_id, latest_rebalance_status, latest_rebalance_partition_id, latest_rebalance_suppress_reason, latest_stale_worker_id } } }`
  - 备注：非法 `sample_runs` / `recent_limit` 返回 `400 SCHEDULER_QUERY_INVALID`
- **GET `/api/runtime/scheduler/ownership`**
  - 说明：读取当前 scheduler partition ownership assignment 视图
  - 参数：`?worker_id=<worker_id>&partition_id=<partition_id>&status=<assigned|migrating|released>`
  - 返回：`{ success: true, data: { items: { partition_id, worker_id, status, version, source, updated_at, latest_migration }[], summary: { returned, assigned_count, migrating_count, released_count, active_partition_count, top_workers, source_breakdown, filters } } }`
  - 备注：非法 `status` 返回 `400 SCHEDULER_QUERY_INVALID`
- **GET `/api/runtime/scheduler/migrations`**
  - 说明：读取最近 scheduler ownership migration 历史
  - 参数：`?limit=20&worker_id=<worker_id>&partition_id=<partition_id>&status=<requested|in_progress|completed|failed|cancelled>`
  - 返回：`{ success: true, data: { items: { id, partition_id, from_worker_id, to_worker_id, status, reason, details, created_at, updated_at, completed_at }[], summary: { returned, limit, in_progress_count, filters } } }`
  - 备注：当前 migration handoff 语义已验证与 lease-expiry failover 兼容；planned migration 不会绕过已有 lease，而是在旧 lease 过期后由新 owner 接管并完成 handoff；非法 `status` / `limit` 返回 `400 SCHEDULER_QUERY_INVALID`
- **GET `/api/runtime/scheduler/workers`**
  - 说明：读取 scheduler worker runtime heartbeat / liveness / capacity snapshot
  - 参数：`?worker_id=<worker_id>&status=<active|stale|suspected_dead>`
  - 返回：`{ success: true, data: { items: { worker_id, status, last_heartbeat_at, owned_partition_count, active_migration_count, capacity_hint, updated_at }[], summary: { returned, active_count, stale_count, suspected_dead_count, filters } } }`
  - 备注：非法 `status` 返回 `400 SCHEDULER_QUERY_INVALID`
- **GET `/api/runtime/scheduler/rebalance/recommendations`**
  - 说明：读取 scheduler automatic rebalance recommendation / suppression / apply 历史
  - 参数：`?limit=20&worker_id=<worker_id>&partition_id=<partition_id>&status=<recommended|suppressed|applied|superseded|expired>&suppress_reason=<reason>`
  - 返回：`{ success: true, data: { items: { id, partition_id, from_worker_id, to_worker_id, status, reason, score, suppress_reason, details, created_at, updated_at, applied_migration_id }[], summary: { returned, limit, status_breakdown, suppress_reason_breakdown, filters } } }`
  - 备注：automatic recommendation 的 apply 仍保持 bounded 且 lease-respecting；即使 recommendation 已 applied，active lease 仍不会被抢占，而是等待 lease expiry 后由新 owner 完成 handoff；非法 `status` / `limit` 返回 `400 SCHEDULER_QUERY_INVALID`
- **GET `/api/runtime/scheduler/runs/latest`**
  - 说明：读取最近一次 scheduler run 的 summary、candidate decisions read model，以及 run-level `cross_link_summary`
  - 备注：当前 `run` 载荷会带 `partition_id`、`lease_holder`、`lease_expires_at_snapshot`；`candidates[*]` 会带 `partition_id`
- **GET `/api/runtime/scheduler/runs/:id`**
  - 说明：按 run id 读取指定 scheduler run 的 summary、candidate decisions read model，以及 run-level `cross_link_summary`
  - 备注：当前 `run` 载荷会带 `partition_id`、`lease_holder`、`lease_expires_at_snapshot`；`candidates[*]` 会带 `partition_id`；空白 `id` 返回 `400 SCHEDULER_QUERY_INVALID`
- **GET `/api/runtime/scheduler/decisions`**
  - 说明：分页查询 scheduler candidate decision 列表
  - 参数：`?limit=20&cursor=<opaque_cursor>&actor_id=<agent_id>&kind=periodic|event_driven&reason=<scheduler_reason>&skipped_reason=<scheduler_skip_reason>&from_tick=<tick>&to_tick=<tick>&partition_id=<partition_id>`
  - 返回：`{ success: true, data: { items: SchedulerCandidateDecision[], page_info: { has_next_page, next_cursor }, summary: { returned, limit, filters: { cursor, actor_id, kind, reason, skipped_reason, from_tick, to_tick, partition_id } } }, meta: { pagination } }`，其中 `items[*]` 现在额外带 `partition_id`；created decision 继续带 `workflow_link: { job_id, status, intent_class, workflow_state, action_intent_id, inference_id, intent_type, dispatch_stage, failure_stage, failure_code, outcome_summary_excerpt, audit_entry } | null`；`skipped_reason` 当前可能包含 `replay_window_periodic_suppressed | replay_window_event_suppressed | retry_window_periodic_suppressed | retry_window_event_suppressed`；`candidate_reasons` 继续保留 merged reasons，同时 read model 现在还会派生 `coalesced_secondary_reason_count` 与 `has_coalesced_signals`
  - 备注：无效查询参数（如 invalid cursor / invalid tick range / unsupported kind / unsupported reason / unsupported skipped_reason）返回 `400 SCHEDULER_QUERY_INVALID`
- **GET `/api/agent/:id/scheduler`**
  - 说明：读取指定 agent 最近的 scheduler candidate decision 轨迹
- **GET `/api/agent/:id/scheduler/projection`**
  - 说明：读取指定 agent 的 scheduler actor-centric projection，返回 actor summary、reason/skipped_reason breakdown、recent timeline 与 recent run/job linkage
  - 参数：`?limit=20`
  - 返回：`{ success: true, data: { actor_id, summary: { total_decisions, created_count, skipped_count, periodic_count, event_driven_count, latest_scheduled_tick, latest_run_id, latest_partition_id, top_reason, top_skipped_reason }, reason_breakdown, skipped_reason_breakdown, timeline, linkage: { recent_runs, recent_created_jobs } } }`，其中 `timeline[*]` 现与 scheduler decisions list 一样可带增强后的 `workflow_link + partition_id`，并派生 `coalesced_secondary_reason_count` / `has_coalesced_signals` 以解释 merged event-driven candidates；`linkage.recent_runs[*]` 与 `linkage.recent_created_jobs[*]` 也会带 `partition_id`
  - 备注：非法 `limit` 返回 `400 AGENT_QUERY_INVALID`

## 9. 推理与工作流接口

### 9.1 Inference Debug Endpoints

- **POST `/api/inference/preview`**
  - 说明：预览推理上下文与结构化 prompt 结果
  - 输入：`{ agent_id?: string, identity_id?: string, strategy?: "mock"|"rule_based", attributes?: Record<string, unknown>, idempotency_key?: string }`
  - 成功返回：`{ success: true, data: { inference_id, actor_ref, strategy, provider, tick, prompt: { system_prompt, role_prompt, world_prompt, context_prompt, output_contract_prompt, combined_prompt, metadata }, metadata: { world_pack_id, binding_ref?, prompt_version? } } }`
  - 约束：
    - 至少提供 `agent_id` 或 `identity_id`
    - 若同时提供两者，必须解析为同一有效 actor，否则返回 `400 INFERENCE_INPUT_INVALID`
- **POST `/api/inference/run`**
  - 说明：手动触发一次推理并返回标准化 decision
  - 输入：`{ agent_id?: string, identity_id?: string, strategy?: "mock"|"rule_based", attributes?: Record<string, unknown>, idempotency_key?: string }`
  - 成功返回：`{ success: true, data: { inference_id, actor_ref, strategy, provider, tick, decision: { action_type, target_ref, payload, confidence?, delay_hint_ticks?, reasoning?, meta? }, trace_metadata: { inference_id, world_pack_id, binding_ref?, prompt_version?, tick, strategy, provider } } }`

### 9.2 Workflow Endpoints

- **GET `/api/inference/jobs`**
  - 说明：查询 inference / workflow job 列表
  - 参数：`?status=pending,running,completed,failed&agent_id=&identity_id=&strategy=&job_type=&from_tick=&to_tick=&from_created_at=&to_created_at=&cursor=&limit=&has_error=true|false&action_intent_id=`
  - 成功返回：`{ success: true, data: { items: InferenceJobListItem[], page_info: { has_next_page, next_cursor }, summary: { returned, limit, counts_by_status, filters } }, meta: { pagination } }`，其中 `items[*]` 当前已稳定包含 `intent_class`
- **POST `/api/inference/jobs`**
  - 说明：按正式工作流入口提交一次推理任务
  - 输入：`{ agent_id?: string, identity_id?: string, strategy?: "mock"|"rule_based", attributes?: Record<string, unknown>, idempotency_key: string }`
  - 成功返回：`{ success: true, data: { replayed, inference_id, job: { id, source_inference_id, action_intent_id, job_type, status, attempt_count, max_attempts, last_error, idempotency_key, intent_class, created_at, updated_at, completed_at }, result, result_source, workflow_snapshot } }`
- **POST `/api/inference/jobs/:id/retry`**
  - 说明：重试一个已失败的 `DecisionJob`
  - 成功返回：`{ success: true, data: { replayed: false, inference_id, job, result, result_source: "fresh_run", workflow_snapshot } }`
  - 备注：当前 retry 复用同一个 `DecisionJob` 记录；成功 reset 后会把顶层 `intent_class` 切到 `retry_recovery`，并同步刷新 `request_input.attributes.job_intent_class=retry_recovery` / `job_source=retry`，随后重置 `started_at` 并重新 claim 执行
- **POST `/api/inference/jobs/:id/replay`**
  - 说明：从已有 `DecisionJob` 派生一个新的 replay job
  - 输入：`{ reason?: string, idempotency_key?: string, overrides?: { strategy?: "mock"|"rule_based", attributes?: Record<string, unknown> } }`
  - 成功返回：`{ success: true, data: { replayed: false, inference_id, job, result: null, result_source: "not_available", workflow_snapshot, replay: { source_job_id, source_trace_id, reason, override_applied, override_snapshot?, parent_job?, child_jobs[] } } }`
- **GET `/api/inference/jobs/:id`**
  - 说明：查询单个决策任务状态
  - 成功返回：`{ success: true, data: { id, source_inference_id, action_intent_id, job_type, status, attempt_count, max_attempts, intent_class, request_input?, last_error, last_error_code?, last_error_stage?, idempotency_key, started_at?, next_retry_at?, locked_by?, locked_at?, lock_expires_at?, replay_of_job_id?, replay_source_trace_id?, replay_reason?, replay_override_snapshot?, created_at, updated_at, completed_at } }`
- **GET `/api/inference/traces/:id`**
  - 说明：查询指定 `InferenceTrace` 持久化记录
  - 成功返回：`{ success: true, data: { id, kind, strategy, provider, actor_ref, input, context_snapshot, prompt_bundle, trace_metadata, decision?, created_at, updated_at } }`
- **GET `/api/inference/traces/:id/intent`**
  - 说明：查询指定推理记录关联的 `ActionIntent`
  - 成功返回：`{ success: true, data: { id, source_inference_id, intent_type, actor_ref, target_ref, payload, scheduled_after_ticks, scheduled_for_tick, transmission_delay_ticks?, transmission_policy, transmission_drop_chance, drop_reason?, dispatch_error_code?, dispatch_error_message?, status, locked_by?, locked_at?, lock_expires_at?, dispatch_started_at?, dispatched_at?, created_at, updated_at } }`
- **GET `/api/inference/traces/:id/job`**
  - 说明：查询指定推理记录关联的 `DecisionJob`
  - 成功返回：`{ success: true, data: { id, source_inference_id, action_intent_id, job_type, status, attempt_count, max_attempts, intent_class, request_input?, last_error, last_error_code?, last_error_stage?, idempotency_key?, started_at?, next_retry_at?, created_at, updated_at, completed_at } }`
- **GET `/api/inference/traces/:id/workflow`**
  - 说明：查询指定推理记录的聚合工作流快照
  - 成功返回：`{ success: true, data: { records: { trace, job, intent }, lineage, derived: { decision_stage, dispatch_stage, workflow_state, failure_stage, failure_code, failure_reason, outcome_summary } } }`
- **GET `/api/inference/jobs/:id/workflow`**
  - 说明：查询指定决策任务的聚合工作流快照
  - 成功返回：与 `/api/inference/traces/:id/workflow` 相同的 `WorkflowSnapshot` 结构；`records.job` 当前会继续带 `intent_class` 以及刷新后的 `request_input.attributes.job_intent_class / job_source`

## 10. 错误代码参考 (Error Codes)

- `SYS_INIT_FAIL`
- `SIM_STEP_ERR`
- `API_INTERNAL_ERROR`
- `CLOCK_FORMAT_ERR`
- `CLOCK_ACTION_INVALID`
- `RUNTIME_SPEED_INVALID`
- `RUNTIME_SPEED_ACTION_INVALID`
- `AGENT_QUERY_INVALID`
- `AGENT_NOT_FOUND`
- `IDENTITY_HEADER_INVALID`
- `IDENTITY_REQUIRED`
- `IDENTITY_FIELD_FORBIDDEN`
- `IDENTITY_INVALID`
- `IDENTITY_BINDING_INVALID`
- `IDENTITY_BINDING_NOT_FOUND`
- `IDENTITY_BINDING_CONFLICT`
- `SOCIAL_FEED_QUERY_INVALID`
- `SOCIAL_POST_INVALID`
- `POLICY_INVALID`
- `POLICY_EVAL_INVALID`
- `POLICY_CONDITIONS_INVALID`
- `RELATIONAL_QUERY_INVALID`
- `RELATIONSHIP_LOG_QUERY_INVALID`
- `WORLD_PACK_NOT_READY`
- `SYS_PRECHECK_FAIL`
- `WORLD_PACK_EMPTY`
- `INFERENCE_INPUT_INVALID`
- `INFERENCE_PROVIDER_FAIL`
- `INFERENCE_NORMALIZATION_FAIL`
- `INFERENCE_TRACE_PERSIST_FAIL`
- `INFERENCE_TRACE_NOT_FOUND`
- `ACTION_INTENT_NOT_FOUND`
- `DECISION_JOB_NOT_FOUND`
- `DECISION_JOB_RETRY_INVALID`
- `DECISION_JOB_RETRY_EXHAUSTED`
- `ACTION_DISPATCH_FAIL`
- `ACTION_RELATIONSHIP_INVALID`
- `RELATIONSHIP_NOT_FOUND`
- `RELATIONSHIP_TYPE_UNSUPPORTED`
- `RELATIONSHIP_WEIGHT_INVALID`
- `ACTION_SNR_INVALID`
- `SNR_TARGET_NOT_FOUND`
- `SNR_LOG_QUERY_INVALID`
- `AUDIT_VIEW_QUERY_INVALID`
- `AUDIT_ENTRY_NOT_FOUND`
- `GRAPH_VIEW_QUERY_INVALID`
- `SCHEDULER_QUERY_INVALID`

---

*更新时间: 2026-04-04*
