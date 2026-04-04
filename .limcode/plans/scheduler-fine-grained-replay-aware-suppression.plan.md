## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [X] 设计并实现细粒度 suppression policy 结构（按 intent_class / signal priority / candidate kind）  `#sfg1`
- [x] 在 scheduler 中对低优先级 event-driven candidate 引入 replay/retry window suppression  `#sfg2`
- [X] 扩展 skip reason taxonomy 与 summary/trend 聚合以反映细粒度 suppression  `#sfg3`
- [x] 补充 agent_scheduler e2e 覆盖 survive/suppress 分支  `#sfg4`
- [X] 同步 API/ARCH/TODO/记录 文档  `#sfg5`
<!-- LIMCODE_TODO_LIST_END -->

# Scheduler Fine-Grained Replay-Aware Suppression 实施计划

> 基于当前已完成的：
> - DecisionJob `intent_class` / `job_source` baseline
> - scheduler query API
> - scheduler summary / trend projections
> - replay/retry recovery-window periodic suppression baseline

## 1. 目标

把当前 replay-aware suppression 从：

- **粗粒度 periodic-only suppression**

推进到：

- **细粒度、按 signal priority 生效的 suppression policy**

同时保持：

- runtime 行为可解释
- operator 可观察
- 不过早引入复杂 DSL
- 不破坏现有 event-driven 核心路径

---

## 2. 当前问题

目前 scheduler 在 replay/retry recovery window 内：

- suppress periodic candidate
- event-driven candidate 全部放行

这已经比 baseline 更合理，但仍然有几个缺点：

1. 低优先级 event-driven signal（例如 `snr_change_followup`）在恢复窗口内仍可能制造噪声
2. suppression 行为没有体现 signal priority 差异
3. summary / trends 虽然能看见 suppression，但看不出 suppression 的精细结构
4. 当前 replay-aware policy 仍不能表达：
   - 哪些 signal 值得穿透 suppression
   - 哪些 signal 应该在恢复窗口内暂时让位

---

## 3. 本阶段范围

## 3.1 细粒度 suppression policy 结构

建议新增内部 policy 结构，用于判断：

- 哪类 recovery window 生效
- 哪类 candidate 会被 suppress
- 哪类 reason 可以穿透 suppression

### 建议结构（代码内常量即可）

例如：

- `replay_recovery`:
  - suppress periodic
  - suppress low-priority event-driven
  - allow high-priority event-driven
- `retry_recovery`:
  - suppress periodic
  - suppress very-low-priority event-driven
  - allow high-priority event-driven

### 第一版优先级划分建议

按当前已有 signal weight：

- `event_followup = 30`
- `relationship_change_followup = 20`
- `snr_change_followup = 10`

建议先定义：

- `event_followup` 作为高优先级，默认允许穿透 suppression
- `relationship_change_followup` / `snr_change_followup` 可作为低优先级 suppression 候选

---

## 3.2 event-driven 细粒度 suppression

### replay window
建议：

- suppress `periodic`
- suppress 低优先级 `event_driven`
- 保留高优先级 `event_followup`

### retry window
建议：

- suppress `periodic`
- 对低优先级 `event_driven` 做类似处理
- 可保持与 replay window 一致，减少实现复杂度

### 原则

第一版不要做太复杂的 per-signal matrix，优先：

- 高优先级 survive
- 低优先级 suppress

---

## 3.3 Skip Reason Taxonomy 扩展

在已有：

- `replay_window_suppressed`
- `retry_window_suppressed`

基础上，建议细化为：

- `replay_window_periodic_suppressed`
- `replay_window_event_suppressed`
- `retry_window_periodic_suppressed`
- `retry_window_event_suppressed`

### 备注

如果你希望保持 taxonomy 简洁，也可以：

- 保留现有粗 reason
- 在 candidate snapshot 中增加 `secondary_reasons` 或 `suppression_detail`

