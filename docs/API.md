# Yidhras API 接口规范 (v0.2.x)

> 本文件只负责当前对外接口契约、错误码与调用约束；阶段状态与优先级请看根目录 `TODO.md`。

## 0. 通用约定

### 0.1 Success Envelope

- 所有成功响应统一返回：`{ success: true, data: ... }`
- 可选附带：`meta?: { pagination?, warnings?, schema_version? }`

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

- `agent / graph / relational / scheduler / social / audit / inference` 相关接口当前均走共享 contracts + Zod 边界解析
- 若 query / params 不满足约束（非法数字、非法枚举、空白必填 params 等），当前实现返回 `400`

## 1. 基础信息 (System)

- **GET `/api/status`**
  - 说明：获取系统运行状态、健康级别、当前加载的 world-pack 元数据
  - 返回：`{ success: true, data: { status, runtime_ready, runtime_speed, scheduler, health_level, world_pack, has_error, startup_errors } }`
- **POST `/api/runtime/speed`**
  - 说明：覆盖或清除运行时步进速度
  - 参数：`{ action: "override", step_ticks: string|number }` 或 `{ action: "clear" }`
- **GET `/api/health`**
  - 说明：启动与运行健康检查结果
  - 返回：`{ success: true, data: { healthy, level, runtime_ready, checks, available_world_packs, errors } }`

## 2. 虚拟时间轴 (Chronos Layer)

- **GET `/api/clock`**
  - 说明：获取原始虚拟时钟
  - 当前后端实现已通过 runtime facade `SimulationManager.getCurrentTick()` 暴露 tick，而不是要求调用层直接访问内部 `clock` 字段
  - 返回：`{ success: true, data: { absolute_ticks: string, calendars: [] } }`
- **GET `/api/clock/formatted`**
  - 说明：获取包含历法格式化结果的时钟数据；当前后端实现通过 runtime facade `SimulationManager.getAllTimes()` 提供历法视图
- **POST `/api/clock/control`**
  - 说明：控制模拟时钟
  - 参数：`{ action: "pause" | "resume" }`

## 3. 社交层 (L1: Social Layer)

- **GET `/api/social/feed`**
  - 说明：获取公共信息流；返回结果会经过当前 identity 上下文的字段可读性过滤
  - 参数：`?limit=20&author_id=<agent_id>&agent_id=<agent_id>&circle_id=<circle_id>&source_action_intent_id=<intent_id>&from_tick=<tick>&to_tick=<tick>&keyword=<text>&signal_min=<0..1>&signal_max=<0..1>&cursor=<opaque_cursor>&sort=latest|signal`
- **POST `/api/social/post`**
  - 说明：以当前 identity 上下文发布动态
  - 参数：`{ content: string }`

## 4. 关系层 (L2: Relational Layer)

- **GET `/api/relational/graph`**
- **GET `/api/relational/circles`**
- **GET `/api/relationships/:from_id/:to_id/:type/logs`**
- **GET `/api/atmosphere/nodes`**
- **GET `/api/graph/view`**

这些接口仍保留当前行为，不是本轮 world-pack unified governance framework 的主要变化点。

## 5. 审计与调度观察接口

### Audit

- **GET `/api/audit/feed`**
  - 说明：统一查询 workflow / post / relationship adjustment / snr adjustment / event 的最小审计时间线
- **GET `/api/audit/entries/:kind/:id`**
  - 说明：查询单条 unified audit entry 详情

### Scheduler

当前 scheduler 接口族保持不变，仍包括：

- `GET /api/runtime/scheduler/runs`
- `GET /api/runtime/scheduler/summary`
- `GET /api/runtime/scheduler/trends`
- `GET /api/runtime/scheduler/operator`
- `GET /api/runtime/scheduler/ownership`
- `GET /api/runtime/scheduler/migrations`
- `GET /api/runtime/scheduler/workers`
- `GET /api/runtime/scheduler/rebalance/recommendations`
- `GET /api/runtime/scheduler/runs/latest`
- `GET /api/runtime/scheduler/runs/:id`
- `GET /api/runtime/scheduler/decisions`
- `GET /api/agent/:id/scheduler`
- `GET /api/agent/:id/scheduler/projection`

## 6. 叙事与投影接口

### Canonical pack narrative projection endpoint

