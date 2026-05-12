# API 说明

本文档描述对外 HTTP contract。路由分为两层：

- **Global** — 直接注册在 Express app 上，无 pack 前缀
- **Pack-scoped** — 挂载于 `/:packId`，经过 `packScopeMiddleware` 校验 pack 状态。非 `ready` 状态的 pack 返回 503（loading/unloading/degraded）或 404（gone）

> 模块分层与宿主关系见 `../ARCH.md` · 业务执行语义见 `../LOGIC.md` · 专题细节见 `../subsystems/`

## 通用说明

- 所有接口路径以 `/api/` 开头
- query / params 不满足约束时返回 `400`
- 返回结构统一为 `{ success: true, data: ... }`，分页接口额外包含 `meta.pagination`
- BigInt 值通过 HTTP 以字符串形式传输
- 全局限流：1000 req / 15 min / IP。超限返回 `429`。响应头含 `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`
- 认证路由（`/api/auth/login`, `/api/auth/refresh`）额外限制：20 req / 15 min / IP
- 请求体大小限制：1 MB

---

## 0. 路由分层速查

### Global 路由（无 `/:packId` 前缀）

| 模块 | 路径 |
|------|------|
| System | `/api/health`, `/api/status`, `/api/system/notifications`, `/api/system/notifications/clear` |
| Config | `/api/config`, `/api/config/domains`, `/api/config/:domain` |
| Config Backup | `/api/config/backups`, `/api/config/backups/:id`, `/api/config/backups/:id/download`, `/api/config/backups/:id/restore`, `/api/config/backup-policy`, `/api/config/backups/cleanup` |
| Auth | `/api/auth/login`, `/api/auth/logout`, `/api/auth/session`, `/api/auth/refresh` |
| Operators | `/api/operators`, `/api/operators/:id` |
| Pack Bindings | `/api/packs/:packId/bindings`, `/api/me/bindings` |
| Agent Bindings | `/api/agents/:agentId/bindings`, `/api/agents/:agentId/bindings/me`, `/api/agents/:agentId/operators` |
| Grants | `/api/packs/:packId/grants` |
| Operator Audit | `/api/audit/logs`, `/api/audit/logs/me` |
| Plugins (global) | `/api/packs/:packId/plugins`, `/api/packs/:packId/plugins/:installationId/*` |
| Plugin Web (global) | `/api/packs/:packId/plugins/runtime/web`, `/api/packs/:packId/plugins/:pluginId/runtime/web/:installationId/*`, `/api/experimental/runtime/packs/:packId/plugins/runtime/web`, `/api/experimental/runtime/packs/:packId/plugins/:pluginId/runtime/web/:installationId/*` |

### Pack-scoped 路由（`/:packId/api/...`）

| 模块 | 路径 |
|------|------|
| Clock | `/api/runtime/speed`, `/api/clock`, `/api/clock/formatted`, `/api/clock/control` |
| Social | `/api/social/feed`, `/api/social/post` |
| Relational | `/api/relational/graph`, `/api/relational/circles`, `/api/atmosphere/nodes`, `/api/relationships/:from_id/:to_id/:type/logs` |
| Graph | `/api/graph/view` |
| Overview | `/api/overview/summary`, `/api/packs/overview` |
| Pack Openings | `/api/packs/openings`, `/api/packs/openings/:openingId/apply` |
| Snapshots | `/api/packs/snapshots`, `/api/packs/snapshots/:snapshotId/restore` |
| Narrative | `/api/packs/projections/timeline` |
| Inference | `/api/inference/preview`, `/api/inference/run`, `/api/inference/jobs`, `/api/inference/jobs/:id`, `/api/inference/jobs/:id/retry`, `/api/inference/jobs/:id/replay`, `/api/inference/jobs/:id/workflow`, `/api/inference/traces/:id`, `/api/inference/traces/:id/intent`, `/api/inference/traces/:id/job`, `/api/inference/traces/:id/workflow`, `/api/inference/ai-invocations`, `/api/inference/ai-invocations/:id` |
| Agent/Entity | `/api/agent/:id/context`, `/api/entities/:id/overview`, `/api/agent/:id/snr/logs`, `/api/agent/:id/scheduler/projection` |
| Identity | `/api/identity/register`, `/api/identity/bind`, `/api/identity/bindings/query`, `/api/identity/bindings/unbind`, `/api/identity/bindings/expire` |
| Audit | `/api/audit/feed`, `/api/audit/entries/:kind/:id` |
| Scheduler | `/api/runtime/scheduler/*`, `/api/agent/:id/scheduler` |
| Experimental | `/api/experimental/runtime/*`, `/api/experimental/packs/*` |

---

## 1. 系统信息 (System)

所有 system 路由为 **global**（无 `/:packId` 前缀）。

- **GET `/api/health`**
  - 鉴权：无
  - 说明：启动与运行健康检查
  - 返回：`{ success: true, data: { healthy, level, runtime_ready, checks, available_world_packs, errors } }`

