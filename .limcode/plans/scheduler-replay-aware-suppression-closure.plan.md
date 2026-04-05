## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 冻结当前 replay/retry fine-grained suppression baseline，并明确本轮非目标  `#srsc1`
- [x] 新增 replay API -> scheduler suppression 的 focused e2e 覆盖（优先新建 focused 用例，而不是把 workflow_replay.ts 继续膨胀）  `#srsc2`
- [x] 按需要抽取 polling/helper 并补 package.json 测试入口，保证新用例可稳定运行  `#srsc3`
- [x] 若新 e2e 揭示真实缺口，则做最小 runtime 修复，不重开 suppression 设计  `#srsc4`
- [x] 同步记录/TODO/必要文档与验证命令快照，完成收尾  `#srsc5`
<!-- LIMCODE_TODO_LIST_END -->

# Scheduler Replay-Aware Suppression 收尾计划

> Historical Note:
> - `.limcode/plans/scheduler-replay-aware-suppression.plan.md` 的核心 runtime / observability 工作已由当前代码实现，旧文档将由用户手动勾选归档。
> - `.limcode/plans/scheduler-fine-grained-replay-aware-suppression.plan.md` 代表当前已经进入主线的 fine-grained baseline；本计划不重做那一轮已完成内容。

## 1. 目标

本轮目标不是重开 replay-aware suppression 主实现，而是做**收尾**：

1. 冻结当前已经存在的 replay/retry recovery-window suppression baseline
2. 只补当前仍缺的一条关键验证链路：**replay API 提交 -> scheduler suppression 证据可被观测到**
3. 在必要时做最小修补，让后续代码实现可以站在一份真实、收口后的计划上继续推进

## 2. 当前已交付基线（本轮不重做）

以下内容视为已完成基线，本轮不再重写设计，只允许被测试驱动地做最小修复：

- `apps/server/src/app/services/inference_workflow/repository.ts`
  - 已有 `listRecentRecoveryWindowActors(...)`
  - recovery actor 查询不再只是最小 actor set，而是返回带 tick 的 actor watermark
- `apps/server/src/app/runtime/agent_scheduler.ts`
  - 已有 recovery suppression policy map
  - 已有 `suppression_tier` 与 `priority_score`
  - 已有 replay/retry 对 periodic 与低优先级 event-driven 的细粒度 suppression
  - readiness 顺序已收敛为：`limit -> pending_workflow -> replay/retry suppression -> periodic_cooldown -> existing idempotency/create`
- skip taxonomy 已进入主线：
  - `replay_window_periodic_suppressed`
  - `replay_window_event_suppressed`
  - `retry_window_periodic_suppressed`
  - `retry_window_event_suppressed`
- `apps/server/src/app/services/scheduler_observability.ts`
  - summary / trends / decisions query / read model 已能下游消费上述 skip reason
- `apps/server/src/e2e/agent_scheduler.ts`
  - 已覆盖 replay/retry periodic suppression
  - 已覆盖高优先级 event survives
  - 已覆盖低优先级 event suppression
- `docs/API.md`、`docs/ARCH.md`、`docs/LOGIC.md`、`TODO.md`
  - 已基本对齐 fine-grained suppression baseline

## 3. 当前真正剩余的问题

结合现有代码，旧计划里真正还值得收尾的点主要只剩：

1. `apps/server/src/e2e/workflow_replay.ts` 目前只验证 replay submit / lineage / workflow snapshot / job read
2. 它还没有验证 replay API 与 scheduler suppression 之间的联动
3. 旧计划虽然写了 `agent_scheduler / workflow_replay e2e`，但当前实际上只有 `agent_scheduler.ts` 承担了 suppression 主验证
4. 如果直接把更多 scheduler 断言塞进 `workflow_replay.ts`，容易把它从“workflow replay 语义测试”膨胀成“scheduler omnibus test”，后续维护成本会升高

因此，本轮的真实问题不是 suppression 没实现，而是：

- **缺少一条 replay API 触发后的 focused、可维护的 scheduler suppression 证据链测试**

