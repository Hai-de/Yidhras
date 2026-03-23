# Yidhras API 接口规范 (v0.1.5)

> Implementation note (2026-03-23): the backend API is now assembled through `apps/server/src/app/create_app.ts`, grouped route modules under `apps/server/src/app/routes/*.ts`, and thin route-to-service delegation into `apps/server/src/app/services/*.ts`. This refactor keeps the external HTTP contract stable; the structures below remain the behavioral source of truth.

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
    - 说明: 获取公共舆论场信息流。
    - 参数: `?limit=20`
    - 返回: `Post[]` (含作者、内容、发布时间)
- **POST `/api/social/post`**
    - 说明: 以特定 Agent 身份发布动态。
    - 参数: `{ content: string }`
    - 备注: `author_id` 由身份上下文注入并在服务端写入。

## 4. 关系层 (L2: Relational Layer)
- **GET `/api/relational/graph`**
    - 说明: 获取 Cytoscape.js 格式的图谱数据 (Nodes & Edges)。
    - 返回: `{ nodes: Node[], edges: Edge[] }`
- **GET `/api/relational/circles`**
    - 说明: 获取所有组织/圈子列表。
- **GET `/api/atmosphere/nodes`**
    - 说明: 查询 atmosphere nodes。
    - 参数: `?owner_id=<agent_id>&include_expired=true|false`
    - 默认: `include_expired=false`（仅返回未过期或无过期时间节点）
    - 返回: `AtmosphereNode[]`

## 5. 叙事层 (L3: Narrative Layer)
- **GET `/api/narrative/timeline`**
    - 说明: 获取历史事件时间线（按 Tick 倒序）。
    - 返回: `Event[]`

## 6. Agent 与 变量 (Identity & Variables)
- **GET `/api/agent/:id/context`**
    - 说明: 获取特定 Agent 的认知上下文（基于其所属 Circle 权限过滤后的解析变量）。
    - 返回: `{ identity: Agent, variables: ResolvedVariablePool }`

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

## 8. Agent 推理与工作流规划接口（Planned, Not Yet Implemented）

> 以下接口为正式路线规划占位，当前版本仅用于冻结契约方向，**尚未在服务端实现**。
>
> Current reserved integration slots: `apps/server/src/app/routes/inference.ts` and `apps/server/src/inference/service.ts`.

### 8.1 Phase B: D-ready Inference Service
- **POST `/api/inference/preview`**
    - 说明: 预览推理上下文与 prompt 结构化结果。
    - 规划输入: `{ agent_id?: string, identity_id?: string, strategy?: string, attributes?: Record<string, unknown> }`
    - 规划返回: `{ inference_id, actor_ref, strategy, provider, tick, prompt: { system_prompt, role_prompt, world_prompt, context_prompt, output_contract_prompt, combined_prompt }, metadata: { world_pack_id, binding_ref?, prompt_version? } }`
- **POST `/api/inference/run`**
    - 说明: 手动触发一次推理并返回标准化决策结果（调试/验证用途）。
    - 规划输入: `{ agent_id?: string, identity_id?: string, strategy?: string, attributes?: Record<string, unknown> }`
    - 规划返回: `{ inference_id, actor_ref, strategy, provider, tick, decision: { action_type, target_ref, payload, delay_hint_ticks, confidence?, reasoning?, meta? }, trace_metadata: { world_pack_id, binding_ref?, prompt_version? } }`

### 8.2 Phase D: Persisted Workflow
- **目标方向（规划中）**
    - 将推理结果持久化为正式工作流对象，而不是仅做临时同步返回。
    - 候选对象包括：`InferenceTrace`、`ActionIntent`、`DecisionJob`。
- **预期能力（规划中）**
    - 幂等（idempotency）
    - 重试（retry）
    - 审计（audit）
    - 回放（replay）
    - 决策与执行分离（decision ≠ execution）
- **候选接口方向（规划中）**
    - `POST /api/inference/jobs`
    - `GET /api/inference/traces/:id`
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
- `INFERENCE_INPUT_INVALID`: （规划预留）推理输入参数非法。
- `INFERENCE_PROVIDER_FAIL`: （规划预留）推理 provider 失败。
- `INFERENCE_NORMALIZATION_FAIL`: （规划预留）推理结果归一化失败。
- `INFERENCE_TRACE_PERSIST_FAIL`: （规划预留）推理 trace 持久化失败。
- `ACTION_INTENT_INVALID`: （规划预留）动作意图不合法。
- `ACTION_DISPATCH_FAIL`: （规划预留）动作调度失败。

---
*更新时间: 2026-03-23*
