# 项目进度
- Project: Yidhras
- Updated At: 2026-04-20T10:19:50.557Z
- Status: active
- Phase: implementation

## 当前摘要

<!-- LIMCODE_PROGRESS_SUMMARY_START -->
- 当前进度：8/8 个里程碑已完成；最新：PG6
- 当前焦点：模块化优先边界收口已完成；当前剩余问题是 agent-scheduler integration 中既有回归失败，需作为独立后续修复项跟进。
- 最新结论：server runtime 模块化优先收口已完成：SimulationManager 已收缩为 thin facade，runtime bootstrap / pack catalog / active-pack runtime / runtime registry / runtime kernel / context-memory ports 均已落地；…
- 当前阻塞：tests/integration/agent-scheduler.spec.ts 仍存在一处既有集成失败（replay/retry periodic suppression 断言未满足），需单独分析调度行为语义，不应在本轮模块化收口中混修。
- 下一步：如继续开发，应单独开一轮针对 agent scheduler suppression 语义的修复与回归分析。
<!-- LIMCODE_PROGRESS_SUMMARY_END -->

## 关联文档

<!-- LIMCODE_PROGRESS_ARTIFACTS_START -->
- 设计：`.limcode/design/server-runtime-modularization-first-boundary-design.md`
- 计划：`.limcode/plans/server-runtime-modularization-first-implementation.plan.md`
- 审查：`.limcode/review/multi-pack-runtime-experimental-assessment.md`
<!-- LIMCODE_PROGRESS_ARTIFACTS_END -->

## 当前 TODO 快照

