# Agent Scheduler 设计

## 1. 背景

当前后端已经具备以下工作流基线：

- `InferenceTrace / ActionIntent / DecisionJob` 持久化已存在
- `runDecisionJobRunner()` 负责消费可运行的 `DecisionJob`
- `runActionDispatcher()` 负责消费可派发的 `ActionIntent`
- `simulation_loop.ts` 已经将 runtime tick、job runner、dispatcher 串联起来
- `InferenceService.submitInferenceJob()` 已支持手动提交任务、幂等 key、retry、replay

但当前系统缺少一个正式的 **Agent Scheduler**：

- 没有一个一等公民模块负责“谁应该在当前 tick 被调度”
- `SimulationManager.step()` 仍只推进时钟，没有真实的自治调度逻辑
- 当前 runtime 更像“任务消费器”，而不是“自治模拟器”

因此需要引入一个专门的调度模块，将“运行时世界推进”与“推理任务生成”正式连接起来。

---

## 2. 目标

Agent Scheduler 的首期目标不是做复杂 AI 行为，而是建立一个 **稳定、可解释、幂等、可扩展** 的调度基线。

### 2.1 首期目标

1. 在 runtime loop 中引入正式的 scheduler 步骤
2. 按当前 tick 与候选 actor 状态，自动创建 `DecisionJob`
3. 避免同一 actor 在短时间内被重复提交过多同类任务
4. 为后续 replay、audit、operator 视图提供清晰的调度原因
5. 为未来 event-driven / policy-driven / world-pack-driven 调度留下扩展点

### 2.2 非目标

首期不直接实现：

- 复杂多级调度优先级系统
- 完整多 worker 分布式调度协议
- 复杂 world-pack scheduler DSL
- 面向前端的完整 scheduler 管理 API
- 所有 agent 自主目标规划算法

---

## 3. 架构定位

### 3.1 模块位置

建议新增以下模块：

- `apps/server/src/app/runtime/agent_scheduler.ts`
- 如有必要，再补：
  - `apps/server/src/app/services/agent_scheduler.ts`
  - `apps/server/src/app/services/agent_scheduler_policy.ts`

其中：

- `app/runtime/agent_scheduler.ts`
  - 面向 runtime loop
  - 负责一次调度扫描与任务投递
- `app/services/*`
  - 承载候选 actor 选择、去重、调度理由计算等业务逻辑

### 3.2 在 runtime 中的位置

当前 loop：

1. expire identity bindings
2. `sim.step()`
3. `runDecisionJobRunner()`
4. `runActionDispatcher()`

建议调整为：

1. expire identity bindings
2. `sim.step()`
3. `runAgentScheduler()`
4. `runDecisionJobRunner()`
5. `runActionDispatcher()`

这样运行时就形成闭环：

- tick 推进
- scheduler 发现应激活 actor
- 生成 `DecisionJob`
- decision runner 生成 `InferenceTrace + ActionIntent`
- dispatcher 落地 world mutation

---

## 4. 首期调度模型

### 4.1 调度对象

首期调度对象建议只覆盖：

- `Agent.type = "active"` 的 agent
- 可选：绑定了有效 `IdentityNodeBinding(role=active,status=active)` 的 actor

暂不优先调度：

- `noise`
- `system`
- atmosphere node 的复杂自治行为

这样可以先把主 actor 闭环做通。

### 4.2 调度输入

每次 scheduler 执行时，主要输入包括：

- `current_tick`
- agent 基本信息（id / type / snr / is_pinned）
- 可用 identity/binding 信息
- 最近 workflow 状态
- 最近事件 / post / relationship 变化（首期可只读取最小信号）
- 当前世界包基础配置

### 4.3 调度输出

输出为新的 `DecisionJob` 记录，最小字段包括：

- `job_type = "inference_run"`
- `status = "pending"`
- `request_input`
  - `agent_id`
  - 可选 `identity_id`
  - `strategy`
  - `attributes`
  - `idempotency_key`

同时建议在 `request_input.attributes` 中注入首期调度元信息，例如：

- `scheduler_reason`
- `scheduler_tick`
- `scheduler_kind`（如 `periodic` / `event_driven`）

首期先不新增 schema 字段，也能把调度解释信息打进现有 workflow 链路。

---

## 5. 幂等与去重策略

这是首期最关键的设计点。

### 5.1 问题

如果每个 tick 都为每个 active agent 提交一个 job，会出现：

- 队列膨胀
- 重复推理
- 调度解释混乱
- audit 噪音严重

### 5.2 首期规则

对每个 agent，调度前检查：

1. 是否已存在未完成 job：
   - `pending`
   - `running`
2. 是否已存在未完成 intent：
   - `pending`
   - `dispatching`
3. 是否在最近 `cooldown_ticks` 内刚被调度过

只有在上述条件均允许时，才创建新 job。

### 5.3 cooldown 规则

建议首期采用简单规则：

- 默认 `cooldown_ticks = 3 ~ 10`（可从 world pack 或常量提供）
- 依据最近 job 的 `created_at` 或最近 trace 的 tick 判断

这能保证系统先稳定运行，再逐步引入更细的优先级和事件触发。

### 5.4 idempotency key 生成

建议由 scheduler 统一生成：

`sch:<agent_id>:<tick>:<kind>`

例如：

- `sch:agent_001:1234:periodic`

作用：

- 防止同一次调度重复提交
- 保持 replay / audit 上下文清晰
- 便于 operator 识别任务来源

---

## 6. 候选 actor 选择策略

### 6.1 首期候选集合

首期可以非常简单：

- 从 `Agent` 中筛选 `type = "active"`
- 可选追加：排除明显不可调度对象
  - 已失效绑定
  - 最近有失败且未到重试窗口的对象（可后置）

