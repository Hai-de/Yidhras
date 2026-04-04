## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 梳理并冻结 Agent Scheduler 首期边界与设计来源  `#p1`
- [x] 新增 Agent Scheduler runtime/service 模块并实现 active agent 扫描  `#p2`
- [x] 实现去重、cooldown 与 scheduler idempotency key 生成  `#p3`
- [x] 将 scheduler 接入 simulation loop 并打通 DecisionJob 提交链路  `#p4`
- [x] 补充 e2e/脚本验证与必要文档同步  `#p5`
<!-- LIMCODE_TODO_LIST_END -->

# Agent Scheduler 首期开发计划

> Source Design: `.limcode/design/agent-scheduler-design.md`

## 1. 目标

在不大幅改动现有 workflow 基线的前提下，引入首期正式 `Agent Scheduler`，让 runtime loop 能自动为合格 actor 生成 `DecisionJob`，从而打通：

- tick 推进
- 自动调度
- decision job 消费
- action intent 派发
- world mutation 落地

本计划聚焦 **Phase 1 / 首期最小可落地版本**，强调：

- 幂等
- 去重
- cooldown
- 可解释
- 低风险集成

---

## 2. 交付范围

### 2.1 本期包含

1. 新增 runtime 侧 `runAgentScheduler()`
2. 扫描 `Agent.type = "active"` 的候选 actor
3. 基于现有 workflow 状态做去重
4. 基于最近调度 tick 做 cooldown 控制
5. 自动创建 `DecisionJob(status=pending, job_type=inference_run)`
6. 在 `request_input.attributes` 中注入 scheduler 元信息
7. 将 scheduler 接入 `simulation_loop.ts`
8. 补齐至少一条验证脚本 / e2e 脚本

### 2.2 本期不包含

1. world-pack scheduler DSL
2. 多 worker scheduler lease
3. 调度专属 API
4. atmosphere / noise actor 调度
5. 事件驱动复杂优先级调度
6. 新 Prisma 表或大规模 schema 重构

---

## 3. 实施步骤

## Step A. 冻结调度输入输出契约

### 目标

在编码前先固定首期 scheduler 的内部最小契约，避免中途扩散。

### 具体事项

- 明确 scheduler 运行函数签名
- 明确候选 actor 最小数据结构
- 明确 scheduler request_input 结构
- 明确 scheduler attributes 命名
- 明确 cooldown 默认值来源

### 建议产物

- `runAgentScheduler(options)`
- `ScheduledInferenceAttributes`
- `SchedulerReason = 'periodic_tick' | 'bootstrap_seed'`

### 验收

- 所有新增 helper 的输入输出可在 TS 层清晰表达
- 不依赖 route 层或前端 contract 才能推进实现

---

## Step B. 新增 scheduler 服务与 runtime 入口

### 目标

在 runtime 中加入独立 scheduler 模块，而不是把逻辑散落到 `simulation_loop.ts` 或 `SimulationManager.step()`。

### 建议文件

- 新增 `apps/server/src/app/runtime/agent_scheduler.ts`
- 可选新增 `apps/server/src/app/services/agent_scheduler.ts`

### 具体事项

- 提供 `runAgentScheduler()` 主入口
- 提供候选 actor 查询 helper
- 提供调度结果统计输出，例如：
  - scanned_count
  - eligible_count
  - created_count
  - skipped_pending_count
  - skipped_cooldown_count

### 验收

- scheduler 逻辑可独立调用
- runtime loop 以单个步骤方式接入，不污染其他模块职责

---

## Step C. 实现 active agent 扫描

### 目标

建立首期候选 actor 集，只处理最核心对象。

### 具体事项

- 从 Prisma 查询 `Agent.type = 'active'`
- 如实现成本可控，可过滤明显不可调度对象
- 保持查询结果结构足够轻量，避免一次性拉太多无关字段

### 建议 helper

- `listSchedulableAgents(context)`

### 验收

- scheduler 仅对 active agent 生效
- 不影响 `noise` / `system` actor