## 4. 收尾主线

## 主线 A：冻结 baseline，并明确非目标

### 目标

把旧计划中仍然有价值的部分吸收为历史基线，同时明确本轮不再做的事，避免实现时误把已完成内容重开。

### 本轮明确不做

- 不把细粒度 skip taxonomy 改回粗粒度 `replay_window_suppressed / retry_window_suppressed`
- 不重写 `listRecentRecoveryWindowActors(...)` 的 helper 形态
- 不重新设计 suppression DSL
- 不在没有证据的前提下大改 `agent_scheduler.ts` runtime 逻辑
- 不把 `workflow_replay.ts` 变成新的综合调度测试入口，除非实践证明 focused 用例不可行

### 验收

- 新计划明确写清：当前主线 baseline 已交付
- 后续实现只围绕真实缺口推进，不重复做已完成项

---

## 主线 B：补 replay API -> scheduler suppression focused e2e

### 目标

新增一条更贴近旧计划缺口的验证链路：

- 先通过公开 replay API 触发 `replay_recovery`
- 再通过 scheduler 的公开读接口观察 suppression 证据
- 证明“replay 提交语义”不只是 workflow 内部完成，而是真的会影响 scheduler 行为

### 推荐实现方向

优先新增 focused e2e，例如：

- `apps/server/src/e2e/workflow_replay_scheduler_suppression.ts`

而不是继续扩张现有 `workflow_replay.ts`。原因：

- `workflow_replay.ts` 当前定位已经清晰：验证 replay submit / lineage / stored trace workflow 语义
- suppression 联动属于“跨 workflow + scheduler 两个读写面”的专题验证
- 分离后更容易控制 polling、滤条件和失败诊断输出

### 推荐验证路径

1. 启动 server
2. 通过 `/api/inference/jobs` 创建基础 job
3. 通过 `/api/inference/jobs/:id/replay` 触发 replay recovery job
4. 等待 replay job 进入稳定状态（至少已能从 job/workflow read path 观测到）
5. 轮询以下 scheduler 公开读接口之一或组合：
   - `GET /api/runtime/scheduler/decisions`
   - `GET /api/runtime/scheduler/summary`
   - 必要时 `GET /api/runtime/scheduler/trends`
6. 以 `actor_id + skipped_reason + from_tick` 为主要过滤维度，寻找：
   - `replay_window_periodic_suppressed`
7. 如果实现路径允许，再补充“不是单纯 pending_workflow 噪音”的结构证据

### 设计约束

- 尽量只使用公开 API，不直接依赖内部 runtime helper
- 避免依赖“全局 latest run 唯一属于本测试”这类脆弱假设
- 优先使用 actor/filter/from_tick 约束缩小观察范围
- 允许用 polling 等待 runtime loop 产生 scheduler 证据

### 验收

- 存在一条稳定 e2e，证明 replay API 提交后，scheduler 侧能观测到 `replay_window_periodic_suppressed`
- 测试失败时能打印足够的 scheduler/query 上下文，便于定位
- 不破坏现有 `workflow_replay.ts` 与 `agent_scheduler.ts` 职责边界

---

## 主线 C：补测试支撑层与入口

### 目标

让新的 focused e2e 真正可跑、可维护，而不是靠大段重复 polling 临时代码堆出来。

### 可选改动

- 为 scheduler decisions / summary 轮询补通用 helper
  - 可放在 `apps/server/src/e2e/helpers.ts`
  - 或在 focused e2e 内先局部实现，待复用价值明确后再抽取
- 如新增新文件，则补 `apps/server/package.json` 测试脚本，例如：
  - `test:workflow-replay-scheduler-suppression`
- 保持现有 `test:workflow-replay` 不变，避免把旧测试语义悄悄改重

### 验收

- 新测试可以通过 package script 单独执行
- polling/helper 逻辑可读，失败输出清晰
- 不引入对内部私有实现的强耦合

---

## 主线 D：仅在测试揭示缺口时做最小 runtime 修补

