# Agent Scheduler 第二阶段增强设计

## 1. 背景

Agent Scheduler v1 已经落地，并提供了最小正式调度基线：

- 扫描 `Agent.type = "active"` 的 actor
- 基于 pending workflow 去重
- 基于最近 scheduler job 的 cooldown 去重
- 在 runtime loop 中自动生成 `DecisionJob`
- 通过 `request_input.attributes.scheduler_*` 注入来源元信息
- 已有 e2e 脚本验证闭环

但 v1 仍然主要是 **固定周期调度器**，离更真实的世界运行还有三个缺口：

1. **event-driven cadence 缺失**：世界发生事件、关系变化、SNR 变化后，系统还不会优先唤起相关 actor。
2. **durable scheduled jobs 缺失**：scheduler 只能“现在创建 pending job”，还不能正式表达“未来某个 tick 才应开始执行”。
3. **scheduler observability 较弱**：虽然 request_input 中有 scheduler metadata，但缺少结构化统计与 operator 侧可读的调度结果摘要。

因此第二阶段目标是在不推翻 v1 的前提下，补上这三块关键能力。

---

## 2. 第二阶段目标

### 2.1 本期目标

1. 为 `DecisionJob` 增加正式的 `scheduled_for_tick` 调度语义
2. 让 decision runner 只消费“到时可运行”的 job
3. 在 scheduler 中新增最小 event-driven cadence：
   - event follow-up
   - relationship adjustment follow-up
   - snr adjustment follow-up
4. 给 scheduler 输出增加结构化统计，便于验证与后续 operator read model 扩展
5. 保持与当前 `InferenceTrace / ActionIntent / DecisionJob` 流水线兼容

### 2.2 非目标

本期暂不做：

- 复杂优先级队列
- 多 worker scheduler lease
- 独立 scheduler audit kind
- 前端 scheduler 管理页
- world-pack DSL 化调度策略

---

## 3. 设计总览

第二阶段保留 v1 的基础轮询逻辑，但拆成两类 cadence：

### 3.1 periodic cadence

延续 v1 行为：

- 每轮 tick 后扫描 active agent
- 满足条件则生成周期型 job
- reason 为 `periodic_tick`

### 3.2 event-driven cadence

新增由近期世界变更驱动的调度：

- 如果某个 agent 在最近 tick 内被事件影响、被关系调整命中、或被 SNR 调整命中，则优先触发 follow-up 调度
- reason 可取：
  - `event_followup`
  - `relationship_change_followup`
  - `snr_change_followup`

### 3.3 durable scheduling

新增 `DecisionJob.scheduled_for_tick` 字段：

- scheduler 创建 job 时可以直接指定未来执行 tick
- decision runner 只有在 `scheduled_for_tick <= now` 时才会 claim job
- 未到时的 job 保持 pending，但不会被执行

这能把“调度时机”和“执行时机”正式分离。

---

## 4. 数据模型变更

### 4.1 `DecisionJob` 新增字段

建议新增：

- `scheduled_for_tick BigInt?`

用途：

- 让 scheduler 能表达未来 tick 的执行窗口
- 为 durable scheduling 打基础
- 避免只能通过 `next_retry_at` 表达“未来再运行”这种语义混用

### 4.2 为什么不新增独立调度表

当前阶段还不需要 `SchedulerEvent` / `SchedulerLease` / `SchedulerCursor`：

- v1 规模仍小
- runtime 单实例假设成立
- 世界变更触发信号可先从现有表中增量读取

因此 Phase 2 仍应优先复用现有 workflow 表，避免 schema 膨胀。

---

## 5. event-driven cadence 设计

### 5.1 信号来源

优先复用当前已存在且结构清晰的世界变更表：

1. `Event`
2. `RelationshipAdjustmentLog`
3. `SNRAdjustmentLog`

### 5.2 actor 识别规则

#### 事件 follow-up

从 `Event` 中提取：

- `source_action_intent.actor_ref.agent_id`

如事件由某 actor 触发，则该 actor 可被加入 follow-up 候选。

#### relationship 调整 follow-up

从 `RelationshipAdjustmentLog` 中提取：

- `from_id`
- `to_id`

这两个 actor 都可以成为候选。

#### snr 调整 follow-up

从 `SNRAdjustmentLog` 中提取：

- `agent_id`

该 actor 可成为候选。

### 5.3 观察窗口

建议使用小窗口：

- `lookback_ticks = max(1, cooldown_ticks)`

