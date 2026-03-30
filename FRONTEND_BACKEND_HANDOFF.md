# Frontend / Backend Handoff for Operator UI

前后端协作交接文档（面向新一版情报台/操作台前端）

Last Updated / 最后更新: 2026-03-30

---

## 0. 背景 / Background

当前前端正在从早期的分层展示型 UI，转向面向操作者的情报工作台 UI。新的前端结构将重点围绕以下能力构建：

- World Overview / 世界总览
- Social Feed / 社交信息流
- Workflow Inspector / 推理与工作流检查器
- Narrative Timeline / 叙事时间线
- Graph View / 关系图谱与传播图谱
- Agent Detail / 角色详情

目前后端能力已经明显领先于前端 UI，但在前后端契约层仍存在几类阻塞项：

1. **成功响应 envelope 不统一**：有的接口返回 raw array/object，有的返回 `{ success: true, data }`。
2. **图谱节点类型不足**：当前图谱主要仍是 `Agent + Relationship`，尚不足以支持新的 Relay / Container 节点设计。
3. **新前端页面所需的若干中等缺口**：如 workflow 列表、overview 聚合摘要、agent 聚合详情、graph v2 查询等。

本文件用于给后端做交接，不直接等价于前端实现文档。

---

## 1. API Envelope 统一方案 / API Envelope Unification

### 1.1 当前问题 / Current Problem

当前后端**错误响应**基本已经统一：

```json
{
  "success": false,
  "error": {
    "code": "...",
    "message": "...",
    "request_id": "...",
    "timestamp": 0,
    "details": {}
  }
}
```

但**成功响应**目前并不统一：

- inference 相关接口多数为：
  - `{ success: true, data: ... }`
- runtime speed 又是：
  - `{ success: true, runtime_speed: ... }`
- system / social / relational / narrative / agent / identity / policy / audit 等接口大量还是：
  - raw object
  - raw array
- `/api/health` 目前还把 `success` 用作“健康结果”字段，而不是 envelope 语义。

这会造成前端问题：

- 每个页面都要手写分支判断
- 很难做统一的 API client / error handling / typing
- 很难稳定做底栏通知、Inspector、列表页、缓存层
- 文档和真实返回结构容易漂移

### 1.2 建议的目标契约 / Target Contract

建议把**所有成功响应**统一为以下结构：

```ts
export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: {
    pagination?: {
      has_next_page?: boolean;
      next_cursor?: string | null;
    };
    warnings?: Array<{
      code: string;
      message: string;
    }>;
    schema_version?: string;
  };
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    request_id: string;
    timestamp: number;
    details?: unknown;
  };
}
```

### 1.3 统一规则 / Rules

#### Rule A：只保留一种成功 envelope

成功响应统一为：

```json
{ "success": true, "data": ... }
```

不再允许混用：

- raw array
- raw object
- `{ success: true, xxx: ... }`

#### Rule B：`success` 只表示 envelope 层是否成功

`success` 只能表示：

- 请求被成功处理并返回了合法业务 payload → `success: true`
- 请求发生业务错误/系统错误 → `success: false`

不能再把 `success` 同时拿来表示：

- 健康检查是否健康
- runtime 是否 ready
- workflow 是否 completed
- 某个业务状态是否成功

这些都应进入 `data` 内部字段，例如：

```json
{
  "success": true,
  "data": {
    "healthy": false,
    "level": "fail"
  }
}
```

#### Rule C：列表型接口建议长期过渡到 object payload

短期迁移时，为减少改动，可以先把旧 payload 原样包进 `data`：

```json
{ "success": true, "data": [ ... ] }
```

但**新接口**或**后续升级过的列表接口**，建议优先使用：

```json
{
  "success": true,
  "data": {
    "items": [ ... ],
    "summary": { ... },
    "page_info": { ... }
  }
}
```

原因：

- 后续更容易加分页、聚合、计数、过滤回显
- 更适合 Overview / Inspector / TweetDeck-style 多列查询
- 避免未来从 bare array 升级时再次破坏契约

#### Rule D：BigInt 仍统一走 string

当前 BigInt → string 的运输规则应保持不变，不建议回退。