---

## Step D. 实现 workflow 去重判断

### 目标

保证 scheduler 不会为已有未完成 workflow 的 actor 重复塞任务。

### 去重规则

对单个 agent 调度前检查：

1. 是否存在 `DecisionJob.status in ('pending','running')`
2. 是否存在未完成 `ActionIntent.status in ('pending','dispatching')`

### 实现建议

- 尽量复用现有 workflow 数据结构
- 如需要可新增小型 service helper
- 首期可通过 `request_input.agent_id` 与 `actor_ref.agent_id` 做匹配

### 建议 helper

- `hasPendingWorkflowForAgent(context, agentId)`

### 风险提示

由于当前 `DecisionJob` 没有单独的 `actor_id` 冗余列，查询可能需要基于 `request_input` 或 trace/intent 关联做折中实现。

### 验收

- 已有 pending/running job 的 agent 不再重复创建 job
- 已有 pending/dispatching intent 的 agent 不再重复创建 job

---

## Step E. 实现 cooldown 规则

### 目标

避免同一 agent 在连续 tick 中被频繁调度。

### 默认策略

- 初始固定常量，例如 `DEFAULT_AGENT_SCHEDULER_COOLDOWN_TICKS = 3n`
- 后续再扩展到 world-pack 配置

### 判定基准

优先采用：

- 最近由 scheduler 创建的 job 的 `created_at`

必要时可回退到：

- 最近 trace tick

### 建议 helper

- `getLastScheduledTickForAgent(context, agentId)`
- `isAgentInSchedulerCooldown(now, lastScheduledTick, cooldownTicks)`

### 验收

- 同一 agent 在 cooldown 窗口内不会反复产生 scheduler job
- cooldown 逻辑不影响手动提交 job

---

## Step F. 生成 scheduler request_input 与 idempotency key

### 目标

把调度行为纳入现有工作流链路，并保留清晰来源信息。

### request_input 建议结构

```ts
{
  agent_id,
  strategy: 'rule_based',
  idempotency_key,
  attributes: {
    scheduler_source: 'runtime_loop',
    scheduler_kind: 'periodic',
    scheduler_reason: 'periodic_tick',
    scheduler_tick: '<tick>'
  }
}
```

### idempotency key 规则

建议：

- `sch:<agent_id>:<tick>:periodic`

### 建议 helper

- `buildScheduledInferenceRequestInput(agentId, tick, reason)`
- `buildSchedulerIdempotencyKey(agentId, tick, kind)`

### 验收

- 新 job 可通过 `request_input.attributes.scheduler_*` 区分来源
- 同 tick 重复执行 scheduler 时不会制造重复 job

---

## Step G. 复用现有 workflow 提交链路创建 DecisionJob

### 目标

避免 scheduler 绕开现有 workflow 基础设施。

### 推荐方案

新增内部 helper，而不是直接从 runtime 手写 Prisma create：

- 可选位置：`apps/server/src/app/services/inference_workflow.ts`
- 可选能力：`createScheduledDecisionJob()` 或 `submitScheduledInferenceJob()`

### 原因

- 能统一 `DecisionJob` 创建语义
- 能保持后续 replay/retry 扩展一致
- 避免 runtime 层直接操作过多 workflow persistence 细节

### 验收

- scheduler 产出的 job 能被现有 `runDecisionJobRunner()` 正常消费
- 不引入新的临时旁路数据流

---

## Step H. 接入 simulation loop

### 目标

让 scheduler 成为 runtime loop 的正式步骤。

### 修改点

文件：`apps/server/src/app/runtime/simulation_loop.ts`

### 调整顺序

当前：

1. expire bindings
2. sim.step
3. decision job runner
4. action dispatcher

调整后：

1. expire bindings
2. sim.step
3. agent scheduler
4. decision job runner
5. action dispatcher

### 验收

- loop 每轮会先产生新 job，再消费 job
- 不破坏已有 runtime pause / error handling 机制

---

## Step I. 增加验证脚本与回归检查

### 目标