### 目标

如果新的 focused e2e 暴露出当前实现与预期之间的真实裂缝，则做最小范围修复；但不把这轮收尾再次升级成新的 suppression 重构项目。

### 可能的最小修补点

- recovery watermark / `last_signal_tick` 推进条件
- replay recovery actor 的观察窗口边界
- scheduler decisions query 过滤维度或返回字段不够用
- 现有 e2e 中 replay 完成后仍长期被 `pending_workflow` 覆盖，导致 suppression 无法稳定浮现

### 约束

- 修补必须由新测试失败直接驱动
- 只修当前验证链路真正需要的部分
- 不重开 skip taxonomy、policy map、signal weighting 设计

### 验收

- 新增 focused e2e 通过
- 现有 `test:agent-scheduler`、`test:workflow-replay` 不回归
- runtime 改动范围尽量局部

---

## 主线 E：文档与记录收尾

### 目标

在功能与测试补齐后，把本轮收尾结果沉淀下来，方便后续继续实现代码时直接参考。

### 本轮建议同步

- `记录.md`
  - 记录新增验证命令与通过结果
  - 如有必要，补一句说明：旧 suppression 计划已作为历史基线，当前补的是 replay API -> scheduler linkage verification
- `TODO.md`
  - 仅在需要体现“replay orchestration / scheduler linkage”剩余项时做最小更新
- `docs/API.md` / `docs/ARCH.md`
  - 只有在实际实现过程中发现接口或语义说明仍不准确时再改
  - 不为了“看起来完整”重复改写已经基本对齐的段落

### 验收

- 记录中可看到新增测试命令
- 文档改动与真实实现一致，不制造新的计划漂移

## 5. 建议改动范围

### 优先
- `apps/server/src/e2e/workflow_replay_scheduler_suppression.ts`（新文件，推荐）
- `apps/server/src/e2e/helpers.ts`（如需抽 helper）
- `apps/server/package.json`
- `记录.md`

### 可能需要
- `apps/server/src/e2e/workflow_replay.ts`（若决定小幅复用 helper 或轻微收口）
- `apps/server/src/app/routes/scheduler.ts`（仅当查询面确实缺过滤/字段）
- `apps/server/src/app/services/scheduler_observability.ts`（仅当新测试证明读接口信息不足）
- `apps/server/src/app/runtime/agent_scheduler.ts`（仅当存在真实 runtime 缺口）

## 6. 风险控制

### 风险 1：把现有 workflow_replay.ts 搞得过重

控制：
- 优先新建 focused e2e
- 保持 replay 语义测试与 scheduler 联动测试分层

### 风险 2：runtime loop 非确定性导致 e2e 脆弱

控制：
- 使用 actor_id / skipped_reason / from_tick 过滤
- 使用 polling 等待结构证据
- 避免依赖 latest run 唯一性

### 风险 3：为了让测试通过而重开 suppression 设计

控制：
- 只允许 test-driven 最小修补
- 不重做已有 fine-grained baseline

## 7. 验收标准

完成后应满足：

1. 旧 suppression 计划中已实现部分被正式视为历史基线，而不是继续挂在“未完成”状态里
2. 新增一条 focused e2e，证明 replay API 的恢复语义会在 scheduler 面形成可观测 suppression 证据
3. 新测试有独立入口，且失败时具备足够诊断信息
4. 若需要 runtime 修补，其范围局部且不重开 suppression 主设计
5. `记录.md` 至少补齐新增验证命令与本轮收尾说明

## 8. 结论

这轮收尾的关键不是“再实现一遍 replay-aware suppression”，而是：

- 承认当前 fine-grained suppression 已经是既成事实
- 把旧计划中仍有价值的目标收束成一条真实剩余链路
- 用一个 focused replay->scheduler 联动测试，把 workflow replay 与 scheduler suppression 两个表面真正接起来

这样后续再继续写代码时，就可以站在**已冻结的 baseline + 已补齐的联动证据**之上推进，而不是继续让旧计划和现状漂移。