- **GET `/api/status`**
  - 鉴权：root
  - 说明：运行时状态快照（含当前活跃 pack 元数据）。多包场景下 `world_pack` 返回首个已加载 pack 的信息，各 pack 独立状态通过 `GET /api/experimental/runtime/packs` 获取。
  - 返回：`{ success: true, data: { status, runtime_ready, runtime_speed, runtime_loop, database, scheduler, ai, health_level, world_pack, has_error, startup_errors } }`

- **GET `/api/system/notifications`**
  - 鉴权：root
  - 说明：系统通知队列
  - 返回：`{ success: true, data: Array<{ id, level, content, timestamp, code?, details? }> }`

- **POST `/api/system/notifications/clear`**
  - 鉴权：root
  - 说明：清空系统通知队列
  - 返回：`{ success: true, data: { acknowledged: true } }`

---

## 2. 配置管理 (Config)

所有 config 路由为 **global**。敏感字段（jwt_secret、default_password）脱敏返回。写操作受 tier 控管：safe tier 即时热重载，其他 tier 写入文件并提示重启。

- **GET `/api/config`**
  - 鉴权：operator（Bearer token）
  - 说明：完整配置（脱敏）
  - 返回：`{ success: true, data: { ... } }`

- **GET `/api/config/domains`**
  - 鉴权：operator
  - 说明：列出所有配置域及其 tier
  - 返回：`{ success: true, data: Array<{ domain, tier, ... }> }`

- **GET `/api/config/:domain`**
  - 鉴权：operator
  - 说明：单个域配置。domain 可选值：`app`, `paths`, `operator`, `plugins`, `world`, `startup`, `database`, `logging`, `clock`, `world_engine`, `scheduler`, `prompt_workflow`, `runtime`, `features`
  - 错误码：`CONFIG_DOMAIN_NOT_FOUND`

- **PATCH `/api/config/:domain`**
  - 鉴权：root
  - 说明：更新指定域配置。body 为 `Record<string, unknown>`，合并写入对应 `conf.d/<domain>.yaml`
  - 返回：`{ success: true, data: { domain, tier, hotReloaded, requiresRestart, message } }`
  - 错误码：`INVALID_CONFIG_UPDATE`, `CONFIG_DOMAIN_NOT_FOUND`, `ROOT_REQUIRED`

---

## 3. 配置备份 (Config Backup)

所有 backup 路由为 **global**。通过 tar.gz 归档 `data/configw/` 目录，元数据存储在 `data/backups/config/backups.json`。默认配置的保留策略：最多 20 个，最长 30 天。

- **POST `/api/config/backups`** — 创建备份（root）。body：`{ name?: string }`
- **GET `/api/config/backups`** — 列出备份（operator）。query：`?limit=20&offset=0`
- **GET `/api/config/backups/:id`** — 备份详情（operator）
- **GET `/api/config/backups/:id/download`** — 下载备份文件（root）
- **DELETE `/api/config/backups/:id`** — 删除备份（root）
- **POST `/api/config/backups/:id/restore`** — 恢复备份（root）。query：`?force=true`
- **GET `/api/config/backup-policy`** — 保留策略（operator）
- **POST `/api/config/backups/cleanup`** — 触发保留策略清理（root）

错误码：`BACKUP_NOT_FOUND`, `ROOT_REQUIRED`, `OPERATOR_REQUIRED`, `INVALID_BACKUP_REQUEST`, `INVALID_LIST_QUERY`

---

## 4. Operator 认证与权限

所有 operator 路由为 **global**。JWT Bearer Token 认证，三层权限递进：Pack Access (L1) → Capability (L2) → Policy (L3)。

### 4.1 认证

- **POST `/api/auth/login`** — 用户名+密码 → JWT token。body：`{ username, password, pack_id? }`
- **POST `/api/auth/logout`** — 注销当前 session（Bearer）
- **GET `/api/auth/session`** — 当前 operator + identity 信息（Bearer）。未认证时返回 `null`
- **POST `/api/auth/refresh`** — 签发新 token（Bearer）

### 4.2 Operator CRUD（root 限定）

- **POST `/api/operators`** — 创建 Operator。body：`{ username, password, is_root?, label? }`
- **GET `/api/operators`** — Operator 列表
- **GET `/api/operators/:id`** — Operator 详情（含 pack_bindings）
- **PATCH `/api/operators/:id`** — 修改状态/密码
- **DELETE `/api/operators/:id`** — 软删除（status='disabled'）

错误码：`OPERATOR_INVALID`, `ROOT_REQUIRED`, `USERNAME_TAKEN`, `OPERATOR_NOT_FOUND`

### 4.3 Pack 绑定

- **POST `/api/packs/:packId/bindings`** — 邀请加入 Pack。body：`{ operator_id, binding_type }`
- **GET `/api/packs/:packId/bindings`** — 成员列表
- **PATCH `/api/packs/:packId/bindings/:operatorId`** — 修改角色。body：`{ binding_type }`
- **DELETE `/api/packs/:packId/bindings/:operatorId`** — 移除成员
- **GET `/api/me/bindings`** — 当前 Operator 的 Pack 列表

错误码：`OPERATOR_REQUIRED`, `BINDING_INVALID`, `BINDING_NOT_FOUND`, `BINDING_ALREADY_EXISTS`

### 4.4 Agent 绑定

