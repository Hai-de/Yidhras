# API 说明

本文档描述当前对外 / 公共可依赖的 HTTP contract、主要读写接口与错误码参考。

> 模块分层与宿主关系见 `ARCH.md` · 业务执行语义见 `LOGIC.md` · 专题细节见 `docs/capabilities/`

## 通用说明

- agent / graph / relational / scheduler / social / audit / inference 相关接口走共享 contracts + Zod 边界解析
- 若 query / params 不满足约束（非法数字、非法枚举、空白必填 params 等），当前实现返回 `400`
- 除非特别注明，否则以下接口均以当前公开 contract 为准，而不是描述内部实现细节

## 0. Stable vs Experimental 边界

Scheduler Docker 式隔离重构后，多 pack 调度已提升为默认架构。pack-scoped 路由挂载于 `/:packId/` 前缀，由 `packScopeMiddleware` 做 pack 状态校验。

pack-scoped 路由（`/:packId/api/...`）：
- 适用于 inference、overview、scheduler、graph、clock、agent、narrative、social、relational、identity、audit 等模块
- 非 `ready` 状态的 pack 返回 503（loading/unloading/degraded）或 404（gone）

global 路由（无 pack 前缀）：
- `/api/status`、`/api/health`、`/api/config`、`/api/admin`、`/api/operators` 等
- 不经过 pack scope 中间件

experimental `/api/experimental/...` 路由仍面向 operator / test-only，不承诺短期稳定 contract。



## 1. 基础信息 (System)

- **GET `/api/status`**
  - 说明：获取系统运行状态、健康级别、当前加载的 world-pack 元数据
  - 返回：`{ success: true, data: { status, runtime_ready, runtime_speed, scheduler, health_level, world_pack, has_error, startup_errors } }`
  - `world_pack` 可能包含：`id / name / version / description / authors / license / homepage / repository / tags / compatibility`
- **POST `/api/runtime/speed`**
  - 稳定边界：只作用于当前 stable active-pack runtime
  - 说明：覆盖或清除运行时步进速度
  - 参数：`{ action: "override", step_ticks: string|number }` 或 `{ action: "clear" }`
- **GET `/api/health`**
  - 说明：启动与运行健康检查结果
  - 返回：`{ success: true, data: { healthy, level, runtime_ready, checks, available_world_packs, errors } }`
- **GET `/api/system/notifications`**
  - 说明：读取当前系统通知队列中的 operator-facing 消息
  - 返回：`{ success: true, data: Array<{ id, level, content, timestamp, code?, details? }> }`
- **POST `/api/system/notifications/clear`**
  - 说明：清空当前系统通知队列
  - 返回：`{ success: true, data: { acknowledged: true } }`

## 2. Pack-local 插件治理接口

- **GET `/api/packs/:packId/plugins`**
  - 说明：列出当前 active pack 的 pack-local plugin installations
  - 返回：`{ success: true, data: { pack_id, items: PluginSummary[], enable_warning } }`
  - `enable_warning` 包含：
    - `enabled`
    - `require_acknowledgement`
    - `reminder_text`
    - `reminder_text_hash`
- **POST `/api/packs/:packId/plugins/:installationId/confirm`**
  - 说明：确认导入一个插件 installation，并可提交 granted capabilities
  - body：`{ granted_capabilities?: string[] }`
- **POST `/api/packs/:packId/plugins/:installationId/enable`**
  - 说明：显式启用一个插件；当 `plugins.enable_warning.require_acknowledgement=true` 时，body 必须提供 `acknowledgement`
  - body：`{ acknowledgement: { reminder_text_hash, actor_id?, actor_label? } }`
  - 失败代码：`PLUGIN_ENABLE_ACK_REQUIRED`、`PLUGIN_ENABLE_ACK_INVALID`、`PLUGIN_ENABLE_INVALID_STATE`
  - enable warning 语义与 canonical text/hash 维护规则见 [`PLUGIN_RUNTIME.md`](capabilities/PLUGIN_RUNTIME.md) 第 5 节
