# 项目进度
- Project: Yidhras
- Updated At: 2026-04-20T07:57:34.858Z
- Status: completed
- Phase: implementation

## 当前摘要

<!-- LIMCODE_PROGRESS_SUMMARY_START -->
- 当前进度：8/8 个里程碑已完成；最新：PG6
- 当前焦点：Phase 5 experimental multi-pack runtime registry implementation fully completed; stable single active-pack contracts pre…
- 最新结论：Phase 5A-5E are complete. The implementation now includes a conservative experimental PackRuntimeRegistry / PackRuntimeHandle / PackRuntimeHost model, pack-local scheduler/plugin/p…
- 下一步：Start a final Phase 5 review/summary pass or move on to the next milestone after experimental multi-pack runtime registry.
<!-- LIMCODE_PROGRESS_SUMMARY_END -->

## 关联文档

<!-- LIMCODE_PROGRESS_ARTIFACTS_START -->
- 设计：`.limcode/design/experimental-multi-pack-runtime-registry-design.md`
- 计划：`.limcode/plans/experimental-multi-pack-runtime-registry-implementation.plan.md`
- 审查：`.limcode/review/multi-pack-runtime-experimental-assessment.md`
<!-- LIMCODE_PROGRESS_ARTIFACTS_END -->

## 当前 TODO 快照

<!-- LIMCODE_PROGRESS_TODOS_START -->
- [x] 建立 experimental multi-pack runtime registry 基础：feature flag、runtime config、PackRuntimeRegistry / PackRuntimeHandle / PackRuntimeHost 骨架  `#phase5a-runtime-registry-foundation`
- [x] 落 pack-local 隔离基础：clock、runtime speed、scheduler scope、startup/health 模型与 `(pack_id, partition_id)` 调度作用域  `#phase5b-pack-local-isolation`
- [x] 提供 experimental operator/test-only API：pack runtime load/unload/list/status/clock/scheduler 观察面  `#phase5c-experimental-operator-api`
- [x] 补 pack-local plugin runtime / projection / route scope 兼容层，确保不破坏当前单 active-pack 稳定 contract  `#phase5d-plugin-projection-compat`
- [x] 补实验性测试、文档与启用说明，明确默认关闭、风险边界与试用反馈路径  `#phase5e-tests-docs-rollout`
<!-- LIMCODE_PROGRESS_TODOS_END -->

## 项目里程碑

<!-- LIMCODE_PROGRESS_MILESTONES_START -->
### PG1 · 数据库边界治理第一阶段完成
- 状态：completed
- 记录时间：2026-04-17T21:41:31.140Z
- 完成时间：2026-04-17T21:41:31.140Z
- 关联 TODO：phase1-guardrails, phase1-workflow-scheduler, phase1-action-dispatcher, phase1-remove-runtime-penetration, phase1-scheduler-runtime, phase1-cleanup-compat
- 关联文档：
  - 设计：`.limcode/design/database-boundary-governance-phase1-design.md`
  - 计划：`.limcode/plans/database-boundary-governance-phase1-implementation.plan.md`
- 摘要:
已完成 workflow/scheduler、action dispatcher、scheduler runtime 的 repository 收口，移除业务层 context.sim.prisma 穿透访问，并清理 inference_workflow 旧兼容壳文件与收尾 lint/typecheck 问题。
- 下一步：进入下一阶段工作，或按需要继续压缩 AppContext.prisma 暴露面。

### phase2a-variable-context · 第二阶段 Phase 2A 变量层正式化完成
- 状态：completed
- 记录时间：2026-04-17T22:25:23.271Z
- 完成时间：2026-04-17T22:17:00.000Z
- 关联 TODO：phase2a-contract-types, phase2a-context-builders, phase2a-renderer-facade, phase2a-caller-integration, phase2a-diagnostics
- 关联文档：
  - 设计：`.limcode/design/world-pack-prompt-macro-variable-formalization-design.md`
  - 计划：`.limcode/plans/world-pack-prompt-macro-variable-formalization-implementation.plan.md`