- **POST `/api/agents/:agentId/bindings`** — 绑定到 Agent。body：`{ operator_id?, role? }`
- **DELETE `/api/agents/:agentId/bindings/me`** — 解绑自身
- **GET `/api/agents/:agentId/operators`** — 控制该 Agent 的 Operators

错误码：`OPERATOR_REQUIRED`, `BINDING_INVALID`

### 4.5 能力委托 (Grants)

- **POST `/api/packs/:packId/grants`** — 委托 capability。body：`{ receiver_identity_id, capability_key, scope_json?, revocable?, expires_at? }`
- **GET `/api/packs/:packId/grants`** — 列出当前 Operator 发出的 grants
- **DELETE `/api/packs/:packId/grants/:grantId`** — 撤销委托（仅 grant owner）

错误码：`OPERATOR_REQUIRED`, `GRANT_INVALID`, `GRANT_NOT_FOUND`

### 4.6 Operator 审计日志

- **GET `/api/audit/logs`** — 审计日志（root 可见全部）。query：`?operator_id&pack_id&action&from_date&to_date&limit&cursor`
- **GET `/api/audit/logs/me`** — 当前 Operator 的审计日志。query 同上

错误码：`OPERATOR_REQUIRED`, `AUDIT_QUERY_INVALID`

---

## 5. 虚拟时钟 (Clock)

**Pack-scoped** — 完整路径为 `/:packId/api/clock`。

- **GET `/api/clock`**
  - 鉴权：无
  - 说明：原始虚拟时钟（absolute_ticks）
  - 返回：`{ success: true, data: { absolute_ticks: string, calendars: [] } }`

- **GET `/api/clock/formatted`**
  - 鉴权：无
  - 说明：含历法格式化结果的时钟数据
  - 返回：`{ success: true, data: { absolute_ticks: string, calendars: [...] } }`
  - 错误码：`CLOCK_FORMAT_ERR`

- **POST `/api/clock/control`**
  - 鉴权：operator
  - 说明：暂停/恢复模拟时钟
  - body：`{ action: "pause" | "resume" }`
  - 错误码：`CLOCK_ACTION_INVALID`

- **POST `/api/runtime/speed`**
  - 鉴权：operator
  - 说明：覆盖或清除运行时步进速度
  - body：`{ action: "override", step_ticks: string|number }` 或 `{ action: "clear" }`
  - 错误码：`RUNTIME_SPEED_INVALID`, `RUNTIME_SPEED_ACTION_INVALID`

---

## 6. 社交层 (Social)

**Pack-scoped** — 完整路径为 `/:packId/api/social/*`。

- **GET `/api/social/feed`**
  - 鉴权：无（通过 identity header 解析上下文）
  - 说明：公共信息流
  - query：`?limit=20&author_id&agent_id&circle_id&source_action_intent_id&from_tick&to_tick&keyword&signal_min&signal_max&cursor&sort=latest|signal`
  - 返回：`{ success: true, data: [...], meta: { pagination: { ... } } }`
  - 错误码：`SOCIAL_FEED_QUERY_INVALID`

- **POST `/api/social/post`**
  - 鉴权：operator
  - 说明：以当前 identity 上下文发布动态
  - body：`{ content: string }`
  - 返回：`{ success: true, data: { id, content, created_at, author_id, ... } }`
  - 错误码：`SOCIAL_POST_INVALID`

---

## 7. 关系层 (Relational)

**Pack-scoped** — 完整路径为 `/:packId/api/relational/*`。

- **GET `/api/relational/graph`** — 关系图谱数据
- **GET `/api/relational/circles`** — 关系圈列表
- **GET `/api/atmosphere/nodes`** — 氛围节点。query：`?owner_id&include_expired=true|false`
- **GET `/api/relationships/:from_id/:to_id/:type/logs`** — 关系调整日志。query：`?limit=20`

错误码：`RELATIONAL_QUERY_INVALID`, `RELATIONSHIP_LOG_QUERY_INVALID`

---

## 8. 图形视图 (Graph)

**Pack-scoped** — 完整路径为 `/:packId/api/graph/view`。

- **GET `/api/graph/view`**
  - 鉴权：无
  - 说明：图形视图查询
  - query：`?view&depth&root_id&kinds&include_inactive&include_unresolved&search`
  - 错误码：`GRAPH_VIEW_QUERY_INVALID`

---

## 9. 概览 (Overview)

**Pack-scoped** — 完整路径为 `/:packId/api/overview/*` 和 `/:packId/api/packs/overview`。

- **GET `/api/overview/summary`**
  - 鉴权：packAccessGuard
  - 说明：operator 首屏聚合摘要
  - 返回：`{ runtime, world_time, active_agent_count, recent_events, latest_posts, latest_propagation, failed_jobs, dropped_intents, notifications, operator_projection, global_projection_index }`

- **GET `/api/packs/overview`**
  - 鉴权：packAccessGuard
  - 说明：pack overview projection 摘要
  - 返回：`{ pack_id, entity_count, entity_state_count, authority_grant_count, mediator_binding_count, rule_execution_count, latest_rule_execution }`

---

## 10. Pack Openings

**Pack-scoped** — 完整路径为 `/:packId/api/packs/openings`。

