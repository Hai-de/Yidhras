# Yidhras API 接口规范 (v0.1.9)

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

## 1. 基础信息 (System)

- **GET `/api/status`**
  - 说明：获取系统运行状态、健康级别、当前加载的 World Pack 元数据
  - 返回：`{ success: true, data: { status: "running"|"paused", runtime_ready: boolean, runtime_speed: { mode: "fixed", source: "default"|"world_pack"|"override", configured_step_ticks: string|null, override_step_ticks: string|null, override_since: number|null, effective_step_ticks: string }, health_level: "ok"|"degraded"|"fail", world_pack: { id, name, version }|null, has_error: boolean, startup_errors: string[] } }`
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
- **GET `/api/atmosphere/nodes`**
  - 说明：查询 atmosphere nodes
  - 参数：`?owner_id=<agent_id>&include_expired=true|false`
  - 默认：`include_expired=false`
  - 返回：`{ success: true, data: AtmosphereNode[] }`

## 4.1 Graph V2

- **GET `/api/graph/view`**
  - 说明：Graph V2 的最小只读 projection 接口
  - 参数：`?view=mesh|tree&root_id=<node_id>&depth=<0..3>&kinds=agent,atmosphere,relay,container&include_inactive=true|false&include_unresolved=true|false&search=<keyword>&q=<keyword>`
  - 返回：`{ success: true, data: { schema_version: "graph-v2", view: "mesh"|"tree", nodes: GraphNodeView[], edges: GraphEdgeView[], summary: { counts_by_kind, active_root_ids, returned_node_count, returned_edge_count, applied_filters } }, meta: { schema_version: "graph-v2" } }`

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
- **GET `/api/agent/:id/overview`**
  - 说明：获取特定 Agent 的聚合总览 read model
  - 参数：`?limit=10`
  - 返回：`{ success: true, data: { profile, binding_summary, relationship_summary, recent_activity, recent_posts, recent_workflows, recent_events, recent_inference_results, snr, memory } }`
- **GET `/api/agent/:id/snr/logs`**
  - 说明：查询指定 Agent 的 SNR 调整日志
  - 参数：`?limit=20`
  - 返回：`{ success: true, data: SNRAdjustmentLog[] }`

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
  - 参数：`{ effect: "allow"|"deny", subject_id?: string, subject_type?: string, resource: string, action: string, field: string, conditions?: object, priority?: number }`
  - 返回：`{ success: true, data: Policy }`
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
  - 参数：`?limit=20&cursor=<opaque_cursor>&from_tick=<tick>&to_tick=<tick>&worker_id=<worker_id>`
  - 返回：`{ success: true, data: { items: SchedulerRunSummary[], page_info: { has_next_page, next_cursor }, summary: { returned, limit, filters: { cursor, from_tick, to_tick, worker_id } } }, meta: { pagination } }`
- **GET `/api/runtime/scheduler/summary`**
  - 说明：读取 scheduler 聚合 summary projection
  - 参数：`?sample_runs=20`
  - 返回：`{ success: true, data: { latest_run, run_totals, top_reasons, top_skipped_reasons, top_actors, intent_class_breakdown } }`
- **GET `/api/runtime/scheduler/trends`**
  - 说明：读取最近 scheduler runs 的趋势点集合
  - 参数：`?sample_runs=20`
  - 返回：`{ success: true, data: { points: { tick, run_id, created_count, created_periodic_count, created_event_driven_count, signals_detected_count }[] } }`
- **GET `/api/runtime/scheduler/runs/latest`**
  - 说明：读取最近一次 scheduler run 的 summary 与 candidate decisions read model
- **GET `/api/runtime/scheduler/runs/:id`**
  - 说明：按 run id 读取指定 scheduler run 的 summary 与 candidate decisions read model
- **GET `/api/runtime/scheduler/decisions`**
  - 说明：分页查询 scheduler candidate decision 列表
  - 参数：`?limit=20&cursor=<opaque_cursor>&actor_id=<agent_id>&kind=periodic|event_driven&reason=<scheduler_reason>&skipped_reason=<scheduler_skip_reason>&from_tick=<tick>&to_tick=<tick>`
  - 返回：`{ success: true, data: { items: SchedulerCandidateDecision[], page_info: { has_next_page, next_cursor }, summary: { returned, limit, filters: { cursor, actor_id, kind, reason, skipped_reason, from_tick, to_tick } } }, meta: { pagination } }`，`skipped_reason` 当前可能包含 `replay_window_periodic_suppressed | replay_window_event_suppressed | retry_window_periodic_suppressed | retry_window_event_suppressed`
- **GET `/api/agent/:id/scheduler`**
  - 说明：读取指定 agent 最近的 scheduler candidate decision 轨迹
  - 备注：无效查询参数（如 invalid cursor / invalid tick range / unsupported kind）返回 `400 SCHEDULER_QUERY_INVALID`

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
  - 成功返回：`{ success: true, data: { items: InferenceJobListItem[], page_info: { has_next_page, next_cursor }, summary: { returned, limit, counts_by_status, filters } }, meta: { pagination } }`
- **POST `/api/inference/jobs`**
  - 说明：按正式工作流入口提交一次推理任务
  - 输入：`{ agent_id?: string, identity_id?: string, strategy?: "mock"|"rule_based", attributes?: Record<string, unknown>, idempotency_key: string }`
  - 成功返回：`{ success: true, data: { replayed, inference_id, job: { id, source_inference_id, action_intent_id, job_type, status, attempt_count, max_attempts, last_error, idempotency_key, intent_class, created_at, updated_at, completed_at }, result, result_source, workflow_snapshot } }`
- **POST `/api/inference/jobs/:id/retry`**
  - 说明：重试一个已失败的 `DecisionJob`
  - 成功返回：`{ success: true, data: { replayed: false, inference_id, job, result, result_source: "fresh_run", workflow_snapshot } }`
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
  - 成功返回：与 `/api/inference/traces/:id/workflow` 相同的 `WorkflowSnapshot` 结构

## 10. 错误代码参考 (Error Codes)

- `SYS_INIT_FAIL`
- `SIM_STEP_ERR`
- `API_INTERNAL_ERROR`
- `CLOCK_FORMAT_ERR`
- `CLOCK_ACTION_INVALID`
- `RUNTIME_SPEED_INVALID`
- `RUNTIME_SPEED_ACTION_INVALID`
- `AGENT_NOT_FOUND`
- `IDENTITY_HEADER_INVALID`
- `IDENTITY_REQUIRED`
- `IDENTITY_FIELD_FORBIDDEN`
- `IDENTITY_INVALID`
- `IDENTITY_BINDING_INVALID`
- `IDENTITY_BINDING_NOT_FOUND`
- `IDENTITY_BINDING_CONFLICT`
- `SOCIAL_POST_INVALID`
- `POLICY_INVALID`
- `POLICY_EVAL_INVALID`
- `POLICY_CONDITIONS_INVALID`
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
- `SCHEDULER_QUERY_INVALID`

---

*更新时间: 2026-03-30*
