# Yidhras API 接口规范 (v0.1.8)

> Implementation note (2026-03-28): the backend API is now assembled through `apps/server/src/app/create_app.ts`, grouped route modules under `apps/server/src/app/routes/*.ts`, and thin route-to-service delegation into `apps/server/src/app/services/*.ts`. The inference debug endpoints are implemented through `apps/server/src/app/routes/inference.ts` and `apps/server/src/inference/service.ts`, and the current minimal Phase D baseline is active through Prisma-backed workflow storage, loop-driven decision execution, and first-pass action dispatch.

## 0. 系统通知与鲁棒性 (System Notifications)
- **GET `/api/system/notifications`**
    - 说明: 获取后端推送的所有系统消息（包含 Info, Warning, Error）。
    - 返回: `SystemMessage[]`
    - 结构: `[{ id, level: "info"|"warning"|"error", content, timestamp, code?, details? }]`
- **POST `/api/system/notifications/clear`**
    - 说明: 清空系统消息队列。
    - 返回: `{ success: true }`

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
    - 返回: `{ status: "running"|"paused", runtime_ready: boolean, runtime_speed: { mode: "fixed", source: "default"|"world_pack"|"override", configured_step_ticks: string|null, override_step_ticks: string|null, override_since: number|null, effective_step_ticks: string }, health_level: "ok"|"degraded"|"fail", world_pack: { id, name, version }|null, has_error: boolean, startup_errors: string[] }`
- **POST `/api/runtime/speed`**
    - 说明: 覆盖或清除运行时步进速度（调试用，优先级高于 world-pack）。
    - 参数: `{ action: "override", step_ticks: string|number }` 或 `{ action: "clear" }`
    - 返回: `{ success: true, runtime_speed: RuntimeSpeedSnapshot }`
    - 备注: 当运行时未就绪时返回 `503` + `WORLD_PACK_NOT_READY`。
- **GET `/api/health`**
    - 说明: 启动与运行健康检查结果（可用于脚本/容器探针）。
    - 返回: `{ success: boolean, level: "ok"|"degraded"|"fail", runtime_ready: boolean, checks: { db, world_pack_dir, world_pack_available }, available_world_packs: string[], errors: string[] }`

## 2. 虚拟时间轴 (Chronos Layer)
- **GET `/api/clock`**
    - 说明: 获取原始虚拟时钟（基础读数接口，不含格式化）。
    - 返回: `{ absolute_ticks: string, calendars: [] }`
- **GET `/api/clock/formatted`**
    - 说明: 获取包含历法格式化结果的时钟数据（用于调试/高级显示）。
    - 返回: `{ absolute_ticks: string, calendars: CalendarFormatted[] }`
    - 运行时未就绪: 返回 `503` + `WORLD_PACK_NOT_READY`（统一与其他受 world-pack 约束接口行为一致）。
- **POST `/api/clock/control`**
    - 说明: 控制模拟时钟。
    - 参数: `{ action: "pause" | "resume" }`
    - 注意: 发生致命错误 (如 `SIM_STEP_ERR`) 时系统会自动暂停。

## 3. 社交层 (L1: Social Layer)
- **GET `/api/social/feed`**
    - 说明: 获取公共舆论场信息流；返回结果会经过当前 identity 上下文的字段可读性过滤。
    - 参数: `?limit=20`
    - 返回: 权限过滤后的 `Post[]`
- **POST `/api/social/post`**
    - 说明: 以当前 identity 上下文发布动态。
    - 参数: `{ content: string }`
    - 备注: `author_id` 由当前 identity 上下文注入并在服务端写入。
    - 当前 provenance 说明: dispatcher 产出的 `post_message` 会在 `Post.source_action_intent_id` 上记录来源 `ActionIntent`。

## 4. 关系层 (L2: Relational Layer)
- **GET `/api/relational/graph`**
    - 说明: 获取 Cytoscape.js 格式的图谱数据 (Nodes & Edges)。
    - 返回: `{ nodes: Node[], edges: Edge[] }`
- **GET `/api/relational/circles`**
    - 说明: 获取所有组织/圈子列表。
- **GET `/api/relationships/:from_id/:to_id/:type/logs`**
    - 说明: 查询指定单向关系边的调整日志。
    - 参数: `?limit=20`
    - 返回: `RelationshipAdjustmentLog[]`
- **GET `/api/atmosphere/nodes`**
    - 说明: 查询 atmosphere nodes。
    - 参数: `?owner_id=<agent_id>&include_expired=true|false`
    - 默认: `include_expired=false`（仅返回未过期或无过期时间节点）
    - 返回: `AtmosphereNode[]`

