# 单世界包多实体并发请求设计

## 1. 背景

当前运行时已经具备以下基础：

- 单 `active pack` 前提下的 world runtime；
- `simulation_loop.ts` 负责串行推进虚拟时钟；
- scheduler 已具备 partition、ownership、lease、rebalance、observability 基线；
- `DecisionJob` / `ActionIntent` 已具备 claim + lock + lease + retry 基础；
- scheduler 已有一定程度的 actor 级去重与 `pending_workflow` 抑制语义。

但当前仍存在明显限制：

- runtime loop 仍以“时钟推进 → scheduler → decision runner → action dispatcher”的串行阶段执行；
- decision runner / action dispatcher 在单进程内仍以顺序 `for` 循环消费；
- 并发约束主要落在 partition 与 job/intent 级别，尚未形成清晰的**实体级并发契约**；
- 在虚拟时钟下，尚未正式定义“一个 tick 内允许多少实体活动、一个实体能否重复激活、如何限制高频 actor 抢占”等策略；
- 数据库竞争当前只由保守默认值间接控制，缺少正式的策略声明。

`TODO.md` 第四阶段要求在不进入多世界包并行之前，先完成**单世界包内的多实体并发请求**。这意味着本阶段目标不是做多 pack runtime，而是：

> 在保持单 active pack、pack 级虚拟时钟一致性的前提下，使不同实体的 workflow 可以受控并发执行，同时保证同实体冲突可控、重试恢复明确、观测面完整。

---

## 2. 设计目标

### 2.1 目标

1. 保持**单 active pack**前提不变；
2. 保持**pack 级虚拟时钟串行推进**不变；
3. 允许**不同实体**在同一 tick 窗口内并发进入 decision / action 工作流；
4. 给出明确的**实体级活动约束模型**；
5. 延续并强化现有 scheduler partition / lease / ownership / claim / lock 机制；
6. 为部署者 / world pack 开发者提供**保守默认值 + 可调配置**，而不是把数据库与并发策略硬编码死；
7. 提供可回溯的失败恢复与 observability 方案。

### 2.2 非目标

1. 本阶段**不引入多世界包同时运行**；
2. 本阶段**不改变 active pack route contract**；
3. 本阶段**不把 `SimulationManager` 升级为多 pack runtime registry**；
4. 本阶段**不要求同一实体内部开放多条 writer workflow 真并发**；
5. 本阶段**不强制规定世界包必须使用哪种数据库**。

---

## 3. 关键约束

### 3.1 保持单 pack 语义边界

当前系统在 API、plugin runtime、projection、route context 等方面都默认单 active pack。第四阶段只在该前提内扩大吞吐，不改变 pack 级隔离结构。

### 3.2 虚拟时钟仍由单 loop 推进

`simulation_loop.ts` 的核心语义仍然是：

- 每轮 loop 先推进一次虚拟时钟；
- scheduler / decision / action 的运行都基于该轮时钟快照；
- 不在多个线程/worker 中同时推进 pack clock。

因此本阶段允许的并发是：

- **实体 workflow 的执行并发**；
- 不是 **clock mutation 并发**。

### 3.3 数据库不做平台强绑定承诺

本阶段不把“数据库竞争如何处理”强行内嵌为世界包语义约束，而采用以下立场：

- 平台提供**保守默认实现**，保证开箱即用；
- 平台暴露**明确配置项**，允许部署者 / world pack 开发者根据自身数据库能力调优；
- 平台不要求世界包开发者只能使用特定数据库；
- 并发度、lease 时长、batch limit、runner concurrency 等都视为**runtime host policy**，而不是世界规则的一部分。

换言之：

> 内核负责提供安全保守的 baseline，不负责替世界包作者决定最终的数据库吞吐策略。

---

## 4. 当前实现现状摘要

## 4.1 Simulation loop

当前 loop 基本结构：

1. `context.sim.step()`
2. `runAgentScheduler()`
3. `runDecisionJobRunner()`
4. `runActionDispatcher()`

该流程整体串行。

## 4.2 Scheduler 基础已存在

scheduler 已具备：