#### Rule E：`X-Request-Id` 继续保留在 header

无需强制在 success body 中重复，但 `error.request_id` 继续必须稳定。

---

### 1.4 推荐的后端落地方式 / Backend Implementation Strategy

建议后端增加统一 helper，而不是继续在路由里直接手写 `res.json(...)`。

示意：

```ts
export const jsonOk = <T>(res: Response, data: T, meta?: ApiSuccess<T>["meta"]) => {
  res.json({
    success: true,
    data,
    ...(meta ? { meta } : {})
  });
};
```

之后所有 route success path 改为统一 helper 输出。

### 1.5 推荐迁移步骤 / Migration Plan

#### Phase 0：前端先做兼容层，先止血

前端新增统一 API client：

- 若收到 `{ success: true, data }` → 取 `data`
- 若收到 `{ success: false, error }` → 统一抛错
- 若收到 raw array/object → 当作 legacy success payload 兼容

这样可以让前端页面先不被 envelope 差异拖死。

> 注意：这只是过渡方案，不应成为长期契约。

#### Phase 1：后端新增 success helper + 文档规范

- 在 `apps/server/src/app/http/` 下补统一 success response helper
- 在 `API.md` 中显式声明：
  - 未来成功响应统一为 `{ success: true, data }`
  - raw payload 为待淘汰 legacy 形态

#### Phase 2：按路由族迁移

优先级建议：

1. `system` / `clock`
2. `social`
3. `relational`
4. `narrative`
5. `agent`
6. `identity`
7. `policy`
8. `audit`
9. 清理 `clock` 中 `{ success: true, runtime_speed }` 这类半统一结构

#### Phase 3：更新 smoke / e2e 断言

新增验收要求：

- 产品前端实际消费的接口，成功路径一律断言有 `success === true`
- 错误路径一律断言 `success === false`
- 不再允许新增 raw success response

#### Phase 4：清理 legacy 兼容

当前端 API client 已经切换并且后端完成迁移后，可以逐步移除前端 raw payload fallback。

---

### 1.6 特殊接口建议 / Special Cases

#### `/api/health`

建议改为：

- HTTP status 仍可保持 `200 | 503`
- 但 body 统一为：

```json
{
  "success": true,
  "data": {
    "healthy": false,
    "level": "fail",
    "runtime_ready": false,
    "checks": { ... },
    "available_world_packs": [],
    "errors": []
  }
}
```

说明：

- `503` 仍表达“服务当前不健康”
- `success: true` 表达“本次 API 响应 envelope 合法”
- 避免和错误 envelope 混淆

#### Ack-only 接口

如清空通知队列之类的接口，不建议继续返回只有 top-level `success` 的结构，建议统一为：

```json
{
  "success": true,
  "data": {
    "acknowledged": true
  }
}
```

或返回真实业务结果对象。

---

### 1.7 当前已知不统一范围 / Known Inconsistent Areas

从当前仓库可见，成功响应风格大致如下：

#### 已较接近统一的

- `apps/server/src/app/routes/inference.ts`

#### 仍大量 raw 返回的

- `apps/server/src/app/routes/system.ts`
- `apps/server/src/app/routes/social.ts`
- `apps/server/src/app/routes/relational.ts`
- `apps/server/src/app/routes/narrative.ts`
- `apps/server/src/app/routes/agent.ts`
- `apps/server/src/app/routes/identity.ts`
- `apps/server/src/app/routes/policy.ts`
- `apps/server/src/app/routes/audit.ts`

#### 半统一、需收敛的

- `apps/server/src/app/routes/clock.ts`

---

## 2. Relay / Intermediary Node 方案 / 中介节点方案

### 2.1 目标定义 / Goal

Relay / Intermediary Node 用于具象化 L4 传输与资源链路，是**非人格化、被动型、代码驱动**的节点类型。

它代表的是：

- 基站
- 信使
- 中继点
- 论坛板块
- 被利用的资源
- 某段传播链路的具象化落点

它不应等同于：

- Agent
- AtmosphereNode
- 普通关系边

### 2.2 为什么不应只由前端“脑补” / Why Backend Support Is Needed

