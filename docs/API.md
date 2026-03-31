# Yidhras API 接口规范 (v0.1.9)

> Implementation note (2026-03-30): the backend API is now assembled through `apps/server/src/app/create_app.ts`, grouped route modules under `apps/server/src/app/routes/*.ts`, and thin route-to-service delegation into `apps/server/src/app/services/*.ts`. The inference debug endpoints are implemented through `apps/server/src/app/routes/inference.ts` and `apps/server/src/inference/service.ts`, and the current minimal Phase D baseline is active through Prisma-backed workflow storage, loop-driven decision execution, and first-pass action dispatch. As of this update, backend success responses consumed by product frontend routes are normalized to the unified success envelope `{ success: true, data }`, with optional `meta` for pagination/schema hints.

## 0. 系统通知与鲁棒性 (System Notifications)
- **Success Envelope 统一约定（当前正式契约）**
  - 所有成功响应统一返回：`{ success: true, data: ... }`
  - 可选附带：`meta?: { pagination?, warnings?, schema_version? }`
  - 不再将 raw object / raw array / `{ success: true, xxx: ... }` 视为正式 success contract。
- **GET `/api/system/notifications`**
    - 说明: 获取后端推送的所有系统消息（包含 Info, Warning, Error）。
    - 返回: `{ success: true, data: SystemMessage[] }`
    - 结构: `[{ id, level: "info"|"warning"|"error", content, timestamp, code?, details? }]`
- **POST `/api/system/notifications/clear`**
    - 说明: 清空系统消息队列。
    - 返回: `{ success: true, data: { acknowledged: true } }`

### 0.1 统一错误响应 (Unified Error Envelope)
- 所有 API 错误统一返回以下结构，便于前端稳定捕获：
  - `{ success: false, error: { code, message, request_id, timestamp, details? } }`
- 每个请求会携带响应头 `X-Request-Id`，与 `error.request_id` 一致，便于日志追踪。
- 错误分层约定：
  - `4xx`: 业务/请求错误（可预期）
  - `5xx`: 系统内部错误（需排查服务端日志）

### 0.2 Identity Header (开发/内置)
- `x-m2-identity`: JSON 字符串，注入身份上下文。
  - 示例: `{"id":"user-001","type":"user","name":"Operator"}`
  - 若不提供，默认使用 `system` 身份。

## 1. 基础信息 (System)
- **GET `/api/status`**
    - 说明: 获取系统运行状态、健康级别、当前加载的 World Pack 元数据。
    - 返回: `{ success: true, data: { status: "running"|"paused", runtime_ready: boolean, runtime_speed: { mode: "fixed", source: "default"|"world_pack"|"override", configured_step_ticks: string|null, override_step_ticks: string|null, override_since: number|null, effective_step_ticks: string }, health_level: "ok"|"degraded"|"fail", world_pack: { id, name, version }|null, has_error: boolean, startup_errors: string[] } }`
- **POST `/api/runtime/speed`**
    - 说明: 覆盖或清除运行时步进速度（调试用，优先级高于 world-pack）。
    - 参数: `{ action: "override", step_ticks: string|number }` 或 `{ action: "clear" }`（当前服务端已接入共享 contract + Zod request-side 边界校验）
    - 返回: `{ success: true, data: { runtime_speed: RuntimeSpeedSnapshot } }`
    - 备注: 当运行时未就绪时返回 `503` + `WORLD_PACK_NOT_READY`。
- **GET `/api/health`**
    - 说明: 启动与运行健康检查结果（可用于脚本/容器探针）。
    - 返回: `{ success: true, data: { healthy: boolean, level: "ok"|"degraded"|"fail", runtime_ready: boolean, checks: { db, world_pack_dir, world_pack_available }, available_world_packs: string[], errors: string[] } }`
    - 备注: HTTP status 仍可为 `200 | 503`；`success=true` 仅表示 envelope 合法，不表示服务健康。

## 2. 虚拟时间轴 (Chronos Layer)
- **GET `/api/clock`**
    - 说明: 获取原始虚拟时钟（基础读数接口，不含格式化）。
    - 返回: `{ success: true, data: { absolute_ticks: string, calendars: [] } }`
