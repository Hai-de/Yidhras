# Yidhras API 接口规范 (v0.1.1)

## 0. 系统通知与鲁棒性 (System Notifications)
- **GET `/api/system/notifications`**
    - 说明: 获取后端推送的所有系统消息（包含 Info, Warning, Error）。
    - 返回: `SystemMessage[]`
    - 结构: `[{ id, level: "info"|"warning"|"error", content, timestamp, code? }]`
- **POST `/api/system/notifications/clear`**
    - 说明: 清空系统消息队列。
    - 返回: `{ success: true }`

## 1. 基础信息 (System)
- **GET `/api/status`**
    - 说明: 获取系统运行状态、当前加载的 World Pack 元数据。
    - 返回: `{ status: "running"|"paused", world_pack: { id, name, version }, has_error: boolean }`

## 2. 虚拟时间轴 (Chronos Layer)
- **GET `/api/clock`**
    - 说明: 获取所有历法下的当前虚拟时间。
    - 返回: `{ absolute_ticks: string, calendars: CalendarFormatted[] }`
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
- `API_CRASH`: 全局中间件捕获的未处理异常。
- `AGENT_CONTEXT_ERR`: 变量池解析器在处理特定权限时报错。
- `CLOCK_READ_ERR`: 历法转换引擎异常。

---
*更新时间: 2026-03-19*