如果前端自己从 audit / workflow / post 数据里临时推导 relay 节点，会出现问题：

- Relay 的创建规则与生命周期规则会散落在前端
- Reachability / GC / pin 语义会无法稳定复用
- 不同页面会各自推导出不同的 relay 图
- 无法做审计回链和稳定节点 ID

因此建议：

> **Relay 的业务语义与生命周期归后端；前端只负责渲染与交互。**

### 2.3 建议的最小字段 / Suggested Minimal Fields

建议后端最终暴露的 graph node view model 中，Relay 节点至少具备：

```ts
interface RelayNodeView {
  id: string;
  kind: 'relay';
  relay_type: 'base_station' | 'messenger' | 'forum_board' | 'resource' | 'custom';
  label: string;
  image_url?: string | null;
  icon?: string | null;
  owner_ref?: {
    agent_id?: string | null;
    identity_id?: string | null;
  } | null;
  state: {
    is_pinned: boolean;
    lifecycle_status: 'active' | 'idle' | 'gc_candidate' | 'recycled' | 'sealed';
    is_reachable_from_active: boolean;
  };
  metrics?: {
    signal_strength?: number | null;
    capacity?: number | null;
    load?: number | null;
  };
  refs?: {
    source_action_intent_id?: string | null;
    source_inference_id?: string | null;
  };
  tags?: string[];
  metadata?: Record<string, unknown>;
}
```

### 2.4 生命周期建议 / Lifecycle Semantics

Relay 节点最重要的不是长相，而是生命周期规则。

建议后端负责以下语义：

1. **Pin 优先**
   - 被人工 pin 的 relay 不自动清理。

2. **Reachability 驱动回收**
   - 若 relay 节点不再能从任何“活跃节点”拓扑触达，且未被 pin，则进入 `gc_candidate`。

3. **延迟回收窗口**
   - 不建议瞬时删除，建议保留一个缓冲窗口（例如 TTL / 回收候选状态），避免前端画布频繁闪烁。

4. **活跃节点定义归后端**
   - “活跃节点”不应由前端自己推断。
   - 建议后端统一定义哪些节点算 active roots（如 active agents、有效 binding 对应实体等）。

5. **Provenance 可追踪**
   - Relay 节点应能回链到创建它的 action / workflow / event，便于 Inspector 与 Timeline 反查。

### 2.5 数据建模建议 / Modeling Recommendation

不建议把 Relay 强塞进当前 `Agent` 或 `Relationship` 模型。

建议二选一：

#### 方案 A：先做 Graph Projection（低风险起步）

- 保持现有 Prisma 结构不大改
- 后端增加一个 graph projection 层
- 将 Relay 以“投影视图节点”形式返回
- 先验证前端图谱交互与 schema

适合第一阶段快速落地。

#### 方案 B：引入持久化 `RelayNode` 模型（正式路线）

适合后续需要以下能力时：

- pin / unpin
- 持续存在的 relay 实体
- 审计与 provenance
- 生命周期与回收
- world pack 预置 relay
- 多种 relay subtype

如果要走正式路线，更推荐 B。

---

## 3. Container / Unresolved Node 方案 / 容器节点方案

### 3.1 目标定义 / Goal

Container / Unresolved Node 用于承接：

- 前端尚未支持的后端新节点/新 intent 类型
- 匿名动作 / 匿名源
- 推理解析失败
- 黑盒系统边界
- 尚未揭面的未决实体

它的核心价值不是“多一种节点皮肤”，而是：

1. **前端鲁棒性兜底**
2. **叙事上的未决实体表达**
3. **为未来 merge / resolve / seal 提供稳定落点**

### 3.2 为什么必须有后端参与 / Why Backend Must Participate

如果只是前端看到未知类型就临时画一个黑盒，会有几个问题：

- 没有稳定 ID，无法追踪
- 无法和 workflow / event / post 做 provenance 绑定
- 不能表达“已解决 / 已合并 / 已封存”这些状态
- 不同页面对同一个未知源可能会产生多个不同黑盒

因此建议：

> **Container Node 作为正式的 fallback node 语义，由后端统一产生；前端只约定统一 render fallback。**