- **GET `/api/clock/formatted`**
    - 说明: 获取包含历法格式化结果的时钟数据（用于调试/高级显示）。
    - 返回: `{ success: true, data: { absolute_ticks: string, calendars: CalendarFormatted[] } }`
    - 运行时未就绪: 返回 `503` + `WORLD_PACK_NOT_READY`（统一与其他受 world-pack 约束接口行为一致）。
- **POST `/api/clock/control`**
    - 说明: 控制模拟时钟。
    - 参数: `{ action: "pause" | "resume" }`（当前服务端已接入共享 contract + Zod request-side 边界校验）
    - 返回: `{ success: true, data: { acknowledged: true, status: "paused"|"running" } }`
    - 注意: 发生致命错误 (如 `SIM_STEP_ERR`) 时系统会自动暂停。

## 3. 社交层 (L1: Social Layer)
- **GET `/api/social/feed`**
    - 说明: 获取公共舆论场信息流；返回结果会经过当前 identity 上下文的字段可读性过滤。
    - 参数: `?limit=20&author_id=<agent_id>&agent_id=<agent_id>&circle_id=<circle_id>&source_action_intent_id=<intent_id>&from_tick=<tick>&to_tick=<tick>&keyword=<text>&signal_min=<0..1>&signal_max=<0..1>&cursor=<opaque_cursor>&sort=latest|signal`（当前服务端已接入共享 contract + Zod query-side 边界校验）
    - 返回: `{ success: true, data: Post[], meta?: { pagination: { has_next_page, next_cursor } } }`
    - 当前已实现过滤能力（Batch 3）:
      - `author_id` / `agent_id`: 当前 social post projection 下两者等价；若同时提供且不一致则返回 `400 SOCIAL_FEED_QUERY_INVALID`
      - `circle_id`: 当前按 `Post.author -> Agent.circle_memberships` 做圈层过滤
      - `source_action_intent_id` / `from_tick` / `to_tick` / `limit` / `sort=latest|signal`
      - `keyword`: 当前按 `Post.content contains` 做最小文本过滤
      - `signal_min` / `signal_max`: 当前按 `signal ≈ 1 - noise_level` 做区间过滤
      - `sort=signal` 当前按 `noise_level asc, created_at desc` 排序，作为最小 signal-first 近似
      - `cursor`: 当前支持基于排序键的稳定翻页，并通过 `meta.pagination` 返回 `has_next_page / next_cursor`
- **POST `/api/social/post`**
    - 说明: 以当前 identity 上下文发布动态。
    - 参数: `{ content: string }`（当前服务端已接入共享 contract + Zod request-side 边界校验）
    - 返回: `{ success: true, data: Post }`
    - 备注: `author_id` 由当前 identity 上下文注入并在服务端写入。
    - 当前 provenance 说明: dispatcher 产出的 `post_message` 会在 `Post.source_action_intent_id` 上记录来源 `ActionIntent`。

## 4. 关系层 (L2: Relational Layer)
- **GET `/api/relational/graph`**
    - 说明: 获取 Cytoscape.js 格式的图谱数据 (Nodes & Edges)。
    - 返回: `{ success: true, data: { nodes: Node[], edges: Edge[] } }`
- **GET `/api/relational/circles`**
    - 说明: 获取所有组织/圈子列表。
    - 返回: `{ success: true, data: Circle[] }`
- **GET `/api/relationships/:from_id/:to_id/:type/logs`**
    - 说明: 查询指定单向关系边的调整日志。
    - 参数: `?limit=20`
    - 返回: `{ success: true, data: RelationshipAdjustmentLog[] }`
- **GET `/api/atmosphere/nodes`**
    - 说明: 查询 atmosphere nodes。
    - 参数: `?owner_id=<agent_id>&include_expired=true|false`
    - 默认: `include_expired=false`（仅返回未过期或无过期时间节点）
    - 返回: `{ success: true, data: AtmosphereNode[] }`

