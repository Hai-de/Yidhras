# 项目进度
- Project: Yidhras
- Updated At: 2026-04-18T09:05:02.279Z
- Status: active
- Phase: implementation

## 当前摘要

<!-- LIMCODE_PROGRESS_SUMMARY_START -->
- 当前进度：6/6 个里程碑已完成；最新：PG4
- 当前焦点：Phase C：补强 scheduler readiness 与 runner claim 后复核，落实实体级 single-flight / activity budget
- 最新结论：单世界包内的多实体并发请求已经形成正式配置、执行与文档闭环，可以在保守默认值下运行，并由部署者按数据库能力自行调优。
- 下一步：回看 TODO.md 的第四阶段条目，必要时同步勾选或继续评估第五阶段多世界包同时运行的前置条件。
<!-- LIMCODE_PROGRESS_SUMMARY_END -->

## 关联文档

<!-- LIMCODE_PROGRESS_ARTIFACTS_START -->
- 设计：`.limcode/design/single-pack-multi-entity-concurrent-request-design.md`
- 计划：`.limcode/plans/single-pack-multi-entity-concurrent-request-implementation.plan.md`
<!-- LIMCODE_PROGRESS_ARTIFACTS_END -->

## 当前 TODO 快照

<!-- LIMCODE_PROGRESS_TODOS_START -->
- [x] 补 runtime config contract：新增 entity_concurrency / tick_budget / runner concurrency 配置、schema 与默认值  `#plan-phase-a-config-contract`
- [x] 将 decision job runner 与 action dispatcher runner 改为受限并发池，保持 claim/lock/ownership 契约不变  `#plan-phase-b-runner-concurrency`
- [x] 补强 scheduler readiness 与 runner claim 后复核，正式落实实体级 single-flight / activity budget  `#plan-phase-c-single-flight`
- [x] 补充并发相关 observability、测试与部署调优文档  `#plan-phase-d-observability-docs`
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
<!-- LIMCODE_PROGRESS_MILESTONES_END -->

## 风险与阻塞

<!-- LIMCODE_PROGRESS_RISKS_START -->
<!-- 暂无风险 -->
<!-- LIMCODE_PROGRESS_RISKS_END -->

## 最近更新

<!-- LIMCODE_PROGRESS_LOG_START -->
- 2026-04-17T22:25:37.111Z | updated | 进入 Phase 2B，开始在统一渲染器上扩展 default / if / each 受控宏能力。
- 2026-04-17T22:33:30.445Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/world-pack-prompt-macro-variable-formalization-implementation.plan.md
- 2026-04-17T22:33:38.734Z | milestone_recorded | phase2b-macro-runtime | 记录里程碑：第二阶段 Phase 2B 宏能力与测试完成
- 2026-04-17T22:38:36.556Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/world-pack-prompt-macro-variable-formalization-implementation.plan.md
- 2026-04-17T22:38:52.272Z | artifact_changed | docs | 已更新 Prompt Workflow / World Pack 文档，补充变量命名空间、宏语法与上手说明。
- 2026-04-17T22:38:52.272Z | milestone_recorded | phase2c-docs-templates | 完成第二阶段文档与模板收口：使用文档可指导作者与使用者上手，death_note 模板已切换到 namespaced 写法。
- 2026-04-17T22:41:27.345Z | updated | 开始开发环境下的第二阶段额外收尾：允许进行更大规模的裸 key 模板占位符替换，以继续减少技术债。
- 2026-04-17T22:46:40.822Z | updated | 完成开发环境额外清理：大规模替换残留裸 key 模板占位符与旧 invocation 占位符写法，进一步压缩后续变量系统技术债。
- 2026-04-18T07:58:09.941Z | artifact_changed | design | 同步设计文档：.limcode/design/single-pack-multi-entity-concurrent-request-design.md
- 2026-04-18T08:31:35.157Z | artifact_changed | plan | 同步计划文档：.limcode/plans/single-pack-multi-entity-concurrent-request-implementation.plan.md
- 2026-04-18T08:35:04.968Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/single-pack-multi-entity-concurrent-request-implementation.plan.md
- 2026-04-18T08:35:13.877Z | updated | plan-phase-a-config-contract | 开始执行 Phase A，准备扩展 runtime config schema、默认值与示例配置。
- 2026-04-18T08:40:58.809Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/single-pack-multi-entity-concurrent-request-implementation.plan.md
- 2026-04-18T08:41:07.845Z | milestone_recorded | PG2 | 记录里程碑：Phase A：runtime config contract 完成
- 2026-04-18T08:44:31.335Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/single-pack-multi-entity-concurrent-request-implementation.plan.md
- 2026-04-18T08:44:41.554Z | updated | plan-phase-b-runner-concurrency | 完成 Phase B：新增通用受限并发池，并将 decision job runner / action dispatcher runner 改造为配置驱动的并发执行。
- 2026-04-18T08:58:17.533Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/single-pack-multi-entity-concurrent-request-implementation.plan.md
- 2026-04-18T08:58:26.400Z | milestone_recorded | PG3 | 记录里程碑：Phase C：实体级 single-flight 与 activity budget 落地
- 2026-04-18T09:04:52.041Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/single-pack-multi-entity-concurrent-request-implementation.plan.md
- 2026-04-18T09:05:02.279Z | milestone_recorded | PG4 | 记录里程碑：单世界包多实体并发请求第四阶段完成
<!-- LIMCODE_PROGRESS_LOG_END -->

