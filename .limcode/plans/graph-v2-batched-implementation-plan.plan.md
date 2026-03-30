## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] Batch 1：新增 /api/graph/view 与最小 Graph V2 projection 骨架  `#graph-batch-1`
- [ ] Batch 2：扩展 atmosphere / provenance / heterogeneous edge fields  `#graph-batch-2`
- [ ] Batch 3：加入 Relay / Container 最小 projection 读模型  `#graph-batch-3`
- [ ] Batch 4：增强 graph 查询能力与 summary  `#graph-batch-4`
<!-- LIMCODE_TODO_LIST_END -->

# Graph V2 / Relay / Container 分批实施计划

## 原则
- 一次只推进一个小批次。
- 每批次只做单一目标，保证改动面可控。
- 先 projection、后扩展；先 read-only、后动作接口。
- 不直接污染旧 `/api/relational/graph`，统一走新接口。

---

## Batch 1：Graph V2 最小只读接口骨架

### 目标
新增一个独立的新接口：
- `GET /api/graph/view`

先不追求完整异构语义，只建立稳定外壳：
- success envelope
- `schema_version = graph-v2`
- `view = mesh`
- `nodes`
- `edges`
- `summary`

### 本批次范围
- 新增 route 文件
- 在 relational service 中新增 Graph V2 projection builder
- 先把现有 `Agent + Relationship + AtmosphereNode` 投影进去
- 先支持 query：
  - `view=mesh|tree`
  - `root_id`
  - `depth`
  - `kinds`
  - `include_inactive`
  - `include_unresolved`
- 但其中可先只真正实现：
  - `view`
  - `kinds`
  - `root_id`
  - `depth`
- `include_inactive/include_unresolved` 可先接参并保留行为兼容

### 产出
- 最小 `GraphNodeView`
- 最小 `GraphEdgeView`
- 新 e2e / smoke 断言
- API.md 文档补充 Graph V2 endpoint

---

## Batch 2：加入 atmosphere / transmission / provenance 扩展字段

### 目标
在 Batch 1 的 schema 上扩展字段，但不引入 relay/container。

### 本批次范围
- 为 node 补：
  - `display`
  - `state.activity_status`
  - `refs.agent_id / atmosphere_node_id`
- 为 edge 补：
  - `kind`
  - `refs.relationship_id / action_intent_id / event_id`
- 将现有 world action / workflow / social/event provenance 接进 graph projection 的 refs 字段

### 产出
- Graph V2 schema 更接近 handoff 文档的 node/edge view model
- 不新增新表

---

## Batch 3：Relay / Container 最小 projection 读模型

### 目标
不改 Prisma schema，先做后端统一 fallback/projection 语义。

### Relay 最小规则
来源优先：
- `post_message` / workflow / action intent / event / transmission metadata

最小字段：
- `id`
- `kind = relay`
- `relay_type`
- `label`
- `state`
- `refs`
- `metadata`

### Container 最小规则
来源优先：
- unsupported / unresolved / anonymous / parse-failure 风格对象
- 当前可以先从未知/未决 workflow or action projection 兜底

最小字段：
- `id`
- `kind = container`
- `container_type`
- `label`
- `state.resolve_state`
- `refs`
- `metadata`

### 本批次范围
- 仅 projection
- 不持久化
- 不做 pin/unpin
- 不做 merge/resolve 动作接口

---

## Batch 4：Graph 查询增强

### 目标
让前端可用性更高，但仍保持只读。

### 本批次范围
- 真正实现：
  - `search`
  - `include_unresolved`
  - `include_inactive`
  - `view=tree`
- 提升 `summary.counts_by_kind`
- 输出 `active_root_ids`

---

## 暂不进入本轮的内容
- RelayNode / ContainerNode Prisma 持久化模型
- pin / unpin
- resolve / merge
- lifecycle GC / reachability 真正执行逻辑
- graph suggestions / neighborhood action APIs

---

## 推荐立即执行顺序
1. Batch 1：Graph V2 最小只读接口骨架
2. 验证通过后，再做 Batch 2
3. Relay / Container 放到 Batch 3 单独推进