## 4.1 Graph V2 (Operator Graph Projection)
- **GET `/api/graph/view`**
    - 说明: Graph V2 的最小只读 projection 接口，用于新版 operator graph / graph explorer。
    - 当前说明: 当前服务端已接入共享 contract + Zod query-side 边界校验。
    - 参数: `?view=mesh|tree&root_id=<node_id>&depth=<0..3>&kinds=agent,atmosphere,relay,container&include_inactive=true|false&include_unresolved=true|false&search=<keyword>&q=<keyword>`
    - 当前返回: `{ success: true, data: { schema_version: "graph-v2", view: "mesh"|"tree", nodes: GraphNodeView[], edges: GraphEdgeView[], summary: { counts_by_kind, active_root_ids, returned_node_count, returned_edge_count, applied_filters } }, meta: { schema_version: "graph-v2" } }`
    - Batch 4 当前实现范围:
      - 节点当前投影：`agent` / `atmosphere` / `relay` / `container`
      - 边当前投影：`relationship` / `ownership(atmosphere owner -> atmosphere node)` / `transmission` / `derived_from`
      - `root_id` / `depth` 提供增强后的局部邻域裁剪（已纳入 relay/container 相关投影）
      - `kinds` 当前支持：`agent,atmosphere,relay,container`
      - relay 当前以 `ActionIntent(post_message or dropped)` 的 transmission/provenance 投影为主
      - container 当前以 `ActionIntent.status=failed` 的 fallback / unresolved projection 为主
      - `include_unresolved=false` 当前可排除 container projection
      - `include_inactive=true` 当前会放宽 atmosphere expired 过滤
      - `search` / `q` 当前按节点 `id + kind + label + metadata` 做最小文本过滤

## 4.2 审计视图 (Audit / Observability)
- **GET `/api/audit/feed`**
    - 说明: 统一查询 workflow / social post / relationship adjustment / SNR adjustment / event 的最小审计时间线。
    - 当前说明: 当前服务端已接入共享 contract + Zod query-side 边界校验。
    - 参数: `?limit=20&kinds=workflow,post,relationship_adjustment,snr_adjustment,event&from_tick=<tick>&to_tick=<tick>&job_id=<job_id>&inference_id=<inference_id>&agent_id=<agent_id>&action_intent_id=<action_intent_id>&cursor=<opaque_cursor>`
    - 返回: `{ success: true, data: { entries: AuditViewEntry[], summary: { returned, limit, applied_kinds, page_info: { has_next_page, next_cursor }, counts_by_kind, filters: { from_tick, to_tick, job_id, inference_id, agent_id, action_intent_id, cursor } } }, meta: { pagination } }`
    - 当前过滤能力:
      - `from_tick` / `to_tick`: 按审计项自身 `created_at` 范围过滤
      - `cursor`: 基于 `{ created_at, kind, id }` 的稳定游标，按时间倒序翻页
      - `job_id`: 过滤 workflow 审计项中的指定 `DecisionJob`
      - `inference_id`: 过滤 workflow 审计项中的指定 `InferenceTrace/source_inference_id`
      - `agent_id`: 过滤 workflow / relationship adjustment / snr adjustment / event / post 中与指定 agent 相关的最小审计项
      - `action_intent_id`: 过滤与指定 `ActionIntent` 直接关联的 workflow / relationship adjustment / snr adjustment / event 审计项
      - `post` 当前也支持 `action_intent_id` provenance 检索（基于 `Post.source_action_intent_id`）
- **GET `/api/audit/entries/:kind/:id`**
    - 说明: 查询单条 unified audit entry 详情。
    - 当前说明: 当前服务端已接入共享 contract + Zod params-side 边界校验。
    - `kind` 当前支持: `workflow | post | relationship_adjustment | snr_adjustment | event`
    - 返回: `{ success: true, data: AuditViewEntry }`
    - workflow detail 当前还会附带 `data.related_counts` 与 `data.related_records`，聚合同一 `ActionIntent` 直接产出的 posts / events / relationship adjustments / snr adjustments。
    - workflow detail 当前还会附带 `data.lineage_detail`，聚合 replay parent/child workflow summaries；其 summary 字段已包含 `workflow_state`、`intent_type`、`action_intent_id`、`inference_id` 等可直接用于 operator/UI 的字段。
    - `relationship_adjustment` detail 当前还会附带 `data.resolved_intent = { intent, baseline, result }`。
    - `snr_adjustment` detail 当前还会附带 `data.resolved_intent = { intent, baseline, result }`。
    - 当前这两类 mutation detail 已在服务层复用统一的 Resolved Intent builder，以减少后续 delta-capable action 扩展时的 detail 结构漂移。