### 3.3 建议的最小字段 / Suggested Minimal Fields

```ts
interface ContainerNodeView {
  id: string;
  kind: 'container';
  container_type:
    | 'unresolved_entity'
    | 'unsupported_intent'
    | 'anonymous_source'
    | 'parse_failure'
    | 'system_boundary'
    | 'custom';
  label: string;
  image_url?: string | null;
  state: {
    is_pinned: boolean;
    resolve_state: 'open' | 'merged' | 'resolved' | 'sealed';
  };
  refs?: {
    source_action_intent_id?: string | null;
    source_inference_id?: string | null;
    source_event_id?: string | null;
    merged_into_node_id?: string | null;
  };
  tags?: string[];
  metadata?: Record<string, unknown>;
}
```

### 3.4 建议触发场景 / Suggested Trigger Scenarios

建议后端在以下场景可返回 container 节点：

1. **后端新增了前端尚未支持的 ActionIntent 类型**
2. **匿名 social noise / 来源不明传播**
3. **解析失败但需要保留痕迹**
4. **系统边界对象需要在图谱中占位**
5. **某些 entity 尚未完成实体解析，只能先放黑盒**

### 3.5 状态流转建议 / State Transitions

Container 节点不应只是“未知”，还应支持后续状态演进：

- `open`：未解决，仍在观察
- `merged`：已并入真实节点
- `resolved`：已识别实体，但保留历史映射
- `sealed`：作为历史黑盒封存，不再参与主视图计算

其中：

- `merged_into_node_id` 由后端给出
- 前端可做跳转、折叠、弱显示

---

## 4. Graph V2 后端契约建议 / Graph V2 Backend Contract

### 4.1 当前问题 / Current Problem

当前 `SimulationManager.getGraphData()` 返回的仍是非常基础的：

```ts
{ nodes, edges }
```

其中节点基本只覆盖：

- Agent

边基本只覆盖：

- Relationship

这不足以支撑：

- relay / container
- atmosphere / active 分离展示
- transmission 关系
- ownership / derived-from / unresolved 等多类边
- 前端主题规则与 world pack 渲染扩展

### 4.2 建议目标 / Suggested Target

建议新增 **Graph V2 视图接口**，不要把所有复杂语义继续塞回旧版简化接口。

建议候选：

- `GET /api/graph/view`
- 或 `GET /api/relational/graph?schema=v2`

推荐返回：

```json
{
  "success": true,
  "data": {
    "schema_version": "graph-v2",
    "view": "mesh",
    "nodes": [],
    "edges": [],
    "summary": {
      "counts_by_kind": {},
      "active_root_ids": []
    }
  }
}
```

### 4.3 节点字段建议 / Node View Model

```ts
interface GraphNodeView {
  id: string;
  kind: 'agent' | 'atmosphere' | 'relay' | 'container' | 'system' | 'noise' | 'custom';
  label: string;
  render_type?: 'avatar' | 'chip' | 'blackbox' | 'relay' | 'system' | 'custom';
  display?: {
    avatar_url?: string | null;
    image_url?: string | null;
    icon?: string | null;
    accent_token?: string | null;
  };
  state?: {
    is_pinned?: boolean;
    activity_status?: 'active' | 'inactive' | 'idle' | 'unknown';
    resolve_state?: 'open' | 'merged' | 'resolved' | 'sealed';
    lifecycle_status?: 'active' | 'idle' | 'gc_candidate' | 'recycled' | 'sealed';
  };
  metrics?: {
    snr?: number | null;
    signal_strength?: number | null;
    weight?: number | null;
  };
  refs?: {
    agent_id?: string | null;
    atmosphere_node_id?: string | null;
    source_action_intent_id?: string | null;
    source_inference_id?: string | null;
    source_event_id?: string | null;
  };
  tags?: string[];
  metadata?: Record<string, unknown>;
}
```

### 4.4 边字段建议 / Edge View Model

