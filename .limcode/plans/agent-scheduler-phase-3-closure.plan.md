## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 梳理并冻结当前 Phase 3 已交付边界，明确本轮仅处理剩余收尾项  `#p3c01`
- [x] 收敛 scheduler actor readiness 评估层并统一 candidate evaluation 顺序  `#p3c02`
- [x] 整理 skip reason taxonomy 与 event coalescing explainability  `#p3c03`
- [x] 加固 scheduler cursor/watermark baseline，避免过粗推进语义  `#p3c04`
- [x] 补充 focused e2e 并同步计划/API/TODO/记录文档  `#p3c05`
<!-- LIMCODE_TODO_LIST_END -->

# Agent Scheduler Phase 3 收尾计划

> Source Design: `.limcode/design/agent-scheduler-phase-3-design.md`
> Historical Note: 原始 Phase 3 路线文件已从仓库移除；本计划承接其剩余收尾工作。

## 1. 目标

当前代码已经明显超出原始 Phase 3 计划：

- observability read model 已落地并扩展到 runs / decisions / summary / trends / operator projection
- multi-worker safety 已超出单 lease + cursor baseline，进入 partition ownership / migration / worker runtime state / automatic rebalance baseline
- richer event-driven policy 也已具备 signal weighting、candidate merge、replay/retry suppression 等基础能力

因此本计划不再重复推进“完整 Phase 3”，而是专注于**收尾**：

1. 让当前 scheduler policy 更清晰、更可解释
2. 让剩余的 readiness / taxonomy / watermark 语义收口
3. 让计划、文档、验证状态重新与真实代码对齐

## 2. 当前状态判断

### 2.1 已完成并不在本轮重做的内容

以下内容视为已交付基线，本轮只允许做增量修正，不重开大设计：

- `SchedulerRun` / `SchedulerCandidateDecision` 持久化快照
- scheduler runs / decisions / summary / trends / operator projection / ownership / workers / rebalance 读面
- partition-scoped `SchedulerLease` / `SchedulerCursor`
- ownership assignment / migration / failover / automatic rebalance baseline
- replay/retry recovery-window suppression baseline

### 2.2 本轮真正剩余的问题

结合当前代码，仍值得收口的点主要是：

- actor readiness 仍以散落判断为主，缺少统一抽象层
- skip reason taxonomy 虽已扩展，但仍存在“plan 语义 / 当前实现 / operator explainability”之间的漂移
- `event_coalesced` 目前更偏 summary 统计，不完全等价于结构化 candidate-level explainability
- cursor / watermark 仍是最小 tick 推进语义，`last_signal_tick` 的推进策略偏粗
- 文档与计划存在漂移，至少需要统一到当前真实代码

## 3. 收尾主线

## 主线 A：Actor Readiness 收敛

### 目标

把当前散落在 `runAgentSchedulerForPartition()` 中的 candidate 评估条件，整理为清晰的 readiness / suppression 层。

### 本轮要求

至少要统一整理以下条件的评估顺序与输出语义：

- `pending_workflow`
- `periodic_cooldown`
- replay / retry recovery suppression
- existing same idempotency
- limit reached

### 建议交付

- 提取 `evaluateSchedulerActorReadiness()` 或等价 helper
- 明确 candidate evaluation precedence（谁先判断、谁覆盖谁）
- 把“当前已有的 readiness-like 条件”从主循环内联判断整理成更可维护的结构

### 可选增强

若当前代码与数据模型足够稳定，可进一步加入：

- failure streak / repeated failure suppression
- binding gating
- policy gating

但如果这些条件需要额外系统设计，不要求在本轮一次性全部做完。优先完成“结构收敛”，避免继续堆散落条件。

## 主线 B：Skip Taxonomy 与 Explainability 收口

### 目标

保留原计划中“显式 skip reason taxonomy”的可取部分，同时承认当前实现已经演进到更细粒度的 replay/retry suppression reason。

### 本轮要求

1. 明确当前正式对外的 `SchedulerSkipReason` 集合
2. 明确哪些 reason 是 candidate-level 决策语义，哪些只是 summary 统计语义
3. 对 `event_coalesced` 做最小收口，避免它既像 skip reason、又像 summary side counter、但没有稳定解释边界

### 建议交付

- 更新 `SchedulerSkipReason` 的正式语义说明
- 若必要，调整 candidate snapshot / summary 聚合对 `event_coalesced` 的表达方式
- 若引入新的 readiness gating，可按实际能力考虑：
  - `actor_not_ready`
  - `policy_suppressed`