## 5. 叙事层 (L3: Narrative Layer)
- **GET `/api/narrative/timeline`**
    - 说明: 获取历史事件时间线（按 Tick 倒序）。
    - 当前说明: `trigger_event` dispatcher path 生成的事件也会出现在该时间线中。
    - 返回: `{ success: true, data: Event[] }`

## 6. Agent 与 变量 (Identity & Variables)
- **GET `/api/agent/:id/context`**
    - 说明: 获取特定 Agent 的认知上下文（基于其所属 Circle 权限过滤后的解析变量）。
    - 返回: `{ success: true, data: { identity: Agent, variables: ResolvedVariablePool } }`
- **GET `/api/agent/:id/overview`**
    - 说明: 获取特定 Agent 的聚合总览 read model，供 operator / social / workflow / timeline / graph 等详情页复用。
    - 参数: `?limit=10`
    - 返回: `{ success: true, data: { profile, binding_summary, relationship_summary, recent_activity, recent_posts, recent_workflows, recent_events, recent_inference_results, snr, memory } }`
    - 当前实现说明:
      - 属于轻聚合 read model，聚合 `agent + bindings + relationships + audit + workflow + snr logs + latest trace memory diagnostics`
- **GET `/api/agent/:id/snr/logs`**
    - 说明: 查询指定 Agent 的 SNR 调整日志。
    - 参数: `?limit=20`
    - 返回: `{ success: true, data: SNRAdjustmentLog[] }`

## 7. 身份与策略 (Identity & Policy)
- **POST `/api/identity/register`**
    - 说明: 注册身份（本地身份层）。
    - 当前说明: 当前服务端已接入共享 contract + Zod request-side 边界校验。
    - 参数: `{ id: string, type: "user"|"agent"|"system"|"plugin_reserved"|"external_reserved", name?: string, claims?: object, metadata?: object }`
    - 返回: `{ success: true, data: Identity }`
- **POST `/api/identity/bind`**
    - 说明: 绑定 Identity 到 active/atmosphere 节点。
    - 当前说明: 当前服务端已接入共享 contract + Zod request-side 边界校验。
    - 参数: `{ identity_id: string, agent_id?: string, atmosphere_node_id?: string, role: "active"|"atmosphere", status?: "active"|"inactive"|"expired", expires_at?: string|number }`
    - 约束: `agent_id` 与 `atmosphere_node_id` 必须二选一。
    - 约束: `status=active` 时，同一 identity + role 只能存在一个 active 绑定。
    - 返回: `{ success: true, data: IdentityNodeBinding }`
- **POST `/api/identity/bindings/query`**
    - 说明: 查询 Identity 绑定记录。
    - 当前说明: 当前服务端已接入共享 contract + Zod request-side 边界校验。
    - 参数: `{ identity_id: string, role?: "active"|"atmosphere", status?: "active"|"inactive"|"expired", include_expired?: boolean, agent_id?: string, atmosphere_node_id?: string }`
    - 约束: `agent_id` 与 `atmosphere_node_id` 只能二选一。
    - 返回: `{ success: true, data: IdentityNodeBinding[] }`
- **POST `/api/identity/bindings/unbind`**
    - 说明: 解绑绑定记录（默认置为 inactive，可指定状态）。
    - 当前说明: 当前服务端已接入共享 contract + Zod request-side 边界校验。
    - 参数: `{ binding_id: string, status?: "active"|"inactive"|"expired" }`
    - 返回: `{ success: true, data: IdentityNodeBinding }`
- **POST `/api/identity/bindings/expire`**
    - 说明: 立即过期绑定记录。
    - 当前说明: 当前服务端已接入共享 contract + Zod request-side 边界校验。
    - 参数: `{ binding_id: string }`
    - 返回: `{ success: true, data: IdentityNodeBinding }`
- **POST `/api/policy`**
    - 说明: 创建策略规则（字段级；支持 deny > allow、`*` / `prefix.*` 通配与条件过滤）。
    - 当前说明: 当前服务端已接入共享 contract + Zod request-side 边界校验；`conditions` 仍会继续经过服务层条件结构校验。
    - 参数: `{ effect: "allow"|"deny", subject_id?: string, subject_type?: string, resource: string, action: string, field: string, conditions?: object, priority?: number }`
    - 返回: `{ success: true, data: Policy }`
