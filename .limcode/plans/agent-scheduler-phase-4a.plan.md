## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 实现 scheduler runs list / decisions query 后端查询与路由  `#p4a1`
- [x] 补充 scheduler 查询分页/过滤与返回模型  `#p4a2`
- [x] 补充 P4-A e2e 验证并修复 lint/typecheck  `#p4a3`
- [x] 同步 API/ARCH/TODO/记录 文档  `#p4a4`
<!-- LIMCODE_TODO_LIST_END -->

# Agent Scheduler Phase 4A 实施计划

> Source Design: `.limcode/design/agent-scheduler-phase-4-roadmap.md`

## 1. 目标

在当前 scheduler minimal read API 的基础上，补齐更可消费的查询面：

- scheduler runs list API
- scheduler decisions query API
- filter + pagination baseline
- 保持稳定 success/error envelope 与 BigInt string transport

## 2. 实施范围

### 后端服务层
- 扩展 `apps/server/src/app/services/scheduler_observability.ts`
- 新增 runs list / decisions query 的过滤、分页、cursor 编解码与返回模型

### 路由层
- 扩展 `apps/server/src/app/routes/scheduler.ts`
- 新增：
  - `GET /api/runtime/scheduler/runs`
  - `GET /api/runtime/scheduler/decisions`
- 保持 route handler thin adapter 风格

### 验证
- 新增/扩展 e2e，覆盖：
  - runs list
  - decisions list
  - cursor 分页
  - filters
  - invalid cursor / invalid tick range

### 文档
- 更新 `docs/API.md`
- 必要时更新 `docs/ARCH.md`
- 同步 `TODO.md` 与 `记录.md`

## 3. 技术设计要点

### 3.1 Runs Query
支持：
- `limit`
- `cursor`
- `from_tick`
- `to_tick`
- `worker_id`

返回：
- `items: SchedulerRunReadModel['run'][]`
- `summary: { returned, limit, filters }`
- `meta.pagination`

### 3.2 Decisions Query
支持：
- `limit`
- `cursor`
- `actor_id`
- `kind`
- `reason`
- `skipped_reason`
- `from_tick`
- `to_tick`

返回：
- `items: SchedulerCandidateDecisionReadModel[]`
- `summary: { returned, limit, filters }`
- `meta.pagination`

### 3.3 Cursor Strategy
建议复用 audit feed 的思路：
- 用 base64url 编码 cursor payload
- run cursor：`created_at + id`
- decision cursor：`created_at + id`

### 3.4 Validation
保持服务层进行参数验证：
- invalid cursor -> `400 SCHEDULER_QUERY_INVALID`
- `from_tick > to_tick` -> `400 SCHEDULER_QUERY_INVALID`
- limit 越界时进行 clamp 或 reject（优先固定规则）

## 4. 验收标准

- `GET /api/runtime/scheduler/runs` 可按时间范围/worker 查询并分页
- `GET /api/runtime/scheduler/decisions` 可按 actor/kind/reason/skipped_reason 查询并分页
- BigInt 字段保持 string transport
- route handlers 保持 thin adapter
- e2e 覆盖成功路径与至少两类无效查询路径
- typecheck 与相关脚本通过