- 摘要:
已完成 PromptVariableContext 正式类型、变量层上下文构建、NarrativeResolver 统一门面、prompt/perception/simulation 调用点接入以及基础变量解析 diagnostics，并通过 server typecheck。
- 下一步：继续在统一渲染器上实现 default / if / each 三类受控宏能力，并补对应测试。

### phase2b-macro-runtime · 第二阶段 Phase 2B 宏能力与测试完成
- 状态：completed
- 记录时间：2026-04-17T22:33:38.734Z
- 完成时间：2026-04-17T22:33:00.000Z
- 关联 TODO：phase2b-macro-runtime, phase2b-tests
- 关联文档：
  - 设计：`.limcode/design/world-pack-prompt-macro-variable-formalization-design.md`
  - 计划：`.limcode/plans/world-pack-prompt-macro-variable-formalization-implementation.plan.md`
- 摘要:
统一渲染器已支持 default、if、each 三类受控宏能力，并增加输出长度护栏、基础错误占位与 narrative/workflow 相关单元测试；lint、typecheck 与针对性 unit tests 均已通过。
- 下一步：更新 Prompt Workflow / World Pack 文档与示例模板，收口命名空间规范、兼容边界与新宏能力说明。

### PG2 · Phase A：runtime config contract 完成
- 状态：completed
- 记录时间：2026-04-18T08:41:07.845Z
- 完成时间：2026-04-18T08:41:07.845Z
- 关联 TODO：plan-phase-a-config-contract
- 关联文档：
  - 设计：`.limcode/design/single-pack-multi-entity-concurrent-request-design.md`
  - 计划：`.limcode/plans/single-pack-multi-entity-concurrent-request-implementation.plan.md`
- 摘要:
已完成单世界包多实体并发的 Phase A：扩展 runtime config schema，新增 entity_concurrency / tick_budget / runner concurrency 配置与 getter，更新内建默认值与 configw default 模板，并补充 runtime_config 单测验证 YAML 与环境变量覆盖行为。
- 下一步：进入 Phase B，先把 decision job runner 与 action dispatcher runner 改造为受限并发池。

### PG3 · Phase C：实体级 single-flight 与 activity budget 落地
- 状态：completed
- 记录时间：2026-04-18T08:58:26.400Z
- 完成时间：2026-04-18T08:58:26.400Z
- 关联 TODO：plan-phase-c-single-flight
- 关联文档：
  - 设计：`.limcode/design/single-pack-multi-entity-concurrent-request-design.md`
  - 计划：`.limcode/plans/single-pack-multi-entity-concurrent-request-implementation.plan.md`
- 摘要:
已完成 Phase C：新增统一 active workflow 查询模块 entity_activity_query，scheduler readiness 已接入 entity_concurrency / tick_budget，并在 decision job runner 与 action dispatcher runner 中加入 claim 后的实体级 single-flight 复核。已补充单元与集成测试验证相同行为主体下的 single-flight 约束。
- 下一步：进入 Phase D，补 observability、部署文档与并发调优说明。

### PG4 · 单世界包多实体并发请求第四阶段完成
- 状态：completed
- 记录时间：2026-04-18T09:05:02.279Z
- 完成时间：2026-04-18T09:05:02.279Z
- 关联 TODO：plan-phase-a-config-contract, plan-phase-b-runner-concurrency, plan-phase-c-single-flight, plan-phase-d-observability-docs
- 关联文档：
  - 设计：`.limcode/design/single-pack-multi-entity-concurrent-request-design.md`
  - 计划：`.limcode/plans/single-pack-multi-entity-concurrent-request-implementation.plan.md`