- **POST `/api/packs/:packId/plugins/:installationId/disable`**
  - 说明：显式禁用一个插件 installation
- **GET `/api/packs/:packId/plugins/runtime/web`**
  - 说明：读取当前 active pack 的已启用 web plugin runtime manifest，用于前端动态面板/路由宿主
- **GET `/api/packs/:packId/plugins/:pluginId/runtime/web/:installationId/*`**
  - 说明：访问已启用 pack-local plugin 的同源 web 资产
  - 失败代码：`PLUGIN_WEB_ASSET_NOT_ENABLED`、`PLUGIN_WEB_ASSET_FORBIDDEN`、`PLUGIN_WEB_ASSET_NOT_FOUND`、`PLUGIN_WEB_ENTRYPOINT_NOT_FOUND`

### 2.1 附加包 plugin runtime web surfaces

- **GET `/api/experimental/runtime/packs/:packId/plugins/runtime/web`**
  - 说明：读取某个已加载 pack runtime 的 web plugin runtime snapshot
- **GET `/api/experimental/runtime/packs/:packId/plugins/:pluginId/runtime/web/:installationId/*`**
  - 说明：访问某个已加载 pack runtime 下已启用插件的同源 web 资产

分层原则：

- `/api/packs/:packId/plugins/runtime/web` 继续走主包 active-pack scope
- `/api/experimental/runtime/packs/:packId/plugins/runtime/web` 才允许读取 experiment-loaded pack scope

更详细的治理与运行时说明：
- `docs/guides/PLUGIN_OPERATIONS.md`
- `docs/capabilities/PLUGIN_RUNTIME.md`

## 3. 虚拟时间轴 (Chronos Layer)

- **GET `/api/clock`**
  - 说明：获取原始虚拟时钟
  - 返回：`{ success: true, data: { absolute_ticks: string, calendars: [] } }`
- **GET `/api/clock/formatted`**
  - 说明：获取包含历法格式化结果的时钟数据
- **POST `/api/clock/control`**
  - 说明：控制模拟时钟
  - 参数：`{ action: "pause" | "resume" }`

## 4. 社交层 (L1: Social Layer)

- **GET `/api/social/feed`**
  - 说明：获取公共信息流
  - 参数：`?limit=20&author_id=<agent_id>&agent_id=<agent_id>&circle_id=<circle_id>&source_action_intent_id=<intent_id>&from_tick=<tick>&to_tick=<tick>&keyword=<text>&signal_min=<0..1>&signal_max=<0..1>&cursor=<opaque_cursor>&sort=latest|signal`
- **POST `/api/social/post`**
  - 说明：以当前 identity 上下文发布动态
  - 参数：`{ content: string }`

## 5. 关系层 (L2: Relational Layer)

- **GET `/api/relational/graph`**
- **GET `/api/relational/circles`**
- **GET `/api/relationships/:from_id/:to_id/:type/logs`**
- **GET `/api/atmosphere/nodes`**
- **GET `/api/graph/view`**

## 6. 审计与调度观察接口

### 6.1 Audit

- **GET `/api/audit/feed`**
  - 说明：统一查询 workflow / post / relationship adjustment / snr adjustment / event 的最小审计时间线
- **GET `/api/audit/entries/:kind/:id`**
  - 说明：查询单条 unified audit entry 详情

### 6.2 Scheduler

所有 scheduler 读接口均支持可选 `?pack_id=<packId>` query 参数：传入时只查询指定 pack 的数据，不传时跨所有已加载 pack 聚合。

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

## 7. 叙事与投影接口

### 7.0 多包运行时 registry / projection 读接口