但这两个 reason 只有在代码中有稳定判定来源时才引入；避免为了对齐旧计划而虚构 reason。

## 主线 C：Cursor / Watermark 最小加固

### 目标

保留当前 cursor baseline，但避免“扫描完成就把 `last_signal_tick` 直接推进到 now”这一过粗语义在后续演进中形成隐患。

### 本轮要求

- 明确 `last_scanned_tick` 与 `last_signal_tick` 的职责边界
- 判断当前推进策略是否需要改为“按真实观测到的最新 signal watermark 前进”
- 保持与 migration / failover / rebalance handoff 兼容

### 建议交付

- `scheduler_lease.ts` 或 `agent_scheduler.ts` 中的 cursor 更新策略收敛
- 对 watermark 推进规则补充注释 / helper / focused test
- 若不改行为，也需要把“为什么当前 baseline 足够”写清楚

## 主线 D：文档与状态同步

### 目标

把计划、文档、验证记录重新对齐到当前代码，结束“原计划未勾选但代码已完成”“文档描述超前或落后于代码”的状态。

### 本轮要求

至少检查并同步：

- `.limcode/plans/agent-scheduler-phase-3-closure.plan.md`
- `docs/API.md`
- `TODO.md`
- `记录.md`

### 特别注意

应重点复核 scheduler 相关 API 列表与实际路由是否一致，避免继续积累描述漂移。

## 4. 建议改动范围

### runtime / service
- `apps/server/src/app/runtime/agent_scheduler.ts`
- `apps/server/src/app/runtime/scheduler_lease.ts`
- 可选新增：
  - `apps/server/src/app/services/agent_scheduler_readiness.ts`
  - 或 `apps/server/src/app/runtime/agent_scheduler_readiness.ts`

### observability / docs
- `apps/server/src/app/services/scheduler_observability.ts`
- `docs/API.md`
- `TODO.md`
- `记录.md`
- `.limcode/plans/agent-scheduler-phase-3-closure.plan.md`

### e2e
- `apps/server/src/e2e/agent_scheduler.ts`
- `apps/server/src/e2e/scheduler_queries.ts`
- 必要时新增 focused e2e：
  - readiness precedence
  - coalescing explainability
  - cursor watermark behavior

## 5. 实施顺序

### Task 1. 先冻结边界

在动代码前，先明确：

- 哪些能力视为已经完成
- 哪些内容明确不在本轮重做
- 本轮只处理收尾，不重新打开 Phase 3B / 3C 大范围实现

### Task 2. 收敛 readiness 评估层

先整理 evaluation order 与 helper 抽象，避免后续 skip taxonomy 和 watermark 调整继续堆在主循环里。

### Task 3. 收口 skip taxonomy / explainability

在 readiness 层稳定后，再决定：

- `event_coalesced` 如何表达
- 是否需要正式引入 `actor_not_ready` / `policy_suppressed`
- candidate snapshot / summary 聚合是否需要小幅调整

### Task 4. 加固 cursor / watermark

最后再处理 cursor 语义，这样可以避免 readiness / skip 顺序未稳定时过早冻结增量扫描行为。

### Task 5. focused e2e + 文档同步

以代码最终状态为准补 focused e2e，并同步计划 / API / TODO / 记录。

## 6. 验收标准

本收尾计划完成时，应满足：

1. scheduler candidate evaluation 的顺序与 readiness/suppression 语义清晰可读
2. skip taxonomy 的正式语义与实际代码一致
3. `event_coalesced` 的表达边界明确，不再混淆 candidate 决策与 summary 统计
4. cursor / watermark 的推进规则有清晰解释，并经过 focused verification
5. 计划、API 文档、TODO、记录与当前代码状态重新对齐

## 7. 非目标

以下内容不属于本轮收尾范围：

- 重做 scheduler observability read model
- 重做 ownership / migration / automatic rebalance 基线
- 一次性引入复杂 DSL 化 scheduler policy 系统
- 设计完整 control-plane mutation API
- 推进比当前更重的 distributed scheduling architecture

## 8. 结论

原始 Phase 3 的大部分主线已经在后续代码演进中落地，甚至被继续推进。

当前最需要的不是“再开一轮完整 Phase 3”，而是：

- **把已经做出的能力收口成清晰的工程边界**
- **把剩余的小缺口补齐**
- **把文档与计划重新拉回真实状态**

这份收尾计划就是为了完成这三个目标。