- partition id 与 `resolveSchedulerPartitionId(agentId)`；
- partition ownership / migration / rebalance；
- scheduler lease；
- worker runtime liveness；
- operator-facing observability。

这意味着系统已经有“把不同实体映射到不同 partition”的基础，但 runner 侧尚未把这种并发潜力释放出来。

## 4.3 Workflow 基础已存在

当前 `DecisionJob` 与 `ActionIntent` 已具备：

- runnable 列表查询；
- claim with conditional update；
- lease/lock ownership 校验；
- lock expiration 后重抢；
- retry / replay 基线。

因此，工作流层已经具备**并发执行的最小安全边界**。

## 4.4 Scheduler 已有 actor 级抑制语义

当前 scheduler 会基于以下条件跳过 actor：

- 存在 pending workflow；
- periodic cooldown；
- replay / retry recovery suppression；
- candidate limit reached。

这是实体级活动约束的雏形，但还不够正式化。

---

## 5. 核心设计结论

本阶段采用如下主结论：

### 5.1 并发模型

采用：

> **pack 级 clock 串行 + 多实体 workflow 并发 + 同实体默认 single-flight**

具体含义：

- pack 只有一个活动时钟；
- 不同实体可以在同一 tick 窗口内并发执行 decision / action；
- 同一实体默认不允许同时存在多个 active workflow writer；
- scheduler、runner、dispatcher 都要尊重该约束。

### 5.2 为什么先不开放“同实体真并发”

原因有三：

1. 同实体 decision 并发会快速引入状态快照竞争；
2. 同实体 action 并发会快速引入世界状态写入乱序；
3. 现有 memory / projection / audit / event 链条更接近单实体线性叙事。

因此，本阶段优先做：

- **多实体并发**；
- **同实体串行**。

这能明显提高吞吐，又不会过早引入复杂冲突控制。

---

## 6. 实体级活动模型

## 6.1 实体活动状态

定义概念性状态（实现上初期可由现有表推导，不强制新增持久化表）：

- `idle`：无 active workflow；
- `decision_pending`：已有待执行 decision job；
- `decision_running`：已有运行中的 decision job；
- `action_pending`：已有待 dispatch 的 action intent；
- `action_dispatching`：已有 dispatching intent；
- `recovery_window`：处于 replay / retry 抑制窗口；
- `cooldown`：处于 periodic 冷却期。

这些状态不要求全部物化为单独 read model，但必须成为正式设计语义。

## 6.2 Active workflow 定义

对实体 `actor_id` 而言，满足以下任一条件即认为存在 active workflow：

- 有 `DecisionJob.status in (pending, running, retry_waiting...)` 且归属于该 actor；
- 有 `ActionIntent.status in (pending, dispatching)` 且归属于该 actor；
- 存在显式 recovery 抑制窗口且策略要求阻止新调度。

## 6.3 Single-flight 规则

默认规则：

- 同实体同时最多 1 条 active workflow；
- 若 scheduler 发现已有 active workflow，则不再为该实体创建新 job；
- 若 runner 在 claim 后发现实体已被另一条更早工作流占用，应放弃当前执行并进入延后/释放路径。

## 6.4 优先级规则

同实体内部优先级建议：

1. retry recovery
2. replay recovery
3. event follow-up
4. periodic tick

但本阶段不建议让高优先级直接与低优先级并发共存；推荐策略是：

- 高优先级信号可**抑制**或**取代后续调度机会**；
- 不直接形成同实体多 active writer。

---

## 7. 虚拟时钟下的活动预算

TODO 明确要求“完善实体在虚拟时钟下的活动行为分配和限制机制”，因此必须引入正式 budget 概念。

## 7.1 Tick budget

定义 pack 级预算：

- 每 tick 最多新建多少 scheduler jobs；
- 每 tick 最多执行多少 decision jobs；
- 每 tick 最多 dispatch 多少 action intents；
- 每 tick 最多扫描多少 candidate actors。

该 budget 属于 host runtime policy，而非业务语义。

## 7.2 Entity budget

定义实体级预算：

- 每实体每 tick 最多激活 1 次；
- 每实体默认最大 active workflow 数 = 1；
- event-driven signal 可合并，不直接生成多个并发 job；
- periodic cooldown 继续作为轻量节流手段。