- **GET `/api/packs/openings`**
  - 鉴权：packAccessGuard
  - 说明：列出 pack 的 openings（模板/变体入口）
  - 返回：`{ success: true, data: { openings: [...] } }`
  - 错误码：`OPENING_LIST_INVALID`

- **POST `/api/packs/openings/:openingId/apply`**
  - 鉴权：packAccessGuard
  - 说明：应用一个 opening。若 pack 处于 active 状态，需 `confirm_data_loss: true`
  - body：`{ confirm_data_loss?: boolean }`
  - 错误码：`OPENING_APPLY_INVALID`, `OPENING_APPLY_BODY_INVALID`, `OPENING_DATA_LOSS_UNCONFIRMED`

---

## 11. 世界包快照 (Snapshots)

**Pack-scoped** — 完整路径为 `/:packId/api/packs/snapshots`。

> 快照功能仅支持 SQLite 后端。非 SQLite 后端返回 `501 SNAPSHOT_NOT_AVAILABLE`。

快照是对世界包运行时完整状态的存档，存储在 `data/world_packs/<pack_id>/snapshots/<snapshot_id>/`。每 pack 最多 20 个快照，超出自动淘汰最旧。

- **GET `/api/packs/snapshots`**
  - 鉴权：packAccessGuard
  - 说明：列出 pack 所有快照
  - 返回：`{ snapshots: Array<{ snapshot_id, label, captured_at_tick, captured_at_timestamp, runtime_db_size_bytes, prisma_record_count }> }`
  - 错误码：`SNAPSHOT_LIST_INVALID`, `SNAPSHOT_NOT_AVAILABLE`

- **POST `/api/packs/snapshots`**
  - 鉴权：packAccessGuard
  - 说明：创建运行时状态快照（自动暂停→捕获→恢复）
  - body：`{ label?: string }` — 最长 256 字符
  - 返回：`{ snapshot_id, pack_id, captured_at_tick, prisma_record_count, runtime_db_size_bytes }`
  - 错误码：`SNAPSHOT_CREATE_INVALID`, `SNAPSHOT_CREATE_BODY_INVALID`, `SNAPSHOT_NOT_AVAILABLE`

- **POST `/api/packs/snapshots/:snapshotId/restore`**
  - 鉴权：packAccessGuard
  - 说明：从快照恢复 pack 运行时。会清除所有运行时数据
  - body：`{ confirm_data_loss: boolean }` — 必须为 `true`
  - 返回：`{ restored: true, pack_id, snapshot_id, restored_at_tick }`
  - 错误码：`SNAPSHOT_RESTORE_INVALID`, `SNAPSHOT_RESTORE_BODY_INVALID`, `SNAPSHOT_DATA_LOSS_UNCONFIRMED`, `SNAPSHOT_NOT_AVAILABLE`, `PACK_NOT_LOADED`, `PACK_ID_MISMATCH`

- **DELETE `/api/packs/snapshots/:snapshotId`**
  - 鉴权：packAccessGuard
  - 说明：删除指定快照及其所有文件
  - 返回：`{ deleted: true, snapshot_id }`
  - 错误码：`SNAPSHOT_DELETE_INVALID`, `SNAPSHOT_NOT_AVAILABLE`

---

## 12. 叙事投影 (Narrative)

**Pack-scoped** — 完整路径为 `/:packId/api/packs/projections/timeline`。

- **GET `/api/packs/projections/timeline`**
  - 鉴权：packAccessGuard
  - 说明：pack 级叙事时间线投影
  - 返回：`{ success: true, data: { pack: { id, name, version }, timeline: TimelineEntry[] } }`
  - `TimelineEntry` 包含：`id`, `kind: "event" | "rule_execution"`, `created_at`, `title`, `description`, `refs`, `data`

---

## 13. Agent / Entity

**Pack-scoped** — 完整路径为 `/:packId/api/agent/*` 和 `/:packId/api/entities/*`。

- **GET `/api/agent/:id/context`**
  - 鉴权：capabilityGuard (`PERCEIVE_AGENT_CONTEXT`)
  - 说明：Agent 认知上下文快照
  - 返回：`{ success: true, data: { identity, variables } }`
  - 错误码：`AGENT_QUERY_INVALID`

- **GET `/api/entities/:id/overview`**
  - 鉴权：capabilityGuard (`PERCEIVE_ENTITY_OVERVIEW`)
  - 说明：canonical entity-centric overview
  - query：`?limit=10`
  - 返回：`{ profile, binding_summary, relationship_summary, pack_projection, recent_activity, recent_posts, recent_workflows, recent_events, recent_inference_results, snr, memory, context_governance }`
  - 错误码：`AGENT_QUERY_INVALID`

- **GET `/api/agent/:id/snr/logs`**
  - 鉴权：capabilityGuard (`PERCEIVE_AGENT_LOGS`)
  - 说明：Agent SNR 调整日志
  - query：`?limit=20`
  - 错误码：`SNR_LOG_QUERY_INVALID`

- **GET `/api/agent/:id/scheduler/projection`**
  - 鉴权：capabilityGuard (`PERCEIVE_AGENT_SCHEDULER`)
  - 说明：Agent 调度器投影
  - query：`?limit`
  - 错误码：`AGENT_QUERY_INVALID`