即只关注最近若干 tick 的变化。

### 5.4 去重策略

event-driven 仍复用 v1 去重基线：

- 有 pending/running job -> 不再重复调度
- 有 pending/dispatching intent -> 不再重复调度
- 同 reason/kind 在同 tick 已有 idempotency key -> 不重复

但 event-driven 应允许在 cooldown 内覆盖 periodic cadence。换言之：

- 如果 periodic 因 cooldown 被跳过，但发生了 follow-up world signal，则允许为该 actor 创建 event-driven job

这要求 cooldown 判断区分 cadence 类型。

---

## 6. durable scheduling 设计

### 6.1 调度语义

scheduler 在创建 job 时可写入：

- `scheduled_for_tick = now + delay`

对于 periodic cadence：

- 首期可默认 `delay = 0`

对于 event-driven cadence：

- 可选做一个很小的 follow-up delay，例如 `1 tick`
- 表达“世界变化后，下一拍再思考”而不是同 tick 硬触发

### 6.2 runner 语义

`listRunnableDecisionJobs()` 需要新增约束：

- `scheduled_for_tick` 为空，或 `scheduled_for_tick <= now`

`claimDecisionJob()` 也需要补相同检查。

### 6.3 request_input 中的调度元信息

仍保留：

- `scheduler_tick`：创建该 job 的 scheduler tick
- `scheduler_reason`
- `scheduler_kind`

并增加：

- `scheduler_scheduled_for_tick`

这样不看 DB 字段也能在 workflow read 中观察调度意图。

---

## 7. scheduler observability 设计

### 7.1 运行统计扩展

`AgentSchedulerRunResult` 在 v1 基础上扩展：

- `created_periodic_count`
- `created_event_driven_count`
- `skipped_limit_count`
- `signals_detected_count`
- `scheduled_for_future_count`

### 7.2 最小日志/通知策略

本期不新增专门 API，但可考虑：

- 当本轮 scheduler 产生了 event-driven job 时，向 notification queue 推一条 info/debug 级消息
- 若一轮调度创建数异常大，可推 warning

不过这属于可选增强，不作为本期硬前置。

---

## 8. 代码结构建议

### 8.1 `agent_scheduler.ts`

建议从 v1 升级为：

- 调度主入口
- cadence 组合器
- request_input builder
- 统计聚合器

### 8.2 `inference_workflow.ts`

新增/扩展：

- `DecisionJobRecord.scheduled_for_tick`
- `createPendingDecisionJob(... scheduled_for_tick?)`
- `listRunnableDecisionJobs()` 增加 `scheduled_for_tick` 过滤
- `claimDecisionJob()` 增加 `scheduled_for_tick` 判断
- recent scheduler 查询支持按 reason/kind 检索

### 8.3 新增 scheduler signal helper

可选新增：

- `listRecentSchedulerSignals(context, sinceTick)`
- 或放进 `agent_scheduler.ts` 内部实现

建议先写在 runtime 模块附近，避免过早抽象。

---

## 9. 实施优先顺序

### 第一优先级

1. Prisma schema 增加 `DecisionJob.scheduled_for_tick`
2. runner / claim 逻辑支持 scheduled job
3. scheduler request_input 注入 scheduled tick metadata

### 第二优先级

4. 实现 event-driven signal 提取
5. 合并 periodic + event-driven cadence
6. 更新 scheduler 统计结构

### 第三优先级

7. 增强 e2e 验证
8. 同步 TODO / 记录 / 稳定文档

---

## 10. 验收标准

第二阶段完成应满足：

1. `DecisionJob` 可表达 `scheduled_for_tick`
2. decision runner 不会提前消费 future-scheduled job
3. scheduler 能基于最近世界变化生成 event-driven job
4. periodic 与 event-driven cadence 可共存且不互相制造重复任务
5. `request_input.attributes` 中能看到调度 reason / scheduled_for_tick 等元信息
6. 至少存在一条 e2e 验证脚本覆盖 future scheduling 与 event-driven follow-up

---

## 11. 结论

Agent Scheduler Phase 2 的本质，不是把 v1 推翻重做，而是让它从“会周期性唤醒 actor”进化到：

- 能根据世界变化触发 follow-up
- 能正式表达未来执行时机
- 能提供更清晰的调度可观测信息

这一步完成后，后端 runtime 会更接近真正的“自治模拟系统”，而不是简单的 tick + queue 消费器。