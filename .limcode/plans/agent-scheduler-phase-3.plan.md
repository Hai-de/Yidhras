## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] 设计并实现 richer event-driven policy（信号权重、候选合并、skip reason taxonomy）  `#p3a1`
- [ ] 落地 scheduler observability read model（run snapshot 与 candidate decision snapshot）  `#p3b1`
- [ ] 按需要补充 scheduler 只读查询接口或内部查询 helper  `#p3b2`
- [ ] 设计并实现 scheduler multi-worker safety（lease + cursor/watermark baseline）  `#p3c1`
- [ ] 补充 Phase 3 验证脚本与 TODO/记录/docs 同步  `#p3v1`
<!-- LIMCODE_TODO_LIST_END -->

# Agent Scheduler Phase 3 开发路线

> Source Design: `.limcode/design/agent-scheduler-phase-3-design.md`

## 1. 目标

在当前 Phase 2 baseline 基础上，把 Agent Scheduler 从“可运行的调度器”提升为“正式 runtime subsystem”。

Phase 3 的目标不是单点补功能，而是围绕三个方向完成工程升级：

1. **更聪明**：richer event-driven policy
2. **更透明**：scheduler observability read model
3. **更安全**：multi-worker safety

---

## 2. 开发主线总览

## 主线 A：Richer Event-Driven Policy

目标：

- 不再只是“有 signal 就调度”
- 形成真正的 candidate policy layer

包含：

- signal weighting
- actor readiness
- candidate merge
- skip reason taxonomy
- 更稳定的 scheduled_for_tick 计算规则

---

## 主线 B：Scheduler Observability Read Model

目标：

- 不再依赖人工翻 workflow/raw jobs 猜调度行为
- 为 operator/read side 提供稳定读模型

包含：

- scheduler run snapshot
- candidate decision snapshot
- 可选只读接口 / 查询 helper

---

## 主线 C：Multi-Worker Safety

目标：

- 从单实例 runtime 假设，提升到最小可控的多 worker 调度语义

包含：

- scheduler lease
- cursor / watermark
- leader-only scheduling baseline

---

## 3. 推荐实施顺序

## Phase 3A：Policy First

### 为什么先做

- 现阶段收益最高
- 能直接改善调度质量
- 为后续 observability 的快照结构提供稳定基础

### 拆解任务

#### Task A1. Signal Weighting Baseline

为当前 signal 类型建立基础权重/延迟配置：

- `event_followup`
- `relationship_change_followup`
- `snr_change_followup`

建议交付：

- `SchedulerSignalPolicy`
- `SchedulerSignalTypePolicyMap`

#### Task A2. Candidate Merge Strategy

把一个 actor 的多个 signals 合并成单个 candidate decision：

- 主原因
- 次原因列表
- priority score
- scheduled_for_tick

建议交付：

- `mergeSchedulerSignalsForActor()`
- `resolveSchedulerCandidateDecision()`

#### Task A3. Skip Reason Taxonomy

显式定义 skip reason：

- `pending_workflow`
- `periodic_cooldown`
- `event_coalesced`
- `actor_not_ready`
- `existing_same_idempotency`
- `policy_suppressed`
- `limit_reached`

建议交付：

- `SchedulerSkipReason`
- `SchedulerCandidateDecisionResult`

#### Task A4. Actor Readiness Checks

引入更清晰的 actor readiness 规则：

- 连续失败抑制
- 高频运行抑制
- 可选 binding/policy gating

建议交付：

- `evaluateSchedulerActorReadiness()`

### 验收标准

- 多个 signal 不再只是简单 dedupe，而能合并为一个结构化决策
- skip reason 可以明确输出
- scheduler 输出的调度决策比当前更稳定、更可解释

---

## Phase 3B：Observability Read Model

### 为什么第二步做

- policy 稳定后，read model 才不至于反复改结构
- 有助于 operator/read side 真正消费 scheduler 决策信息

### 拆解任务

#### Task B1. Scheduler Run Snapshot Persistence

新增 run 级快照模型：

- run_id
- tick
- worker_id
- summary counts
- started_at / finished_at

建议交付：

- 新 Prisma model（例如 `SchedulerRun`）
- 写入逻辑：每次 scheduler run 后持久化 summary

#### Task B2. Candidate Decision Snapshot Persistence

新增 candidate 级快照模型：

- actor_id
- candidate_reasons
- chosen_reason
- scheduled_for_tick
- priority_score
- skipped_reason
- created_job_id

建议交付：

- 新 Prisma model（例如 `SchedulerCandidateDecision`）
- 与 `SchedulerRun` 关联

#### Task B3. Internal Query Helper / API Read

按需求选择：

