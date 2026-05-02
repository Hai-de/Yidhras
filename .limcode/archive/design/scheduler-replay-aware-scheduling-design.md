# Scheduler Replay-Aware Scheduling 与 Job Intent Classes 设计

## 1. 背景

当前后端已经具备：

- `DecisionJob` / `ActionIntent` / `InferenceTrace` 正式工作流基线
- Agent Scheduler v3c / p4a-baseline：
  - durable scheduling
  - event-driven cadence
  - richer policy baseline
  - scheduler observability read model
  - scheduler lease + cursor baseline
  - filtered / paginated scheduler runs & decisions query API
- replay baseline：
  - retry
  - idempotency replay
  - replay lineage baseline

这意味着 scheduler 本身已经足够“可观察”，但仍缺少一个关键层：

> **scheduler 创建的 job 到底属于什么语义类别，以及它与 replay / retry / operator-forced flows 应该如何区分。**

当前系统里虽然有：

- `scheduler_kind`
- `scheduler_reason`
- `idempotency_key`
- replay lineage

但还没有形成更稳定、统一的“job source / intent class”语义。

这会导致几个问题：

1. operator 只能看见“这是一个 job”，但不容易判断它是：
   - periodic maintenance
   - event follow-up
   - replay recovery
   - operator-triggered re-check
2. scheduler observability 与 workflow observability 之间的语义桥还不够直接。
3. future multi-worker / partitioned scheduling 时，不同来源的 job 难以进行更明确的隔离与策略差异化。
4. replay job 与 scheduler-created job 目前是“结构上能区分”，但“产品/运营语义上不够明确”。

---

## 2. 目标

本阶段目标是：

1. 为 `DecisionJob` 引入稳定的 **job intent class / job source semantics**
2. 让 scheduler 在创建 job 时写入更明确的 **scheduler source labels**
3. 让 replay / retry / operator-forced job 与 scheduler-created job 在 workflow 层具备更清晰区分
4. 为后续：
   - richer scheduler summary/trends
   - operator drill-down
   - stronger multi-worker semantics
   - replay-aware scheduling suppression / policy
   打好基础

---

## 3. 核心设计

## 3.1 新增统一语义字段：Job Intent Class

建议在 `DecisionJob` 上新增一个稳定字段，例如：

- `intent_class String`

建议枚举值先保持 string literal，而不是过早引入 DB enum：

- `direct_inference`
- `scheduler_periodic`
- `scheduler_event_followup`
- `replay_recovery`
- `retry_recovery`
- `operator_forced`

### 说明

#### `direct_inference`
用于非 scheduler、非 replay、非 retry 的普通提交：

- `/api/inference/jobs`
- 未来其他正式 direct workflow submit path

#### `scheduler_periodic`
用于 scheduler 的 periodic cadence 创建的 job。

#### `scheduler_event_followup`
用于 scheduler 的 event-driven follow-up job。

#### `replay_recovery`
用于 replay 派生出来的 job。

#### `retry_recovery`
用于对 failed job 做 retry reset 后再次进入 pending/running 的语义。

#### `operator_forced`
为未来 operator 主动触发 re-check / forced reschedule 预留。

---

## 3.2 与现有 scheduler metadata 的关系

当前已有：

- `scheduler_kind`
- `scheduler_reason`
- `scheduler_secondary_reasons`
- `scheduler_priority_score`

这些字段仍然保留，因为它们描述的是：

- “scheduler 为什么创建这个 job”

而 `intent_class` 描述的是：

- “这个 job 在整个 workflow 体系里属于哪类意图”

两者关系如下：

- `intent_class` = 更稳定的顶层分类
- `scheduler_*` = scheduler-specific explanation metadata

例如：

- `intent_class = scheduler_event_followup`
- `scheduler_kind = event_driven`
- `scheduler_reason = event_followup`

---

## 3.3 request_input.attributes 也写入稳定 source label

除 DB 字段外，建议同时在 `request_input.attributes` 中显式写入：

- `job_intent_class`
- `job_source`

例如：

### scheduler periodic
- `job_intent_class = scheduler_periodic`
- `job_source = scheduler`

### scheduler event-driven
- `job_intent_class = scheduler_event_followup`
- `job_source = scheduler`

### replay
- `job_intent_class = replay_recovery`
- `job_source = replay`

### retry
- `job_intent_class = retry_recovery`
- `job_source = retry`

### normal submit
- `job_intent_class = direct_inference`
- `job_source = api_submit`

这样做的好处是：