- **POST `/api/policy/evaluate`**
    - 说明: 评估字段级访问结果（用于调试/验证）。
    - 当前说明: 当前服务端已接入共享 contract + Zod request-side 边界校验。
    - 参数: `{ resource: string, action: string, fields: string[], attributes?: Record<string, unknown> }`
    - 返回: `{ success: true, data: { allowed_fields: string[], denied_fields: string[], has_wildcard_allow: boolean, details: { field: string, allow: boolean, reason: string, rule_id?: string, matched_pattern?: string }[] } }`

## 8. Overview 聚合接口
- **GET `/api/overview/summary`**
    - 说明: 为新版 operator / overview 首屏提供聚合摘要，减少前端多接口拼装。
    - 返回: `{ success: true, data: { runtime, world_time: { tick, calendars }, active_agent_count, recent_events, latest_posts, latest_propagation, failed_jobs, dropped_intents, notifications } }`
    - 当前实现说明:
      - `recent_events` / `latest_posts` / `latest_propagation` / `failed_jobs` / `dropped_intents` 均基于现有 unified audit / social 数据拼装
      - 属于轻聚合 read model，可在后续版本继续丰富字段

## 9. Agent 推理接口（Phase B 已实现）与最小工作流（Phase D 已落地）

### 9.1 Phase B: Inference Debug Endpoints (Implemented)
- **POST `/api/inference/preview`**
    - 说明: 预览推理上下文与结构化 prompt 结果。
    - 输入: `{ agent_id?: string, identity_id?: string, strategy?: "mock"|"rule_based", attributes?: Record<string, unknown>, idempotency_key?: string }`
    - 成功返回: `{ success: true, data: { inference_id, actor_ref, strategy, provider, tick, prompt: { system_prompt, role_prompt, world_prompt, context_prompt, output_contract_prompt, combined_prompt, metadata }, metadata: { world_pack_id, binding_ref?, prompt_version? } } }`
    - 约束:
      - 至少提供 `agent_id` 或 `identity_id`。
      - 若同时提供两者，必须解析为同一有效 actor，否则返回 `400 INFERENCE_INPUT_INVALID`。
      - 运行时未就绪时返回 `503 WORLD_PACK_NOT_READY`，并保留稳定 `details`。
- **POST `/api/inference/run`**
    - 说明: 手动触发一次推理并返回标准化 decision。
    - 输入: `{ agent_id?: string, identity_id?: string, strategy?: "mock"|"rule_based", attributes?: Record<string, unknown>, idempotency_key?: string }`
    - 成功返回: `{ success: true, data: { inference_id, actor_ref, strategy, provider, tick, decision: { action_type, target_ref, payload, confidence?, delay_hint_ticks?, reasoning?, meta? }, trace_metadata: { inference_id, world_pack_id, binding_ref?, prompt_version?, tick, strategy, provider } } }`

- **GET `/api/inference/jobs`**
    - 说明: 查询 inference / workflow job 列表，供 operator workflow 列表页消费。
    - 当前说明: 当前服务端已接入共享 contract + Zod request/query/params-side 边界校验。
    - 参数: `?status=pending,running,completed,failed&agent_id=&identity_id=&strategy=&job_type=&from_tick=&to_tick=&from_created_at=&to_created_at=&cursor=&limit=&has_error=true|false&action_intent_id=`
    - 成功返回: `{ success: true, data: { items: InferenceJobListItem[], page_info: { has_next_page, next_cursor }, summary: { returned, limit, counts_by_status, filters } }, meta: { pagination } }`
    - 当前实现说明:
      - `from_tick/to_tick` 当前作为 `created_at` 过滤别名处理，便于前端平滑接入
      - 每条 item 会聚合最小 workflow 派生状态、actor_ref、strategy、request_input 摘要
- **POST `/api/inference/jobs`**
    - 说明: 按正式工作流入口提交一次推理任务，要求提供 `idempotency_key`。
    - 当前说明: 当前服务端已接入共享 contract + Zod request-side 边界校验。
    - 输入: `{ agent_id?: string, identity_id?: string, strategy?: "mock"|"rule_based", attributes?: Record<string, unknown>, idempotency_key: string }`
    - 成功返回: `{ success: true, data: { replayed, inference_id, job: { id, source_inference_id, action_intent_id, job_type, status, attempt_count, max_attempts, last_error, idempotency_key, created_at, updated_at, completed_at }, result, result_source, workflow_snapshot } }`