- `GET /api/experimental/runtime/system/health`
- `GET /api/experimental/runtime/packs`
- `GET /api/experimental/runtime/packs/:packId/status`
- `GET /api/experimental/runtime/packs/:packId/clock`
- `GET /api/experimental/runtime/packs/:packId/scheduler/summary`
- `GET /api/experimental/runtime/packs/:packId/scheduler/ownership`
- `GET /api/experimental/runtime/packs/:packId/scheduler/workers`
- `GET /api/experimental/runtime/packs/:packId/scheduler/operator`
- `POST /api/experimental/runtime/packs/:packId/load`
- `POST /api/experimental/runtime/packs/:packId/unload`
- `GET /api/experimental/packs/:packId/overview`
- `GET /api/experimental/packs/:packId/projections/timeline`
- `GET /api/experimental/packs/:packId/projections/entities`
- `GET /api/experimental/packs/:packId/entities/:id/overview`
- `GET /api/experimental/packs/:packId/plugins`

约束：

- 这些接口 **不替代** 当前 canonical stable API
- 这些接口只面向 operator / test-only 试验，不承诺短期稳定 contract
- `:packId` 需要先进入 experimental runtime registry（显式 load 或已存在于 loaded set）
- 当前本轮已实现的 contract 收口包括：
  - stable/experimental projection 路径共享 `pack-scoped core service + scope adapter`，但 stable active-pack guard 保持不变
  - `GET /api/experimental/runtime/packs` 已增强为 control-plane snapshot，除 loaded pack list 外，还会返回：
    - `active_pack_id`
    - `system_health_level`
    - `runtime_ready`
    - per-pack `status/current_tick/runtime_speed`
    - per-pack scheduler/plugin availability 摘要
  - plugin runtime web routes 已统一到 pack-scoped service：
    - stable `/api/packs/:packId/plugins/runtime/web` 继续走 active-pack scope
    - experimental `/api/experimental/runtime/packs/:packId/plugins/runtime/web` 才允许读取 loaded-pack scope
  - inference/context 当前只新增 internal pack-scoped contract，不新增 public inference multi-pack run API

### 7.1 Canonical pack narrative projection endpoint

- **GET `/api/packs/:packId/projections/timeline`**
  - 说明：返回 pack 级 narrative projection
  - 返回：`{ success: true, data: { pack: { id, name, version }, timeline: TimelineEntry[] } }`
  - `TimelineEntry` 至少包含：
    - `id`
    - `kind: "event" | "rule_execution"`
    - `created_at`
    - `title`
    - `description`
    - `refs`
    - `data`

### 7.2 Pack overview

- **GET `/api/packs/:packId/overview`**
  - 说明：返回 pack overview projection 摘要
  - 返回至少包含：
    - `pack_id`
    - `entity_count`
    - `entity_state_count`
    - `authority_grant_count`
    - `mediator_binding_count`
    - `rule_execution_count`
    - `latest_rule_execution`

### 7.3 稳定约束

见第 0 节边界说明。
## 8. Agent / Entity 读取接口

### 8.1 Agent context

- **GET `/api/agent/:id/context`**
  - 说明：获取特定 Agent 的认知上下文
  - 返回：`{ success: true, data: { identity, variables } }`

### 8.2 Canonical entity overview endpoint

- **GET `/api/entities/:id/overview`**
  - 说明：当前 canonical entity-centric overview 路由
  - 参数：`?limit=10`
  - 返回结构包含：
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
    - `context_governance`

### 8.3 Agent SNR logs

- **GET `/api/agent/:id/snr/logs`**
  - 说明：查询指定 Agent 的 SNR 调整日志
  - 参数：`?limit=20`

### 8.4 当前稳定约束

- `/api/entities/:id/overview` 是当前 canonical entity overview 读面
- `/api/agent/:id/overview` 已退出默认调用面

## 9. Overview 聚合接口

### 9.1 Operator overview summary

- **GET `/api/overview/summary`**
  - 说明：为 operator / overview 首屏提供聚合摘要
  - 返回结构至少包含：
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

## 10. 推理与工作流接口

### 10.1 Inference endpoints