但从 operator/read-model 可解释性角度看，我更推荐显式细化 skip reason。

---

## 3.4 Observability / Summary / Trends 联动

本阶段建议让 scheduler summary/trends 至少能反映：

- top skipped reasons 中出现细粒度 suppression
- trend 点继续维持兼容
- future 如需可再加 suppression-specific aggregates

### 本阶段不强制做新接口

只要：
- `/api/runtime/scheduler/summary`
- `/api/runtime/scheduler/trends`

能够自然包含新的 skip reason 统计即可。

---

## 4. 建议改动范围

### Runtime / Service
- `apps/server/src/app/runtime/agent_scheduler.ts`
- `apps/server/src/app/services/inference_workflow.js`
- `apps/server/src/app/services/scheduler_observability.ts`

### e2e
- `apps/server/src/e2e/agent_scheduler.ts`

### 文档
- `docs/API.md`
- `docs/ARCH.md`
- `TODO.md`
- `记录.md`

---

## 5. 实施步骤

## Task 1. 定义细粒度 suppression policy

### 目标
在代码中引入清晰 policy map，例如：

- recovery type -> suppression rule
- signal priority -> allowed / suppressed

### 验收
- scheduler 代码里不再用散落 if/else 表达 suppression 规则
- policy 结构具备扩展性

---

## Task 2. event-driven suppression 落地

### 目标
在 replay/retry recovery window 内：

- suppress low-priority event-driven candidates
- 保留 high-priority event-driven candidates

### 第一版建议
- `event_followup` survive
- `relationship_change_followup` / `snr_change_followup` suppress

### 验收
- event-driven 不再“全放行”
- 但高优先级 world-followup 仍可通过

---

## Task 3. skip taxonomy / summary 更新

### 目标
让细粒度 suppression 成为结构化 skip reason，并被 summary/trend 观测到。

### 验收
- summary 中 top skipped reasons 能体现 event suppression
- 不破坏现有 summary 接口结构

---

## Task 4. e2e 补充

### 场景建议

#### A. replay window + high-priority event survives
- 制造 `event_followup`
- 断言仍可创建或至少不被 event suppression 阻断

#### B. replay window + low-priority event suppressed
- 制造 relationship/snr followup
- 断言被 suppress
- 断言 skip reason = replay window event suppression

#### C. retry window + low-priority event suppressed
- 同上

### 验收
- 覆盖 survive / suppress 两个分支
- 测试尽量避免依赖完全非确定的 “latest run” 假设

---

## Task 5. 文档同步

### API
补充新的 skip reason 取值

### ARCH
补充 scheduler policy 已具备 priority-aware replay/retry suppression baseline

### TODO / 记录
更新当前阶段状态

---

## 6. 风险控制

### 风险 1：抑制过强

控制：
- 第一版只 suppress 低优先级 event-driven
- `event_followup` 明确保留

### 风险 2：skip reason 过度膨胀

控制：
- 只增加少量高价值 reason
- 不为每个细节再拆更多 reason

### 风险 3：行为不稳定导致 e2e 易碎

控制：
- 测试以“存在 suppression or survive 结构证据”为主
- 避免依赖全局 latest-run 唯一性假设

---

## 7. 验收标准

完成后应满足：

1. replay/retry suppression 不再仅限 periodic，而能细粒度作用于低优先级 event-driven
2. 高优先级 `event_followup` 默认可以穿透 suppression
3. skip reason 可结构化区分 periodic suppression 与 event suppression
4. summary/trend 接口仍兼容，并能观测到新的 suppression reason
5. e2e 覆盖 survive / suppress 两类分支

---

## 8. 结论

这一阶段的意义是把当前 scheduler 从：

- recovery-window aware

继续提升到：

- **priority-aware replay/retry suppression aware**

它仍然保持“工程上可控的代码内 policy”，但已经足以明显提升：

- runtime 行为合理性
- operator 可解释性
- future multi-worker / policy DSL 演进空间
