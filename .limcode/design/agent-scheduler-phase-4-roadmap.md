# Agent Scheduler Phase 4 路线建议

## 1. 背景

截至当前阶段，Agent Scheduler 的 Phase 3 已经完成：

- richer event-driven policy baseline 已落地
- scheduler observability read model 已落地
- minimal scheduler read API 已落地
- lease + cursor leader-only safety baseline 已落地
- 独立 e2e 与文档同步已完成

这意味着 scheduler 已经从“可运行组件”进化为“具备最小工程成熟度的 runtime subsystem”。

但从 Phase 4 开始，关注点需要从“把 scheduler 做出来”转向“让 scheduler 真正服务 operator、更多部署形态与更复杂工作流”。

---

## 2. Phase 4 总目标

Phase 4 建议围绕四个方向展开：

1. **更可消费**：把现有 scheduler observability 变成更完整的 read API / operator projection
2. **更可操作**：支持 operator 视角下的筛选、诊断、对比与 drill-down
3. **更强部署语义**：从 leader-only baseline 继续演进到更强 multi-worker / partitioned scheduling
4. **更完整工作流衔接**：把 scheduler 与 replay orchestration、durable job scheduling、future operators 更自然地联通

---

## 3. 建议主线

## 3.1 主线 A：Scheduler Read API Richening

### 当前状态

目前已有：

- `GET /api/runtime/scheduler/runs/latest`
- `GET /api/runtime/scheduler/runs/:id`
- `GET /api/agent/:id/scheduler`

这套接口已经足够验证和最小观察，但仍偏“开发视角”，还不够 operator-friendly。

### 建议目标

补足面向人和前端的查询能力，例如：

- scheduler run 列表
- 时间范围过滤
- worker 过滤
- actor 过滤
- reason / skipped_reason 过滤
- kind 过滤（periodic / event-driven）
- 分页与 cursor

### 建议增强项

#### A1. Run List API

建议新增：

- `GET /api/runtime/scheduler/runs`

支持：

- `limit`
- `cursor`
- `from_tick`
- `to_tick`
- `worker_id`

用途：

- operator 查看最近一段时间的 scheduler run 历史
- 对比不同 run 的 created/skipped 分布

#### A2. Candidate Decision Query API

建议新增：

- `GET /api/runtime/scheduler/decisions`

支持：

- `actor_id`
- `kind`
- `reason`
- `skipped_reason`
- `from_tick`
- `to_tick`
- `limit`
- `cursor`

用途：

- 回答“为什么这个 actor 一直没被调度”
- 回答“哪些 decision 经常被 pending_workflow 吃掉”

#### A3. Read Model Summary Projection

建议增加轻量 summary helper：

- skipped_by_reason trend
- created_periodic vs created_event_driven trend
- top affected actors
- top chosen reasons

这类 summary 不一定一开始就单独建表，也可以先通过 service 层聚合。

---

## 3.2 主线 B：Operator-Facing Scheduler View

### 当前状态

后端已经有 minimal read API，但前端 operator 还没有正式消费 scheduler 数据。

### 建议目标

让 scheduler 从“存在于后端的技术能力”升级为“operator 能看懂、能定位问题、能建立心智模型的控制面板”。

### 建议增强项

#### B1. Scheduler Runs Panel

前端可增加：

- recent runs 列表
- run detail panel
- summary chips：
  - created_count
  - skipped_pending_count
  - skipped_cooldown_count
  - signals_detected_count

#### B2. Actor Scheduling Timeline

把某个 agent 最近的 scheduler decision 轨迹接入 Agent Overview / Workflow 相关页面：

- 最近被调度原因
- 最近被跳过原因
- 最近 future-scheduled 记录
- 最近 job linkage

#### B3. Cross-Linking

建议支持以下 drill-down：

- SchedulerRun -> CandidateDecision -> DecisionJob -> WorkflowSnapshot
- AgentOverview -> SchedulerDecisions -> RelatedJobs
- Audit / Workflow detail -> 回跳到 scheduler decision source

### 价值

这一条主线的意义不只是“多一个页面”，而是把 scheduler 真正变成 operator 可以观察和调试的 subsystem。

---

## 3.3 主线 C：Stronger Multi-Worker Semantics

### 当前状态

目前已经有：

- `SchedulerLease`
- `SchedulerCursor`
- leader-only scheduling baseline

这在开发期和轻量部署场景下已经足够，但严格来说，它仍然是“单 leader 的最小并发安全语义”，还不是“更强的多 worker 调度模型”。

### 建议目标

从“防止明显重复扫描”进一步升级到“支持更高并发下更清晰、更可验证的调度责任划分”。

### 建议增强项

#### C1. Lease Renewal / Failover Semantics

建议补强：

- lease renew 的显式周期和策略
- lease 持有者失活时的 failover 说明
- run snapshot 中记录 lease ownership metadata

#### C2. Better Cursor / Watermark Semantics

当前 cursor 还是最小写法，后续可以演进到：

- 按 signal source 的 watermark
- 按 signal type 的 watermark
- run-complete 才推进 watermark
- partial failure 下的 cursor safety policy

#### C3. Partitioned Scheduling

如果 actor 数量继续增大，建议进入 partition 模式：

- 按 actor hash 或逻辑分区分配 worker
- 每个 partition 有自己的 lease / cursor
- observability 中显式暴露 partition id

