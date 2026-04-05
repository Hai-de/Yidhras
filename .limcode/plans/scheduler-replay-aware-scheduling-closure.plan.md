<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/scheduler-replay-aware-scheduling-design.md","contentHash":"sha256:b3b3b28f4cc19065fc9f35322a796dbd291e95303332d3009b18f610f424cc22"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 冻结当前真实交付边界，并把原计划中已被代码实现的部分标记为历史基线  `#srasc1`
- [x] 收口 retry 路径：统一 request_input.attributes.job_intent_class / job_source，并明确 retry reset/claim 的语义边界  `#srasc2`
- [x] 补齐 workflow jobs list read model 的 intent_class 暴露，完成 list/detail/snapshot 一致性  `#srasc3`
- [x] 补 focused verification：成功 retry API 端到端语义断言，并复核前端 scheduler typed fixture 与 vue-tsc 一致性  `#srasc4`
- [x] 同步 docs/API.md、docs/ARCH.md、TODO.md、记录.md 与原计划状态，使文档重新对齐实际代码  `#srasc5`
<!-- LIMCODE_TODO_LIST_END -->

# Scheduler Replay-Aware Scheduling 收尾计划

> Source Design: `.limcode/design/scheduler-replay-aware-scheduling-design.md`
> Historical Note: `.limcode/plans/scheduler-replay-aware-scheduling.plan.md` 的大部分主线已被当前代码实现，本计划只处理剩余收尾项。

## 1. 目标

当前代码已经完成了该设计的大部分主目标：

- `DecisionJob.intent_class` 已落地到 schema / migration / snapshot / detail read path
- direct submit / scheduler / replay 路径已经稳定写入 `intent_class` 与 `job_source`
- scheduler observability 已开始消费 `intent_class`，并扩展到 summary / trends / crosslink / operator projection
- `记录.md`、`TODO.md`、`docs/API.md` 已有部分同步

因此本轮不再重开整套实现，而是专注于**收尾**：

1. 修正 retry 路径与原设计之间仍然存在的语义漂移
2. 补齐 workflow list read model 缺失的 `intent_class`
3. 用 focused verification 和文档同步，把代码、测试、计划、文档重新拉回一致状态

## 2. 当前状态判断

### 2.1 已完成且不在本轮重做的内容

以下内容视为已交付基线，本轮只允许增量修正：

- `DecisionJob.intent_class` schema / migration / index
- direct submit / scheduler / replay 的 `intent_class` 与 `job_source` 注入
- job detail / workflow snapshot 的 `intent_class` 暴露
- scheduler summary / trends / decision crosslink 对 `intent_class` 的下游消费
- replay-aware / retry-aware suppression baseline

### 2.2 当前真正剩余的问题

结合当前代码，收尾阶段仍值得处理的点主要有：

- retry 路径当前只更新顶层 `DecisionJob.intent_class = retry_recovery`，但没有同步刷新 `request_input.attributes.job_intent_class / job_source`
- retry 执行时仍通过 `getDecisionJobRequestInput(job)` 读取持久化 `request_input`，因此如果不刷新 attributes，下游 trace / workflow 上下文会继续携带旧 source label
- `GET /api/inference/jobs` 的 list item 目前尚未暴露 `intent_class`，与 detail / snapshot / 设计目标不一致
- 成功 retry API 的端到端 e2e 断言仍然偏弱，目前更接近 failure gate / seeded data 验证，而不是真正的 `/retry` 正向闭环验证
- `docs/ARCH.md` 与原计划状态尚未和真实代码对齐
- 前端 `SchedulerTrendPoint` 类型已经扩展；虽然当前 workspace 下 `vue-tsc` 已通过，但 typed fixture 漂移仍应纳入收尾验证，避免再次出现局部未同步问题

## 3. 收尾主线

## 主线 A：Retry 路径语义收口

### 目标

把 retry 从“只改顶层状态”的最小实现，收口为与设计一致的稳定语义入口。

### 当前问题

当前 retry 流程是：

- `retryInferenceJob()` 对原 job 做 reset
- `updateDecisionJobState()` 把顶层 `intent_class` 改成 `retry_recovery`
- `claimDecisionJob()` 重新 claim 同一 job 并执行
- `executeDecisionJob()` 再次从 `request_input` 读取输入

但 `updateDecisionJobState()` 不会刷新 `request_input.attributes`，因此 retry 后执行链路读取到的仍可能是旧的：

- `job_intent_class = direct_inference` 或其他旧值
- `job_source = api_submit` 或其他旧值

### 本轮要求

至少收口以下语义：

1. retry reset 后，持久化 `request_input.attributes.job_intent_class = retry_recovery`
2. retry reset 后，持久化 `request_input.attributes.job_source = retry`
3. 明确 retry 是否继续复用同一 job id、是否保留原 `started_at`、以及这些语义是否要在文档中解释清楚
4. 保证 retry 后的 trace / workflow 读取链路观察到的是最新的 retry 语义，而不是旧 submit 语义

### 建议交付

- 在 workflow repository 层补一个专门的 retry reset helper，或为 `updateDecisionJobState()` 增加受控的 request_input patch 能力
- 避免把 metadata patch 散落在 route/service/runtime 各层
- 对 retry 复用旧 job 的行为加注释或文档说明，明确它不是“新建 retry job”模型

## 主线 B：Workflow List Read Model 补齐 intent_class

### 目标

完成设计里要求的 list/detail/snapshot 一致性，而不是只在 detail / snapshot 暴露 `intent_class`。

### 当前问题

`workflow_query.ts` 中：

- `InferenceJobListItem` 目前没有 `intent_class`
- `buildInferenceJobListItem()` 也没有把 `job.intent_class` 投影出来

这使得：

