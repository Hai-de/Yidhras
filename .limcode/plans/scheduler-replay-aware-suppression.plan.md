## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [X] 设计并实现 replay/retry recovery window 查询 helper  `#srs1`
- [X] 在 scheduler candidate evaluation 中加入 replay/retry suppression policy  `#srs2`
- [X] 扩展 skip reason taxonomy、observability snapshot 与 summary/trend 聚合  `#srs3`
- [X] 补充 agent_scheduler / workflow_replay e2e 验证 suppression 行为  `#srs4`
- [X] 同步 API/ARCH/TODO/记录 文档  `#srs5`
<!-- LIMCODE_TODO_LIST_END -->

# Scheduler Replay-Aware Suppression Policy 实施计划

> 基于当前已完成的：
> - DecisionJob `intent_class` / `job_source` baseline
> - scheduler runs / decisions query API
> - scheduler summary / trend projections

## 1. 目标

把当前 scheduler 从“能区分 replay / retry / scheduler job 的语义类别”，进一步推进到：

- **会因为 replay / retry 恢复态而调整调度行为**
- **避免恢复窗口内被普通 cadence 干扰**
- **让 suppression 成为结构化可观测的 skip reason**

换句话说，本阶段要从：

- 语义分类层（intent_class）

推进到：

- 策略层（suppression / recovery window aware scheduling）

---

## 2. 问题定义

当前系统已经能明确区分：

- `direct_inference`
- `scheduler_periodic`
- `scheduler_event_followup`
- `replay_recovery`
- `retry_recovery`

但 scheduler 仍然没有在 candidate evaluation 中真正利用这些语义。

这会导致：

1. replay/retry 恢复中的 actor 仍然可能继续吃到 periodic cadence
2. event-driven signals 可能在恢复窗口内继续放大噪声
3. pending_workflow skip 与真实“恢复态抑制”原因混杂
4. operator 看到 skip 时，不容易知道是：
   - 真正有 pending workflow
   - 还是系统主动 suppress 了普通 cadence

---

## 3. 本阶段设计范围

## 3.1 Recovery Window Helper

新增 helper，用于识别“当前 actor 是否处于恢复窗口内”。

建议先做最小实现：

- replay recovery window
- retry recovery window

### 建议 helper

- `listRecentReplayRecoveryActors(context, sinceTick)`
- `listRecentRetryRecoveryActors(context, sinceTick)`

或者统一为：

- `listRecentRecoveryWindowActors(context, { sinceTick, intentClasses })`

### 数据来源

直接读取 `DecisionJob.intent_class` + `request_input.agent_id` + `created_at / updated_at`

### 注意

- 第一版不必新建表
- 先复用现有 `DecisionJob` 持久化记录

---

## 3.2 Scheduler Candidate Suppression Policy

在 `runAgentScheduler()` candidate evaluation 流程中加入 suppression 判断。

### 第一版建议规则

#### Rule A. replay window suppress periodic cadence

如果 actor 最近处于 replay recovery window：

- suppress `periodic` candidate
- event-driven candidate 暂时允许保留（第一版更保守）

#### Rule B. retry window suppress periodic cadence

如果 actor 最近处于 retry recovery window：

- suppress `periodic` candidate
- 保持与 replay 类似的最小策略

### 为什么先只 suppress periodic

因为：

- periodic 是背景扫描，更适合先被抑制
- event-driven 通常更接近“世界变化必须响应”
- 第一版避免过度 suppress，降低误伤风险

### 后续可演进

未来可以再加：

- replay window 下 suppress 某些低优先级 event-driven signals
- operator-forced override bypass suppression
- signal-type-specific suppression rule

---

## 3.3 Skip Reason Taxonomy 扩展

当前已有：

- `pending_workflow`
- `periodic_cooldown`
- `event_coalesced`
- `existing_same_idempotency`
- `limit_reached`

建议新增：

- `replay_window_suppressed`
- `retry_window_suppressed`

### 要求

这些新 reason 需要进入：

- `SchedulerSkipReason`
- `candidateDecisions[].skipped_reason`
- `skipped_by_reason`
- scheduler summary / trend / future operator view

---

## 3.4 Observability 联动

本阶段至少做到：