## 4.1 审计视图 (Audit / Observability)
- **GET `/api/audit/feed`**
    - 说明: 统一查询 workflow / social post / relationship adjustment / SNR adjustment / event 的最小审计时间线。
    - 参数: `?limit=20&kinds=workflow,post,relationship_adjustment,snr_adjustment,event&from_tick=<tick>&to_tick=<tick>&job_id=<job_id>&inference_id=<inference_id>&agent_id=<agent_id>&action_intent_id=<action_intent_id>&cursor=<opaque_cursor>`
    - 返回: `{ entries: AuditViewEntry[], summary: { returned, limit, applied_kinds, page_info: { has_next_page, next_cursor }, counts_by_kind, filters: { from_tick, to_tick, job_id, inference_id, agent_id, action_intent_id, cursor } } }`
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
    - `kind` 当前支持: `workflow | post | relationship_adjustment | snr_adjustment | event`
    - 返回: `AuditViewEntry`
    - workflow detail 当前还会附带 `data.related_counts` 与 `data.related_records`，聚合同一 `ActionIntent` 直接产出的 posts / events / relationship adjustments / snr adjustments。

## 5. 叙事层 (L3: Narrative Layer)
- **GET `/api/narrative/timeline`**
    - 说明: 获取历史事件时间线（按 Tick 倒序）。
    - 当前说明: `trigger_event` dispatcher path 生成的事件也会出现在该时间线中。
    - 返回: `Event[]`

## 6. Agent 与 变量 (Identity & Variables)
- **GET `/api/agent/:id/context`**
    - 说明: 获取特定 Agent 的认知上下文（基于其所属 Circle 权限过滤后的解析变量）。
    - 返回: `{ identity: Agent, variables: ResolvedVariablePool }`
- **GET `/api/agent/:id/snr/logs`**
    - 说明: 查询指定 Agent 的 SNR 调整日志。
    - 参数: `?limit=20`
    - 返回: `SNRAdjustmentLog[]`

## 7. 身份与策略 (Identity & Policy)
- **POST `/api/identity/register`**
    - 说明: 注册身份（本地身份层）。
    - 参数: `{ id: string, type: "user"|"agent"|"system"|"plugin_reserved"|"external_reserved", name?: string, claims?: object, metadata?: object }`
    - 返回: `Identity`
- **POST `/api/identity/bind`**
    - 说明: 绑定 Identity 到 active/atmosphere 节点。
    - 参数: `{ identity_id: string, agent_id?: string, atmosphere_node_id?: string, role: "active"|"atmosphere", status?: "active"|"inactive"|"expired", expires_at?: string|number }`
    - 约束: `agent_id` 与 `atmosphere_node_id` 必须二选一。
    - 约束: `status=active` 时，同一 identity + role 只能存在一个 active 绑定。
    - 返回: `IdentityNodeBinding`
- **POST `/api/identity/bindings/query`**
    - 说明: 查询 Identity 绑定记录。
    - 参数: `{ identity_id: string, role?: "active"|"atmosphere", status?: "active"|"inactive"|"expired", include_expired?: boolean, agent_id?: string, atmosphere_node_id?: string }`
    - 约束: `agent_id` 与 `atmosphere_node_id` 只能二选一。
    - 返回: `IdentityNodeBinding[]`
- **POST `/api/identity/bindings/unbind`**
    - 说明: 解绑绑定记录（默认置为 inactive，可指定状态）。
    - 参数: `{ binding_id: string, status?: "active"|"inactive"|"expired" }`
    - 返回: `IdentityNodeBinding`
- **POST `/api/identity/bindings/expire`**
    - 说明: 立即过期绑定记录。
    - 参数: `{ binding_id: string }`
    - 返回: `IdentityNodeBinding`
- **POST `/api/policy`**
    - 说明: 创建策略规则（字段级；支持 deny > allow、`*` / `prefix.*` 通配与条件过滤）。
    - 参数: `{ effect: "allow"|"deny", subject_id?: string, subject_type?: string, resource: string, action: string, field: string, conditions?: object, priority?: number }`
    - `field` 规则:
      - `*`: 匹配所有字段
      - `a.b`: 精确匹配
      - `a.*`: 匹配 `a` 与 `a.` 前缀下字段
    - `conditions` 规则（可选）:
      - 必须是 object
      - key 不能为空字符串
      - value 仅允许 `string|number|boolean|null` 或上述标量数组
      - 请求不合法时返回 `400 POLICY_CONDITIONS_INVALID`
    - 返回: `Policy`