- **GET `/api/packs/:packId/projections/timeline`**
  - 说明：返回 pack 级 narrative projection
  - 返回：`{ success: true, data: { pack: { id, name, version }, timeline: TimelineEntry[] } }`
  - `TimelineEntry` 当前至少包含：
    - `id: string`
    - `kind: "event" | "rule_execution"`
    - `created_at: string`
    - `title: string`
    - `description: string`
    - `refs: Record<string, string | null>`
    - `data: Record<string, unknown>`
  - 说明：这是当前唯一的 narrative timeline API
  - 当前补充约束：pack runtime 的 `rule_execution` 证据来自 pack-local `runtime.sqlite`
  - 当前 `Event` 仍为 kernel-hosted shared evidence bridge；其 pack-scoped 过滤/关联契约仍在继续完善
  - 当前 packId 语义：在单 active-pack 模式下，请求的 `packId` 必须与当前 active pack 一致；不一致时返回 `409 / PACK_ROUTE_ACTIVE_PACK_MISMATCH`

## 7. Agent / Entity 读取接口

### 7.1 Agent context

- **GET `/api/agent/:id/context`**
  - 说明：获取特定 Agent 的认知上下文
  - 返回：`{ success: true, data: { identity, variables } }`

### 7.2 Canonical entity overview endpoint

- **GET `/api/entities/:id/overview`**
  - 说明：当前 canonical entity-centric overview 路由
  - 参数：`?limit=10`
  - 当前返回结构包含：
    - `profile`
    - `binding_summary`
    - `relationship_summary`
    - `pack_projection`
    - `recent_activity`
    - `recent_posts`
    - `recent_workflows`
    - `recent_events`
    - `recent_inference_results`
    - `snr`
    - `memory`

### 7.4 Agent SNR logs

- **GET `/api/agent/:id/snr/logs`**
  - 说明：查询指定 Agent 的 SNR 调整日志
  - 参数：`?limit=20`

## 8. Overview 聚合接口

### 8.1 Operator overview summary

- **GET `/api/overview/summary`**
  - 说明：为 operator / overview 首屏提供聚合摘要
  - 当前返回结构至少包含：
    - `runtime`
    - `world_time`
    - `active_agent_count`
    - `recent_events`
    - `latest_posts`
    - `latest_propagation`
    - `failed_jobs`
    - `dropped_intents`
    - `notifications`
    - `operator_projection`
    - `global_projection_index`

### 8.2 Pack overview

- **GET `/api/packs/:packId/overview`**
  - 说明：返回当前 pack overview projection 摘要
  - 当前返回至少包含：
    - `pack_id`
    - `entity_count`
    - `entity_state_count`
    - `authority_grant_count`
    - `mediator_binding_count`
    - `rule_execution_count`
    - `latest_rule_execution`
  - 当前补充约束：pack runtime core counts 基于 pack-local `runtime.sqlite` engine-owned tables 读取
  - 当前说明：接口表面已 pack 化；在单 active-pack 模式下，`packId` 必须与当前 active pack 一致

## 9. 推理与工作流接口

### 9.1 Inference debug endpoints

- **POST `/api/inference/preview`**
  - 说明：预览推理上下文与结构化 prompt 结果
  - 输入：`{ agent_id?: string, identity_id?: string, strategy?: "mock"|"rule_based", attributes?: Record<string, unknown>, idempotency_key?: string }`
- **POST `/api/inference/run`**
  - 说明：手动触发一次推理并返回标准化 decision

### 9.2 Workflow endpoints

- **GET `/api/inference/jobs`**
- **POST `/api/inference/jobs`**
- **POST `/api/inference/jobs/:id/retry`**
- **POST `/api/inference/jobs/:id/replay`**
- **GET `/api/inference/jobs/:id`**
- **GET `/api/inference/traces/:id`**
- **GET `/api/inference/traces/:id/intent`**
- **GET `/api/inference/traces/:id/job`**
- **GET `/api/inference/traces/:id/workflow`**
- **GET `/api/inference/jobs/:id/workflow`**

### 9.3 Execution semantics note

说明：

- `ActionIntent` 仍是持久化工作流中的外显对象
- pack 世界规则执行当前主要通过 `InvocationRequest -> enforcement engine` 完成
- `ActionIntent` / `InferenceTrace` / `DecisionJob` 当前仍保留在 kernel-side Prisma，而不是 pack runtime

## 10. 身份与 Access-Policy 接口

- **POST `/api/identity/register`**
- **POST `/api/identity/bind`**
- **POST `/api/identity/bindings/query`**
- **POST `/api/identity/bindings/unbind`**
- **POST `/api/identity/bindings/expire`**
- **POST `/api/access-policy`**
- **POST `/api/access-policy/evaluate`**

说明：

