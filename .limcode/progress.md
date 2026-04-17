# 项目进度
- Project: Yidhras
- Updated At: 2026-04-17T22:46:40.822Z
- Status: active
- Phase: implementation

## 当前摘要

<!-- LIMCODE_PROGRESS_SUMMARY_START -->
- 当前进度：3/3 个里程碑已完成；最新：phase2b-macro-runtime
- 当前焦点：第二阶段开发环境额外清理已完成，等待切换到下一阶段
- 最新结论：已完成开发环境下的一轮更激进模板清理：残留裸 key 占位符与旧 invocation 标记已在模板、测试、示例与文档中批量迁移，进一步压缩了后续技术债。
- 下一步：如无额外补充，可正式记录第二阶段完成并切换到第三阶段 YAML 配置迁移。
<!-- LIMCODE_PROGRESS_SUMMARY_END -->

## 关联文档

<!-- LIMCODE_PROGRESS_ARTIFACTS_START -->
- 设计：`.limcode/design/world-pack-prompt-macro-variable-formalization-design.md`
- 计划：`.limcode/plans/world-pack-prompt-macro-variable-formalization-implementation.plan.md`
<!-- LIMCODE_PROGRESS_ARTIFACTS_END -->

## 当前 TODO 快照

<!-- LIMCODE_PROGRESS_TODOS_START -->
- [x] 改造 prompt_builder、template_renderer、SimulationManager.resolvePackVariables 等调用点接入 variable_context  `#phase2a-caller-integration`
- [x] 在 inference/runtime 上下文构建阶段生成 system/app/pack/runtime/actor/request 层变量上下文与 alias precedence  `#phase2a-context-builders`
- [x] 定义 PromptVariableLayer / PromptVariableContext / trace 等正式类型，并为旧 visible_variables 保留薄兼容投影  `#phase2a-contract-types`
- [x] 把变量解析摘要与 trace 接入 Prompt Workflow / PromptBundle / InferenceTrace diagnostics  `#phase2a-diagnostics`
- [x] 将 NarrativeResolver 收口为统一变量/模板渲染门面，保证 prompt/perception/simulation 共享同一解析入口  `#phase2a-renderer-facade`
- [x] 在统一渲染器上扩展 default、if、each 三类受控宏能力，并设置深度/长度/错误护栏  `#phase2b-macro-runtime`
- [x] 补充单元与集成测试，覆盖命名空间解析、alias precedence、缺失变量、block 执行与兼容桥  `#phase2b-tests`
- [x] 更新 Prompt Workflow / World Pack 文档与示例模板，明确新命名空间规范与兼容边界  `#phase2c-docs-templates`
- [x] 盘点并替换仓库中仍残留的裸 key 模板占位符，优先迁移到 namespaced 写法  `#cleanup-bare-template-placeholders`
- [x] 同步文档说明本轮大规模替换后的推荐写法与兼容边界  `#cleanup-docs-followup`
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
<!-- LIMCODE_PROGRESS_MILESTONES_END -->

## 风险与阻塞

<!-- LIMCODE_PROGRESS_RISKS_START -->
<!-- 暂无风险 -->
<!-- LIMCODE_PROGRESS_RISKS_END -->

## 最近更新