- `GET /api/inference/jobs` 无法直接按语义类别展示/消费 job
- 设计文档与实际 API 表现不一致
- 后续 operator / overview / workflow 列表型 UI 不能稳定复用这层分类

### 本轮要求

- 为 `InferenceJobListItem` 增加 `intent_class`
- 在 list builder 中稳定写出该字段
- 保持 BigInt/string transport 习惯不变
- 不重构整个 workflow DTO，仅增量补字段

## 主线 C：Focused Verification 与类型漂移复核

### 目标

用最小但关键的测试把本轮收尾问题真正封口。

### 本轮要求

至少补强以下验证：

1. 成功 retry API 正向 e2e：
   - failed job -> `/api/inference/jobs/:id/retry`
   - 返回 job 的 `intent_class === retry_recovery`
   - `request_input.attributes.job_intent_class === retry_recovery`
   - `request_input.attributes.job_source === retry`
   - workflow snapshot / trace 读路径能观察到一致 metadata
2. `GET /api/inference/jobs` list item 包含 `intent_class`
3. 前端 scheduler typed fixture 与 `SchedulerTrendPoint` 类型保持同步，避免再次出现本地 fixture 缺字段导致的 `vue-tsc` 报错

### 当前复核结论

- 当前 workspace 中 `apps/web/tests/unit/overview.scheduler.spec.ts` 已包含 `partition_id`、`worker_id`、`skipped_by_reason`
- 本地执行 `pnpm --filter web exec vue-tsc --noEmit` 已通过
- 因此该报错更像是“类型接口升级后、旧 fixture/未保存 buffer/编辑器缓存”的残留症状，而不是当前仓库 HEAD 仍然报错

## 主线 D：计划与文档同步

### 目标

结束“原计划仍显示未完成，但代码已经做完大半”的漂移状态。

### 本轮要求

至少同步：

- `.limcode/plans/scheduler-replay-aware-scheduling.plan.md`
- `.limcode/plans/scheduler-replay-aware-scheduling-closure.plan.md`
- `docs/API.md`
- `docs/ARCH.md`
- `TODO.md`
- `记录.md`

### 同步重点

1. 明确原计划哪些项已经被代码实现
2. 明确收尾计划只处理 retry / list read model / verification / docs drift
3. 在 `docs/ARCH.md` 中补齐 `intent_class` / `job_source` 作为稳定 workflow semantics layer 的说明
4. 如 API 行为与原设计存在差异（例如 retry 复用同一 job），应把实际行为写清楚，而不是继续沿用模糊表述

## 4. 建议改动范围

### backend workflow / service
- `apps/server/src/inference/service.ts`
- `apps/server/src/app/services/inference_workflow/repository.ts`
- `apps/server/src/app/services/inference_workflow/workflow_query.ts`
- `apps/server/src/app/services/inference_workflow/results.ts`
- 视情况补充 parser / snapshot helper

### tests
- `apps/server/src/e2e/workflow_replay.ts`
- `apps/server/src/e2e/smoke_endpoints.ts`
- 或新增 focused e2e，例如 `workflow_retry_semantics.ts`
- `apps/web/tests/unit/overview.scheduler.spec.ts`（仅在 fixture 再次漂移时修正）

### docs / plans
- `.limcode/plans/scheduler-replay-aware-scheduling.plan.md`
- `docs/API.md`
- `docs/ARCH.md`
- `TODO.md`
- `记录.md`

## 5. 实施顺序

### Task 1. 冻结真实交付边界

先把当前“已经完成的部分”和“本轮真正剩余的问题”写清楚，避免继续把原计划当成全量待办。

### Task 2. 收口 retry metadata

优先补 retry 的 metadata patch，因为这是当前最直接的语义缺口，而且会影响 trace / workflow / observability 的一致性。

### Task 3. 补齐 list read model

在 retry 语义稳定后，再为 `GET /api/inference/jobs` 增量暴露 `intent_class`，完成 list/detail/snapshot 对齐。

### Task 4. 补 focused verification

确认正向 retry e2e、list read model、前端 typed fixture 都与最终类型/行为一致。

### Task 5. 同步计划与文档

最后更新 API / ARCH / TODO / 记录 / 原计划状态，确保此轮结束后不再出现“代码与计划两套世界”的情况。

## 6. 验收标准

本收尾计划完成时，应满足：

1. retry 后的 job 顶层 `intent_class` 与 `request_input.attributes.job_intent_class / job_source` 一致
2. retry 执行链路读取到的是最新 retry metadata，而不是旧 submit metadata
3. `GET /api/inference/jobs` / `GET /api/inference/jobs/:id` / workflow snapshot 都能看到 `intent_class`
4. 成功 retry API 有 focused e2e 覆盖，而不仅是 seeded data 或 invalid retry case
5. `docs/API.md`、`docs/ARCH.md`、`TODO.md`、`记录.md` 与原计划状态重新对齐
6. web `SchedulerTrendPoint` 相关 typed fixture 与当前 API 类型保持一致，`vue-tsc` 无回归

## 7. 非目标

以下内容不属于本轮收尾范围：

- 重做 replay-aware suppression 策略
- 重做 scheduler summary / trends / operator projection
- 重新设计 retry 为“新建 job”模型
- 引入新的 DB enum 或重构整个 workflow DTO
- 推进 `operator_forced` 的完整控制面实现

## 8. 结论

`scheduler-replay-aware-scheduling` 原计划的主体已经被代码实现，当前真正需要的不是再做一轮大开发，而是：

- **把 retry 语义补齐到设计预期**
- **把 list read model 的最后一个缺口补上**
- **把测试、计划、文档重新拉回与真实代码一致**

这份收尾计划就是围绕这三个目标展开。