- `/api/access-policy/*` 当前已作为独立 access-policy 子系统宿主
- 它们负责 access / projection policy 的显式写入与评估
- 它们不属于 world-pack governance framework 的核心接口，但也不再被视为 compat/debug surface
- 当前响应不再附带 debug-surface warning meta

## 11. Operator 高级视图后端合同

当前后端已经具备下列高级视图所需的核心证据面；前端页面与交互属于前端实现范围。

### 11.1 Authority Inspector backend contract

可直接复用/组合以下后端证据：

- `buildInferenceContextV2(...).authority_context`
- `buildInferenceContextV2(...).world_rule_context.mediator_bindings`
- `resolveAuthorityForSubject(...)`
- `resolveMediatorBindingsForPack(...)`

核心字段包括：

- `resolved_capabilities[]`
  - `capability_key`
  - `grant_type`
  - `source_entity_id`
  - `mediated_by_entity_id`
  - `target_selector`
  - `conditions`
  - `priority`
  - `provenance.authority_id`
  - `provenance.matched_via`
- `blocked_authority_ids[]`
- `mediator_bindings[]`

### 11.2 Rule Execution Timeline backend contract

可直接复用：

- `getPackEntityOverviewProjection(...).recent_rule_executions`
- `listPackNarrativeTimelineProjection(...).timeline` 中的 `kind='rule_execution'`
- pack-local `rule_execution_records`

核心字段包括：

- `id`
- `rule_id`
- `capability_key`
- `mediator_id`
- `subject_entity_id`
- `target_entity_id`
- `execution_status`
- `created_at`
- `payload_json`
- `emitted_events_json`

### 11.3 Perception Diff backend contract

可直接复用：

- `buildInferenceContextV2(...).perception_context`
- `resolvePerceptionForSubject(...)`

核心字段包括：

- `visible_state_entries[]`
  - `entity_id`
  - `state_namespace`
  - `state_json`
- `hidden_state_entries[]`
  - `entity_id`
  - `state_namespace`
  - `visible`
  - `reason`

### 11.4 前后端交接边界

后端负责：

- authority / perception / mediator provenance / rule execution evidence 输出
- pack/entity/rule 相关 projection contract 稳定化
- handoff 字段与示例说明

前端负责：

- Authority Inspector 页面 UI
- Rule Execution Timeline 页面 UI
- Perception Diff 页面 UI
- 筛选器、布局、导航、交互状态与可视化表达

## 12. 当前边界说明

以下约束需要在调用方与维护文档中保持明确：

1. `/api/packs/:packId/projections/timeline` 是当前唯一的 narrative timeline 接口
2. `/api/entities/:id/overview` 是当前唯一 canonical entity overview 接口
3. `/api/access-policy/*` 属于独立 access-policy 子系统，而不是 world-pack governance 主接口
4. world-pack schema 当前不再接受 legacy `scenario / actions / decision_rules / event_templates`
5. 当前 ownership matrix 已明确：
   - world governance core -> pack runtime
   - `Post / ActionIntent / InferenceTrace / DecisionJob / relationship evidence` -> kernel-side Prisma
   - `Event` -> kernel-side shared evidence host，承担 pack objective enforcement 与 audit/memory/workflow/narrative projection 之间的 bridge
6. `/api/agent/:id/overview` 已删除；web 默认调用面已统一到 `/api/entities/:id/overview`
7. 当前未引入正式 `PackOutboxEvent`：
   - objective enforcement 仍直接写 kernel `Event`
   - narrative / audit / workflow follow-up 继续基于当前 bridge 与 projection extraction 运作
8. runtime boundary 的第一轮调整已完成：
   - activation/bootstrap 细节已从 `SimulationManager.init()` 抽离到独立模块
   - 生产代码中的 tick / calendar 读取已优先经由 runtime facade，而不是继续直接依赖内部 `clock` 对象
9. 当前 pack 投影 API 在单 active-pack 模式下运行：
   - `packId` 必须与当前 active pack 一致
   - 不一致时返回 `PACK_ROUTE_ACTIVE_PACK_MISMATCH`

## 13. 错误代码参考 (Error Codes)

当前常见错误码包括但不限于：

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
- `POLICY_INVALID`
- `POLICY_EVAL_INVALID`
- `INFERENCE_INPUT_INVALID`
- `INFERENCE_PROVIDER_FAIL`
- `ACTION_DISPATCH_FAIL`
- `EVENT_TYPE_UNSUPPORTED`
- `WORLD_PACK_NOT_READY`
- `PACK_ROUTE_ACTIVE_PACK_MISMATCH`