## 7.3 为什么必须有 budget

如果没有 budget，则单 tick 内可能出现：

- 大量 actor 同时入队；
- decision jobs 过量堆积；
- wall-clock 执行时间暴涨；
- 虚拟时钟推进明显滞后；
- 某些热点实体不断重试占满吞吐。

因此“并发”必须是**受控并发**，而非“尽可能多地同时跑”。

---

## 8. Scheduler 设计调整

## 8.1 保持 partition 作为并发分区基础

继续沿用：

- `resolveSchedulerPartitionId(agentId)`
- partition ownership
- lease
- rebalance

这样“不同实体分散到不同 partition”已经有可扩展基础。

## 8.2 Scheduler 仍负责创建工作，而不直接执行工作

scheduler 的职责继续限定为：

- 扫描候选 actor；
- 评估 readiness；
- 产生 `DecisionJob`；
- 记录 candidate decision observability。

不把 scheduler 演化成“直接跑 inference 的执行器”。

## 8.3 Readiness 语义正式化

在现有 `evaluateSchedulerActorReadiness()` 基础上，正式收口为以下检查链：

1. 是否超过本轮 candidate scan budget；
2. 实体是否已存在 active workflow；
3. 是否处于 replay / retry recovery window；
4. periodic 是否命中 cooldown；
5. 是否已达到实体 per-tick activation budget；
6. 是否命中相同 idempotency / duplicate signal 合并规则。

## 8.4 Signal 合并原则

对于同实体的多个 follow-up signal：

- 优先合并为一个 candidate；
- 保留主 reason + secondary reasons；
- 观测面保留 coalesced 次数；
- 不因多信号直接生成多条并发 writer job。

---

## 9. Runner 并发模型

## 9.1 Decision runner

当前 `runDecisionJobRunner()` 为顺序消费。调整目标：

- 保留 `listRunnableDecisionJobs` → `claimDecisionJob` 的模式；
- 引入**受限并发池**；
- 并发上限由 runtime config 提供；
- 每个 job 仍通过 DB claim + lock ownership 保证单一执行者。

建议模型：

1. 查询一批 runnable jobs；
2. 对每个 job 尝试 claim；
3. claim 成功后放入并发池；
4. 并发执行 `executeDecisionJob`；
5. 成功或失败后按现有路径释放锁 / 更新状态。

## 9.2 Action dispatcher

当前 `runActionDispatcher()` 同样为顺序消费。调整目标：

- 结构与 decision runner 对齐；
- 引入独立 concurrency 配置；
- 并发度初始值应比 decision runner 更保守。

原因：

- action dispatch 更可能写事件、memory、projection、副作用记录；
- 对底层存储写压力通常更高。

## 9.3 Runner 并发不改变 claim 语义

即使 runner 改成并发池，也不改变以下原则：

- list 只是候选发现；
- 真正执行资格以 claim 成功为准；
- lock ownership 是最终执行合法性依据；
- lock expiration 后允许重新 claim。

这能保证多 worker / 多并发执行仍然安全。

---

## 10. 实体级冲突控制

## 10.1 第一阶段采用软性实体锁语义

本阶段建议先不新增全新的“entity lock”持久化表，而采用：

- scheduler 侧以 active workflow 查询做前置抑制；
- runner 侧在 claim 成功后再做一次实体级复核；
- 若发现同实体已有更早 active writer，则当前工作项退出执行。

这样能先建立契约，而不立刻引入新的底层协调表。

## 10.2 冲突判定口径

同实体冲突的最小口径：

- 该实体已有 `running DecisionJob`；
- 该实体已有 `dispatching ActionIntent`；
- 该实体已有更早创建且仍 active 的 writer workflow。

## 10.3 冲突处理策略

建议优先采用：

- **释放当前 lock 并延后重试**，而不是直接失败；
- 记录明确 observability reason，例如：
  - `entity_conflict_active_decision`
  - `entity_conflict_dispatching`
  - `entity_single_flight_suppressed`

这有利于后续判断是否需要升级为显式实体锁表。

---

## 11. 幂等与重试设计

## 11.1 延续现有 job idempotency 模型