```ts
interface GraphEdgeView {
  id: string;
  source: string;
  target: string;
  kind:
    | 'relationship'
    | 'transmission'
    | 'ownership'
    | 'derived_from'
    | 'contains'
    | 'mentions'
    | 'custom';
  label?: string;
  weight?: number | null;
  state?: {
    active?: boolean;
    dropped?: boolean;
    hidden?: boolean;
  };
  refs?: {
    relationship_id?: string | null;
    action_intent_id?: string | null;
    event_id?: string | null;
  };
  metadata?: Record<string, unknown>;
}
```

### 4.5 前后端职责分界 / Responsibility Split

#### 后端负责

- 节点语义分类
- provenance
- lifecycle / reachability / resolve state
- graph projection
- 搜索/过滤所需核心字段

#### 前端负责

- mesh / tree / local-focus 等视图切换
- 主题映射
- 卡片、badge、头像、黑盒、浮层等渲染细节
- world pack 提供的样式 token 和渲染规则映射

> 原则：**后端定义“这是什么”，前端定义“它怎么显示”。**

---

## 5. 需要后端支撑的中等缺口 / Medium Backend Gaps Needed by New Frontend

以下缺口不是“理想增强项”，而是新一版前端如果要顺畅落地，后端中期应补齐的支撑项。

### 5.1 P0：Success Envelope 全域统一

**优先级：P0 / Cross-cutting**

#### 原因

这是所有页面的基础契约问题。如果不统一：

- 前端 API 层会持续污染
- 缓存/错误处理/类型收敛都会变复杂
- 任何新页面都得重复兼容逻辑

#### 建议

- 统一到 `{ success: true, data }`
- 所有 route success path 走统一 helper
- 更新 `API.md` + smoke/e2e 断言

---

### 5.2 P1：Workflow 列表 / 筛选接口

**优先级：P1**

当前已有：

- 单个 job 查询
- 单个 workflow 查询
- retry / replay

但还缺：

- 支撑 GitHub Actions 风列表页的正式 jobs list API

#### 建议接口

- `GET /api/inference/jobs`

#### 最小查询能力建议

- `status=pending|running|completed|failed|dropped`
- `agent_id=`
- `identity_id=`
- `strategy=`
- `job_type=`
- `from_tick=` / `to_tick=`
- `from_created_at=` / `to_created_at=`
- `cursor=` / `limit=`
- `has_error=true|false`
- `action_intent_id=`

#### 返回建议

至少包含：

- job summary
- trace / intent 关键摘要
- derived workflow state summary
- page_info

否则前端做工作流总览页时要 N 次补请求，成本过高。

---

### 5.3 P1：Overview 聚合摘要接口

**优先级：P1**

Overview 首页会同时展示：

- runtime ready / degraded
- 当前 world time / tick / speed
- 最近事件
- 当前活跃 agent 数
- 最新帖子/传播
- 最近失败 job / dropped intent / 告警

如果全部拆成多个接口前端拼装，会带来：

- 首屏并发过多
- 数据时间窗不一致
- 组件层过度耦合 API

#### 建议接口

- `GET /api/overview/summary`

#### 返回建议

```ts
{
  runtime: ...,
  world_time: ...,
  active_agent_count: number,
  recent_events: EventSummary[],
  latest_posts: PostSummary[],
  latest_propagation: PropagationSummary[],
  failed_jobs: JobSummary[],
  dropped_intents: IntentSummary[],
  notifications: NotificationSummary[]
}
```

---

### 5.4 P1：Graph V2 / 异构图谱查询接口

**优先级：P1**

这是 Relay / Container、mesh / tree、多种视图切换的基础。

#### 建议至少支持

- 节点 kind 分类
- heterogeneous nodes/edges
- `search=` / `q=`
- `kinds=`
- `root_id=`（局部关系图 / focus 子图）
- `depth=`
- `include_inactive=`
- `include_unresolved=`
- `view=mesh|tree`

前端不应自己从各个表和各个 API 拼一个“伪图谱语义层”。

---

### 5.5 P2：Social Feed 高级过滤能力

**优先级：P2**

TweetDeck / X Pro 风多列信息流要求同一个 feed 能被不同 query preset 复用。

#### 建议增强当前 `/api/social/feed`

建议支持：