- **POST `/api/inference/jobs/:id/retry`**
    - 说明: 重试一个已失败的 `DecisionJob`。
    - 当前说明: 当前服务端已接入共享 contract + Zod params-side 边界校验。
    - 成功返回: `{ success: true, data: { replayed: false, inference_id, job, result, result_source: "fresh_run", workflow_snapshot } }`
- **POST `/api/inference/jobs/:id/replay`**
    - 说明: 从已有 `DecisionJob` 派生一个新的 replay job。
    - 当前说明: 当前服务端已接入共享 contract + Zod body/params-side 边界校验。
    - 输入: `{ reason?: string, idempotency_key?: string, overrides?: { strategy?: "mock"|"rule_based", attributes?: Record<string, unknown> } }`
    - 成功返回: `{ success: true, data: { replayed: false, inference_id, job, result: null, result_source: "not_available", workflow_snapshot, replay: { source_job_id, source_trace_id, reason, override_applied, override_snapshot?, parent_job?, child_jobs[] } } }`
- **GET `/api/inference/jobs/:id`**
    - 说明: 查询单个决策任务状态。
    - 当前说明: 当前服务端已接入共享 contract + Zod params-side 边界校验。
    - 成功返回: `{ success: true, data: { id, source_inference_id, action_intent_id, job_type, status, attempt_count, max_attempts, request_input?, last_error, last_error_code?, last_error_stage?, idempotency_key, started_at?, next_retry_at?, locked_by?, locked_at?, lock_expires_at?, replay_of_job_id?, replay_source_trace_id?, replay_reason?, replay_override_snapshot?, created_at, updated_at, completed_at } }`

### 9.2 Phase D: Persisted Workflow & Execution (Minimal Baseline Implemented)
- **GET `/api/inference/traces/:id`**
    - 说明: 查询指定 `InferenceTrace` 持久化记录。
    - 当前说明: 当前服务端已接入共享 contract + Zod params-side 边界校验。
    - 成功返回: `{ success: true, data: { id, kind, strategy, provider, actor_ref, input, context_snapshot, prompt_bundle, trace_metadata, decision?, created_at, updated_at } }`
- **GET `/api/inference/traces/:id/intent`**
    - 说明: 查询指定推理记录关联的 `ActionIntent`。
    - 当前说明: 当前服务端已接入共享 contract + Zod params-side 边界校验。
    - 成功返回: `{ success: true, data: { id, source_inference_id, intent_type, actor_ref, target_ref, payload, scheduled_after_ticks, scheduled_for_tick, transmission_delay_ticks?, transmission_policy, transmission_drop_chance, drop_reason?, dispatch_error_code?, dispatch_error_message?, status, locked_by?, locked_at?, lock_expires_at?, dispatch_started_at?, dispatched_at?, created_at, updated_at } }`
- **GET `/api/inference/traces/:id/job`**
    - 说明: 查询指定推理记录关联的 `DecisionJob`。
    - 当前说明: 当前服务端已接入共享 contract + Zod params-side 边界校验。
    - 成功返回: `{ success: true, data: { id, source_inference_id, action_intent_id, job_type, status, attempt_count, max_attempts, request_input?, last_error, last_error_code?, last_error_stage?, idempotency_key?, started_at?, next_retry_at?, created_at, updated_at, completed_at } }`
- **GET `/api/inference/traces/:id/workflow`**
    - 说明: 查询指定推理记录的聚合工作流快照。
    - 当前说明: 当前服务端已接入共享 contract + Zod params-side 边界校验。
    - 成功返回: `{ success: true, data: { records: { trace, job, intent }, derived: { decision_stage, dispatch_stage, workflow_state, failure_stage, failure_code, failure_reason, outcome_summary } } }`
- **GET `/api/inference/jobs/:id/workflow`**
    - 说明: 查询指定决策任务的聚合工作流快照。
    - 当前说明: 当前服务端已接入共享 contract + Zod params-side 边界校验。
    - 成功返回: 与 `/api/inference/traces/:id/workflow` 相同的 `WorkflowSnapshot` 结构。