<!-- LIMCODE_PROGRESS_LOG_START -->
- 2026-04-17T21:41:31.140Z | milestone_recorded | PG1 | 记录里程碑：数据库边界治理第一阶段完成
- 2026-04-17T21:41:31.159Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/database-boundary-governance-phase1-implementation.plan.md
- 2026-04-17T21:41:31.169Z | milestone_recorded | phase1-cleanup-compat | 已完成第一阶段收尾清理，删除旧兼容壳并通过 lint/typecheck。
- 2026-04-17T22:14:31.675Z | artifact_changed | design | 同步设计文档：.limcode/design/world-pack-prompt-macro-variable-formalization-design.md
- 2026-04-17T22:16:45.395Z | artifact_changed | plan | 同步计划文档：.limcode/plans/world-pack-prompt-macro-variable-formalization-implementation.plan.md
- 2026-04-17T22:17:10.288Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/world-pack-prompt-macro-variable-formalization-implementation.plan.md
- 2026-04-17T22:17:24.177Z | artifact_changed | design | 新增并确认第二阶段设计文档：.limcode/design/world-pack-prompt-macro-variable-formalization-design.md
- 2026-04-17T22:17:24.177Z | artifact_changed | plan | 新增并确认第二阶段实施计划：.limcode/plans/world-pack-prompt-macro-variable-formalization-implementation.plan.md
- 2026-04-17T22:17:24.177Z | updated | 开始第二阶段实现，当前优先定义变量层 contract、统一变量上下文与薄兼容投影。
- 2026-04-17T22:25:14.782Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/world-pack-prompt-macro-variable-formalization-implementation.plan.md
- 2026-04-17T22:25:23.271Z | milestone_recorded | phase2a-variable-context | 记录里程碑：第二阶段 Phase 2A 变量层正式化完成
- 2026-04-17T22:25:37.111Z | milestone_recorded | phase2a-variable-context | 完成 Phase 2A：变量层 contract、上下文构建、统一渲染门面、调用点接入与基础 diagnostics，并通过 server typecheck。
- 2026-04-17T22:25:37.111Z | updated | 进入 Phase 2B，开始在统一渲染器上扩展 default / if / each 受控宏能力。
- 2026-04-17T22:33:30.445Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/world-pack-prompt-macro-variable-formalization-implementation.plan.md
- 2026-04-17T22:33:38.734Z | milestone_recorded | phase2b-macro-runtime | 记录里程碑：第二阶段 Phase 2B 宏能力与测试完成
- 2026-04-17T22:38:36.556Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/world-pack-prompt-macro-variable-formalization-implementation.plan.md
- 2026-04-17T22:38:52.272Z | artifact_changed | docs | 已更新 Prompt Workflow / World Pack 文档，补充变量命名空间、宏语法与上手说明。
- 2026-04-17T22:38:52.272Z | milestone_recorded | phase2c-docs-templates | 完成第二阶段文档与模板收口：使用文档可指导作者与使用者上手，death_note 模板已切换到 namespaced 写法。
- 2026-04-17T22:41:27.345Z | updated | 开始开发环境下的第二阶段额外收尾：允许进行更大规模的裸 key 模板占位符替换，以继续减少技术债。
- 2026-04-17T22:46:40.822Z | updated | 完成开发环境额外清理：大规模替换残留裸 key 模板占位符与旧 invocation 占位符写法，进一步压缩后续变量系统技术债。
<!-- LIMCODE_PROGRESS_LOG_END -->