当前 scheduler job idempotency key 形式：

- `sch:${agentId}:${tick}:${kind}:${reason}`

本阶段暂不扩大该 key 维度，避免过早让 signal lineage 与多并发语义耦合复杂化。

## 11.2 幂等的作用边界

幂等 key 负责：

- 避免同 actor 同 tick 同 reason 的重复入队；
- 配合 scheduler signal 合并抑制重复 workflow。

幂等 key 不负责：

- 解决所有实体级顺序冲突；
- 表达复杂的“同实体多 writer 并发”图景。

## 11.3 重试策略

失败工作项继续沿用现有：

- lease 过期可重抢；
- retry / replay 恢复窗口；
- next retry tick；
- recovery suppression。

新增要求：

- 区分“执行失败”和“实体冲突延后”；
- 对实体冲突类延后，不计入真正失败统计，或至少单独统计。

---

## 12. 数据库与部署策略声明

## 12.1 平台责任边界

平台负责：

- 提供保守可运行的默认数据库 / 并发配置；
- 提供 claim / lease / retry / batch / concurrency 的正式配置项；
- 提供 observability，帮助部署者发现数据库竞争与吞吐瓶颈；
- 保证在保守默认值下行为正确。

平台不负责：

- 强制规定世界包开发者必须使用哪种数据库；
- 假定所有部署环境都具有相同写吞吐；
- 为特定世界包自动决定最佳并发度。

## 12.2 世界包开发者 / 部署者责任边界

世界包开发者或部署者负责：

- 根据自身 pack 规模、事件密度、推理频率、数据库能力调整配置；
- 选择更保守或更激进的 runner concurrency / batch limit / lease ticks；
- 在自定义数据库环境下承担吞吐调优责任。

## 12.3 文档表述原则

后续文档应明确表达：

> 系统提供保守默认策略与调优入口；当部署者选择不同数据库或更高负载世界包时，应自行评估并发参数与底层数据库能力匹配关系。

---

## 13. 建议新增配置

以下配置建议全部归入 runtime config，而不是硬编码：

```yaml
scheduler:
  entity_concurrency:
    default_max_active_workflows_per_entity: 1
    max_entity_activations_per_tick: 1
    allow_parallel_decision_per_entity: false
    allow_parallel_action_per_entity: false
    event_followup_preempts_periodic: true

  tick_budget:
    max_created_jobs_per_tick: 32
    max_executed_decisions_per_tick: 16
    max_dispatched_actions_per_tick: 16

  runners:
    decision_job:
      batch_limit: 16
      concurrency: 4
      lock_ticks: 5

    action_dispatcher:
      batch_limit: 8
      concurrency: 2
      lock_ticks: 5
```

### 13.1 配置原则

- 默认值偏保守；
- 允许 env / yaml override；
- 所有高吞吐参数都应清晰出现在 runtime config snapshot 中；
- 文档中应给出“SQLite 保守值”和“更强数据库/更大包体的调优示例”。

---

## 14. Observability 设计

为了让并发运行可调试，必须扩充观测面。

## 14.1 Scheduler 指标

建议补充：

- 每 tick 创建 job 数；
- 每 partition 创建 job 数；
- actor 级 skip reason 分布；
- `pending_workflow` / `periodic_cooldown` / `limit_reached` 命中率；
- signal coalesced 计数；
- 热点 actor / 热点 partition 摘要。

## 14.2 Decision runner 指标

建议补充：

- claim success / fail 数；
- 当前并发执行数；
- 平均与分位执行耗时；
- retry / replay 触发数；
- 实体冲突延后次数；
- lock 失效 / ownership 校验失败次数。

## 14.3 Action dispatcher 指标

建议补充：

- claim success / fail 数；
- 当前 dispatch 并发数；
- completed / failed / dropped 分布；
- memory record / compaction 路径耗时；
- 实体冲突延后次数。

## 14.4 Worker / lease / migration 指标

建议补充：

- 续租失败数；
- migration backlog；
- stale / suspected_dead worker 影响分区数；
- rebalance recommendation → migration → assignment applied 的链路计数。

---

## 15. 失败恢复设计