- **POST `/api/inference/preview`**
  - 说明：预览推理上下文与结构化 prompt 结果
  - 输入：`{ agent_id?: string, identity_id?: string, actor_entity_id?: string, strategy?: "mock"|"rule_based", attributes?: Record<string, unknown>, idempotency_key?: string }`
    - `agent_id`：直接指定宿主 runtime agent ID（如 `"agent-001"` 或 `"my-pack:guard-001"`）
    - `identity_id`：直接指定 Prisma identity ID（如 `"my-pack:identity:guard-001"`）
    - `actor_entity_id`：指定 pack-local actor entity ID（如 `"guard-001"`），运行时自动桥接为 `"${packId}:${actor_entity_id}"` 的 agent ID
    - 优先级：`agent_id` > `identity_id` > `actor_entity_id` > system fallback
- **POST `/api/inference/run`**
  - 说明：手动触发一次推理并返回标准化 decision

### 10.2 Workflow endpoints

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

### 10.3 AI invocation observability

- **GET `/api/inference/ai-invocations`**
  - 说明：分页列出 kernel-side `AiInvocationRecord` 观测记录
  - 输入：`{ status?: "completed"|"failed"|"blocked"|"timeout", provider?: string, model?: string, task_type?: string, source_inference_id?: string, route_id?: string, has_error?: "true"|"false", from_created_at?: string, to_created_at?: string, cursor?: string, limit?: string }`
  - 返回：`{ success: true, data: { items, page_info, summary }, meta?: { pagination } }`
- **GET `/api/inference/ai-invocations/:id`**
  - 说明：读取单条 `AiInvocationRecord` 详情

### 10.4 当前稳定边界

- 当前公开 inference strategy 只稳定承诺 `mock` 与 `rule_based`
- `model_routed` 为内部 / 受控能力，不在公共 contract 中承诺
- `GET /api/inference/ai-invocations*` 为公开只读 observability surface

策略定位与内部 gateway 分层详见 [`AI_GATEWAY.md`](capabilities/AI_GATEWAY.md) 第 5 节。

## 11. 身份与 Access-Policy 接口

- **POST `/api/identity/register`**
- **POST `/api/identity/bind`**
- **POST `/api/identity/bindings/query`**
- **POST `/api/identity/bindings/unbind`**
- **POST `/api/identity/bindings/expire`**
- **POST `/api/access-policy`**
- **POST `/api/access-policy/evaluate`**

当前稳定边界：

- `/api/access-policy/*` 是独立 access-policy 子系统
- 它们不属于 world-pack governance 主接口

## 12. Operator 高级视图后端合同

当前后端已经具备下列高级视图所需的核心证据面；前端页面与交互属于前端实现范围。

### 12.1 Authority Inspector backend contract

可直接复用 / 组合以下后端证据：

- `buildInferenceContextV2(...).authority_context`
- `buildInferenceContextV2(...).world_rule_context.mediator_bindings`
- `resolveAuthorityForSubject(...)`
- `resolveMediatorBindingsForPack(...)`

### 12.2 Rule Execution Timeline backend contract

可直接复用：

- `getPackEntityOverviewProjection(...).recent_rule_executions`
- `listPackNarrativeTimelineProjection(...).timeline` 中的 `kind='rule_execution'`
- pack-local `rule_execution_records`

### 12.3 Perception Diff backend contract

可直接复用：

- `buildInferenceContextV2(...).perception_context`
- `resolvePerceptionForSubject(...)`

### 12.4 前后端交接边界

后端负责：

- authority / perception / mediator provenance / rule execution evidence 输出
- pack / entity / rule 相关 projection contract 稳定化
- handoff 字段与示例说明

前端负责：

- Authority Inspector 页面 UI
- Rule Execution Timeline 页面 UI
- Perception Diff 页面 UI
- 筛选器、布局、导航、交互状态与可视化表达

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
- `OPERATOR_REQUIRED`
- `PACK_ACCESS_DENIED`
- `CAPABILITY_DENIED`
- `ROOT_REQUIRED`
- `INVALID_CREDENTIALS`
- `OPERATOR_DISABLED`
- `OPERATOR_NOT_FOUND`
- `BINDING_NOT_FOUND`
- `BINDING_ALREADY_EXISTS`
- `GRANT_NOT_FOUND`
- `GRANT_INVALID`
- `USERNAME_TAKEN`
- `SESSION_EXPIRED`
- `TOKEN_INVALID`