<!-- LIMCODE_PROGRESS_METADATA_START -->
{
  "formatVersion": 1,
  "kind": "limcode.progress",
  "projectId": "yidhras",
  "projectName": "Yidhras",
  "createdAt": "2026-04-17T21:05:29.611Z",
  "updatedAt": "2026-04-17T22:46:40.822Z",
  "status": "active",
  "phase": "implementation",
  "currentFocus": "第二阶段开发环境额外清理已完成，等待切换到下一阶段",
  "latestConclusion": "已完成开发环境下的一轮更激进模板清理：残留裸 key 占位符与旧 invocation 标记已在模板、测试、示例与文档中批量迁移，进一步压缩了后续技术债。",
  "currentBlocker": null,
  "nextAction": "如无额外补充，可正式记录第二阶段完成并切换到第三阶段 YAML 配置迁移。",
  "activeArtifacts": {
    "design": ".limcode/design/world-pack-prompt-macro-variable-formalization-design.md",
    "plan": ".limcode/plans/world-pack-prompt-macro-variable-formalization-implementation.plan.md"
  },
  "todos": [
    {
      "id": "phase2a-caller-integration",
      "content": "改造 prompt_builder、template_renderer、SimulationManager.resolvePackVariables 等调用点接入 variable_context",
      "status": "completed"
    },
    {
      "id": "phase2a-context-builders",
      "content": "在 inference/runtime 上下文构建阶段生成 system/app/pack/runtime/actor/request 层变量上下文与 alias precedence",
      "status": "completed"
    },
    {
      "id": "phase2a-contract-types",
      "content": "定义 PromptVariableLayer / PromptVariableContext / trace 等正式类型，并为旧 visible_variables 保留薄兼容投影",
      "status": "completed"
    },
    {
      "id": "phase2a-diagnostics",
      "content": "把变量解析摘要与 trace 接入 Prompt Workflow / PromptBundle / InferenceTrace diagnostics",
      "status": "completed"
    },
    {
      "id": "phase2a-renderer-facade",
      "content": "将 NarrativeResolver 收口为统一变量/模板渲染门面，保证 prompt/perception/simulation 共享同一解析入口",
      "status": "completed"
    },
    {
      "id": "phase2b-macro-runtime",
      "content": "在统一渲染器上扩展 default、if、each 三类受控宏能力，并设置深度/长度/错误护栏",
      "status": "completed"
    },
    {
      "id": "phase2b-tests",
      "content": "补充单元与集成测试，覆盖命名空间解析、alias precedence、缺失变量、block 执行与兼容桥",
      "status": "completed"
    },
    {
      "id": "phase2c-docs-templates",
      "content": "更新 Prompt Workflow / World Pack 文档与示例模板，明确新命名空间规范与兼容边界",
      "status": "completed"
    },
    {
      "id": "cleanup-bare-template-placeholders",
      "content": "盘点并替换仓库中仍残留的裸 key 模板占位符，优先迁移到 namespaced 写法",
      "status": "completed"
    },
    {
      "id": "cleanup-docs-followup",
      "content": "同步文档说明本轮大规模替换后的推荐写法与兼容边界",
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
    }
  ],
  "risks": [],
  "log": [
    {
      "at": "2026-04-17T21:41:31.140Z",
      "type": "milestone_recorded",
      "refId": "PG1",
      "message": "记录里程碑：数据库边界治理第一阶段完成"
    },
    {
      "at": "2026-04-17T21:41:31.159Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/database-boundary-governance-phase1-implementation.plan.md"
    },
    {
      "at": "2026-04-17T21:41:31.169Z",
      "type": "milestone_recorded",
      "refId": "phase1-cleanup-compat",
      "message": "已完成第一阶段收尾清理，删除旧兼容壳并通过 lint/typecheck。"
    },
    {
      "at": "2026-04-17T22:14:31.675Z",
      "type": "artifact_changed",
      "refId": "design",
      "message": "同步设计文档：.limcode/design/world-pack-prompt-macro-variable-formalization-design.md"
    },
    {
      "at": "2026-04-17T22:16:45.395Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划文档：.limcode/plans/world-pack-prompt-macro-variable-formalization-implementation.plan.md"
    },
    {
      "at": "2026-04-17T22:17:10.288Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/world-pack-prompt-macro-variable-formalization-implementation.plan.md"
    },
    {
      "at": "2026-04-17T22:17:24.177Z",
      "type": "artifact_changed",
      "refId": "design",
      "message": "新增并确认第二阶段设计文档：.limcode/design/world-pack-prompt-macro-variable-formalization-design.md"
    },
    {
      "at": "2026-04-17T22:17:24.177Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "新增并确认第二阶段实施计划：.limcode/plans/world-pack-prompt-macro-variable-formalization-implementation.plan.md"
    },
    {
      "at": "2026-04-17T22:17:24.177Z",
      "type": "updated",
      "message": "开始第二阶段实现，当前优先定义变量层 contract、统一变量上下文与薄兼容投影。"
    },
    {
      "at": "2026-04-17T22:25:14.782Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/world-pack-prompt-macro-variable-formalization-implementation.plan.md"
    },
    {
      "at": "2026-04-17T22:25:23.271Z",
      "type": "milestone_recorded",
      "refId": "phase2a-variable-context",
      "message": "记录里程碑：第二阶段 Phase 2A 变量层正式化完成"
    },
    {
      "at": "2026-04-17T22:25:37.111Z",
      "type": "milestone_recorded",
      "refId": "phase2a-variable-context",
      "message": "完成 Phase 2A：变量层 contract、上下文构建、统一渲染门面、调用点接入与基础 diagnostics，并通过 server typecheck。"
    },
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
    }
  ],
  "stats": {
    "milestonesTotal": 3,
    "milestonesCompleted": 3,
    "todosTotal": 10,
    "todosCompleted": 10,
    "todosInProgress": 0,
    "todosCancelled": 0,
    "activeRisks": 0
  },
  "render": {
    "rendererVersion": 1,
    "generatedAt": "2026-04-17T22:46:40.822Z",
    "bodyHash": "sha256:d7268044ff386ae8d3c6d0cea57cebaa75dc8e0959f149b3cbec8544605202bb"
  }
}
<!-- LIMCODE_PROGRESS_METADATA_END -->