确保首期 scheduler 不是“代码存在但闭环未验证”。

### 建议新增验证

优先新增一个可执行脚本，例如：

- `apps/server/src/e2e/agent_scheduler.ts`

验证内容至少包括：

1. 初始化 runtime
2. loop 或 scheduler 单次运行后，产生 scheduler job
3. 同一 tick 再运行一次，不产生重复 job
4. 在 cooldown 窗口内不重复创建 job
5. scheduler job 可被 job runner 消费

### 可选补充

- 若已有 workflow locking/replay 风格脚本可复用，可沿用同样模式

### 验收

- 存在至少一条可执行验证路径
- 验证结果可纳入后续 `记录.md`

---

## Step J. 文档同步

### 目标

在实现完成后同步必要文档，但不提前污染稳定文档。

### 首期建议更新

实现完成后再视落地范围更新：

- `TODO.md`
- `记录.md`
- 如形成稳定运行边界，再更新：
  - `docs/ARCH.md`
  - `docs/LOGIC.md`
  - `docs/API.md`（仅当出现对外 API 变化时）

### 注意

本轮开发前不先改稳定 docs；先以 `.limcode/design/` + `.limcode/plans/` 为依据推进实现。

---

## 4. 建议改动文件清单

### 高优先级新增文件

- `apps/server/src/app/runtime/agent_scheduler.ts`
- `apps/server/src/e2e/agent_scheduler.ts`

### 高优先级修改文件

- `apps/server/src/app/runtime/simulation_loop.ts`
- `apps/server/src/app/services/inference_workflow.ts`
- `apps/server/src/inference/service.ts`（仅在需要内部 helper 暴露时）

### 可选新增/修改文件

- `apps/server/src/app/services/agent_scheduler.ts`
- `apps/server/src/inference/types.ts`（若需补 scheduler 内部类型）
- `TODO.md`
- `记录.md`
- `docs/ARCH.md`
- `docs/LOGIC.md`

---

## 5. 风险控制

### 风险 1：扫描逻辑过重

如果 scheduler 为每个 agent 都做多次独立数据库查询，loop 开销会快速升高。

**控制方式：**
- 首期优先小规模、简单查询
- 必要时分步缓存/批量化
- 先保证正确性，再优化查询批次

### 风险 2：request_input 过滤不稳定

当前去重若依赖 `request_input.agent_id`，需要确保所有 scheduler job 都按统一结构写入。

**控制方式：**
- 统一由 helper 构建 scheduler request_input
- 避免 runtime 层手拼 JSON

### 风险 3：与手动提交语义冲突

scheduler job 与手动提交 job 若无法区分，会影响 audit/operator 理解。

**控制方式：**
- 强制注入 `scheduler_*` attributes
- 统一 idempotency key 前缀 `sch:`

### 风险 4：loop 一接入就产生大量任务

如果 seed 数据较多，scheduler 接入后可能瞬间塞满 queue。

**控制方式：**
- 首期限制每轮调度上限，例如 `limit = 5`
- 后续再扩展到配置化

---

## 6. 完成定义（Definition of Done）

完成本计划时，应满足：

1. runtime loop 中已正式接入 `runAgentScheduler()`
2. active agent 能自动被调度为 `DecisionJob`
3. scheduler 具备幂等 key、pending workflow 去重、cooldown 控制
4. 新 job 的 `request_input.attributes` 能表达调度来源与原因
5. 现有 decision runner / action dispatcher 能无缝消费 scheduler 产物
6. 至少一条 e2e 或脚本验证可运行
7. 设计与计划文档可作为后续 Phase 2 扩展基础

---

## 7. 执行建议顺序

建议实际编码顺序如下：

1. 先写 scheduler 内部类型与 helper
2. 再实现 active agent 扫描
3. 再做 pending workflow 去重
4. 再做 cooldown
5. 再接 workflow 提交 helper
6. 再接入 simulation loop
7. 最后补 e2e 验证与文档同步

这样可以最大程度减少调试面，并保证每一步都可单独验证。