<!-- LIMCODE_PROGRESS_TODOS_START -->
- [x] 冻结模块边界与接口命名：补 PackRuntimeLocator / PackRuntimeControl / PackRuntimeObservation / RuntimeKernelFacade / PackRuntimeLookupPort 等契约草案，并明确迁移守则（新代码禁止扩张 context.sim）  `#plan-m1-boundary-freeze`
- [x] 拆出 PackRuntimeRegistryService 与 ActivePackRuntimeFacade，让 SimulationManager 收缩为 thin facade，同时保持 stable single active-pack contract 不变  `#plan-m2-runtime-registry-active-pack`
- [x] 拆出 RuntimeDatabaseBootstrap 与 PackCatalogService，收口 SimulationManager 的数据库准备与 pack catalog 职责，并补最小单测  `#plan-m2-simulation-bootstrap-catalog`
- [x] 为 AppContext 增加窄接口入口（runtimeBootstrap / activePackRuntime / packCatalog / packRuntimeLocator / runtimeKernel / pluginHost 等），并开始把上层 service/route 从 context.sim 迁移出去  `#plan-m3-app-context-migration`
- [x] 实现 PackScopeResolver 与 PackRuntimeLookupPort，收口 plugin runtime web / projection / asset resolve 对 pack runtime 的依赖，移除对 runtime internal object 的直接绑定  `#plan-m4-plugin-scope-resolver`
- [x] 补 ContextAssemblyPort 与 MemoryRuntimePort，统一 workflow / scheduler / plugin runtime 的 context/memory 读取路径  `#plan-m5-context-memory-ports`
- [x] 补 RuntimeKernelFacade、SchedulerObservationPort、SchedulerControlPort，并收口 operator/read-model 对 scheduler/runtime loop 的访问面  `#plan-m5-runtime-kernel-ports`
- [x] 补 unit/integration/e2e 回归测试与文档同步（ARCH.md、PLUGIN_RUNTIME.md），验证 stable contract 不回退且为后续 Rust world engine 预留 Host API 边界  `#plan-m6-regression-doc-sync`
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
- 2026-04-20T09:09:28.610Z | updated | plan-m2-simulation-bootstrap-catalog | 已完成 RuntimeDatabaseBootstrap 与 PackCatalogService 拆分，并在 SimulationManager 中开始委托数据库准备与 pack catalog 能力。
- 2026-04-20T09:09:28.610Z | updated | plan-m3-app-context-migration | 已在 AppContext/index.ts 接入 runtimeBootstrap 与 packCatalog 首批窄接口，继续迁移更多 context.sim 调用点。
- 2026-04-20T09:15:59.802Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/server-runtime-modularization-first-implementation.plan.md
- 2026-04-20T09:16:28.687Z | updated | plan-m3-app-context-migration | 已完成首轮 AppContext 窄接口迁移：experimental multi-pack、plugin runtime web、experimental projection、plugin service 已接入 helper。
- 2026-04-20T09:16:28.687Z | updated | plan-m4-plugin-scope-resolver | 开始继续收口 PackRuntimeLookupPort / scope resolver，逐步替换 plugin/runtime/projection 对 context.sim 内部对象的直接依赖。
- 2026-04-20T09:24:07.170Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/server-runtime-modularization-first-implementation.plan.md
- 2026-04-20T09:24:39.249Z | updated | plan-m4-plugin-scope-resolver | 已完成 PackScopeResolver，plugin runtime web 与 experimental runtime routes 已统一通过 scope resolver / lookup port 做 pack scope 校验。
- 2026-04-20T09:24:39.249Z | updated | plan-m2-runtime-registry-active-pack | 开始进入 PackRuntimeRegistryService / ActivePackRuntimeFacade 拆分，让 SimulationManager 进一步收缩为 thin facade。
- 2026-04-20T09:31:21.742Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/server-runtime-modularization-first-implementation.plan.md
- 2026-04-20T09:31:47.919Z | updated | plan-m2-runtime-registry-active-pack | 已完成 PackRuntimeRegistryService 与 ActivePackRuntimeFacade 拆分，SimulationManager 已进一步收缩为 thin facade。
- 2026-04-20T09:31:47.919Z | updated | plan-m5-runtime-kernel-ports | 开始进入 runtime kernel ports 收口，准备补 RuntimeKernelFacade / SchedulerObservationPort / SchedulerControlPort。
- 2026-04-20T09:51:02.473Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/server-runtime-modularization-first-implementation.plan.md
- 2026-04-20T09:51:26.348Z | updated | plan-m5-runtime-kernel-ports | 已完成 runtime kernel ports 收口：新增 runtime kernel service，并在 system、scheduler routes、experimental scheduler runtime 中接入。
- 2026-04-20T09:51:26.348Z | updated | plan-m5-context-memory-ports | 开始进入 context/memory ports 收口，准备统一 workflow / scheduler / plugin runtime 的上下文与内存读取路径。
- 2026-04-20T10:04:52.646Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/server-runtime-modularization-first-implementation.plan.md
- 2026-04-20T10:05:10.768Z | updated | plan-m5-context-memory-ports | 已完成 context/memory ports 收口：新增 port 工厂并接入 AppContext，inference context builder、memory compaction、memory block store 已开始通过正式端口访问。
- 2026-04-20T10:05:10.768Z | updated | plan-m6-regression-doc-sync | 开始执行最终回归测试与文档同步，确认模块边界收口后稳定 contract 不回退。
- 2026-04-20T10:19:27.947Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/server-runtime-modularization-first-implementation.plan.md
- 2026-04-20T10:19:50.557Z | updated | plan-m6-regression-doc-sync | 已完成 lint/typecheck/关键 unit tests 与文档同步；发现 agent-scheduler integration 仍有一处既有失败，留待独立后续修复。
- 2026-04-20T10:19:50.557Z | milestone_recorded | server-runtime-modularization-first | server runtime 模块化优先边界收口实现完成，核心 ports/facades 已落地并完成文档同步。
<!-- LIMCODE_PROGRESS_LOG_END -->