---

## 14. 推理与工作流 (Inference)

**Pack-scoped** — 完整路径为 `/:packId/api/inference/*`。

### 14.1 推理执行

- **POST `/api/inference/preview`**
  - 鉴权：operator
  - 说明：预览推理上下文与结构化 prompt 结果
  - body：`{ agent_id?, identity_id?, actor_entity_id?, strategy?: "mock"|"rule_based", attributes?, idempotency_key? }`
    - 优先级：`agent_id` > `identity_id` > `actor_entity_id` > system fallback
  - 错误码：`INFERENCE_INPUT_INVALID`

- **POST `/api/inference/run`**
  - 鉴权：operator
  - 说明：手动触发推理并返回标准化 decision
  - body：同 preview

### 14.2 工作流

- **GET `/api/inference/jobs`** — 推理任务列表（分页）。query：`?status&agent_id&identity_id&strategy&job_type&from_tick&to_tick&from_created_at&to_created_at&cursor&limit&has_error&action_intent_id`
- **POST `/api/inference/jobs`** — 提交推理任务。body：同 inferenceRequestSchema
- **POST `/api/inference/jobs/:id/retry`** — 重试失败任务
- **POST `/api/inference/jobs/:id/replay`** — 重放任务（可覆盖 strategy/attributes）
- **GET `/api/inference/jobs/:id`** — 按 ID 获取任务详情
- **GET `/api/inference/jobs/:id/workflow`** — 获取任务的完整工作流快照
- **GET `/api/inference/traces/:id`** — 按 ID 获取推理追踪
- **GET `/api/inference/traces/:id/intent`** — 获取追踪的 action intent
- **GET `/api/inference/traces/:id/job`** — 获取追踪的 decision job
- **GET `/api/inference/traces/:id/workflow`** — 获取追踪的工作流快照

### 14.3 AI 调用观测

- **GET `/api/inference/ai-invocations`** — AI 调用记录列表（分页）。query：`?status&provider&model&task_type&source_inference_id&route_id&has_error&from_created_at&to_created_at&cursor&limit`
- **GET `/api/inference/ai-invocations/:id`** — 单条 AI 调用记录详情

### 14.4 稳定边界

- 公开 inference strategy 只稳定承诺 `mock` 与 `rule_based`；`model_routed` 为内部/受控能力（内部已配备 4 个真实 provider adapter 及多 provider fallback 链）
- `GET /api/inference/ai-invocations*` 为公开只读 observability surface

---

## 15. 身份 (Identity)

**Pack-scoped** — 完整路径为 `/:packId/api/identity/*`。

- **POST `/api/identity/register`** — 注册 identity。鉴权：operator
- **POST `/api/identity/bind`** — 创建 identity binding。鉴权：operator
- **POST `/api/identity/bindings/query`** — 查询 identity bindings。鉴权：operator
- **POST `/api/identity/bindings/unbind`** — 解绑 identity binding。鉴权：operator
- **POST `/api/identity/bindings/expire`** — 过期 identity binding。鉴权：operator

错误码：`IDENTITY_INVALID`, `IDENTITY_BINDING_INVALID`, `IDENTITY_BINDING_NOT_FOUND`, `IDENTITY_REQUIRED`, `IDENTITY_HEADER_INVALID`, `IDENTITY_FIELD_FORBIDDEN`

---

## 16. Pack 审计 (Audit)

**Pack-scoped** — 完整路径为 `/:packId/api/audit/*`。

- **GET `/api/audit/feed`**
  - 鉴权：无
  - 说明：统一查询 workflow / post / relationship adjustment / snr adjustment / event 的最小审计时间线
  - query：`?limit&kinds&from_tick&to_tick&job_id&inference_id&agent_id&action_intent_id&cursor`
  - 返回：`{ success: true, data: [...], meta: { pagination: { ... } } }`
  - 错误码：`AUDIT_VIEW_QUERY_INVALID`

- **GET `/api/audit/entries/:kind/:id`**
  - 鉴权：无
  - 说明：单条 unified audit entry 详情
  - 错误码：`AUDIT_VIEW_QUERY_INVALID`

---

## 17. 调度器观测 (Scheduler Observability)

**Pack-scoped** — 完整路径为 `/:packId/api/runtime/scheduler/*`。

所有 scheduler 读接口支持可选 `?packId=` query 参数（部分接口使用 `?pack_id=`），传入时只查询指定 pack，不传时跨所有已加载 pack 聚合。均需 `PERCEIVE_SCHEDULER_OBSERVABILITY` capability。