- **POST `/api/policy/evaluate`**
    - 说明: 评估字段级访问结果（用于调试/验证）。
    - 参数: `{ resource: string, action: string, fields: string[], attributes?: Record<string, unknown> }`
    - 返回: `{ allowed_fields: string[], denied_fields: string[], has_wildcard_allow: boolean, details: { field: string, allow: boolean, reason: string, rule_id?: string, matched_pattern?: string }[] }`
    - 评估规则:
      - 策略匹配顺序遵循 `deny > allow`，再按主体精确度、字段精确度、priority 决定
      - `attributes` 与 identity.claims 合并参与条件判断（后者可被前者覆盖同名键）
    - 字段说明:
      - `details` 用于解释每个字段命中的规则来源
      - 命中规则时 `reason` 形如 `allow:<rule_id>` 或 `deny:<rule_id>`
      - 当无匹配规则时，按默认拒绝（`reason = default_deny`）

## 8. Agent 推理接口（Phase B 已实现）与最小工作流（Phase D 已落地）

### 8.1 Phase B: Inference Debug Endpoints (Implemented)
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
    - 当前说明:
      - `tick` / `delay_hint_ticks` 等 tick-like 字段通过 HTTP 统一使用字符串。
      - `run` 是立即执行型调试入口；与 `POST /api/inference/jobs` 的正式入队语义不同，不会先返回一个待 loop 消费的 `pending` job。
      - `ActionIntentDraft` 当前仅作为服务层内部兼容对象定义，尚未在 HTTP 响应中公开。
      - 当前实现会在服务层内部将标准化 decision 映射为持久化的 `ActionIntent` / `DecisionJob` 记录。
      - 当前 `prompt.metadata` 还会附带 `processing_trace`，用于说明 prompt pipeline 中经过了哪些 processor。
      - 当前 `context_snapshot` 会保留 `memory_context`、`memory_selection` 与 `prompt_processing_trace`，便于后续审计与调试。

- **POST `/api/inference/jobs`**
    - 说明: 按正式工作流入口提交一次推理任务，要求提供 `idempotency_key`。
    - 输入: `{ agent_id?: string, identity_id?: string, strategy?: "mock"|"rule_based", attributes?: Record<string, unknown>, idempotency_key: string }`
    - 成功返回: `{ success: true, data: { replayed, inference_id, job: { id, source_inference_id, action_intent_id, job_type, status, attempt_count, max_attempts, last_error, idempotency_key, created_at, updated_at, completed_at }, result, result_source, workflow_snapshot } }`
    - 当前语义:
      - 首次提交同一个 `idempotency_key` 时，创建 `pending` job 并返回 `replayed=false`。
      - 再次提交相同 `idempotency_key` 时，返回已存在记录并返回 `replayed=true`。
      - 首次入队时 `result = null` 且 `result_source = not_available`；同时返回当前 `workflow_snapshot`。
      - 当任务尚未真正执行前，`workflow_snapshot.records.trace` 可能仍为 `null`，且 `inference_id` 可能表现为 `pending_<idempotency_key>` 占位值。
      - 当重复提交命中已存在 trace 时，`result_source = stored_trace`，表示当前 `result` 来自历史持久化 trace，而不是本次重新执行。
- **POST `/api/inference/jobs/:id/retry`**
    - 说明: 重试一个已失败的 `DecisionJob`。
    - 约束:
      - 仅允许 `status=failed` 的任务重试。
      - 若 `attempt_count >= max_attempts`，返回重试耗尽错误。
    - 成功返回: `{ success: true, data: { replayed: false, inference_id, job, result, result_source: "fresh_run", workflow_snapshot } }`
- **POST `/api/inference/jobs/:id/replay`**
    - 说明: 从已有 `DecisionJob` 派生一个新的 replay job。
    - 输入: `{ reason?: string, idempotency_key?: string, overrides?: { strategy?: "mock"|"rule_based", attributes?: Record<string, unknown> } }`
    - 成功返回: `{ success: true, data: { replayed: false, inference_id, job, result: null, result_source: "not_available", workflow_snapshot, replay: { source_job_id, source_trace_id, reason, override_applied, override_snapshot?, parent_job?, child_jobs[] } } }`
- **GET `/api/inference/jobs/:id`**
    - 说明: 查询单个决策任务状态。
    - 成功返回: `{ success: true, data: { id, source_inference_id, action_intent_id, job_type, status, attempt_count, max_attempts, request_input?, last_error, last_error_code?, last_error_stage?, idempotency_key, started_at?, next_retry_at?, locked_by?, locked_at?, lock_expires_at?, replay_of_job_id?, replay_source_trace_id?, replay_reason?, replay_override_snapshot?, created_at, updated_at, completed_at } }`