- `author_id=`
- `agent_id=`
- `circle_id=`
- `signal_min=` / `signal_max=`
- `from_tick=` / `to_tick=`
- `source_action_intent_id=`
- `keyword=`
- `cursor=` / `limit=`
- `sort=latest|signal`

如后续需要，也可以拆成新的 operator feed API，但不要把复杂筛选逻辑推给前端本地做。

---

### 5.6 P2：Agent 聚合详情接口

**优先级：P2**

Agent Detail 页面需要的不只是单个 agent context，而是一个**角色总览聚合体**。

#### 建议接口

- `GET /api/agent/:id/overview`

#### 建议内容

- 基础信息
- role/binding 摘要
- 关系摘要
- 最近行为
- 最近帖子
- 最近工作流
- 最近事件
- SNR 摘要与日志预览
- 最近推理结果摘要
- memory summary（即便暂时是 placeholder）

这样 Social / Graph / Workflow / Timeline 点开同一角色时，都可以落到同一详情模型。

---

### 5.7 P2：Graph Search / Filter / Pin / Resolve 辅助接口

**优先级：P2**

当 Relay / Container 正式落地后，中期还需要以下辅助动作接口：

- pin / unpin node
- resolve / merge container
- graph search suggestions
- local neighborhood query

这类接口不一定要和 Graph V2 同一阶段落地，但建议在 schema 设计时预留 refs / state 字段。

---

## 6. 建议优先级 / Recommended Priority Order

### 第一优先级 / First Priority

1. **Success envelope 全域统一**
2. **Workflow list API**
3. **Overview summary API**

### 第二优先级 / Second Priority

4. **Graph V2 heterogeneous schema**
5. **Relay / Container 最小读模型**
6. **Social feed 高级过滤**

### 第三优先级 / Third Priority

7. **Agent aggregate overview**
8. **Relay lifecycle / pin / GC / merge 等动作接口**

---

## 7. 给后端的明确协作结论 / Concrete Handoff Conclusions

### 7.1 关于 envelope

- 错误 envelope 现有方向可保留。
- 成功 envelope 必须收敛为单一结构：`{ success: true, data }`。
- 前端会先做兼容层，但这只是过渡，不应长期依赖。

### 7.2 关于 Relay / Container

- 这两类节点不应只作为前端皮肤概念存在。
- 后端需要提供至少读层语义：稳定 ID、kind、state、provenance。
- Reachability / GC / resolve / merge 等业务规则归后端，前端不做业务推导。

### 7.3 关于新前端所需接口

若要支撑新的情报台 UI，后端中期至少应补：

- workflow list/filter
- overview summary
- graph v2 heterogeneous schema
- social feed advanced filters
- agent aggregate overview

---

## 8. 建议验收标准 / Suggested Acceptance Criteria

### API Envelope

- [ ] 产品前端消费的 success path 全部返回 `{ success: true, data }`
- [ ] error path 全部返回 `{ success: false, error }`
- [ ] `API.md` 与实际返回一致
- [ ] smoke/e2e 有 envelope 断言

### Relay / Container

- [ ] Graph V2 能返回 `kind=relay|container`
- [ ] 节点有稳定 ID 和最小 state / refs
- [ ] 前端遇到未知/未决实体时不再抛错，而是可回退到 container render
- [ ] Relay 节点能表达 pin / lifecycle / reachability 基本状态

### Frontend Support Gaps

- [ ] 有正式 workflow 列表接口
- [ ] 有 overview 聚合接口
- [ ] 有 graph v2 异构图谱接口
- [ ] social feed 至少具备可复用多列的基础过滤能力
- [ ] agent detail 至少有一个统一聚合 read model

---

## 9. 备注 / Notes

- 当前前端的世界包主题可替换目标，建议先限制在 design tokens / render hints 层，不建议一开始就让 world pack 注入任意前端组件代码。
- Graph V2 建议作为新 schema 或新 endpoint 推进，不建议直接把旧版简单图谱接口硬改成超复杂混合结构。
- 如果后端短期无法一次性完成所有迁移，最低要求也应先完成：
  1. success envelope 统一规范
  2. workflow list API
  3. overview summary API

---

End of Document.