这会让系统从：

- 单 leader 扫全量

演进为：

- 多 worker 分片调度

#### C4. Replay-Aware Scheduling Safety

未来 replay orchestration 增强后，scheduler 需要更明确区分：

- 正常 cadence job
- replay-derived job
- operator-forced job

避免不同来源的调度请求在多 worker 场景下互相干扰。

---

## 3.4 主线 D：Replay / Durable Scheduling Evolution

### 当前状态

目前已有：

- retry
- idempotency replay
- replay lineage baseline
- scheduled_for_tick durable scheduling baseline

### 建议目标

让 scheduler 不只是“创建新 job”，也能更自然参与 durable orchestration。

### 建议增强项

#### D1. Replay-Aware Scheduling Policy

例如：

- replay 期间 suppress 某些 periodic cadence
- replay job 对应特殊 chosen_reason / source label
- replay 链路进入 scheduler observability

#### D2. Deferred / Windowed Scheduling

当前 `scheduled_for_tick` 已经有了，但还可以增强：

- scheduling windows
- not-before / not-after 约束
- delayed follow-up batching

#### D3. Job Intent Classes

可以逐步把 scheduler 创建的 job 分成更明确的 intent classes：

- periodic maintenance
- event follow-up
- replay recovery
- operator forced re-eval

这有利于后续统计、权限与调度策略差异化。

---

## 4. 推荐实施顺序

## Phase 4A：先补 Read API / Query Surface

优先做：

1. scheduler runs list
2. decisions query API
3. cursor / pagination / filters

### 原因

- 成本相对低
- 直接提升 operator 与前端可消费性
- 不会过早把精力拖入更复杂并发语义

---

## Phase 4B：再做 Operator Projection

优先做：

1. scheduler runs panel
2. actor scheduling timeline
3. cross-linking into workflow / agent / audit views

### 原因

- 当 read API 足够稳定后，前端接入的返工风险更低
- 能快速把已有后端能力转化为真实产品能力

---

## Phase 4C：最后补强 stronger multi-worker semantics

优先做：

1. better lease renew/failover
2. better watermark semantics
3. partitioned scheduling design

### 原因

- 这部分技术深度高
- 需要建立在已有 observability 之上，否则难以验证
- 当前 leader-only baseline 已经足以支撑开发阶段

---

## 4.5 可并行长期线：Replay / Durable Scheduling Evolution

这条线可与 4A/4B 部分并行，但不建议一开始就全面铺开。

建议先做最小设计，再按实际 workflow 需求推进。

---

## 5. 推荐改动范围

### Phase 4A 可能涉及

- `apps/server/src/app/routes/scheduler.ts`
- `apps/server/src/app/services/scheduler_observability.ts`
- 可选新增：
  - `apps/server/src/app/services/scheduler_queries.ts`

### Phase 4B 可能涉及

- `apps/web/features/workflow/**`
- `apps/web/features/agent/**`
- `apps/web/features/overview/**`
- 可选新增：
  - `apps/web/features/scheduler/**`

### Phase 4C 可能涉及

- `apps/server/src/app/runtime/scheduler_lease.ts`
- `apps/server/src/app/runtime/agent_scheduler.ts`
- `apps/server/prisma/schema.prisma`
- `apps/server/prisma/migrations/**`
- 可选新增：
  - `apps/server/src/app/runtime/scheduler_partitioning.ts`

### Replay / Durable Scheduling Evolution 可能涉及

- `apps/server/src/app/services/inference_workflow.ts`
- `apps/server/src/inference/service.ts`
- `apps/server/src/app/runtime/agent_scheduler.ts`
- `apps/server/src/app/services/scheduler_observability.ts`

---

## 6. 风险提示

### 风险 1：过早做前端面板，但后端查询面还没稳定

建议：

- 先补 query surface，再做 UI

### 风险 2：过早上 partitioned scheduling

建议：

- 先把 leader-only baseline 的观测和 failover 语义做扎实
- 再进入 partitioning

### 风险 3：scheduler 与 replay orchestration 语义混杂

建议：

- 在 Phase 4 中尽早把 job source / intent class 结构显式化

---

## 7. 建议里程碑

### Milestone P4-A

- scheduler runs list API
- scheduler decisions query API
- filter + pagination baseline

### Milestone P4-B

- operator-facing scheduler panel
- actor scheduling timeline
- workflow / audit / agent cross-linking

### Milestone P4-C

- stronger lease renew/failover
- richer cursor semantics
- partitioned scheduling design baseline

### Milestone P4-D

- replay-aware scheduling
- deferred/windowed scheduling
- richer job intent classes

---

## 8. 结论

Phase 4 不建议再把重点放在“补一个新的小功能点”，而应聚焦于把 scheduler 从后端能力进一步升级为：

- **可查询**：read API 更完整
- **可理解**：operator 能直接消费
- **可扩展**：能承接更复杂部署和更复杂工作流
- **可演进**：与 replay、durable scheduling、future operator control 更自然耦合

如果说：

- Phase 1 解决了“有没有 scheduler”
- Phase 2 解决了“scheduler 会不会响应世界变化”
- Phase 3 解决了“scheduler 是否具备基础工程成熟度”

那么 Phase 4 要解决的就是：

> **scheduler 是否已经能够成为 operator-facing、deployment-aware、workflow-aware 的正式调度子系统。**