- 摘要:
已完成单 active pack 前提下的多实体受控并发落地：runtime config 已新增 entity_concurrency / tick_budget / runner concurrency；decision job runner 与 action dispatcher runner 已改为受限并发池；scheduler readiness 与 runner claim 后复核已落实实体级 single-flight；并已补充测试、架构与部署调优文档，并通过 lint、typecheck、unit 与 integration 验证。
- 下一步：回看 TODO.md 的第四阶段条目，必要时同步勾选或继续评估第五阶段多世界包同时运行的前置条件。

### PG5 · Phase 5A：experimental multi-pack runtime registry 基础骨架完成
- 状态：completed
- 记录时间：2026-04-18T09:46:22.221Z
- 完成时间：2026-04-18T09:46:22.221Z
- 关联 TODO：phase5a-runtime-registry-foundation
- 关联文档：
  - 设计：`.limcode/design/experimental-multi-pack-runtime-registry-design.md`
  - 计划：`.limcode/plans/experimental-multi-pack-runtime-registry-implementation.plan.md`
- 摘要:
已完成 experimental multi-pack runtime registry 的第一阶段：扩展 runtime config schema 与默认值，加入 experimental multi-pack feature flag / runtime.multi_pack 配置、env override、snapshot getter；建立 PackRuntimeRegistry / PackRuntimeHandle / PackRuntimeHost / pack runtime health 基础抽象，并在 SimulationManager 中接入最小 registry facade；补充 runtime_config 与 pack_runtime_registry 单测验证。
- 下一步：进入 Phase 5B，开始拆 pack-local clock、runtime speed 与 `(pack_id, partition_id)` scheduler scope。

### PG6 · Phase 5B：scheduler lease/cursor 已接入 pack-scoped partition scope
- 状态：completed
- 记录时间：2026-04-18T10:13:47.885Z
- 完成时间：2026-04-18T10:13:47.885Z
- 关联 TODO：phase5b-pack-local-isolation
- 关联文档：
  - 设计：`.limcode/design/experimental-multi-pack-runtime-registry-design.md`
  - 计划：`.limcode/plans/experimental-multi-pack-runtime-registry-implementation.plan.md`
- 摘要:
在不破坏当前单 active-pack 稳定模式的前提下，为 scheduler lease/cursor 引入 pack-scoped partition scope 支持。新增 `multi_pack_scheduler_scope.ts` 的解析辅助能力，并将 `scheduler_lease.ts` 扩展为可接受形如 `pack_id::p0` 的 scoped partition id；这样不同 pack 可以独立持有相同 partition id 的 lease/cursor 记录而不互相覆盖。新增集成测试 `tests/integration/scheduler-pack-scope.spec.ts` 验证 pack-scoped lease/cursor/release 行为，并通过 lint、typecheck 与相关 integration tests。
- 下一步：继续 Phase 5B/5C 交界：把 ownership/status 读面与 experimental operator API 接到新的 pack-local runtime 与 scheduler scope。
<!-- LIMCODE_PROGRESS_MILESTONES_END -->

## 风险与阻塞

<!-- LIMCODE_PROGRESS_RISKS_START -->
<!-- 暂无风险 -->
<!-- LIMCODE_PROGRESS_RISKS_END -->

## 最近更新