### 6.2 后续可扩展方向

后续可以逐步扩展为以下信号综合：

- 最近是否收到事件影响
- 最近关系是否变动
- 最近是否发帖/触发动作
- SNR 阈值
- world-pack 中配置的 actor cadence
- 某些 agent 是否因剧情状态进入“高活跃期”

但这些不必在首期一次性实现。

---

## 7. 调度理由模型

为了让 scheduler 可观测、可解释，首期就应明确 reason 模型。

建议 reason 至少规范为：

- `periodic_tick`
- `bootstrap_seed`
- `event_followup`
- `relationship_change_followup`
- `operator_forced`（未来）

首期实现至少支持：

- `periodic_tick`
- `bootstrap_seed`

这些值可写入：

- `DecisionJob.request_input.attributes.scheduler_reason`
- audit 展示时可从 request_input 中解析

---

## 8. 与现有模块的集成

### 8.1 与 `simulation_loop.ts`

增加：

- `runAgentScheduler({ context, inferenceService? })`

该步骤位于 `runDecisionJobRunner()` 之前。

### 8.2 与 `InferenceService`

首期不要求修改现有 `submitInferenceJob()` 对外接口；scheduler 可以：

- 直接复用 `createPendingDecisionJob()`
- 或新增一层内部 helper，例如 `submitScheduledInferenceJob()`

更推荐后者，因为可以：

- 封装 scheduler idempotency key 生成
- 统一调度 attributes 结构
- 复用未来 schedule reason / source 分类

### 8.3 与 `Audit / Observability`

首期至少保证：

- 被 scheduler 创建的 job 与手动 API 创建的 job 可以区分
- 区分方式先通过 `request_input.attributes.scheduler_*`
- 不强制新增独立 audit kind

后续若 operator 需求增强，可新增 scheduler 专属 audit 投影。

---

## 9. 数据模型建议

### 9.1 首期：尽量少改 schema

为了快速落地，首期建议 **不新增 Prisma 表**，优先复用：

- `DecisionJob`
- `InferenceTrace`
- `ActionIntent`

调度附加元信息放进：

- `DecisionJob.request_input.attributes`

优点：

- 风险小
- 改动集中
- 不阻塞开发

### 9.2 二期可选 schema 扩展

如果后续 scheduler 复杂度提升，再考虑新增：

#### `SchedulerLease` / `SchedulerCursor`
用于：
- 多 worker 协调
- 分片扫描
- last sweep tick 记录

#### `DecisionJob.scheduled_for_tick`
用于：
- 正式 durable scheduling
- 明确未来 tick 才应执行的 job

#### `DecisionJob.source_kind`
用于：
- `manual`
- `scheduler`
- `replay`
- `retry`

但这些属于后续增强，不是首期落地前置条件。

---

## 10. 首期开发切入建议

### 10.1 最小交付切片

第一批建议完成以下最小切片：

1. 新增 `runAgentScheduler()`
2. 扫描 `active` agent
3. 按去重/cooldown 规则为合格 agent 创建 `DecisionJob`
4. 将 scheduler 接入 `simulation_loop.ts`
5. 为新 job 注入统一 `scheduler_*` attributes
6. 补一条 e2e 脚本验证：运行 loop 后自动出现 scheduler 产生的 job

### 10.2 关键 helper

建议新增 helper：

- `listSchedulableAgents(context)`
- `hasPendingWorkflowForAgent(context, agentId)`
- `getLastScheduledTickForAgent(context, agentId)`
- `buildScheduledInferenceRequestInput(agentId, tick, reason)`
- `createScheduledDecisionJob(context, input)`

---

## 11. 风险与约束

### 11.1 队列爆炸风险

如果没有 cooldown 和 pending workflow 去重，scheduler 会快速制造大量冗余 job。

### 11.2 可解释性不足风险

如果调度原因不进入持久化链路，后续 operator 会分不清：

- 这个 job 是手动提交的
- 还是系统自动调度的

### 11.3 未来多 worker 风险

当前 job 侧已有 lock 机制，但 scheduler 自身还没有正式 lease/ownership 设计。

因此首期设计应明确：

- 默认单实例 runtime
- scheduler 只作为本进程 loop 内步骤
- multi-worker safety 作为后续增强项

---

## 12. 验收标准

首期 Agent Scheduler 视为完成，应满足：

1. runtime loop 运行时，active agent 能自动产出 `DecisionJob`
2. 同一 agent 不会在 cooldown 内连续产生大量重复任务
3. 已有 `pending/running` job 的 agent 不会被重复提交
4. 新 job 的 `request_input.attributes` 中可看到 scheduler 元信息
5. 现有 `runDecisionJobRunner()` 和 `runActionDispatcher()` 不需要大规模重写即可消费 scheduler 产物
6. 至少有一条后端验证脚本能证明调度闭环打通

---

## 13. 后续演进方向

首期完成后，再逐步推进：

1. event-driven scheduling
2. durable scheduling（future tick）
3. richer replay orchestration 与 scheduler reason 联动
4. world-pack 可配置 cadence / priority
5. atmosphere node / noise actor 调度
6. scheduler observability read model

---

## 14. 结论

Agent Scheduler 是当前后端从“可消费 workflow”走向“自治运行世界”的关键补口。

首期应坚持：

- 先做最小但正式的 scheduler
- 优先保证幂等、去重、可解释
- 复用现有 `DecisionJob`/`InferenceTrace`/`ActionIntent` 工作流链路
- 不在第一版过度引入复杂 schema 和 DSL

这样能以最小风险把 runtime 真正变成一个会自己推进 agent 行为的模拟系统。