- **GET `/api/runtime/scheduler/runs/latest`** — 最新一次调度运行
- **GET `/api/runtime/scheduler/runs`** — 调度运行列表（分页）。query：`?limit&cursor&from_tick&to_tick&worker_id&partition_id&pack_id`
- **GET `/api/runtime/scheduler/runs/:id`** — 单次运行详情。query：`?packId=`
- **GET `/api/runtime/scheduler/summary`** — 调度摘要。query：`?sample_runs&packId=`
- **GET `/api/runtime/scheduler/trends`** — 调度趋势。query：`?sample_runs&pack_id=`
- **GET `/api/runtime/scheduler/operator`** — operator 投影。query：`?sample_runs&recent_limit&packId=`
- **GET `/api/runtime/scheduler/ownership`** — 分区所有权分配。query：`?worker_id&partition_id&status&packId=`
- **GET `/api/runtime/scheduler/migrations`** — 所有权迁移。query：`?limit&worker_id&partition_id&status&pack_id=`
- **GET `/api/runtime/scheduler/workers`** — worker 运行时状态。query：`?worker_id&status&packId=`
- **GET `/api/runtime/scheduler/rebalance/recommendations`** — 再平衡建议。query：`?limit&worker_id&partition_id&status&suppress_reason&pack_id=`
- **GET `/api/runtime/scheduler/decisions`** — 调度决策列表（分页）。query：`?limit&cursor&actor_id&kind&reason&skipped_reason&from_tick&to_tick&partition_id&pack_id=`
- **GET `/api/agent/:id/scheduler`** — 特定 agent 的调度决策。鉴权：`PERCEIVE_AGENT_SCHEDULER`。query：`?packId=`

错误码：`SCHEDULER_QUERY_INVALID`

---

## 18. 插件治理 (Plugins)

插件治理接口为 **global**（通过 `:packId` 路径参数指定 pack，不经过 packScopeMiddleware）。

### 18.1 安装管理

- **GET `/api/packs/:packId/plugins`**
  - 鉴权：packAccessGuard
  - 说明：列出 pack-local plugin installations
  - 返回：`{ success: true, data: { pack_id, items: PluginSummary[], enable_warning } }`
  - 错误码：`PLUGIN_QUERY_INVALID`

- **POST `/api/packs/:packId/plugins/:installationId/confirm`**
  - 鉴权：packAccessGuard + capabilityGuard (`MANAGE_PLUGINS`)
  - 说明：确认导入插件 installation
  - body：`{ granted_capabilities?: string[] }`
  - 错误码：`PLUGIN_INSTALLATION_INVALID`

- **POST `/api/packs/:packId/plugins/:installationId/enable`**
  - 鉴权：packAccessGuard + capabilityGuard (`MANAGE_PLUGINS`)
  - 说明：启用插件。当 `enable_warning.require_acknowledgement=true` 时，body 必须提供 `acknowledgement`
  - body：`{ acknowledgement: { reminder_text_hash, actor_id?, actor_label? } }`
  - 错误码：`PLUGIN_ENABLE_ACK_REQUIRED`, `PLUGIN_ENABLE_ACK_INVALID`, `PLUGIN_ENABLE_INVALID_STATE`, `PLUGIN_INSTALLATION_INVALID`

- **POST `/api/packs/:packId/plugins/:installationId/disable`**
  - 鉴权：packAccessGuard + capabilityGuard (`MANAGE_PLUGINS`)
  - 说明：禁用插件 installation
  - 错误码：`PLUGIN_INSTALLATION_INVALID`

### 18.2 Plugin Runtime Web（global 命名空间）

分层原则：
- `/api/packs/:packId/plugins/runtime/web` — stable surface，仅限当前活跃包（active pack）
- `/api/experimental/runtime/packs/:packId/plugins/runtime/web` — experimental surface，任意已加载包

- **GET `/api/packs/:packId/plugins/runtime/web`** — 读取指定 pack 的已启用 web plugin runtime manifest（stable 仅允许活跃包）
- **GET `/api/packs/:packId/plugins/:pluginId/runtime/web/:installationId/*`** — 访问 stable 同源 web 资产
- **GET `/api/experimental/runtime/packs/:packId/plugins/runtime/web`** — 读取 loaded pack 的 web plugin runtime snapshot（不限制包）
- **GET `/api/experimental/runtime/packs/:packId/plugins/:pluginId/runtime/web/:installationId/*`** — 访问 experimental 同源 web 资产

错误码：`PLUGIN_WEB_ASSET_NOT_ENABLED`, `PLUGIN_WEB_ASSET_FORBIDDEN`, `PLUGIN_WEB_ASSET_NOT_FOUND`, `PLUGIN_WEB_ENTRYPOINT_NOT_FOUND`, `PLUGIN_QUERY_INVALID`

更详细的治理与运行时说明见 `../guides/PLUGIN_OPERATIONS.md` 和 `../subsystems/PLUGIN_RUNTIME.md`。

---

## 19. Experimental 接口

**稳定性声明**：以下接口面向 operator / test-only 试验，不承诺短期稳定 contract。路由同时存在于 global 命名空间（plugin web）和 pack-scoped 命名空间（`:packId` 子路由下）。

### 19.1 Experimental Runtime（pack-scoped，`:packId/api/experimental/runtime/*`）

