## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] 落地 durable scheduled jobs 的 schema 与 workflow/runner 基线  `#s2p1`
- [ ] 实现 event-driven cadence 的最小 follow-up 调度  `#s2p2`
- [ ] 扩展 scheduler 统计与 observability 输出  `#s2p3`
- [ ] 补充 e2e 验证并同步 TODO/记录文档  `#s2p4`
<!-- LIMCODE_TODO_LIST_END -->

# Agent Scheduler 第二阶段实现计划

> Source Design: `.limcode/design/agent-scheduler-phase-2-design.md`

## 1. 目标

在 Agent Scheduler v1 基础上，继续推进三个增强方向：

1. `DecisionJob.scheduled_for_tick` 驱动的 durable scheduled jobs
2. 基于世界变更信号的 event-driven cadence
3. 更结构化的 scheduler 统计与可观测输出

本计划按分批实现方式推进，先确保 durable scheduling 基线稳定，再叠加 event-driven 调度。

---

## 2. 分批策略

## Batch 1：Durable Scheduled Jobs Baseline

### 范围

- Prisma schema 增加 `DecisionJob.scheduled_for_tick`
- workflow service 与 runner 支持 future-scheduled job
- scheduler 创建 job 时写入 `scheduled_for_tick`
- request_input 注入 `scheduler_scheduled_for_tick`

### 目标

把“创建 job”与“允许执行 job”正式分离。

### 关键改动

- `apps/server/prisma/schema.prisma`
- 新 migration
- `apps/server/src/app/services/inference_workflow.ts`
- `apps/server/src/inference/types.ts`
- `apps/server/src/app/runtime/agent_scheduler.ts`

### 验收

- future-scheduled job 不会被提前 claim
- `scheduled_for_tick <= now` 的 job 可被正常消费

---

## Batch 2：Event-Driven Cadence

### 范围

- 提取最近 world signal：
  - `Event`
  - `RelationshipAdjustmentLog`
  - `SNRAdjustmentLog`
- 为相关 actor 生成 follow-up job
- 新增 scheduler reason：
  - `event_followup`
  - `relationship_change_followup`
  - `snr_change_followup`

### 目标

让 scheduler 不再只是固定周期扫描，而能响应世界状态变化。

### 关键改动

- `apps/server/src/app/runtime/agent_scheduler.ts`
- `apps/server/src/app/services/inference_workflow.ts`（必要时补 signal helper）

### 验收

- 世界变更后，相关 actor 能获得 follow-up 调度
- event-driven job 与 periodic job 不重复冲突

---

## Batch 3：Observability & Validation

### 范围

- 扩展 `AgentSchedulerRunResult`
- 补充 scheduler e2e
- 文档同步

### 目标

让调度结果可验证、可解释、可继续扩展到 operator 读模型。

### 验收

- e2e 覆盖 future scheduling + event-driven follow-up
- `TODO.md` / `记录.md` 与实现一致

---

## 3. Batch 1 详细任务

### Task 1.1 Schema & Migration

- 在 `DecisionJob` 上新增 `scheduled_for_tick BigInt?`
- 增加索引，便于状态+时间窗口检索
- 编写 migration SQL

### Task 1.2 Workflow Persistence Update

- `DecisionJobRecord` 新增 `scheduled_for_tick`
- `createPendingDecisionJob()` 支持 `scheduled_for_tick`
- `createReplayDecisionJob()` 明确写 `scheduled_for_tick = null`
- `updateDecisionJobState()` 支持更新 `scheduled_for_tick`
- `toWorkflowDecisionJobSnapshot()` 输出该字段

### Task 1.3 Runner & Claim Semantics

- `listRunnableDecisionJobs()` 仅返回到时 job
- `claimDecisionJob()` 增加未到时保护
- `updateMany(where)` 同步增加 `scheduled_for_tick` 条件

### Task 1.4 Scheduler Runtime Baseline

- scheduler 构造 request_input 时写入 `scheduler_scheduled_for_tick`
- v2 第一批先将 `scheduled_for_tick = now`，建立 durable baseline

### Task 1.5 Validation

- 更新/新增 e2e 验证 future scheduling 基线
- 至少验证“future job 不可提前 claim”

---

## 4. 风险控制

### 风险 1：Migration 与现有 SQLite 数据兼容

- 采用 nullable 字段追加
- 避免破坏现有 job 记录

### 风险 2：Runner 过滤条件不一致

- `listRunnableDecisionJobs()` 与 `claimDecisionJob()` 必须保持同一时间约束

### 风险 3：request_input 与 DB 字段语义不一致

- `scheduler_scheduled_for_tick` 仅作 explainability 元信息
- 真正执行门槛以 `DecisionJob.scheduled_for_tick` 为准

---

## 5. 完成定义（Batch 1）

Batch 1 完成时应满足：

1. `DecisionJob` 已支持 `scheduled_for_tick`
2. workflow snapshot 已可读出该字段
3. decision runner 不会提前执行 future job
4. scheduler 创建 job 时已显式写入 scheduled tick
5. 类型检查与至少一条相关验证脚本通过
