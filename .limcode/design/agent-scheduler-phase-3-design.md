# Agent Scheduler Phase 3 设计

## 1. 背景

截至当前阶段，Agent Scheduler 已经完成了 v1 与 Phase 2 baseline：

- periodic cadence 已可运行
- event-driven cadence 已有最小 follow-up 基线
- `DecisionJob.scheduled_for_tick` 已支持 durable scheduling
- scheduler metadata 已进入 `DecisionJob.request_input.attributes`
- `runAgentScheduler()` 已输出基础统计
- 已有 e2e 验证 future-scheduled job 与 follow-up job 的创建行为

这意味着后端已经从“固定 tick 扫描器”进化成了“带最小事件驱动能力的调度器”。

但要真正支撑更复杂的模拟系统，Phase 3 还需要补足三块：

1. **richer event-driven policy**：不仅知道“有信号”，还要知道“谁更值得被调度、何时调度、为什么调度”。
2. **scheduler observability read model**：不仅内部能统计，还要对 operator/read side 形成稳定可读投影。
3. **multi-worker safety**：从当前单实例 runtime 假设走向可控的多 worker 调度安全语义。

---

## 2. Phase 3 总目标

Phase 3 不是简单继续堆功能，而是要让 scheduler 从“能工作”进一步提升为：

- **可解释**：调度决策能读、能追溯、能比较
- **可控**：支持优先级、冷却、节流、去重策略升级
- **可扩展**：能承接后续 operator、replay、更多 actor 类型与多 worker 部署

---

## 3. Phase 3 三条主线

## 3.1 主线 A：Richer Event-Driven Policy

### 当前问题

当前 event-driven cadence 是“最近 lookback 窗口里有 signal 就 follow-up”。

这在 Phase 2 是合理的最小基线，但存在几个不足：

- 不区分 signal 强弱
- 不区分 actor 当前活跃度和优先级
- 不区分 signal 类型之间的竞争关系
- 一个 actor 可能被多个 signal 命中，但目前只是简单 dedupe
- cooldown 规则仍较粗

### Phase 3 目标

引入更清晰的 policy layer，用于决定：

1. 是否调度
2. 为什么调度
3. 何时调度
4. 优先级多高
5. 是否应覆盖已有 periodic cadence

### 建议增强项

#### A1. Signal Weighting / 信号权重

为不同 signal 类型建立基础权重，例如：

- `event_followup`
- `relationship_change_followup`
- `snr_change_followup`
- 未来还可加入：
  - `post_followup`
  - `binding_change_followup`
  - `policy_change_followup`

每种信号可带：

- `base_weight`
- `delay_ticks`
- `coalesce_window_ticks`
- `max_followup_per_window`

#### A2. Actor Readiness / Actor 可调度状态

在“有信号”之外，增加 actor readiness 评估，例如：

- 是否已有长时间 running job
- 最近是否连续失败
- 是否处于高频调度抑制窗口
- 是否因 SNR / binding / policy 状态不应被调度

#### A3. Candidate Resolution / 候选合并策略

对一个 actor 被多个 signal 命中的情况，不再只是简单 dedupe，而是要形成：

- 主原因（primary reason）
- 次原因列表（secondary reasons）
- 最终 scheduled_for_tick
- 最终优先级

这样后续 operator 才能知道“为什么这个 actor 被调度”。

#### A4. Policy Source 扩展

后续可以将调度 policy 的来源从“代码常量”扩展到：

- world-pack cadence config
- system override
- operator forced policy

但 Phase 3 首轮应先在代码内固定结构，不急于直接 DSL 化。

---

## 3.2 主线 B：Scheduler Observability Read Model

### 当前问题

当前 scheduler 的可观测性主要依赖：

- `request_input.attributes.scheduler_*`
- `runAgentScheduler()` 的统计输出
- 手工 e2e 观察 job 结果

这对开发足够，但对 operator/read side 不够稳定。

### Phase 3 目标

形成 scheduler 专属 read model，让系统能够回答：

- 最近一次 scheduler 扫描调度了谁
- 哪些 actor 被跳过，为什么
- 是 periodic 还是 event-driven 触发
- 为什么会 scheduled 到 future tick
- 某个 actor 最近几轮调度轨迹是什么

### 建议增强项

#### B1. Scheduler Run Snapshot

新增一个 scheduler run 级别的快照模型，至少包含：

- run_id
- tick
- scanned_count
- eligible_count
- created_count
- skipped counts
- signals_detected_count
- created_periodic_count
- created_event_driven_count
- duration_ms（可选）

这个模型可以先作为：

- persisted table
- 或 lightweight audit-like store

#### B2. Scheduler Candidate Decision Snapshot

对每个候选 actor 记录：

- actor_id
- candidate kinds / reasons
- chosen reason
- chosen scheduled_for_tick
- skipped_reason（如果没创建）
- linked job_id（如果创建成功）

这样能支持 operator 视图做：

- “为什么这个 actor 没被调度？”
- “为什么是 event_followup 而不是 periodic?”

#### B3. Read API / Operator Projection

后续可新增只读接口，例如：