- **GET `/api/experimental/runtime/system/health`** — 系统健康快照（无 packId 依赖）
- **GET `/api/experimental/runtime/packs`** — control-plane snapshot（含 primary_pack_id（首个已加载 pack）, system_health_level, runtime_ready, per-pack status/clock/scheduler/plugin 摘要）
- **POST `/api/experimental/runtime/packs/load`** — 加载 pack 到 experimental runtime registry。鉴权：packAccessGuard + `INVOKE_SCHEDULER_CONTROL`
- **POST `/api/experimental/runtime/packs/unload`** — 卸载。鉴权：同上
- **POST `/api/experimental/runtime/packs/step`** — 手动推进 pack 时钟。body：`{ amount?: number }`。鉴权：同上
- **GET `/api/experimental/runtime/packs/status`** — pack 运行时状态。鉴权：packAccessGuard + `PERCEIVE_SCHEDULER_OBSERVABILITY`
- **GET `/api/experimental/runtime/packs/clock`** — pack 时钟快照。鉴权：同上
- **GET `/api/experimental/runtime/packs/scheduler/summary`** — pack 调度摘要。鉴权：同上
- **GET `/api/experimental/runtime/packs/scheduler/ownership`** — pack 所有权分配。鉴权：同上
- **GET `/api/experimental/runtime/packs/scheduler/workers`** — pack worker 状态。鉴权：同上
- **GET `/api/experimental/runtime/packs/scheduler/operator`** — pack operator 投影。鉴权：同上

错误码：`EXPERIMENTAL_PACK_ID_INVALID`, `EXPERIMENTAL_PACK_RUNTIME_NOT_FOUND`, `EXPERIMENTAL_PACK_RUNTIME_CAPACITY_REACHED`, `EXPERIMENTAL_PACK_RUNTIME_LOAD_FAILED`, `EXPERIMENTAL_PACK_RUNTIME_ACTIVE_UNLOAD_FORBIDDEN`, `EXPERIMENTAL_PACK_RUNTIME_UNLOAD_FAILED`

### 19.2 Experimental Projections（pack-scoped，`:packId/api/experimental/packs/*`）

- **GET `/api/experimental/packs/overview`** — pack overview projection。鉴权：packAccessGuard
- **GET `/api/experimental/packs/projections/timeline`** — narrative timeline projection。鉴权：packAccessGuard
- **GET `/api/experimental/packs/projections/entities`** — entity 列表 projection。鉴权：packAccessGuard
- **GET `/api/experimental/packs/entities/:id/overview`** — 单 entity overview。鉴权：packAccessGuard
- **GET `/api/experimental/packs/plugins`** — plugin installations。鉴权：packAccessGuard

错误码：`EXPERIMENTAL_PACK_ID_INVALID`, `EXPERIMENTAL_PACK_RUNTIME_NOT_FOUND`, `EXPERIMENTAL_PACK_PROJECTION_FAILED`

### 19.3 约束

- 不替代 canonical stable API
- `:packId` 需先进入 experimental runtime registry（显式 load 或已存在于 loaded set）
- stable/experimental projection 路径共享 `pack-scoped core service + scope adapter`，但 stable active-pack guard 保持不变
- inference/context 只新增 internal pack-scoped contract，不新增 public inference multi-pack run API

---

## 20. Plugin-contributed 动态路由

启动时 `pluginRuntimeRegistry.applyPackRoutes()` 在 global app 上注册已启用 plugin manifest 声明的任意 GET 路由。这些路由按 pack/plugin/installation 作用域限定，不在本文档中逐条列出。具体路由以各 plugin 的 manifest 声明为准。

---

## 21. 错误代码参考

