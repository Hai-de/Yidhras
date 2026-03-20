# Yidhras API 接口规范 (v0.1.2)

## 0. 系统通知与鲁棒性 (System Notifications)
- **GET `/api/system/notifications`**
    - 说明: 获取后端推送的所有系统消息（包含 Info, Warning, Error）。
    - 返回: `SystemMessage[]`
    - 结构: `[{ id, level: "info"|"warning"|"error", content, timestamp, code? }]`
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

## 1. 基础信息 (System)
- **GET `/api/status`**
    - 说明: 获取系统运行状态、健康级别、当前加载的 World Pack 元数据。
    - 返回: `{ status: "running"|"paused", runtime_ready: boolean, health_level: "ok"|"degraded"|"fail", world_pack: { id, name, version }|null, has_error: boolean, startup_errors: string[] }`
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
    - 参数: `{ author_id: string, content: string }`

## 4. 关系层 (L2: Relational Layer)
- **GET `/api/relational/graph`**
    - 说明: 获取 Cytoscape.js 格式的图谱数据 (Nodes & Edges)。
    - 返回: `{ nodes: Node[], edges: Edge[] }`
- **GET `/api/relational/circles`**
    - 说明: 获取所有组织/圈子列表。

## 5. 叙事层 (L3: Narrative Layer)
- **GET `/api/narrative/timeline`**
    - 说明: 获取历史事件时间线（按 Tick 倒序）。
    - 返回: `Event[]`

## 6. Agent 与 变量 (Identity & Variables)
- **GET `/api/agent/:id/context`**
    - 说明: 获取特定 Agent 的认知上下文（基于其所属 Circle 权限过滤后的解析变量）。
    - 返回: `{ identity: Agent, variables: ResolvedVariablePool }`

## 7. 错误代码参考 (Error Codes)
- `SYS_INIT_FAIL`: 系统初始化（数据库、世界包）失败。
- `SIM_STEP_ERR`: 模拟步进异常（通常涉及 BigInt 或 undefined 参数）。
- `API_INTERNAL_ERROR`: 全局中间件捕获的未归类内部异常。
- `CLOCK_FORMAT_ERR`: 历法格式化异常（`/api/clock/formatted`）。
  - 仅用于运行时已就绪但格式化过程发生内部异常的场景。
- `CLOCK_ACTION_INVALID`: 时钟控制参数非法（非 `pause|resume`）。
- `AGENT_NOT_FOUND`: 请求的 Agent 不存在。
- `WORLD_PACK_NOT_READY`: 世界包未就绪，当前接口不可用（常见于空 world-pack 降级启动）。
- `SYS_PRECHECK_FAIL`: 启动前健康检查失败（例如数据库不可用）。
- `WORLD_PACK_EMPTY`: 启动时 world-pack 为空，系统进入降级模式等待导入。

---
*更新时间: 2026-03-21*
