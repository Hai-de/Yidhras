## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 统一 success envelope 并迁移产品前端相关 route  `#done-envelope`
- [x] 新增 overview summary 聚合接口  `#done-overview-summary`
- [x] 新增 workflow / inference jobs 列表接口  `#done-workflow-list`
- [ ] 新增 agent aggregate overview 聚合接口  `#next-agent-overview`
- [ ] 设计 Graph V2 projection endpoint 与 heterogeneous schema  `#next-graph-v2-plan`
- [ ] 设计 Relay / Container 最小读模型字段与投影规则  `#next-relay-container-read-model`
- [ ] 增强 social feed 高级过滤能力  `#next-social-feed-filters`
<!-- LIMCODE_TODO_LIST_END -->

# Frontend / Backend Handoff Backend Plan

## 本轮已落地

### 1. Success envelope 全域统一
- 新增统一 success helper：`apps/server/src/app/http/json.ts`
- 产品前端直接消费的 route 已统一为 `{ success: true, data }`
- `audit` / `inference jobs list` 增加了 `meta.pagination`
- `/api/health` 已改为：HTTP `200|503` + body `{ success: true, data: { healthy, ... } }`
- ack-only 接口已统一为 `data.acknowledged`

### 2. Workflow list API
- 已新增：`GET /api/inference/jobs`
- 已支持最小筛选：`status / agent_id / identity_id / strategy / job_type / from_tick / to_tick / from_created_at / to_created_at / cursor / limit / has_error / action_intent_id`
- 返回结构：`{ success: true, data: { items, page_info, summary }, meta: { pagination } }`

### 3. Overview summary API
- 已新增：`GET /api/overview/summary`
- 当前聚合：`runtime / world_time / active_agent_count / recent_events / latest_posts / latest_propagation / failed_jobs / dropped_intents / notifications`
- 当前为轻聚合 read model，后续可继续扩充

### 4. 文档与验证
- 已更新：`API.md` / `ARCH.md` / `LOGIC.md`
- 已通过：`typecheck`、`lint`、`smoke`、以及关键 e2e 测试集

---

## 本轮明确未落地（保留到下一阶段）

### Graph V2 / Relay / Container
- 本轮未新增正式 Graph V2 endpoint
- 本轮未引入 Relay / Container 持久化模型
- 本轮未实现 pin / unpin / resolve / merge / GC 动作接口

原因：
- 需要先确认异构图谱 schema 与 projection 规则
- 需要避免把旧 `/api/relational/graph` 直接硬改成复杂混合结构

---

## 下一阶段建议

### P1: Graph V2 只做读层 projection
建议新增：
- `GET /api/graph/view`

建议先支持：
- `schema_version=graph-v2`
- heterogeneous `nodes[]` / `edges[]`
- `kinds=`
- `root_id=`
- `depth=`
- `include_inactive=`
- `include_unresolved=`
- `view=mesh|tree`
- `search=`

### P1: Relay / Container 最小读模型
建议先只做 projection schema：
- stable `id`
- `kind`
- `state`
- `refs`
- `metadata`

不在本阶段承诺：
- RelayNode 持久化正式模型
- pin/unpin API
- resolve/merge API
- reachability / GC 真正执行器

### P2: Social feed advanced filters
增强现有：
- `GET /api/social/feed`

补充：
- `author_id`
- `agent_id`
- `circle_id`
- `signal_min / signal_max`
- `from_tick / to_tick`
- `source_action_intent_id`
- `keyword`
- `cursor / limit`
- `sort=latest|signal`

### P2: Agent aggregate overview
建议新增：
- `GET /api/agent/:id/overview`

聚合：
- 基础信息
- role/binding 摘要
- 关系摘要
- 最近行为
- 最近帖子
- 最近工作流
- 最近事件
- SNR 摘要
- 最近推理结果摘要
- memory summary

---

## 约束与原则

1. 后端定义业务语义，前端定义渲染样式
2. 新接口优先使用 object payload，而不是 bare array
3. 所有新成功响应必须使用统一 envelope
4. Graph V2 使用新 endpoint 或新 schema，不直接污染旧简图接口
5. Relay / Container 先 projection，后 persistence