---

## 14. Operator 认证与权限端点

Operator-Subject 统一权限层通过 JWT Bearer Token 认证，所有 operator 端点遵循三层权限递进过滤：Pack Access (L1) → Capability (L2) → Policy (L3)。详见 `ARCH.md` §3.1.1 与 `LOGIC.md` §11。

### 14.1 认证

- **POST `/api/auth/login`** — 用户名+密码 → JWT token。body：`{ username, password, pack_id? }`
- **POST `/api/auth/logout`** — 注销当前 session（鉴权：Bearer）
- **GET `/api/auth/session`** — 返回当前 operator + identity 信息（鉴权：Bearer）
- **POST `/api/auth/refresh`** — 签发新 token（鉴权：Bearer）

### 14.2 Operator CRUD（root 限定）

- **POST `/api/operators`** — 创建 Operator（同步创建 Identity type='user'）
- **GET `/api/operators`** — Operator 列表
- **GET `/api/operators/:id`** — Operator 详情（含 pack_bindings）
- **PATCH `/api/operators/:id`** — 修改状态/密码
- **DELETE `/api/operators/:id`** — 软删除（status='disabled'）

### 14.3 Pack 绑定

- **POST `/api/packs/:packId/bindings`** — 邀请加入 Pack。body：`{ operator_id, binding_type }`
- **GET `/api/packs/:packId/bindings`** — 成员列表
- **PATCH `/api/packs/:packId/bindings/:operatorId`** — 修改角色
- **DELETE `/api/packs/:packId/bindings/:operatorId`** — 移除成员
- **GET `/api/me/bindings`** — 当前 Operator 的 Pack 列表

### 14.4 Agent 绑定

- **POST `/api/agents/:agentId/bindings`** — 绑定到 Agent。底层复用 `IdentityNodeBinding`
- **DELETE `/api/agents/:agentId/bindings/me`** — 解绑
- **GET `/api/agents/:agentId/operators`** — 控制该 Agent 的 Operators

### 14.5 能力委托

- **POST `/api/packs/:packId/grants`** — 委托 capability（支持 TTL 和 revocable 约束）
- **GET `/api/packs/:packId/grants`** — 列出当前 Operator 发出的 grants
- **DELETE `/api/packs/:packId/grants/:grantId`** — 撤销委托（仅 grant owner）

### 14.6 审计

- **GET `/api/audit/logs`** — 审计日志（root 可见全部，支持分页和过滤）
- **GET `/api/audit/logs/me`** — 当前 Operator 的审计日志

## 15. 配置管理接口

配置读写通过 `/api/config` 端点，敏感字段（jwt_secret、default_password）脱敏返回。写操作受 tier 控管：safe tier 即时热重载，其他 tier 写入文件并提示重启。

### 15.1 读取配置

- **GET `/api/config`** — 返回完整配置（鉴权：操作员）。敏感字段显示为 `xxxx***`
- **GET `/api/config/domains`** — 列出所有配置域及其 tier（鉴权：操作员）
- **GET `/api/config/:domain`** — 返回单个域配置（鉴权：操作员）。domain 可选值：`app`、`paths`、`operator`、`plugins`、`world`、`startup`、`sqlite`、`logging`、`clock`、`world_engine`、`scheduler`、`prompt_workflow`、`runtime`、`features`

### 15.2 更新配置

- **PATCH `/api/config/:domain`** — 更新指定域配置（鉴权：root）。body 为 `Record<string, unknown>`，合并写入对应 `conf.d/<domain>.yaml`。返回 `{ domain, tier, hotReloaded, requiresRestart, message }`

## 16. 配置备份接口

配置备份通过 tar.gz 归档 `data/configw/` 目录，元数据存储在 `data/backups/config/backups.json`。保留策略：最多 20 个，最长 30 天。