### A. run snapshot 中 `skipped_by_reason` 能体现 suppression

### B. candidate decision snapshot 中可看到 suppression reason

### C. scheduler summary projection 中自动纳入 suppression 相关 top skipped reasons

不强制新增 schema；优先复用现有：

- `SchedulerRun.summary`
- `SchedulerCandidateDecision.skipped_reason`

---

## 4. 建议改动范围

### 服务层 / runtime
- `apps/server/src/app/runtime/agent_scheduler.ts`
- `apps/server/src/app/services/inference_workflow.ts`
- `apps/server/src/app/services/scheduler_observability.ts`

### e2e
- `apps/server/src/e2e/agent_scheduler.ts`
- `apps/server/src/e2e/workflow_replay.ts`
- 必要时新增 focused e2e

### 文档
- `docs/API.md`
- `docs/ARCH.md`
- `TODO.md`
- `记录.md`

---

## 5. 实施步骤

## Task 1. Recovery Window Helper

### 目标
新增 recovery actor 查询 helper。

### 建议实现
- 基于 `DecisionJob.intent_class`
- 读取最近窗口（例如 cooldownTicks 或独立 recoveryTicks）
- 解析 `request_input.agent_id`

### 验收
- 能稳定返回“最近处于 replay/retry 恢复态的 actor 集合”

---

## Task 2. Candidate Evaluation 加 suppression

### 目标
在 scheduler evaluation 流程中加入：

- replay recovery window suppress periodic
- retry recovery window suppress periodic

### 位置建议
在：
- pending_workflow 检查之后
- periodic cooldown 检查之前或之后

建议顺序要明确，避免 skip reason 冲突。

### 验收
- actor 在 recovery window 内不会继续创建 periodic cadence job
- event-driven candidate 第一版保持可运行

---

## Task 3. Skip Reason / Summary 扩展

### 目标
补充：
- `replay_window_suppressed`
- `retry_window_suppressed`

并确保它们进入：
- run summary
- candidate decision snapshot
- summary projection

### 验收
- `/api/runtime/scheduler/summary` 能看到 suppression 相关 skipped reason 统计

---

## Task 4. e2e 验证

### 建议覆盖

#### 场景 A：replay submit 后 suppress periodic
- 先制造 replay recovery job
- 再运行 scheduler
- 断言 periodic 不再创建
- 断言 skip reason = `replay_window_suppressed`

#### 场景 B：retry flow 后 suppress periodic
- 先制造 failed -> retry recovery
- 再运行 scheduler
- 断言 periodic 被 suppress
- 断言 skip reason = `retry_window_suppressed`

#### 场景 C：event-driven 仍可运行
- 在 recovery window 内产生 event signal
- 断言 event-driven candidate 仍有机会创建

---

## Task 5. 文档同步

### API
如果对外响应中的 skip taxonomy 有变化，补到 `docs/API.md`

### ARCH
补充：
- scheduler 现已具备 recovery-window-aware suppression baseline

### TODO / 记录
更新当前阶段状态与验证快照

---

## 6. 风险控制

### 风险 1：suppression 过强导致系统“假死”

控制：
- 第一版只 suppress periodic
- 不先 suppress event-driven

### 风险 2：skip reason 冲突

控制：
- 明确 evaluation order
- 保证同一 candidate 只有一个主 skip reason

### 风险 3：recovery window 判定过粗

控制：
- 第一版允许粗粒度时间窗
- 先验证行为正确，再细化 watermark / per-actor suppression policy

---

## 7. 验收标准

完成后应满足：

1. scheduler 能识别 replay / retry recovery actors
2. replay / retry recovery window 内 periodic cadence 会被 suppress
3. suppression 会形成结构化 skip reason
4. scheduler summary / trends 可观察到 suppression 结果
5. e2e 能覆盖 replay suppress / retry suppress / event-driven survives 三类场景

---

## 8. 结论

这一步是把当前已完成的：

- intent_class 语义层
- summary/trend 观测层

进一步推进到：

- **真正的 replay-aware scheduling policy 层**

它不会一次把 scheduler 变成复杂 DSL 系统，但会显著提升：

- runtime 行为合理性
- operator 可解释性
- future multi-worker / partitioned scheduling 的可扩展性