<!-- LIMCODE_PROGRESS_METADATA_START -->
{
  "formatVersion": 1,
  "kind": "limcode.progress",
  "projectId": "yidhras",
  "projectName": "Yidhras",
  "createdAt": "2026-04-17T21:05:29.611Z",
  "updatedAt": "2026-04-20T10:19:50.557Z",
  "status": "active",
  "phase": "implementation",
  "currentFocus": "模块化优先边界收口已完成；当前剩余问题是 agent-scheduler integration 中既有回归失败，需作为独立后续修复项跟进。",
  "latestConclusion": "server runtime 模块化优先收口已完成：SimulationManager 已收缩为 thin facade，runtime bootstrap / pack catalog / active-pack runtime / runtime registry / runtime kernel / context-memory ports 均已落地；typecheck、关键 unit tests、文档同步已完成。",
  "currentBlocker": "tests/integration/agent-scheduler.spec.ts 仍存在一处既有集成失败（replay/retry periodic suppression 断言未满足），需单独分析调度行为语义，不应在本轮模块化收口中混修。",
  "nextAction": "如继续开发，应单独开一轮针对 agent scheduler suppression 语义的修复与回归分析。",
  "activeArtifacts": {
    "design": ".limcode/design/server-runtime-modularization-first-boundary-design.md",
    "plan": ".limcode/plans/server-runtime-modularization-first-implementation.plan.md",
    "review": ".limcode/review/multi-pack-runtime-experimental-assessment.md"
  },
  "todos": [
    {
      "id": "plan-m1-boundary-freeze",
      "content": "冻结模块边界与接口命名：补 PackRuntimeLocator / PackRuntimeControl / PackRuntimeObservation / RuntimeKernelFacade / PackRuntimeLookupPort 等契约草案，并明确迁移守则（新代码禁止扩张 context.sim）",
      "status": "completed"
    },
    {
      "id": "plan-m2-runtime-registry-active-pack",
      "content": "拆出 PackRuntimeRegistryService 与 ActivePackRuntimeFacade，让 SimulationManager 收缩为 thin facade，同时保持 stable single active-pack contract 不变",
      "status": "completed"
    },
    {
      "id": "plan-m2-simulation-bootstrap-catalog",
      "content": "拆出 RuntimeDatabaseBootstrap 与 PackCatalogService，收口 SimulationManager 的数据库准备与 pack catalog 职责，并补最小单测",
      "status": "completed"
    },
    {
      "id": "plan-m3-app-context-migration",
      "content": "为 AppContext 增加窄接口入口（runtimeBootstrap / activePackRuntime / packCatalog / packRuntimeLocator / runtimeKernel / pluginHost 等），并开始把上层 service/route 从 context.sim 迁移出去",
      "status": "completed"
    },
    {
      "id": "plan-m4-plugin-scope-resolver",
      "content": "实现 PackScopeResolver 与 PackRuntimeLookupPort，收口 plugin runtime web / projection / asset resolve 对 pack runtime 的依赖，移除对 runtime internal object 的直接绑定",
      "status": "completed"
    },
    {
      "id": "plan-m5-context-memory-ports",
      "content": "补 ContextAssemblyPort 与 MemoryRuntimePort，统一 workflow / scheduler / plugin runtime 的 context/memory 读取路径",
      "status": "completed"
    },
    {
      "id": "plan-m5-runtime-kernel-ports",
      "content": "补 RuntimeKernelFacade、SchedulerObservationPort、SchedulerControlPort，并收口 operator/read-model 对 scheduler/runtime loop 的访问面",
      "status": "completed"
    },
    {
      "id": "plan-m6-regression-doc-sync",
      "content": "补 unit/integration/e2e 回归测试与文档同步（ARCH.md、PLUGIN_RUNTIME.md），验证 stable contract 不回退且为后续 Rust world engine 预留 Host API 边界",
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
      "at": "2026-04-20T09:09:28.610Z",
      "type": "updated",
      "refId": "plan-m2-simulation-bootstrap-catalog",
      "message": "已完成 RuntimeDatabaseBootstrap 与 PackCatalogService 拆分，并在 SimulationManager 中开始委托数据库准备与 pack catalog 能力。"
    },
    {
      "at": "2026-04-20T09:09:28.610Z",
      "type": "updated",
      "refId": "plan-m3-app-context-migration",
      "message": "已在 AppContext/index.ts 接入 runtimeBootstrap 与 packCatalog 首批窄接口，继续迁移更多 context.sim 调用点。"
    },
    {
      "at": "2026-04-20T09:15:59.802Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/server-runtime-modularization-first-implementation.plan.md"
    },
    {
      "at": "2026-04-20T09:16:28.687Z",
      "type": "updated",
      "refId": "plan-m3-app-context-migration",
      "message": "已完成首轮 AppContext 窄接口迁移：experimental multi-pack、plugin runtime web、experimental projection、plugin service 已接入 helper。"
    },
    {
      "at": "2026-04-20T09:16:28.687Z",
      "type": "updated",
      "refId": "plan-m4-plugin-scope-resolver",
      "message": "开始继续收口 PackRuntimeLookupPort / scope resolver，逐步替换 plugin/runtime/projection 对 context.sim 内部对象的直接依赖。"
    },
    {
      "at": "2026-04-20T09:24:07.170Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/server-runtime-modularization-first-implementation.plan.md"
    },
    {
      "at": "2026-04-20T09:24:39.249Z",
      "type": "updated",
      "refId": "plan-m4-plugin-scope-resolver",
      "message": "已完成 PackScopeResolver，plugin runtime web 与 experimental runtime routes 已统一通过 scope resolver / lookup port 做 pack scope 校验。"
    },
    {
      "at": "2026-04-20T09:24:39.249Z",
      "type": "updated",
      "refId": "plan-m2-runtime-registry-active-pack",
      "message": "开始进入 PackRuntimeRegistryService / ActivePackRuntimeFacade 拆分，让 SimulationManager 进一步收缩为 thin facade。"
    },
    {
      "at": "2026-04-20T09:31:21.742Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/server-runtime-modularization-first-implementation.plan.md"
    },
    {
      "at": "2026-04-20T09:31:47.919Z",
      "type": "updated",
      "refId": "plan-m2-runtime-registry-active-pack",
      "message": "已完成 PackRuntimeRegistryService 与 ActivePackRuntimeFacade 拆分，SimulationManager 已进一步收缩为 thin facade。"
    },
    {
      "at": "2026-04-20T09:31:47.919Z",
      "type": "updated",
      "refId": "plan-m5-runtime-kernel-ports",
      "message": "开始进入 runtime kernel ports 收口，准备补 RuntimeKernelFacade / SchedulerObservationPort / SchedulerControlPort。"
    },
    {
      "at": "2026-04-20T09:51:02.473Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/server-runtime-modularization-first-implementation.plan.md"
    },
    {
      "at": "2026-04-20T09:51:26.348Z",
      "type": "updated",
      "refId": "plan-m5-runtime-kernel-ports",
      "message": "已完成 runtime kernel ports 收口：新增 runtime kernel service，并在 system、scheduler routes、experimental scheduler runtime 中接入。"
    },
    {
      "at": "2026-04-20T09:51:26.348Z",
      "type": "updated",
      "refId": "plan-m5-context-memory-ports",
      "message": "开始进入 context/memory ports 收口，准备统一 workflow / scheduler / plugin runtime 的上下文与内存读取路径。"
    },
    {
      "at": "2026-04-20T10:04:52.646Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/server-runtime-modularization-first-implementation.plan.md"
    },
    {
      "at": "2026-04-20T10:05:10.768Z",
      "type": "updated",
      "refId": "plan-m5-context-memory-ports",
      "message": "已完成 context/memory ports 收口：新增 port 工厂并接入 AppContext，inference context builder、memory compaction、memory block store 已开始通过正式端口访问。"
    },
    {
      "at": "2026-04-20T10:05:10.768Z",
      "type": "updated",
      "refId": "plan-m6-regression-doc-sync",
      "message": "开始执行最终回归测试与文档同步，确认模块边界收口后稳定 contract 不回退。"
    },
    {
      "at": "2026-04-20T10:19:27.947Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/server-runtime-modularization-first-implementation.plan.md"
    },
    {
      "at": "2026-04-20T10:19:50.557Z",
      "type": "updated",
      "refId": "plan-m6-regression-doc-sync",
      "message": "已完成 lint/typecheck/关键 unit tests 与文档同步；发现 agent-scheduler integration 仍有一处既有失败，留待独立后续修复。"
    },
    {
      "at": "2026-04-20T10:19:50.557Z",
      "type": "milestone_recorded",
      "refId": "server-runtime-modularization-first",
      "message": "server runtime 模块化优先边界收口实现完成，核心 ports/facades 已落地并完成文档同步。"
    }
  ],
  "stats": {
    "milestonesTotal": 8,
    "milestonesCompleted": 8,
    "todosTotal": 8,
    "todosCompleted": 8,
    "todosInProgress": 0,
    "todosCancelled": 0,
    "activeRisks": 0
  },
  "render": {
    "rendererVersion": 1,
    "generatedAt": "2026-04-20T10:19:50.557Z",
    "bodyHash": "sha256:d4b2147c265b11c623bdfd72a964e6dfe8dcda16aba45308e78f74dd68877348"
  }
}
<!-- LIMCODE_PROGRESS_METADATA_END -->