- 先只做内部查询 helper
- 或直接增加只读 API：
  - `/api/runtime/scheduler/runs`
  - `/api/runtime/scheduler/runs/:id`
  - `/api/agent/:id/scheduler`

建议优先：

- 先内部 helper
- 再视 operator 需求决定是否上 API

### 验收标准

- 能查询最近 scheduler run summary
- 能追踪某 actor 最近调度轨迹
- operator/read side 不必直接翻 workflow 原始记录来推断调度行为

---

## Phase 3C：Multi-Worker Safety

### 为什么放最后

- 改动深度最大
- 依赖 policy 与 read model 基本稳定
- 当前单实例 runtime 仍然可支撑开发阶段

### 拆解任务

#### Task C1. Scheduler Lease

新增最小 lease 模型：

- key
- holder
- acquired_at
- expires_at

建议交付：

- Prisma model（例如 `RuntimeLease` / `SchedulerLease`）
- `acquireSchedulerLease()`
- `renewSchedulerLease()`
- `releaseSchedulerLease()`

#### Task C2. Cursor / Watermark

为 scheduler signal 处理增加 cursor：

- last scanned tick
- last processed signal watermark

建议交付：

- `SchedulerCursor`
- 增量扫描 helper

#### Task C3. Leader-Only Scheduling Mode

在 runtime loop 中增加：

- 当前 worker 是否持有 scheduler lease
- 若无 lease，只跑 job runner / dispatcher，不跑 scheduler scan

### 验收标准

- 多实例条件下不会明显重复扫描
- event-driven signal 不会被无限重复消费
- scheduler 主流程具备最小 leader-only 保护

---

## 4. 建议改动文件范围

### 主线 A 可能涉及

- `apps/server/src/app/runtime/agent_scheduler.ts`
- `apps/server/src/app/services/inference_workflow.ts`
- 可选新增：
  - `apps/server/src/app/services/agent_scheduler_policy.ts`
  - `apps/server/src/app/services/agent_scheduler_readiness.ts`

### 主线 B 可能涉及

- `apps/server/prisma/schema.prisma`
- `apps/server/prisma/migrations/**`
- 新增：
  - `apps/server/src/app/services/scheduler_observability.ts`
  - `apps/server/src/app/routes/scheduler.ts`（若上 API）

### 主线 C 可能涉及

- `apps/server/prisma/schema.prisma`
- `apps/server/prisma/migrations/**`
- `apps/server/src/app/runtime/simulation_loop.ts`
- 新增：
  - `apps/server/src/app/runtime/scheduler_lease.ts`
  - `apps/server/src/app/services/scheduler_cursor.ts`

---

## 5. 依赖关系

### A -> B

- observability read model 需要稳定的 candidate decision 结构
- 因此 A 应先于 B

### B -> C（弱依赖）

- C 不绝对依赖 B
- 但有 B 的 run snapshot / candidate snapshot 后，多 worker 问题更容易观察和验证

---

## 6. 风险提示

### 风险 1：过早 DSL 化

Phase 3 容易滑向 world-pack DSL 设计，但这会显著拉高复杂度。

建议：
- 先在代码内固定策略结构
- 等 policy 足够稳定再 DSL 化

### 风险 2：observability 先行导致结构反复变动

如果在 policy 还没稳定前就冻结 read model，后续会频繁改 schema。

建议：
- 先完成主线 A 的结构稳定
- 再上主线 B

### 风险 3：多 worker 过早推进

如果 lease/cursor 提前做，可能会把当前开发重心从“调度质量”拖成“分布式一致性细节”。

建议：
- 当前阶段先保持 leader-only baseline
- 不急着做 partitioned scheduling

---

## 7. 推荐里程碑

### Milestone P3-A

- signal weighting
- candidate merge
- skip reason taxonomy
- actor readiness

### Milestone P3-B

- scheduler run snapshot
- candidate decision snapshot
- internal query helper / optional read API

### Milestone P3-C

- scheduler lease
- cursor/watermark
- leader-only scheduling mode

---

## 8. 完成定义（Phase 3）

Phase 3 完成时，应满足：

1. scheduler 对多 signal 冲突有稳定决策规则
2. scheduler 可输出结构化 skip reason
3. scheduler run 与 candidate 决策可被查询
4. operator/read side 可稳定观察调度行为
5. 多 worker 下调度具备最小安全保护
6. 验证脚本能覆盖 policy / read model / lease 关键路径

---

## 9. 结论

Phase 3 的开发路线应遵循：

- **先策略，再观测，后并发安全**

也就是：

1. 先让 scheduler 决策更合理
2. 再让这些决策变得可读
3. 最后让整个调度子系统适应更复杂部署场景

这条路线能最大化降低返工风险，并持续提升 Agent Scheduler 的工程成熟度。
