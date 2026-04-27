# 项目进度
- Project: Yidhras
- Updated At: 2026-04-26T16:16:36.001Z
- Status: active
- Phase: implementation

## 当前摘要

<!-- LIMCODE_PROGRESS_SUMMARY_START -->
- 当前进度：4/4 个里程碑已完成；最新：pack-runtime-materialization-shared
- 当前焦点：AI 网关盲点修复收尾 — 仅剩 Streaming/SSE（择日处理）
- 最新结论：测试冲刺完成：10 失败→5 失败，278 pass→314 pass。新增 registry/task_decoder/observability 降级/openai adapter 共 31 个新测试。TODO.md 仅剩 Streaming/SSE 一项未处理。
- 下一步：仅剩 Streaming/SSE 需求评估留待日后。可关闭本轮盲点修复
<!-- LIMCODE_PROGRESS_SUMMARY_END -->

## 关联文档

<!-- LIMCODE_PROGRESS_ARTIFACTS_START -->
- 设计：`.limcode/design/experimental-pack-runtime-materialization.md`
- 计划：`.limcode/plans/共享-pack-runtime-materialization-接口抽取.plan.md`
- 审查：`.limcode/review/测试链路重构评估.md`
<!-- LIMCODE_PROGRESS_ARTIFACTS_END -->

## 当前 TODO 快照

<!-- LIMCODE_PROGRESS_TODOS_START -->
- [x] 新建 pack_materializer.ts 接口文件（类型定义 + 空函数签名）  `#t1`
- [x] 新建 pack_materializer.spec.ts 单元测试（6 个用例）  `#t2`
- [x] 实现 materializePackRuntime() 函数体（三条已有函数调用）  `#t3`
- [x] 重构 runtime_activation.ts：三行调用 → 一行 materializePackRuntime  `#t4`
- [x] 重构 PackRuntimeRegistryService.load()：注入 materialization + 独立时钟  `#t5`
- [x] 扩展 pack_runtime_registry.spec.ts（load 集成测试 + unload 清理测试）  `#t6`
- [x] 全量回归：unit / integration / e2e + tsc --noEmit  `#t7`
<!-- LIMCODE_PROGRESS_TODOS_END -->

## 项目里程碑

<!-- LIMCODE_PROGRESS_MILESTONES_START -->
### ai-registry-hot-reload · AI 注册表热加载实现完成
- 状态：completed
- 记录时间：2026-04-26T11:20:31.281Z
- 完成时间：2026-04-26T11:20:31.281Z
- 关联 TODO：t1, t2, t3, t4
- 关联文档：
  - 设计：`.limcode/design/ai-registry-hot-reload.md`
  - 计划：`.limcode/plans/ai-注册表热加载registry-hot-reload.plan.md`
- 摘要:
实现了 ai_models.yaml 和 prompt_slots.yaml 的 fs.watch 文件监听热加载。变更后自动校验（先 parse+merge，后 reset），校验失败保留旧缓存。零外部依赖，在 SIGINT/SIGTERM 时优雅关闭。涉及文件：ai/registry.ts（导出 3 个符号）、ai/registry_watcher.ts（新建 ~175 行）、index.ts（接入 ~12 行）。

### PG2 · AI 网关弹性工程实现完成
- 状态：completed
- 记录时间：2026-04-26T11:55:26.791Z
- 完成时间：2026-04-26T11:55:26.791Z
- 关联 TODO：e1, e2, e3, e4, e5, e6, e7, e8
- 关联文档：
  - 设计：`.limcode/design/ai-elasticity-circuit-breaker-rate-limiter-backoff.md`
  - 计划：`.limcode/plans/plan.plan.md`
- 摘要:
为 AI 网关新增三层弹性防护：CircuitBreaker（per-provider 状态机，5 次连续失败→open，30s 后半开探测）、RateLimiter（per-provider 并发计数器+Promise 队列，默认 10 并发/50 队列/30s 超时）、ExponentialBackoff（指数退避+jitter，base=1s, max=30s）。全部挂载在 gateway 层，适配器无需改动。新增错误码 AI_CIRCUIT_OPEN、AI_RATE_LIMIT_QUEUE_FULL、AI_RATE_LIMIT_QUEUE_TIMEOUT。预留 AiRouteDefaults 配置字段供后续 YAML 暴露。