### 8.2 Phase D: Persisted Workflow & Execution (Minimal Baseline Implemented)
- **GET `/api/inference/traces/:id`**
    - 说明: 查询指定 `InferenceTrace` 持久化记录。
    - 成功返回: `{ success: true, data: { id, kind, strategy, provider, actor_ref, input, context_snapshot, prompt_bundle, trace_metadata, decision?, created_at, updated_at } }`
- **GET `/api/inference/traces/:id/intent`**
    - 说明: 查询指定推理记录关联的 `ActionIntent`。
    - 成功返回: `{ success: true, data: { id, source_inference_id, intent_type, actor_ref, target_ref, payload, scheduled_after_ticks, scheduled_for_tick, transmission_delay_ticks?, transmission_policy, transmission_drop_chance, drop_reason?, dispatch_error_code?, dispatch_error_message?, status, locked_by?, locked_at?, lock_expires_at?, dispatch_started_at?, dispatched_at?, created_at, updated_at } }`
- **GET `/api/inference/traces/:id/job`**
    - 说明: 查询指定推理记录关联的 `DecisionJob`。
    - 成功返回: `{ success: true, data: { id, source_inference_id, action_intent_id, job_type, status, attempt_count, max_attempts, request_input?, last_error, last_error_code?, last_error_stage?, idempotency_key?, started_at?, next_retry_at?, created_at, updated_at, completed_at } }`
- **GET `/api/inference/traces/:id/workflow`**
    - 说明: 查询指定推理记录的聚合工作流快照。
    - 成功返回: `{ success: true, data: { records: { trace, job, intent }, derived: { decision_stage, dispatch_stage, workflow_state, failure_stage, failure_code, failure_reason, outcome_summary } } }`
- **GET `/api/inference/jobs/:id/workflow`**
    - 说明: 查询指定决策任务的聚合工作流快照。
    - 成功返回: 与 `/api/inference/traces/:id/workflow` 相同的 `WorkflowSnapshot` 结构。