<!-- LIMCODE_PROGRESS_LOG_START -->
- 2026-04-18T09:20:58.806Z | artifact_changed | review | 同步审查文档：.limcode/review/multi-pack-runtime-experimental-assessment.md
- 2026-04-18T09:21:17.218Z | artifact_changed | experimental-multi-pack-runtime-registry-design | 开始创建第五阶段 experimental multi-pack runtime registry 设计文档。
- 2026-04-18T09:22:28.547Z | artifact_changed | review | 同步审查里程碑：M1
- 2026-04-18T09:25:13.964Z | artifact_changed | design | 同步设计文档：.limcode/design/experimental-multi-pack-runtime-registry-design.md
- 2026-04-18T09:29:00.426Z | artifact_changed | plan | 同步计划文档：.limcode/plans/experimental-multi-pack-runtime-registry-implementation.plan.md
- 2026-04-18T09:34:48.279Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/experimental-multi-pack-runtime-registry-implementation.plan.md
- 2026-04-18T09:35:05.766Z | updated | phase5a-runtime-registry-foundation | 开始执行 Phase 5A，先为 experimental multi-pack runtime registry 增加 feature flag、runtime config 与基础抽象骨架。
- 2026-04-18T09:46:02.487Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/experimental-multi-pack-runtime-registry-implementation.plan.md
- 2026-04-18T09:46:22.221Z | milestone_recorded | PG5 | 记录里程碑：Phase 5A：experimental multi-pack runtime registry 基础骨架完成
- 2026-04-18T10:05:47.023Z | updated | phase5b-pack-local-isolation | 扩展 PackRuntimeInstance 与 experimental multi-pack runtime service，补 system health vs per-pack runtime health split、pack-local runtime speed/clock snapshot，并通过 lint 与 unit tests。
- 2026-04-18T10:13:47.885Z | milestone_recorded | PG6 | 记录里程碑：Phase 5B：scheduler lease/cursor 已接入 pack-scoped partition scope
- 2026-04-18T10:18:16.888Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/experimental-multi-pack-runtime-registry-implementation.plan.md
- 2026-04-18T10:18:34.275Z | updated | phase5c-experimental-operator-api | 开始接入 experimental operator/test-only runtime API，先开放 registry list、system health、per-pack status 与 clock 只读接口，并增加默认关闭/显式开启的 e2e 验证。
- 2026-04-18T10:29:28.556Z | updated | phase5c-experimental-operator-api | experimental operator API 已支持显式 load/unload，以及 pack-scoped scheduler summary/ownership/workers/operator 只读接口，并通过 e2e、lint、typecheck 验证。
- 2026-04-20T07:04:58.294Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/experimental-multi-pack-runtime-registry-implementation.plan.md
- 2026-04-20T07:05:46.344Z | updated | phase5d-plugin-projection-compat | 按当前决策收口 Phase 5C，剩余增强项留给 docs/ENHANCEMENTS.md；正式开始 Phase 5D，进入 plugin runtime / projection / route scope 兼容层。
- 2026-04-20T07:57:14.559Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/experimental-multi-pack-runtime-registry-implementation.plan.md
- 2026-04-20T07:57:34.858Z | updated | phase5d-plugin-projection-compat | Phase 5D completed: added conservative experimental pack-local plugin runtime / projection / route compatibility surfaces while preserving stable active-pack guards and canonical contracts.
- 2026-04-20T07:57:34.858Z | updated | phase5e-tests-docs-rollout | Phase 5E completed: synced focused regression coverage and rollout documentation across API, architecture, plugin runtime, commands, and DB operations guidance.
- 2026-04-20T07:57:34.858Z | milestone_recorded | phase5-complete | Phase 5 experimental multi-pack runtime registry finished with all plan todos completed and stable single-pack behavior preserved by default.
<!-- LIMCODE_PROGRESS_LOG_END -->