- `/api/runtime/scheduler/runs`
- `/api/runtime/scheduler/runs/:id`
- `/api/agent/:id/scheduler`

不过 API 是否在本阶段实现，要看前端/operator 需求优先级。

Phase 3 至少要先把 read model 结构定下来。

---

## 3.3 主线 C：Multi-Worker Safety

### 当前问题

当前 scheduler 默认是单实例 runtime loop 内步骤，尚未正式支持多 worker 协作。

已有的安全措施主要在：

- `DecisionJob` claim lock
- `ActionIntent` claim lock

但 scheduler 本身还没有：

- scheduler lease
- scheduler cursor
- scheduler ownership
- partitioning

因此在多进程/多实例情况下，可能会有：

- 重复扫描
- 重复 candidate creation
- event-driven fan-out 放大
- observability 不一致

### Phase 3 目标

建立 scheduler 本身的最小多 worker 安全语义。

### 建议增强项

#### C1. Scheduler Lease

新增轻量 lease 模型，例如：

- lease key: `agent_scheduler_main`
- holder: worker_id
- acquired_at
- expires_at

作用：

- 确保同一时刻只有一个 scheduler 主实例负责扫描

#### C2. Scheduler Cursor / High-Water Mark

记录：

- 最近扫描 tick
- 最近处理的 signal watermark

作用：

- 避免 event-driven signal 重复消费
- 支持增量扫描而不是每轮 lookback 全表扫

#### C3. Partitioned Scheduling（后续）

如果将来 actor 数量增大，可以进一步演进到：

- 按 actor hash 分片
- 多 worker 各自负责不同 partition

不过这属于更后续阶段，Phase 3 首轮可以先做到单-leader 模式。

---

## 4. Phase 3 推荐实施顺序

## Phase 3A：Policy Layer First

先做 richer event-driven policy，但先不引入多 worker：

1. signal weighting
2. candidate merge strategy
3. skip reason taxonomy
4. 更清晰的 scheduled_for_tick 计算规则

### 原因

- 成本低
- 收益高
- 能直接提升调度质量与 explainability

---

## Phase 3B：Observability Read Model

在 policy 稳定后，再补 scheduler run / candidate read model：

1. scheduler run snapshot
2. candidate decision snapshot
3. 最小 operator 读取接口或内部查询 helper

### 原因

- 没有稳定 policy 前，read model 会频繁变
- 先稳策略，再冻结 read model 更合理

---

## Phase 3C：Multi-Worker Safety

最后再引入：

1. scheduler lease
2. signal watermark / cursor
3. optional leader-only scheduling mode

### 原因

- 这是架构增强，改动更深
- 当前单实例 runtime 仍可支撑开发阶段
- 等 policy 与 read model 基本稳定再做更划算

---

## 5. Phase 3 关键数据结构建议

## 5.1 Scheduler Skip Reason

建议显式定义 skip reason taxonomy，例如：

- `pending_workflow`
- `periodic_cooldown`
- `event_coalesced`
- `actor_not_ready`
- `existing_same_idempotency`
- `policy_suppressed`
- `limit_reached`

这样 observability 才能真正好用。

## 5.2 Scheduler Candidate Snapshot

建议统一结构：

- `actor_id`
- `candidate_reasons[]`
- `chosen_reason`
- `kind`
- `scheduled_for_tick`
- `priority_score`
- `skipped_reason?`
- `created_job_id?`

## 5.3 Scheduler Run Snapshot

建议统一结构：

- `run_id`
- `tick`
- `worker_id`
- `summary`
- `candidate_count`
- `created_count`
- `skipped_by_reason`
- `started_at`
- `finished_at`

---

## 6. 文档与接口影响

Phase 3 可能影响：

- `docs/ARCH.md`
  - runtime 调度边界
  - scheduler/read model/multi-worker 结构
- `docs/LOGIC.md`
  - 调度规则与 actor cadence 逻辑
- `docs/API.md`
  - 若增加 scheduler read API，需要补接口契约
- `TODO.md`
  - M2 当前状态与下一步更新
- `记录.md`
  - 验证与验收证据

---

## 7. 验收标准建议

### Phase 3A 验收

- 多种 signal 能按权重/规则合并为单个 actor 调度决策
- skip reason 可结构化输出
- 调度结果比当前“有 signal 就 follow-up”更稳定

### Phase 3B 验收

- 能查询最近 scheduler run summary
- 能查询某 actor 最近调度决策轨迹
- operator/read side 不需要直接翻 workflow 原始记录来猜调度行为

### Phase 3C 验收

- 多实例下不会出现明显重复扫描与重复 candidate creation
- scheduler 主流程具备 lease / watermark 保护

---

## 8. 结论

Phase 3 的重点不是再把 scheduler 做得更“大”，而是让它变得：

- **更聪明**：通过 richer policy 做更合理调度
- **更透明**：通过 read model 让 operator 看懂调度决策
- **更安全**：通过 multi-worker safety 支撑更稳定运行

如果说 v1 解决了“有没有 scheduler”，Phase 2 解决了“scheduler 能不能响应世界变化”，那么 Phase 3 解决的就是：

> **scheduler 是否已经具备成为正式 runtime subsystem 的工程质量。**