| 错误码 | 说明 |
|--------|------|
| `SYS_INIT_FAIL` | 系统初始化失败 |
| `SIM_STEP_ERR` | 模拟步进错误 |
| `API_INTERNAL_ERROR` | 内部错误 |
| `CLOCK_FORMAT_ERR` | 时钟格式化失败 |
| `CLOCK_ACTION_INVALID` | 时钟操作无效 |
| `RUNTIME_SPEED_INVALID` | 运行时速度参数无效 |
| `RUNTIME_SPEED_ACTION_INVALID` | 运行时速度操作无效 |
| `AGENT_QUERY_INVALID` | Agent 查询参数无效 |
| `AGENT_NOT_FOUND` | Agent 不存在 |
| `IDENTITY_HEADER_INVALID` | Identity header 无效 |
| `IDENTITY_REQUIRED` | 需要 Identity |
| `IDENTITY_FIELD_FORBIDDEN` | Identity 字段禁止修改 |
| `IDENTITY_INVALID` | Identity 参数无效 |
| `IDENTITY_BINDING_INVALID` | Identity 绑定参数无效 |
| `IDENTITY_BINDING_NOT_FOUND` | Identity 绑定不存在 |
| `POLICY_INVALID` | 策略参数无效 |
| `POLICY_EVAL_INVALID` | 策略评估参数无效 |
| `INFERENCE_INPUT_INVALID` | 推理输入无效 |
| `INFERENCE_PROVIDER_FAIL` | 推理提供者失败 |
| `ACTION_DISPATCH_FAIL` | Action 分发失败 |
| `EVENT_TYPE_UNSUPPORTED` | 不支持的事件类型 |
| `WORLD_PACK_NOT_READY` | World-pack 未就绪 |
| `PACK_ROUTE_ACTIVE_PACK_MISMATCH` | Pack 路由不匹配 |
| `OPERATOR_REQUIRED` | 需要 Operator 认证 |
| `PACK_ACCESS_DENIED` | Pack 访问拒绝 |
| `CAPABILITY_DENIED` | 能力不足 |
| `ROOT_REQUIRED` | 需要 root 权限 |
| `INVALID_CREDENTIALS` | 凭证无效 |
| `OPERATOR_DISABLED` | Operator 已禁用 |
| `OPERATOR_NOT_FOUND` | Operator 不存在 |
| `BINDING_NOT_FOUND` | 绑定不存在 |
| `BINDING_ALREADY_EXISTS` | 绑定已存在 |
| `GRANT_NOT_FOUND` | Grant 不存在 |
| `GRANT_INVALID` | Grant 参数无效 |
| `USERNAME_TAKEN` | 用户名已被占用 |
| `SESSION_EXPIRED` | Session 已过期 |
| `TOKEN_INVALID` | Token 无效 |
| `BACKUP_NOT_FOUND` | 备份不存在 |
| `INVALID_BACKUP_REQUEST` | 备份请求无效 |
| `INVALID_LIST_QUERY` | 列表查询参数无效 |
| `CONFIG_DOMAIN_NOT_FOUND` | 配置域不存在 |
| `INVALID_CONFIG_UPDATE` | 配置更新无效 |
| `SNAPSHOT_NOT_AVAILABLE` | 快照功能不可用（非 SQLite 后端） |
| `SNAPSHOT_LIST_INVALID` | 快照列表查询无效 |
| `SNAPSHOT_CREATE_INVALID` | 快照创建参数无效 |
| `SNAPSHOT_CREATE_BODY_INVALID` | 快照创建 body 无效 |
| `SNAPSHOT_RESTORE_INVALID` | 快照恢复参数无效 |
| `SNAPSHOT_RESTORE_BODY_INVALID` | 快照恢复 body 无效 |
| `SNAPSHOT_DATA_LOSS_UNCONFIRMED` | 未确认数据丢失风险 |
| `SNAPSHOT_DELETE_INVALID` | 快照删除参数无效 |
| `PACK_NOT_LOADED` | Pack 未加载 |
| `PACK_ID_MISMATCH` | Pack ID 不匹配 |
| `PLUGIN_ENABLE_ACK_REQUIRED` | 插件启用需要确认 |
| `PLUGIN_ENABLE_ACK_INVALID` | 插件启用确认无效 |
| `PLUGIN_ENABLE_INVALID_STATE` | 插件启用状态无效 |
| `PLUGIN_QUERY_INVALID` | 插件查询参数无效 |
| `PLUGIN_INSTALLATION_INVALID` | 插件安装参数无效 |
| `PLUGIN_WEB_ASSET_NOT_ENABLED` | 插件 web 资产未启用 |
| `PLUGIN_WEB_ASSET_FORBIDDEN` | 插件 web 资产访问禁止 |
| `PLUGIN_WEB_ASSET_NOT_FOUND` | 插件 web 资产不存在 |
| `PLUGIN_WEB_ENTRYPOINT_NOT_FOUND` | 插件 web 入口不存在 |
| `OPENING_LIST_INVALID` | Opening 列表查询无效 |
| `OPENING_APPLY_INVALID` | Opening 应用参数无效 |
| `OPENING_APPLY_BODY_INVALID` | Opening 应用 body 无效 |
| `OPENING_DATA_LOSS_UNCONFIRMED` | Opening 应用未确认数据丢失 |
| `SCHEDULER_QUERY_INVALID` | 调度器查询参数无效 |
| `SOCIAL_FEED_QUERY_INVALID` | Social feed 查询参数无效 |
| `SOCIAL_POST_INVALID` | Social 发布参数无效 |
| `GRAPH_VIEW_QUERY_INVALID` | 图形视图查询参数无效 |
| `AUDIT_VIEW_QUERY_INVALID` | 审计视图查询参数无效 |
| `AUDIT_QUERY_INVALID` | Operator 审计查询参数无效 |
| `AI_INVOCATION_QUERY_INVALID` | AI 调用查询参数无效 |
| `RELATIONAL_QUERY_INVALID` | 关系查询参数无效 |
| `RELATIONSHIP_LOG_QUERY_INVALID` | 关系日志查询参数无效 |
| `SNR_LOG_QUERY_INVALID` | SNR 日志查询参数无效 |
| `LOGIN_INVALID` | 登录参数无效 |
| `EXPERIMENTAL_PACK_ID_INVALID` | Experimental pack ID 无效 |
| `EXPERIMENTAL_PACK_RUNTIME_NOT_FOUND` | Experimental pack runtime 不存在 |
| `EXPERIMENTAL_PACK_RUNTIME_CAPACITY_REACHED` | Experimental pack runtime 容量已满 |
| `EXPERIMENTAL_PACK_RUNTIME_LOAD_FAILED` | Experimental pack runtime 加载失败 |
| `EXPERIMENTAL_PACK_RUNTIME_ACTIVE_UNLOAD_FORBIDDEN` | 禁止卸载 active pack |
| `EXPERIMENTAL_PACK_RUNTIME_UNLOAD_FAILED` | Experimental pack runtime 卸载失败 |
| `EXPERIMENTAL_PACK_PROJECTION_FAILED` | Experimental pack projection 失败 |