<!-- LIMCODE_PROGRESS_METADATA_START -->
{
  "formatVersion": 1,
  "kind": "limcode.progress",
  "projectId": "yidhras",
  "projectName": "Yidhras",
  "createdAt": "2026-04-17T21:05:29.611Z",
  "updatedAt": "2026-04-18T09:05:02.279Z",
  "status": "active",
  "phase": "implementation",
  "currentFocus": "Phase C：补强 scheduler readiness 与 runner claim 后复核，落实实体级 single-flight / activity budget",
  "latestConclusion": "单世界包内的多实体并发请求已经形成正式配置、执行与文档闭环，可以在保守默认值下运行，并由部署者按数据库能力自行调优。",
  "currentBlocker": null,
  "nextAction": "回看 TODO.md 的第四阶段条目，必要时同步勾选或继续评估第五阶段多世界包同时运行的前置条件。",
  "activeArtifacts": {
    "design": ".limcode/design/single-pack-multi-entity-concurrent-request-design.md",
    "plan": ".limcode/plans/single-pack-multi-entity-concurrent-request-implementation.plan.md"
  },
  "todos": [
    {
      "id": "plan-phase-a-config-contract",
      "content": "补 runtime config contract：新增 entity_concurrency / tick_budget / runner concurrency 配置、schema 与默认值",
      "status": "completed"
    },
    {
      "id": "plan-phase-b-runner-concurrency",
      "content": "将 decision job runner 与 action dispatcher runner 改为受限并发池，保持 claim/lock/ownership 契约不变",
      "status": "completed"
    },
    {
      "id": "plan-phase-c-single-flight",
      "content": "补强 scheduler readiness 与 runner claim 后复核，正式落实实体级 single-flight / activity budget",
      "status": "completed"
    },
    {
      "id": "plan-phase-d-observability-docs",
      "content": "补充并发相关 observability、测试与部署调优文档",
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
    }
  ],
  "risks": [],
  "log": [
    {
      "at": "2026-04-17T22:25:37.111Z",
      "type": "updated",
      "message": "进入 Phase 2B，开始在统一渲染器上扩展 default / if / each 受控宏能力。"
    },
    {
      "at": "2026-04-17T22:33:30.445Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/world-pack-prompt-macro-variable-formalization-implementation.plan.md"
    },
    {
      "at": "2026-04-17T22:33:38.734Z",
      "type": "milestone_recorded",
      "refId": "phase2b-macro-runtime",
      "message": "记录里程碑：第二阶段 Phase 2B 宏能力与测试完成"
    },
    {
      "at": "2026-04-17T22:38:36.556Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/world-pack-prompt-macro-variable-formalization-implementation.plan.md"
    },
    {
      "at": "2026-04-17T22:38:52.272Z",
      "type": "artifact_changed",
      "refId": "docs",
      "message": "已更新 Prompt Workflow / World Pack 文档，补充变量命名空间、宏语法与上手说明。"
    },
    {
      "at": "2026-04-17T22:38:52.272Z",
      "type": "milestone_recorded",
      "refId": "phase2c-docs-templates",
      "message": "完成第二阶段文档与模板收口：使用文档可指导作者与使用者上手，death_note 模板已切换到 namespaced 写法。"
    },
    {
      "at": "2026-04-17T22:41:27.345Z",
      "type": "updated",
      "message": "开始开发环境下的第二阶段额外收尾：允许进行更大规模的裸 key 模板占位符替换，以继续减少技术债。"
    },
    {
      "at": "2026-04-17T22:46:40.822Z",
      "type": "updated",
      "message": "完成开发环境额外清理：大规模替换残留裸 key 模板占位符与旧 invocation 占位符写法，进一步压缩后续变量系统技术债。"
    },
    {
      "at": "2026-04-18T07:58:09.941Z",
      "type": "artifact_changed",
      "refId": "design",
      "message": "同步设计文档：.limcode/design/single-pack-multi-entity-concurrent-request-design.md"
    },
    {
      "at": "2026-04-18T08:31:35.157Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划文档：.limcode/plans/single-pack-multi-entity-concurrent-request-implementation.plan.md"
    },
    {
      "at": "2026-04-18T08:35:04.968Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/single-pack-multi-entity-concurrent-request-implementation.plan.md"
    },
    {
      "at": "2026-04-18T08:35:13.877Z",
      "type": "updated",
      "refId": "plan-phase-a-config-contract",
      "message": "开始执行 Phase A，准备扩展 runtime config schema、默认值与示例配置。"
    },
    {
      "at": "2026-04-18T08:40:58.809Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/single-pack-multi-entity-concurrent-request-implementation.plan.md"
    },
    {
      "at": "2026-04-18T08:41:07.845Z",
      "type": "milestone_recorded",
      "refId": "PG2",
      "message": "记录里程碑：Phase A：runtime config contract 完成"
    },
    {
      "at": "2026-04-18T08:44:31.335Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/single-pack-multi-entity-concurrent-request-implementation.plan.md"
    },
    {
      "at": "2026-04-18T08:44:41.554Z",
      "type": "updated",
      "refId": "plan-phase-b-runner-concurrency",
      "message": "完成 Phase B：新增通用受限并发池，并将 decision job runner / action dispatcher runner 改造为配置驱动的并发执行。"
    },
    {
      "at": "2026-04-18T08:58:17.533Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/single-pack-multi-entity-concurrent-request-implementation.plan.md"
    },
    {
      "at": "2026-04-18T08:58:26.400Z",
      "type": "milestone_recorded",
      "refId": "PG3",
      "message": "记录里程碑：Phase C：实体级 single-flight 与 activity budget 落地"
    },
    {
      "at": "2026-04-18T09:04:52.041Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/single-pack-multi-entity-concurrent-request-implementation.plan.md"
    },
    {
      "at": "2026-04-18T09:05:02.279Z",
      "type": "milestone_recorded",
      "refId": "PG4",
      "message": "记录里程碑：单世界包多实体并发请求第四阶段完成"
    }
  ],
  "stats": {
    "milestonesTotal": 6,
    "milestonesCompleted": 6,
    "todosTotal": 4,
    "todosCompleted": 4,
    "todosInProgress": 0,
    "todosCancelled": 0,
    "activeRisks": 0
  },
  "render": {
    "rendererVersion": 1,
    "generatedAt": "2026-04-18T09:05:02.279Z",
    "bodyHash": "sha256:dcb05ee7e094f7e2df60696ee9e6f27523706214b4cc4cdba7d6fecd3d77f73c"
  }
}
<!-- LIMCODE_PROGRESS_METADATA_END -->