## 10. 错误代码参考 (Error Codes)
- `SYS_INIT_FAIL`: 系统初始化（数据库、世界包）失败。
- `SIM_STEP_ERR`: 模拟步进异常（通常涉及 BigInt 或 undefined 参数）。
- `API_INTERNAL_ERROR`: 全局中间件捕获的未归类内部异常。
- `CLOCK_FORMAT_ERR`: 历法格式化异常（`/api/clock/formatted`）。
- `CLOCK_ACTION_INVALID`: 时钟控制参数非法（非 `pause|resume`）。
- `RUNTIME_SPEED_INVALID`: 运行时步进参数非法（非正整数或格式错误）。
- `RUNTIME_SPEED_ACTION_INVALID`: 运行时步进控制动作非法（非 `override|clear`）。
- `AGENT_NOT_FOUND`: 请求的 Agent 不存在。
- `IDENTITY_HEADER_INVALID`: identity header 解析失败。
- `IDENTITY_REQUIRED`: 需要身份上下文。
- `IDENTITY_FIELD_FORBIDDEN`: 目标字段无权限写入。
- `IDENTITY_INVALID`: 身份注册参数非法。
- `IDENTITY_BINDING_INVALID`: 身份绑定参数非法。
- `IDENTITY_BINDING_NOT_FOUND`: 绑定记录不存在。
- `IDENTITY_BINDING_CONFLICT`: 同一身份角色存在重复 active 绑定。
- `SOCIAL_POST_INVALID`: 社交动态参数非法。
- `POLICY_INVALID`: 策略参数非法。
- `POLICY_EVAL_INVALID`: 策略评估参数非法。
- `POLICY_CONDITIONS_INVALID`: 策略 conditions 结构非法。
- `WORLD_PACK_NOT_READY`: 世界包未就绪，当前接口不可用（常见于空 world-pack 降级启动）。
- `SYS_PRECHECK_FAIL`: 启动前健康检查失败（例如数据库不可用）。
- `WORLD_PACK_EMPTY`: 启动时 world-pack 为空，系统进入降级模式等待导入。
- `INFERENCE_INPUT_INVALID`: 推理输入参数非法。
- `INFERENCE_PROVIDER_FAIL`: 推理 provider 失败。
- `INFERENCE_NORMALIZATION_FAIL`: 推理结果归一化失败。
- `INFERENCE_TRACE_PERSIST_FAIL`: 推理 trace / workflow 持久化失败。
- `INFERENCE_TRACE_NOT_FOUND`: 推理 trace 不存在。
- `ACTION_INTENT_NOT_FOUND`: 动作意图不存在。
- `DECISION_JOB_NOT_FOUND`: 决策任务不存在。
- `DECISION_JOB_RETRY_INVALID`: 非 failed 任务不允许重试。
- `DECISION_JOB_RETRY_EXHAUSTED`: 任务已达到最大重试次数。
- `ACTION_DISPATCH_FAIL`: 动作调度失败（通用兜底）。
- `ACTION_RELATIONSHIP_INVALID`: `adjust_relationship` actor / target / payload 不合法。
- `RELATIONSHIP_NOT_FOUND`: `adjust_relationship` 目标边不存在且未允许自动创建。
- `RELATIONSHIP_TYPE_UNSUPPORTED`: `adjust_relationship` 使用了不支持的 relationship_type。
- `RELATIONSHIP_WEIGHT_INVALID`: `adjust_relationship` 的 target_weight 非法。
- `ACTION_SNR_INVALID`: `adjust_snr` actor / target / payload 不合法。
- `SNR_TARGET_NOT_FOUND`: `adjust_snr` 目标 Agent 不存在。
- `SNR_LOG_QUERY_INVALID`: SNR 审计日志查询参数非法。
- `AUDIT_VIEW_QUERY_INVALID`: unified audit feed 查询参数非法。
- `AUDIT_ENTRY_NOT_FOUND`: unified audit entry 不存在。

---
*更新时间: 2026-03-30*

补充说明（当前实现阶段）：
- 前后端共享 contract 基线已开始落地，当前已引入 `packages/contracts` 纯契约包。
- 当前已完成三批接入：第一批为 `system / clock / social`，第二批为 `identity / policy`，第三批为 `inference / audit / graph` 的 request-side 边界校验；前端当前仅完成最小 envelope 消费修正（clock 路径）。
- 当前 BigInt HTTP 传输规则保持不变：**统一以 string 传输，前端按需显式转换**。