### test-fix-and-coverage · 测试修复与新覆盖完成
- 状态：completed
- 记录时间：2026-04-26T12:18:28.651Z
- 完成时间：2026-04-26T12:18:28.651Z
- 关联 TODO：t1, t2, t3, t4, t5, t6, t7
- 关联文档：
  - 计划：`.limcode/plans/plan.plan.md`
- 摘要:
测试冲刺完成：(1) 修复 3 个预存测试失败 — 删除 prompt_bundle_v2.spec.ts 中 2 个过时测试（toLegacyPromptBundle / buildPromptBundle），删除 prompt_workflow_sections.spec.ts 中 1 个过时 pipeline 测试；(2) 新增 4 个测试文件 — registry.spec.ts (13 tests)、task_decoder.spec.ts (13 tests)、ai_observability.spec.ts 扩展 (+5 resilience tests)、openai_adapter.spec.ts (5 tests)。失败从 10 降至 5，通过从 278 升至 314。(3) 导出 mergeAiRegistryConfig 供测试使用。

### pack-runtime-materialization-shared · 共享 Pack Runtime Materialization 接口抽取完成
- 状态：completed
- 记录时间：2026-04-26T16:16:36.001Z
- 完成时间：2026-04-26T16:16:36.001Z
- 关联 TODO：t1, t2, t3, t4, t5, t6, t7
- 关联文档：
  - 设计：`.limcode/design/experimental-pack-runtime-materialization.md`
  - 计划：`.limcode/plans/共享-pack-runtime-materialization-接口抽取.plan.md`
- 摘要:
实现共享 pack materialization 函数：新建 pack_materializer.ts（MaterializePackRuntimeInput/Output 接口 + materializePackRuntime() 三元调用）、6 个单元测试（fresh pack / idempotent / file structure / scoped IDs / no storage / custom collections）、重构 runtime_activation.ts（三行调用→一行共享函数）、重构 PackRuntimeRegistryService.load()（注入 materialization + 独立 ChronosEngine 时钟 + RuntimeSpeedPolicy）、扩展注册表测试（+3 集成测试：load 触发 materialization / unload 清理 actor bridges / already_loaded 幂等）。全量 336 单元测试通过，无回归。
<!-- LIMCODE_PROGRESS_MILESTONES_END -->

## 风险与阻塞

<!-- LIMCODE_PROGRESS_RISKS_START -->
<!-- 暂无风险 -->
<!-- LIMCODE_PROGRESS_RISKS_END -->

## 最近更新

<!-- LIMCODE_PROGRESS_LOG_START -->
- 2026-04-26T00:53:31.081Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/prompt-bundle-组件化重构-phase-2-推进.plan.md
- 2026-04-26T01:42:43.193Z | artifact_changed | plan | 同步计划文档：.limcode/plans/prompt-bundle-组件化重构-phase-3-processor-管线树化.plan.md
- 2026-04-26T01:48:48.013Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/prompt-bundle-组件化重构-phase-3-processor-管线树化.plan.md
- 2026-04-26T11:07:21.579Z | artifact_changed | design | 同步设计文档：.limcode/design/ai-registry-hot-reload.md
- 2026-04-26T11:10:50.545Z | artifact_changed | plan | 同步计划文档：.limcode/plans/ai-注册表热加载registry-hot-reload.plan.md
- 2026-04-26T11:20:21.587Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/ai-注册表热加载registry-hot-reload.plan.md
- 2026-04-26T11:20:31.281Z | milestone_recorded | ai-registry-hot-reload | 记录里程碑：AI 注册表热加载实现完成
- 2026-04-26T11:32:42.722Z | artifact_changed | 归档 plans/测试链路定向改造计划.plan.md → archive/plans/；移除 review 测试链路重构评估.md 活跃引用
- 2026-04-26T11:32:42.722Z | milestone_recorded | 注册表热加载实现完成，详见 .limcode/design/ai-registry-hot-reload.md
- 2026-04-26T11:43:07.392Z | artifact_changed | design | 同步设计文档：.limcode/design/ai-elasticity-circuit-breaker-rate-limiter-backoff.md
- 2026-04-26T11:44:30.189Z | artifact_changed | plan | 同步计划文档：.limcode/plans/plan.plan.md
- 2026-04-26T11:54:58.314Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/plan.plan.md
- 2026-04-26T11:55:26.791Z | milestone_recorded | PG2 | 记录里程碑：AI 网关弹性工程实现完成
- 2026-04-26T12:05:01.314Z | artifact_changed | plan | 同步计划文档：.limcode/plans/plan.plan.md
- 2026-04-26T12:18:12.219Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/plan.plan.md
- 2026-04-26T12:18:28.651Z | milestone_recorded | test-fix-and-coverage | 记录里程碑：测试修复与新覆盖完成
- 2026-04-26T15:59:44.842Z | artifact_changed | design | 同步设计文档：.limcode/design/experimental-pack-runtime-materialization.md
- 2026-04-26T16:02:01.887Z | artifact_changed | plan | 同步计划文档：.limcode/plans/共享-pack-runtime-materialization-接口抽取.plan.md
- 2026-04-26T16:16:23.984Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/共享-pack-runtime-materialization-接口抽取.plan.md
- 2026-04-26T16:16:36.001Z | milestone_recorded | pack-runtime-materialization-shared | 记录里程碑：共享 Pack Runtime Materialization 接口抽取完成
<!-- LIMCODE_PROGRESS_LOG_END -->