- DB 字段适合正式过滤/索引/读模型
- request_input.attributes 适合保留原始工作流上下文
- audit / debug / raw trace 阅读时也更直观

---

## 3.4 Scheduler replay-aware baseline

当前 scheduler 已具备 candidate policy，但对 replay-aware 语义还没有明确策略。

本阶段不建议一次上太复杂 suppression engine，而是先做：

### A. replay job 明确标记
让 replay 派生 job 在 workflow 层可以清楚区分。

### B. scheduler 不主动把 replay job 当成普通 cadence 统计对象
例如在后续聚合 helper 中：

- scheduler trend 默认只统计 `scheduler_* intent_class`
- replay / retry 走独立分类

### C. 为 future suppression 留出结构
例如可在 scheduler candidate 决策里后续引入：

- `skip_due_to_replay_window`
- `skip_due_to_operator_override`

本阶段先不实现这些 skip rule，但要让结构演进方向清晰。

---

## 3.5 与 workflow read model / observability 的联动

本阶段建议最少做到：

### A. Workflow read path 能看到 `intent_class`
例如：

- `GET /api/inference/jobs`
- `GET /api/inference/jobs/:id`
- workflow snapshot read model

都补充 `intent_class`

### B. Scheduler observability 可继续沿用现有结构
不强行改 `SchedulerRun` / `SchedulerCandidateDecision` schema，避免不必要破坏。

必要时只在 summary 或 query helper 中利用 `DecisionJob.intent_class` 做分类统计。

---

## 4. 建议改动范围

### Prisma / 数据层
- `apps/server/prisma/schema.prisma`
- `apps/server/prisma/migrations/**`

### Workflow service
- `apps/server/src/app/services/inference_workflow.ts`

### Scheduler runtime
- `apps/server/src/app/runtime/agent_scheduler.ts`

### Inference service
- `apps/server/src/inference/service.ts`

### Workflow read / routes
- `apps/server/src/app/routes/inference.ts`
- 相关 workflow snapshot / list helper 所在文件

### 验证
- `apps/server/src/e2e/agent_scheduler.ts`
- `apps/server/src/e2e/workflow_replay.ts`
- 可选新增专门 e2e

---

## 5. 推荐实施步骤

## Step 1. 加 schema 字段
为 `DecisionJob` 新增：

- `intent_class String @default("direct_inference")`

并增加必要索引，例如：

- `@@index([intent_class, created_at])`

---

## Step 2. workflow create/update path 接入 intent_class
至少覆盖：

- `createPendingDecisionJob()`
- `createReplayDecisionJob()`
- retry reset / retry claim path
- scheduler create path

确保不同入口都显式写入正确 `intent_class`。

---

## Step 3. request_input.attributes 补充 source labels
统一约束：

- `job_intent_class`
- `job_source`

避免不同入口写法不一致。

---

## Step 4. workflow read model 暴露 intent_class
补到：

- jobs list item
- job detail
- workflow snapshot

必要时 API 文档同步。

---

## Step 5. e2e 验证
至少验证：

- normal submit -> `direct_inference`
- scheduler periodic -> `scheduler_periodic`
- scheduler event-driven -> `scheduler_event_followup`
- replay job -> `replay_recovery`
- retry flow -> `retry_recovery`

---

## 6. 风险与约束

### 风险 1：过早 enum 化
建议先保持 string literal，不急于 DB enum。

### 风险 2：把 scheduler-specific reason 与顶层 intent_class 混在一起
必须保持分层：

- `intent_class` 是顶层分类
- `scheduler_reason` 是调度解释

### 风险 3：大范围改动 read models
本阶段只补必要字段，不做破坏性重构。

---

## 7. 验收标准

完成后应满足：

1. 任意 `DecisionJob` 都能明确回答“它属于哪类 intent class”
2. scheduler-created / replay-created / retry-created / direct submit jobs 可稳定区分
3. workflow list/detail/read model 暴露 `intent_class`
4. request_input.attributes 中存在一致的 `job_intent_class` / `job_source`
5. e2e 能覆盖 scheduler / replay / retry / direct submit 的 intent_class 断言

---

## 8. 结论

这一步的意义不是单纯“多加一个字段”，而是让 scheduler / replay / retry / operator forcing 在 workflow 体系里拥有统一、稳定、可查询的语义边界。

这会直接提升：

- 后端可观测性
- operator 可解释性
- future scheduler summary/trend 统计能力
- future multi-worker / partitioned scheduling 的演进空间