- **POST `/api/config/backups`** — 创建备份（鉴权：root）。body：`{ name?: string }`
- **GET `/api/config/backups`** — 列出备份（鉴权：操作员）。query：`?limit=20&offset=0`
- **GET `/api/config/backups/:id`** — 备份详情（鉴权：操作员）
- **GET `/api/config/backups/:id/download`** — 下载备份文件（鉴权：root）
- **DELETE `/api/config/backups/:id`** — 删除备份（鉴权：root）
- **POST `/api/config/backups/:id/restore`** — 恢复备份（鉴权：root）。query：`?force=true` 强制覆盖非空目录
- **GET `/api/config/backup-policy`** — 获取保留策略（鉴权：操作员）
- **POST `/api/config/backups/cleanup`** — 触发保留策略清理（鉴权：root）

错误码：`BACKUP_NOT_FOUND`、`ROOT_REQUIRED`、`OPERATOR_REQUIRED`、`INVALID_BACKUP_REQUEST`、`INVALID_LIST_QUERY`

## 17. 世界包快照接口

> **后端兼容性**：快照功能**仅支持 SQLite 后端**。快照系统直接复制 `runtime.sqlite` 文件以保留完整数据库物理状态（WAL、索引结构等），这是 adapter 行数据导出无法替代的。PostgreSQL 等分布式数据库的部署者应使用数据库原生工具（如 `pg_dump`、`pg_basebackup`、WAL archiving）进行备份。对非 SQLite 后端调用快照接口将返回 `501 SNAPSHOT_NOT_AVAILABLE`。

快照是对世界包运行时完整状态的存档，覆盖三层数据：包运行时数据库（世界引擎状态）、中央 Prisma 数据库（Agent/Identity/Binding/Post/Relationship/Memory/ContextOverlay 等 domain 数据）、内存时钟状态。快照以目录形式存储在 `data/world_packs/<pack_id>/snapshots/<snapshot_id>/`，包含 `metadata.json`、`runtime.sqlite`、`prisma.json`、`storage-plan.json` 四个文件。

所有快照接口均需 pack 操作员鉴权（`packAccessGuard`）。创建和恢复操作要求模拟已暂停（自动暂停/恢复）。

- **GET `/api/packs/:packId/snapshots`**
  - 说明：列出 pack 所有快照
  - 返回：`{ snapshots: Array<{ snapshot_id, label, captured_at_tick, captured_at_timestamp, runtime_db_size_bytes, prisma_record_count }> }`

- **POST `/api/packs/:packId/snapshots`**
  - 说明：创建当前运行时状态的快照。模拟自动暂停 → 捕获 → 恢复
  - 参数：`{ label?: string }` — 可选标签，最长 256 字符
  - 返回：`{ snapshot_id, pack_id, captured_at_tick, prisma_record_count, runtime_db_size_bytes }`
  - 注意：每 pack 最多保留 20 个快照，超出自动淘汰最旧

- **POST `/api/packs/:packId/snapshots/:snapshotId/restore`**
  - 说明：从快照恢复 pack 运行时状态。会清除当前所有运行时数据
  - 参数：`{ confirm_data_loss: boolean }` — 必须为 `true` 才执行，否则返回 409
  - 返回：`{ restored: true, pack_id, snapshot_id, restored_at_tick }`
  - 恢复流程：暂停 → 卸载 sidecar → 清除运行时数据库 → 拆除 kernel 桥接 → 删除 pack-scoped Prisma 记录 → 复制快照数据库和 storage-plan → 重建 Prisma 记录（事务） → 恢复时钟 → 幂等物化 → 重载 sidecar

- **DELETE `/api/packs/:packId/snapshots/:snapshotId`**
  - 说明：删除指定快照及其所有文件
  - 返回：`{ deleted: true, snapshot_id }`

错误码：`SNAPSHOT_LIST_INVALID`、`SNAPSHOT_CREATE_INVALID`、`SNAPSHOT_CREATE_BODY_INVALID`、`SNAPSHOT_RESTORE_INVALID`、`SNAPSHOT_RESTORE_BODY_INVALID`、`SNAPSHOT_DATA_LOSS_UNCONFIRMED`、`SNAPSHOT_DELETE_INVALID`、`PACK_NOT_LOADED`、`PACK_ID_MISMATCH`