<!-- LIMCODE_PROGRESS_METADATA_START -->
{
  "formatVersion": 1,
  "kind": "limcode.progress",
  "projectId": "yidhras",
  "projectName": "Yidhras",
  "createdAt": "2026-04-24T15:27:52.689Z",
  "updatedAt": "2026-04-26T16:16:36.001Z",
  "status": "active",
  "phase": "implementation",
  "currentFocus": "AI 网关盲点修复收尾 — 仅剩 Streaming/SSE（择日处理）",
  "latestConclusion": "测试冲刺完成：10 失败→5 失败，278 pass→314 pass。新增 registry/task_decoder/observability 降级/openai adapter 共 31 个新测试。TODO.md 仅剩 Streaming/SSE 一项未处理。",
  "currentBlocker": null,
  "nextAction": "仅剩 Streaming/SSE 需求评估留待日后。可关闭本轮盲点修复",
  "activeArtifacts": {
    "design": ".limcode/design/experimental-pack-runtime-materialization.md",
    "plan": ".limcode/plans/共享-pack-runtime-materialization-接口抽取.plan.md",
    "review": ".limcode/review/测试链路重构评估.md"
  },
  "todos": [
    {
      "id": "t1",
      "content": "新建 pack_materializer.ts 接口文件（类型定义 + 空函数签名）",
      "status": "completed"
    },
    {
      "id": "t2",
      "content": "新建 pack_materializer.spec.ts 单元测试（6 个用例）",
      "status": "completed"
    },
    {
      "id": "t3",
      "content": "实现 materializePackRuntime() 函数体（三条已有函数调用）",
      "status": "completed"
    },
    {
      "id": "t4",
      "content": "重构 runtime_activation.ts：三行调用 → 一行 materializePackRuntime",
      "status": "completed"
    },
    {
      "id": "t5",
      "content": "重构 PackRuntimeRegistryService.load()：注入 materialization + 独立时钟",
      "status": "completed"
    },
    {
      "id": "t6",
      "content": "扩展 pack_runtime_registry.spec.ts（load 集成测试 + unload 清理测试）",
      "status": "completed"
    },
    {
      "id": "t7",
      "content": "全量回归：unit / integration / e2e + tsc --noEmit",
      "status": "completed"
    }
  ],
  "milestones": [
    {
      "id": "ai-registry-hot-reload",
      "title": "AI 注册表热加载实现完成",
      "status": "completed",
      "summary": "实现了 ai_models.yaml 和 prompt_slots.yaml 的 fs.watch 文件监听热加载。变更后自动校验（先 parse+merge，后 reset），校验失败保留旧缓存。零外部依赖，在 SIGINT/SIGTERM 时优雅关闭。涉及文件：ai/registry.ts（导出 3 个符号）、ai/registry_watcher.ts（新建 ~175 行）、index.ts（接入 ~12 行）。",
      "relatedTodoIds": [
        "t1",
        "t2",
        "t3",
        "t4"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/ai-registry-hot-reload.md",
        "plan": ".limcode/plans/ai-注册表热加载registry-hot-reload.plan.md"
      },
      "completedAt": "2026-04-26T11:20:31.281Z",
      "recordedAt": "2026-04-26T11:20:31.281Z",
      "nextAction": null
    },
    {
      "id": "PG2",
      "title": "AI 网关弹性工程实现完成",
      "status": "completed",
      "summary": "为 AI 网关新增三层弹性防护：CircuitBreaker（per-provider 状态机，5 次连续失败→open，30s 后半开探测）、RateLimiter（per-provider 并发计数器+Promise 队列，默认 10 并发/50 队列/30s 超时）、ExponentialBackoff（指数退避+jitter，base=1s, max=30s）。全部挂载在 gateway 层，适配器无需改动。新增错误码 AI_CIRCUIT_OPEN、AI_RATE_LIMIT_QUEUE_FULL、AI_RATE_LIMIT_QUEUE_TIMEOUT。预留 AiRouteDefaults 配置字段供后续 YAML 暴露。",
      "relatedTodoIds": [
        "e1",
        "e2",
        "e3",
        "e4",
        "e5",
        "e6",
        "e7",
        "e8"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/ai-elasticity-circuit-breaker-rate-limiter-backoff.md",
        "plan": ".limcode/plans/plan.plan.md"
      },
      "completedAt": "2026-04-26T11:55:26.791Z",
      "recordedAt": "2026-04-26T11:55:26.791Z",
      "nextAction": null
    },
    {
      "id": "test-fix-and-coverage",
      "title": "测试修复与新覆盖完成",
      "status": "completed",
      "summary": "测试冲刺完成：(1) 修复 3 个预存测试失败 — 删除 prompt_bundle_v2.spec.ts 中 2 个过时测试（toLegacyPromptBundle / buildPromptBundle），删除 prompt_workflow_sections.spec.ts 中 1 个过时 pipeline 测试；(2) 新增 4 个测试文件 — registry.spec.ts (13 tests)、task_decoder.spec.ts (13 tests)、ai_observability.spec.ts 扩展 (+5 resilience tests)、openai_adapter.spec.ts (5 tests)。失败从 10 降至 5，通过从 278 升至 314。(3) 导出 mergeAiRegistryConfig 供测试使用。",
      "relatedTodoIds": [
        "t1",
        "t2",
        "t3",
        "t4",
        "t5",
        "t6",
        "t7"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "plan": ".limcode/plans/plan.plan.md"
      },
      "completedAt": "2026-04-26T12:18:28.651Z",
      "recordedAt": "2026-04-26T12:18:28.651Z",
      "nextAction": null
    },
    {
      "id": "pack-runtime-materialization-shared",
      "title": "共享 Pack Runtime Materialization 接口抽取完成",
      "status": "completed",
      "summary": "实现共享 pack materialization 函数：新建 pack_materializer.ts（MaterializePackRuntimeInput/Output 接口 + materializePackRuntime() 三元调用）、6 个单元测试（fresh pack / idempotent / file structure / scoped IDs / no storage / custom collections）、重构 runtime_activation.ts（三行调用→一行共享函数）、重构 PackRuntimeRegistryService.load()（注入 materialization + 独立 ChronosEngine 时钟 + RuntimeSpeedPolicy）、扩展注册表测试（+3 集成测试：load 触发 materialization / unload 清理 actor bridges / already_loaded 幂等）。全量 336 单元测试通过，无回归。",
      "relatedTodoIds": [
        "t1",
        "t2",
        "t3",
        "t4",
        "t5",
        "t6",
        "t7"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/experimental-pack-runtime-materialization.md",
        "plan": ".limcode/plans/共享-pack-runtime-materialization-接口抽取.plan.md"
      },
      "completedAt": "2026-04-26T16:16:36.001Z",
      "recordedAt": "2026-04-26T16:16:36.001Z",
      "nextAction": null
    }
  ],
  "risks": [],
  "log": [
    {
      "at": "2026-04-26T00:53:31.081Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/prompt-bundle-组件化重构-phase-2-推进.plan.md"
    },
    {
      "at": "2026-04-26T01:42:43.193Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划文档：.limcode/plans/prompt-bundle-组件化重构-phase-3-processor-管线树化.plan.md"
    },
    {
      "at": "2026-04-26T01:48:48.013Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/prompt-bundle-组件化重构-phase-3-processor-管线树化.plan.md"
    },
    {
      "at": "2026-04-26T11:07:21.579Z",
      "type": "artifact_changed",
      "refId": "design",
      "message": "同步设计文档：.limcode/design/ai-registry-hot-reload.md"
    },
    {
      "at": "2026-04-26T11:10:50.545Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划文档：.limcode/plans/ai-注册表热加载registry-hot-reload.plan.md"
    },
    {
      "at": "2026-04-26T11:20:21.587Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/ai-注册表热加载registry-hot-reload.plan.md"
    },
    {
      "at": "2026-04-26T11:20:31.281Z",
      "type": "milestone_recorded",
      "refId": "ai-registry-hot-reload",
      "message": "记录里程碑：AI 注册表热加载实现完成"
    },
    {
      "at": "2026-04-26T11:32:42.722Z",
      "type": "artifact_changed",
      "message": "归档 plans/测试链路定向改造计划.plan.md → archive/plans/；移除 review 测试链路重构评估.md 活跃引用"
    },
    {
      "at": "2026-04-26T11:32:42.722Z",
      "type": "milestone_recorded",
      "message": "注册表热加载实现完成，详见 .limcode/design/ai-registry-hot-reload.md"
    },
    {
      "at": "2026-04-26T11:43:07.392Z",
      "type": "artifact_changed",
      "refId": "design",
      "message": "同步设计文档：.limcode/design/ai-elasticity-circuit-breaker-rate-limiter-backoff.md"
    },
    {
      "at": "2026-04-26T11:44:30.189Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划文档：.limcode/plans/plan.plan.md"
    },
    {
      "at": "2026-04-26T11:54:58.314Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/plan.plan.md"
    },
    {
      "at": "2026-04-26T11:55:26.791Z",
      "type": "milestone_recorded",
      "refId": "PG2",
      "message": "记录里程碑：AI 网关弹性工程实现完成"
    },
    {
      "at": "2026-04-26T12:05:01.314Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划文档：.limcode/plans/plan.plan.md"
    },
    {
      "at": "2026-04-26T12:18:12.219Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/plan.plan.md"
    },
    {
      "at": "2026-04-26T12:18:28.651Z",
      "type": "milestone_recorded",
      "refId": "test-fix-and-coverage",
      "message": "记录里程碑：测试修复与新覆盖完成"
    },
    {
      "at": "2026-04-26T15:59:44.842Z",
      "type": "artifact_changed",
      "refId": "design",
      "message": "同步设计文档：.limcode/design/experimental-pack-runtime-materialization.md"
    },
    {
      "at": "2026-04-26T16:02:01.887Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划文档：.limcode/plans/共享-pack-runtime-materialization-接口抽取.plan.md"
    },
    {
      "at": "2026-04-26T16:16:23.984Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/共享-pack-runtime-materialization-接口抽取.plan.md"
    },
    {
      "at": "2026-04-26T16:16:36.001Z",
      "type": "milestone_recorded",
      "refId": "pack-runtime-materialization-shared",
      "message": "记录里程碑：共享 Pack Runtime Materialization 接口抽取完成"
    }
  ],
  "stats": {
    "milestonesTotal": 4,
    "milestonesCompleted": 4,
    "todosTotal": 7,
    "todosCompleted": 7,
    "todosInProgress": 0,
    "todosCancelled": 0,
    "activeRisks": 0
  },
  "render": {
    "rendererVersion": 1,
    "generatedAt": "2026-04-26T16:16:36.001Z",
    "bodyHash": "sha256:bd4875ee4783f741a1d7fac035a5d54f5b3cca5294b28806aad63d9160c6616e"
  }
}
<!-- LIMCODE_PROGRESS_METADATA_END -->