<!-- LIMCODE_PROGRESS_METADATA_START -->
{
  "formatVersion": 1,
  "kind": "limcode.progress",
  "projectId": "yidhras",
  "projectName": "Yidhras",
  "createdAt": "2026-04-17T21:05:29.611Z",
  "updatedAt": "2026-04-20T07:57:34.858Z",
  "status": "completed",
  "phase": "implementation",
  "currentFocus": "Phase 5 experimental multi-pack runtime registry implementation fully completed; stable single active-pack contracts preserved while experimental multi-pack remains default-off and operator/test-only.",
  "latestConclusion": "Phase 5A-5E are complete. The implementation now includes a conservative experimental PackRuntimeRegistry / PackRuntimeHandle / PackRuntimeHost model, pack-local scheduler/plugin/projection compatibility paths, experimental operator and projection APIs, focused regression coverage, and rollout documentation without weakening stable `/api/status`, `/api/packs/:packId/overview`, `/api/packs/:packId/projections/timeline`, or `PACK_ROUTE_ACTIVE_PACK_MISMATCH`.",
  "currentBlocker": null,
  "nextAction": "Start a final Phase 5 review/summary pass or move on to the next milestone after experimental multi-pack runtime registry.",
  "activeArtifacts": {
    "design": ".limcode/design/experimental-multi-pack-runtime-registry-design.md",
    "plan": ".limcode/plans/experimental-multi-pack-runtime-registry-implementation.plan.md",
    "review": ".limcode/review/multi-pack-runtime-experimental-assessment.md"
  },
  "todos": [
    {
      "id": "phase5a-runtime-registry-foundation",
      "content": "建立 experimental multi-pack runtime registry 基础：feature flag、runtime config、PackRuntimeRegistry / PackRuntimeHandle / PackRuntimeHost 骨架",
      "status": "completed"
    },
    {
      "id": "phase5b-pack-local-isolation",
      "content": "落 pack-local 隔离基础：clock、runtime speed、scheduler scope、startup/health 模型与 `(pack_id, partition_id)` 调度作用域",
      "status": "completed"
    },
    {
      "id": "phase5c-experimental-operator-api",
      "content": "提供 experimental operator/test-only API：pack runtime load/unload/list/status/clock/scheduler 观察面",
      "status": "completed"
    },
    {
      "id": "phase5d-plugin-projection-compat",
      "content": "补 pack-local plugin runtime / projection / route scope 兼容层，确保不破坏当前单 active-pack 稳定 contract",
      "status": "completed"
    },
    {
      "id": "phase5e-tests-docs-rollout",
      "content": "补实验性测试、文档与启用说明，明确默认关闭、风险边界与试用反馈路径",
      "status": "completed"
    }
  ],
  "milestones": [
    {
      "id": "PG1",
      "title": "数据库边界治理第一阶段完成",
      "status": "completed",
      "summary": "已完成 workflow/scheduler、action dispatcher、scheduler runtime 的 repository 收口，移除业务层 context.sim.prisma 穿透访问，并清理 inference_workflow 旧兼容壳文件与收尾 lint/typecheck 问题。",
      "relatedTodoIds": [
        "phase1-guardrails",
        "phase1-workflow-scheduler",
        "phase1-action-dispatcher",
        "phase1-remove-runtime-penetration",
        "phase1-scheduler-runtime",
        "phase1-cleanup-compat"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/database-boundary-governance-phase1-design.md",
        "plan": ".limcode/plans/database-boundary-governance-phase1-implementation.plan.md"
      },
      "completedAt": "2026-04-17T21:41:31.140Z",
      "recordedAt": "2026-04-17T21:41:31.140Z",
      "nextAction": "进入下一阶段工作，或按需要继续压缩 AppContext.prisma 暴露面。"
    },
    {
      "id": "phase2a-variable-context",
      "title": "第二阶段 Phase 2A 变量层正式化完成",
      "status": "completed",
      "summary": "已完成 PromptVariableContext 正式类型、变量层上下文构建、NarrativeResolver 统一门面、prompt/perception/simulation 调用点接入以及基础变量解析 diagnostics，并通过 server typecheck。",
      "relatedTodoIds": [
        "phase2a-contract-types",
        "phase2a-context-builders",
        "phase2a-renderer-facade",
        "phase2a-caller-integration",
        "phase2a-diagnostics"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/world-pack-prompt-macro-variable-formalization-design.md",
        "plan": ".limcode/plans/world-pack-prompt-macro-variable-formalization-implementation.plan.md"
      },
      "completedAt": "2026-04-17T22:17:00.000Z",
      "recordedAt": "2026-04-17T22:25:23.271Z",
      "nextAction": "继续在统一渲染器上实现 default / if / each 三类受控宏能力，并补对应测试。"
    },
    {
      "id": "phase2b-macro-runtime",
      "title": "第二阶段 Phase 2B 宏能力与测试完成",
      "status": "completed",
      "summary": "统一渲染器已支持 default、if、each 三类受控宏能力，并增加输出长度护栏、基础错误占位与 narrative/workflow 相关单元测试；lint、typecheck 与针对性 unit tests 均已通过。",
      "relatedTodoIds": [
        "phase2b-macro-runtime",
        "phase2b-tests"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/world-pack-prompt-macro-variable-formalization-design.md",
        "plan": ".limcode/plans/world-pack-prompt-macro-variable-formalization-implementation.plan.md"
      },
      "completedAt": "2026-04-17T22:33:00.000Z",
      "recordedAt": "2026-04-17T22:33:38.734Z",
      "nextAction": "更新 Prompt Workflow / World Pack 文档与示例模板，收口命名空间规范、兼容边界与新宏能力说明。"
    },
    {
      "id": "PG2",
      "title": "Phase A：runtime config contract 完成",
      "status": "completed",
      "summary": "已完成单世界包多实体并发的 Phase A：扩展 runtime config schema，新增 entity_concurrency / tick_budget / runner concurrency 配置与 getter，更新内建默认值与 configw default 模板，并补充 runtime_config 单测验证 YAML 与环境变量覆盖行为。",
      "relatedTodoIds": [
        "plan-phase-a-config-contract"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/single-pack-multi-entity-concurrent-request-design.md",
        "plan": ".limcode/plans/single-pack-multi-entity-concurrent-request-implementation.plan.md"
      },
      "completedAt": "2026-04-18T08:41:07.845Z",
      "recordedAt": "2026-04-18T08:41:07.845Z",
      "nextAction": "进入 Phase B，先把 decision job runner 与 action dispatcher runner 改造为受限并发池。"
    },
    {
      "id": "PG3",
      "title": "Phase C：实体级 single-flight 与 activity budget 落地",
      "status": "completed",
      "summary": "已完成 Phase C：新增统一 active workflow 查询模块 entity_activity_query，scheduler readiness 已接入 entity_concurrency / tick_budget，并在 decision job runner 与 action dispatcher runner 中加入 claim 后的实体级 single-flight 复核。已补充单元与集成测试验证相同行为主体下的 single-flight 约束。",
      "relatedTodoIds": [
        "plan-phase-c-single-flight"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/single-pack-multi-entity-concurrent-request-design.md",
        "plan": ".limcode/plans/single-pack-multi-entity-concurrent-request-implementation.plan.md"
      },
      "completedAt": "2026-04-18T08:58:26.400Z",
      "recordedAt": "2026-04-18T08:58:26.400Z",
      "nextAction": "进入 Phase D，补 observability、部署文档与并发调优说明。"
    },
    {
      "id": "PG4",
      "title": "单世界包多实体并发请求第四阶段完成",
      "status": "completed",
      "summary": "已完成单 active pack 前提下的多实体受控并发落地：runtime config 已新增 entity_concurrency / tick_budget / runner concurrency；decision job runner 与 action dispatcher runner 已改为受限并发池；scheduler readiness 与 runner claim 后复核已落实实体级 single-flight；并已补充测试、架构与部署调优文档，并通过 lint、typecheck、unit 与 integration 验证。",
      "relatedTodoIds": [
        "plan-phase-a-config-contract",
        "plan-phase-b-runner-concurrency",
        "plan-phase-c-single-flight",
        "plan-phase-d-observability-docs"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/single-pack-multi-entity-concurrent-request-design.md",
        "plan": ".limcode/plans/single-pack-multi-entity-concurrent-request-implementation.plan.md"
      },
      "completedAt": "2026-04-18T09:05:02.279Z",
      "recordedAt": "2026-04-18T09:05:02.279Z",
      "nextAction": "回看 TODO.md 的第四阶段条目，必要时同步勾选或继续评估第五阶段多世界包同时运行的前置条件。"
    },
    {
      "id": "PG5",
      "title": "Phase 5A：experimental multi-pack runtime registry 基础骨架完成",
      "status": "completed",
      "summary": "已完成 experimental multi-pack runtime registry 的第一阶段：扩展 runtime config schema 与默认值，加入 experimental multi-pack feature flag / runtime.multi_pack 配置、env override、snapshot getter；建立 PackRuntimeRegistry / PackRuntimeHandle / PackRuntimeHost / pack runtime health 基础抽象，并在 SimulationManager 中接入最小 registry facade；补充 runtime_config 与 pack_runtime_registry 单测验证。",
      "relatedTodoIds": [
        "phase5a-runtime-registry-foundation"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/experimental-multi-pack-runtime-registry-design.md",
        "plan": ".limcode/plans/experimental-multi-pack-runtime-registry-implementation.plan.md"
      },
      "completedAt": "2026-04-18T09:46:22.221Z",
      "recordedAt": "2026-04-18T09:46:22.221Z",
      "nextAction": "进入 Phase 5B，开始拆 pack-local clock、runtime speed 与 `(pack_id, partition_id)` scheduler scope。"
    },
    {
      "id": "PG6",
      "title": "Phase 5B：scheduler lease/cursor 已接入 pack-scoped partition scope",
      "status": "completed",
      "summary": "在不破坏当前单 active-pack 稳定模式的前提下，为 scheduler lease/cursor 引入 pack-scoped partition scope 支持。新增 `multi_pack_scheduler_scope.ts` 的解析辅助能力，并将 `scheduler_lease.ts` 扩展为可接受形如 `pack_id::p0` 的 scoped partition id；这样不同 pack 可以独立持有相同 partition id 的 lease/cursor 记录而不互相覆盖。新增集成测试 `tests/integration/scheduler-pack-scope.spec.ts` 验证 pack-scoped lease/cursor/release 行为，并通过 lint、typecheck 与相关 integration tests。",
      "relatedTodoIds": [
        "phase5b-pack-local-isolation"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/experimental-multi-pack-runtime-registry-design.md",
        "plan": ".limcode/plans/experimental-multi-pack-runtime-registry-implementation.plan.md"
      },
      "completedAt": "2026-04-18T10:13:47.885Z",
      "recordedAt": "2026-04-18T10:13:47.885Z",
      "nextAction": "继续 Phase 5B/5C 交界：把 ownership/status 读面与 experimental operator API 接到新的 pack-local runtime 与 scheduler scope。"
    }
  ],
  "risks": [],
  "log": [
    {
      "at": "2026-04-18T09:20:58.806Z",
      "type": "artifact_changed",
      "refId": "review",
      "message": "同步审查文档：.limcode/review/multi-pack-runtime-experimental-assessment.md"
    },
    {
      "at": "2026-04-18T09:21:17.218Z",
      "type": "artifact_changed",
      "refId": "experimental-multi-pack-runtime-registry-design",
      "message": "开始创建第五阶段 experimental multi-pack runtime registry 设计文档。"
    },
    {
      "at": "2026-04-18T09:22:28.547Z",
      "type": "artifact_changed",
      "refId": "review",
      "message": "同步审查里程碑：M1"
    },
    {
      "at": "2026-04-18T09:25:13.964Z",
      "type": "artifact_changed",
      "refId": "design",
      "message": "同步设计文档：.limcode/design/experimental-multi-pack-runtime-registry-design.md"
    },
    {
      "at": "2026-04-18T09:29:00.426Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划文档：.limcode/plans/experimental-multi-pack-runtime-registry-implementation.plan.md"
    },
    {
      "at": "2026-04-18T09:34:48.279Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/experimental-multi-pack-runtime-registry-implementation.plan.md"
    },
    {
      "at": "2026-04-18T09:35:05.766Z",
      "type": "updated",
      "refId": "phase5a-runtime-registry-foundation",
      "message": "开始执行 Phase 5A，先为 experimental multi-pack runtime registry 增加 feature flag、runtime config 与基础抽象骨架。"
    },
    {
      "at": "2026-04-18T09:46:02.487Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/experimental-multi-pack-runtime-registry-implementation.plan.md"
    },
    {
      "at": "2026-04-18T09:46:22.221Z",
      "type": "milestone_recorded",
      "refId": "PG5",
      "message": "记录里程碑：Phase 5A：experimental multi-pack runtime registry 基础骨架完成"
    },
    {
      "at": "2026-04-18T10:05:47.023Z",
      "type": "updated",
      "refId": "phase5b-pack-local-isolation",
      "message": "扩展 PackRuntimeInstance 与 experimental multi-pack runtime service，补 system health vs per-pack runtime health split、pack-local runtime speed/clock snapshot，并通过 lint 与 unit tests。"
    },
    {
      "at": "2026-04-18T10:13:47.885Z",
      "type": "milestone_recorded",
      "refId": "PG6",
      "message": "记录里程碑：Phase 5B：scheduler lease/cursor 已接入 pack-scoped partition scope"
    },
    {
      "at": "2026-04-18T10:18:16.888Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/experimental-multi-pack-runtime-registry-implementation.plan.md"
    },
    {
      "at": "2026-04-18T10:18:34.275Z",
      "type": "updated",
      "refId": "phase5c-experimental-operator-api",
      "message": "开始接入 experimental operator/test-only runtime API，先开放 registry list、system health、per-pack status 与 clock 只读接口，并增加默认关闭/显式开启的 e2e 验证。"
    },
    {
      "at": "2026-04-18T10:29:28.556Z",
      "type": "updated",
      "refId": "phase5c-experimental-operator-api",
      "message": "experimental operator API 已支持显式 load/unload，以及 pack-scoped scheduler summary/ownership/workers/operator 只读接口，并通过 e2e、lint、typecheck 验证。"
    },
    {
      "at": "2026-04-20T07:04:58.294Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/experimental-multi-pack-runtime-registry-implementation.plan.md"
    },
    {
      "at": "2026-04-20T07:05:46.344Z",
      "type": "updated",
      "refId": "phase5d-plugin-projection-compat",
      "message": "按当前决策收口 Phase 5C，剩余增强项留给 docs/ENHANCEMENTS.md；正式开始 Phase 5D，进入 plugin runtime / projection / route scope 兼容层。"
    },
    {
      "at": "2026-04-20T07:57:14.559Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/experimental-multi-pack-runtime-registry-implementation.plan.md"
    },
    {
      "at": "2026-04-20T07:57:34.858Z",
      "type": "updated",
      "refId": "phase5d-plugin-projection-compat",
      "message": "Phase 5D completed: added conservative experimental pack-local plugin runtime / projection / route compatibility surfaces while preserving stable active-pack guards and canonical contracts."
    },
    {
      "at": "2026-04-20T07:57:34.858Z",
      "type": "updated",
      "refId": "phase5e-tests-docs-rollout",
      "message": "Phase 5E completed: synced focused regression coverage and rollout documentation across API, architecture, plugin runtime, commands, and DB operations guidance."
    },
    {
      "at": "2026-04-20T07:57:34.858Z",
      "type": "milestone_recorded",
      "refId": "phase5-complete",
      "message": "Phase 5 experimental multi-pack runtime registry finished with all plan todos completed and stable single-pack behavior preserved by default."
    }
  ],
  "stats": {
    "milestonesTotal": 8,
    "milestonesCompleted": 8,
    "todosTotal": 5,
    "todosCompleted": 5,
    "todosInProgress": 0,
    "todosCancelled": 0,
    "activeRisks": 0
  },
  "render": {
    "rendererVersion": 1,
    "generatedAt": "2026-04-20T07:57:34.858Z",
    "bodyHash": "sha256:de8437d14f4294a0c3758a7ef4ad978dc2a0a46b5101ad39f18b2a39dc54bde8"
  }
}
<!-- LIMCODE_PROGRESS_METADATA_END -->