## 15.1 失败类型拆分

建议把失败至少拆为：

1. 执行异常（inference / dispatch 实际失败）；
2. lock ownership 失效；
3. claim 竞争失败；
4. 实体 single-flight 冲突；
5. worker lease / partition ownership 失效。

## 15.2 恢复策略

- 执行异常：按现有 retry / replay 路径；
- claim 竞争失败：静默跳过即可；
- ownership 失效：立即退出当前分区工作；
- 实体冲突：延后，不视为业务失败；
- worker stale/dead：交由现有 ownership migration / rebalance 基线处理。

## 15.3 为什么实体冲突不应视为普通失败

因为这是吞吐控制策略的一部分，而不是世界语义失败。若把这类情况混进普通失败指标，会导致：

- 误判世界包逻辑异常；
- 无法区分真正执行故障与设计性限流。

---

## 16. 分阶段落地计划

## 阶段 A：正式化设计与配置边界

目标：

- 确认“多实体并发、同实体 single-flight”作为阶段目标；
- 明确数据库责任边界与配置化原则；
- 补 runtime config schema 与文档草案。

## 阶段 B：Runner 并发池化

目标：

- `runDecisionJobRunner()` 改为受限并发；
- `runActionDispatcher()` 改为受限并发；
- 保持现有 claim / lock / ownership 契约不变。

## 阶段 C：实体级活动约束补强

目标：

- scheduler readiness 正式接入 entity budget / single-flight 语义；
- runner 增加 claim 后实体级复核；
- 为冲突延后添加专用 observability 分类。

## 阶段 D：观测与调优

目标：

- 扩展 scheduler/operator 观测指标；
- 给部署者补保守默认值与调优建议；
- 根据不同数据库和世界包负载进行经验性调参。

---

## 17. 兼容性影响

## 17.1 对世界包语义的影响

理论上不改变世界规则语义；变化主要体现为：

- 不同实体的 workflow 吞吐提升；
- 热点实体会更明确地受到活动预算限制；
- 某些过去因顺序执行而自然串行的行为，现在变成“多实体并发但同实体仍串行”。

## 17.2 对 API / route contract 的影响

本阶段不需要修改 pack route / active pack API contract。

## 17.3 对部署默认值的影响

会新增更多 runtime config 项，但默认值应保持保守，从而不破坏现有部署基线。

---

## 18. 风险与缓解

### 风险 1：数据库写竞争增加

缓解：

- 默认低并发；
- 并发度全部配置化；
- 通过观测指导部署者调优；
- 不把高并发作为默认行为。

### 风险 2：同实体状态乱序

缓解：

- 默认 single-flight；
- scheduler 与 runner 双重实体级检查；
- 冲突延后而不是直接双写执行。

### 风险 3：单 tick wall-clock 过长

缓解：

- 引入 tick budget；
- 区分 batch limit 与 concurrency；
- 允许部署者根据数据库能力调小吞吐。

### 风险 4：观测不足导致难以调试

缓解：

- 增加 actor / partition / runner / worker 多层指标；
- 单独统计 single-flight conflict 与 DB claim miss。

---

## 19. 本阶段最终结论

本设计建议将“单世界包内的多实体并发请求”正式定义为：

> 在单 active pack 和单 pack 虚拟时钟串行推进不变的前提下，允许不同实体的 decision / action workflow 受控并发执行；同一实体默认保持 single-flight；所有并发度、budget、lease、batch、runner 参数均通过 runtime config 暴露，并以保守默认值交付，最终数据库竞争与吞吐调优由世界包开发者 / 部署者根据实际环境负责。

该方案的优点是：

- 与现有 scheduler partition / lease / ownership / claim 体系兼容；
- 不提前引入多 pack 复杂度；
- 明确了实体级并发契约；
- 对数据库选择保持开放，只提供保守默认值与调优入口；
- 为后续多世界包并行奠定更稳定的执行模型。

---

## 20. 后续实现建议

实现顺序建议为：

1. 先补 runtime config 与文档 contract；
2. 再改 decision/action runner 的并发池；
3. 再补 scheduler / runner 的实体级 single-flight 复核；
4. 最后补 observability 与部署调优文档。