- **当前最小持久化语义**
    - `preview` 会持久化 `InferenceTrace`。
    - `run` 会持久化 `InferenceTrace`，并生成关联的 `ActionIntent` 与 `DecisionJob`。
    - `jobs` 会使用 `idempotency_key` 做去重复用。
    - 当前 `DecisionJob.status` 允许的最小状态集合为：`pending | running | completed | failed`。
    - 当前 runner 会在 loop 中消费可 claim 的 `pending/running` 任务，并通过轻量锁避免重复执行。
    - `DecisionJob` 当前带有最小调度字段：`request_input`, `started_at`, `next_retry_at`, `last_error_code`, `last_error_stage`。
    - `DecisionJob` 当前还带有最小锁字段：`locked_by`, `locked_at`, `lock_expires_at`。
    - 当 `running` 任务的锁过期后，后续 worker 可重新 claim，以恢复 orphan 任务。
    - 当前实现以 loop 驱动执行完成后记为 `completed`；该状态仅表示 decision generation 完成，不等同于 world-side dispatch 完成。
    - retry 路径会重新进入 `pending -> running -> completed|failed` 状态更新。
    - job 完成、失败、或 retry reset 为 `pending` 时都会释放轻量锁。
    - replay API 现在可以从已有 `DecisionJob` 派生新的 pending replay job，而不是只复用历史结果。
    - replay lineage 当前最小记录在 `DecisionJob` 上：`replay_of_job_id`, `replay_source_trace_id`, `replay_reason`。
    - replay API 当前已支持受控 overrides：`strategy` / `attributes`。
    - actor override（`agent_id` / `identity_id`）当前会被显式拒绝，避免 replay 退化为跨 actor resubmit。
    - `workflow_snapshot` 当前还会暴露 `lineage`，用于观察 replay 来源、override 应用情况、parent job 摘要与 child replay jobs。
    - `ActionIntent.status` 当前最小状态集合为：`pending | dispatching | completed | failed | dropped`。
    - dispatcher 现在还支持：
      - `intent_type = adjust_relationship`
    - `adjust_relationship` 第一版约束：
      - active actor only
      - `target_ref.agent_id` only
      - single-direction edge only
      - `operation = set` only
      - `weight` clamp 到 `[0,1]`
    - dispatcher 现在还支持：
      - `intent_type = adjust_snr`
    - `adjust_snr` 第一版约束：
      - active actor only
      - `target_ref.agent_id` only
      - `operation = set` only
      - `target_snr` clamp 到 `[0,1]`
    - dispatcher 现在还支持：
      - `intent_type = trigger_event`
    - `trigger_event` 第一版约束：
      - append-only
      - `Event.type ∈ {history, interaction, system}`
      - active actor 或 system actor
      - 不允许自定义 tick
    - `adjust_relationship` 当前还会写入 `RelationshipAdjustmentLog`，记录：
      - `action_intent_id`, `relationship_id`, `old_weight`, `new_weight`, `reason`, `created_at`
    - `adjust_snr` 当前还会写入 `SNRAdjustmentLog`，记录：
      - `action_intent_id`, `agent_id`, `operation`, `requested_value`, `baseline_value`, `resolved_value`, `reason`, `created_at`
    - 后端当前已提供 SNR adjustment log read API：
      - `GET /api/agent/:id/snr/logs`
    - Action dispatcher 当前已引入轻量锁字段：`locked_by`, `locked_at`, `lock_expires_at`。
    - dispatcher loop 现在会先 claim `ActionIntent` 再执行派发，避免重复 dispatch。
    - 当 `dispatching` intent 的锁过期后，后续 worker 可重新 claim，以恢复 orphan dispatch。
    - loop 中的 dispatcher 当前只消费：
      - `intent_type = adjust_snr`
      - `intent_type = adjust_relationship`
      - `intent_type = trigger_event`
      - `intent_type = post_message`
      - `status = pending`
      - `scheduled_for_tick <= current_tick`（或为空）
    - 最小 L4 元数据当前包括：
      - `transmission_delay_ticks`
      - `transmission_policy`
      - `transmission_drop_chance`
      - `drop_reason`
    - `transmission_policy` 现在可由运行时上下文自动推导，也可由 attributes 显式覆盖。
    - 当前自动推导会参考：
      - social post write capability
      - actor role
      - agent SNR
    - dispatch 成功后会真正写入 social post；当策略判定阻断或概率丢弃时会进入 `dropped`。
    - `dropped` 被视为传输/策略层主动丢弃，不等同于 `failed`。
    - `workflow_snapshot.derived` 当前会显式区分：
      - `decision_stage`
      - `dispatch_stage`
      - `workflow_state`
      - `failure_stage` / `failure_code` / `failure_reason`
      - `outcome_summary`
    - `InferenceTrace.context_snapshot` 当前还会记录：
      - `memory_context`
      - `memory_selection`
      - `prompt_processing_trace`
    - `prompt_bundle.metadata` 当前还会记录：
      - `processing_trace.processor_names`
      - `processing_trace.fragment_count_before`
      - `processing_trace.fragment_count_after`
      - `processing_trace.steps[]`
    - 当前默认 prompt processor 顺序为：
      - `memory-injector`
      - `policy-filter`
      - `memory-summary`
      - `token-budget-trimmer`
    - `processing_trace` 当前还可暴露：
      - `summary_compaction`
      - `policy_filtering`
      - `token_budget_trimming`

- **目标方向（规划中）**
    - richer audit / replay tooling
    - durable scheduling、job locking 与 multi-worker safety
    - 扩展更广泛的 decision ≠ execution 工作流与 world-action mapping（超出当前 `post_message` 路径）
- **候选接口方向（规划中）**
    - `GET /api/action-intents/:id`
    - `POST /api/action-intents/:id/dispatch`

## 9. 错误代码参考 (Error Codes)
- `SYS_INIT_FAIL`: 系统初始化（数据库、世界包）失败。
- `SIM_STEP_ERR`: 模拟步进异常（通常涉及 BigInt 或 undefined 参数）。
- `API_INTERNAL_ERROR`: 全局中间件捕获的未归类内部异常。
- `CLOCK_FORMAT_ERR`: 历法格式化异常（`/api/clock/formatted`）。
  - 仅用于运行时已就绪但格式化过程发生内部异常的场景。
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
- `INFERENCE_INPUT_INVALID`: 当 `/api/inference/jobs` 缺少 `idempotency_key` 时同样返回该错误码。
- `DECISION_JOB_RETRY_INVALID`: 非 failed 任务不允许重试。
- `DECISION_JOB_RETRY_EXHAUSTED`: 任务已达到最大重试次数。
- `ACTION_DISPATCH_FAIL`: 动作调度失败。
- `ACTION_SNR_INVALID`: `adjust_snr` actor / target / payload 不合法。
- `SNR_TARGET_NOT_FOUND`: `adjust_snr` 目标 Agent 不存在。
- `SNR_LOG_QUERY_INVALID`: SNR 审计日志查询参数非法。
- `AUDIT_VIEW_QUERY_INVALID`: unified audit feed 查询参数非法。

---
*更新时间: 2026-03-28*
