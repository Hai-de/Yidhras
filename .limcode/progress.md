# 项目进度
- Project: Yidhras
- Updated At: 2026-05-24T21:40:14.219Z
- Status: active
- Phase: plan

## 当前摘要

<!-- LIMCODE_PROGRESS_SUMMARY_START -->
- 当前进度：1/1 个里程碑已完成；最新：phase-8-complete
- 当前焦点：no-unsafe-type-assertion 渐进收敛计划（追加 no-unsafe-* 系列）
- 最新结论：Phase 0-8 全部完成；no-unsafe-type-assertion + no-unsafe-* 系列 + 6 条 tests/scripts 质量规则已全部收敛并固化为 error
<!-- LIMCODE_PROGRESS_SUMMARY_END -->

## 关联文档

<!-- LIMCODE_PROGRESS_ARTIFACTS_START -->
- 设计：`.limcode/design/worker-thread-plugin-isolation-design.md`
- 计划：`.limcode/plans/worker-thread-plugin-isolation-plan.md`
<!-- LIMCODE_PROGRESS_ARTIFACTS_END -->

## 当前 TODO 快照

<!-- LIMCODE_PROGRESS_TODOS_START -->
- [ ] 定义 Worker IPC 协议、contribution descriptor、Host API 2.0.0 和 plugins.isolation 配置  `#worker-isolation-phase-1-protocol-config`
- [ ] 实现 Worker entry resolver、worker bootstrap、Worker-side host proxy、PluginWorkerClient 和 host_call handler  `#worker-isolation-phase-2-worker-client`
- [ ] 实现 PluginWorkerManager，并重构 runtime.ts 删除主线程插件 dynamic import、采用原子 registry 替换  `#worker-isolation-phase-3-runtime-integration`
- [ ] 实现 step/rule/query/context/prompt/data-cleaner/slot/perception/API-route contribution proxy 和 manifest 对齐校验  `#worker-isolation-phase-4-contribution-proxy`
- [ ] 删除函数式 registerPackRoute，改为固定主线程 route host 转发 Worker handler  `#worker-isolation-phase-5-route-host`
- [ ] 清理 full AppContext sandbox 暴露，统一主线程 capability gate  `#worker-isolation-phase-6-sandbox-cleanup`
- [ ] 增加 Worker metrics，更新 PLUGIN_RUNTIME 文档和 generic-capability 计划状态  `#worker-isolation-phase-7-docs-metrics`
- [ ] 补齐 Worker 隔离单元/集成测试并运行 typecheck 与插件相关回归测试  `#worker-isolation-phase-8-tests`
<!-- LIMCODE_PROGRESS_TODOS_END -->

## 项目里程碑

<!-- LIMCODE_PROGRESS_MILESTONES_START -->
### phase-8-complete · Phase 8: tests/scripts 质量规则 warn→error 收敛完成
- 状态：completed
- 记录时间：2026-05-24T19:35:32.697Z
- 开始时间：2026-05-24T16:15:36.183Z
- 完成时间：2026-05-24T19:35:00.000Z
- 关联 TODO：phase-7a-config-baseline, phase-7a-counts, phase-7b-assignment-member-access, phase-7c-call-argument-return, phase-7d-low-frequency, phase-7e-disable-audit, phase-7f-final-verify, phase8-impl-baseline, phase8-impl-non-null-batch, phase8-impl-unused-any, phase8-impl-verify-sync, analyze-tests-scripts-warn-error, append-tests-scripts-warn-error-plan
- 关联文档：
  - 计划：`.limcode/plans/no-unsafe-type-assertion-convergence.plan.md`
- 摘要:
## 阶段 8 测试/脚本质量规则 warn→error 收敛完成

### 完成内容

**基线**: tests/scripts 目标质量规则 397 条 warning（全部在 tests），scripts 为 0。

**清理结果**:
| 规则 | 修复前 | 修复后 |
|------|--------|--------|
| `@typescript-eslint/no-non-null-assertion` | 317 | 0 |
| `@typescript-eslint/no-unused-vars` | 42 | 0 |
| `@typescript-eslint/no-explicit-any` | 38 | 0 |
| `prefer-const` | 0 | 0 |
| `simple-import-sort/imports` | 0 | 0 |
| `simple-import-sort/exports` | 0 | 0 |

**配置固化**: `apps/server/eslint.config.mjs` 中 tests/scripts 规则块，6 条目标质量规则已从 `warn` 升为 `error`。移除过期注释。

**验证**:
- `pnpm run typecheck` → exit 0
- `pnpm run test:unit` → 1313/1313 pass (124 files)
- `pnpm exec eslint tests/**/*.ts scripts/**/*.ts` → exit 0，6 条目标规则全 0
- integration 测试有 3 个既有断言失败（slot_condition_plugin, pipeline_edge_cases），非本阶段引入

**主要修复模式**:
- 抽取 `expectDefined()` / `expectArrayElement()` helper 替换 non-null assertions
- 抽取 `captureRequests()` pattern 替换 `let captured: T | null = null` + `!`
- `currentTick()` / `packRuntime()` / `packRuntimeOf()` helper 减少重复模式
- 删除未使用 import/变量；`any` → `unknown` + guard
<!-- LIMCODE_PROGRESS_MILESTONES_END -->

## 风险与阻塞

<!-- LIMCODE_PROGRESS_RISKS_START -->
<!-- 暂无风险 -->
<!-- LIMCODE_PROGRESS_RISKS_END -->

## 最近更新

<!-- LIMCODE_PROGRESS_LOG_START -->
- 2026-05-24T16:15:36.183Z | created | 初始化项目进度
- 2026-05-24T16:15:36.183Z | artifact_changed | plan | 同步计划文档：.limcode/plans/no-unsafe-type-assertion-convergence.plan.md
- 2026-05-24T16:17:38.376Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/no-unsafe-type-assertion-convergence.plan.md
- 2026-05-24T16:19:51.121Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/no-unsafe-type-assertion-convergence.plan.md
- 2026-05-24T19:35:32.697Z | milestone_recorded | phase-8-complete | 记录里程碑：Phase 8: tests/scripts 质量规则 warn→error 收敛完成
- 2026-05-24T19:47:38.584Z | artifact_changed | plan | 同步计划文档：.limcode/plans/generic-capability-p3-batch1-batch2.plan.md
- 2026-05-24T20:07:58.546Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/generic-capability-p3-batch1-batch2.plan.md
- 2026-05-24T20:10:47.477Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/generic-capability-p3-batch1-batch2.plan.md
- 2026-05-24T21:30:55.320Z | artifact_changed | design | 同步设计文档：.limcode/design/worker-thread-plugin-isolation-design.md
- 2026-05-24T21:40:14.219Z | artifact_changed | plan | 同步计划文档：.limcode/plans/worker-thread-plugin-isolation-plan.md
<!-- LIMCODE_PROGRESS_LOG_END -->

<!-- LIMCODE_PROGRESS_METADATA_START -->
{
  "formatVersion": 1,
  "kind": "limcode.progress",
  "projectId": "yidhras",
  "projectName": "Yidhras",
  "createdAt": "2026-05-24T16:15:36.183Z",
  "updatedAt": "2026-05-24T21:40:14.219Z",
  "status": "active",
  "phase": "plan",
  "currentFocus": "no-unsafe-type-assertion 渐进收敛计划（追加 no-unsafe-* 系列）",
  "latestConclusion": "Phase 0-8 全部完成；no-unsafe-type-assertion + no-unsafe-* 系列 + 6 条 tests/scripts 质量规则已全部收敛并固化为 error",
  "currentBlocker": null,
  "nextAction": null,
  "activeArtifacts": {
    "design": ".limcode/design/worker-thread-plugin-isolation-design.md",
    "plan": ".limcode/plans/worker-thread-plugin-isolation-plan.md"
  },
  "todos": [
    {
      "id": "worker-isolation-phase-1-protocol-config",
      "content": "定义 Worker IPC 协议、contribution descriptor、Host API 2.0.0 和 plugins.isolation 配置",
      "status": "pending"
    },
    {
      "id": "worker-isolation-phase-2-worker-client",
      "content": "实现 Worker entry resolver、worker bootstrap、Worker-side host proxy、PluginWorkerClient 和 host_call handler",
      "status": "pending"
    },
    {
      "id": "worker-isolation-phase-3-runtime-integration",
      "content": "实现 PluginWorkerManager，并重构 runtime.ts 删除主线程插件 dynamic import、采用原子 registry 替换",
      "status": "pending"
    },
    {
      "id": "worker-isolation-phase-4-contribution-proxy",
      "content": "实现 step/rule/query/context/prompt/data-cleaner/slot/perception/API-route contribution proxy 和 manifest 对齐校验",
      "status": "pending"
    },
    {
      "id": "worker-isolation-phase-5-route-host",
      "content": "删除函数式 registerPackRoute，改为固定主线程 route host 转发 Worker handler",
      "status": "pending"
    },
    {
      "id": "worker-isolation-phase-6-sandbox-cleanup",
      "content": "清理 full AppContext sandbox 暴露，统一主线程 capability gate",
      "status": "pending"
    },
    {
      "id": "worker-isolation-phase-7-docs-metrics",
      "content": "增加 Worker metrics，更新 PLUGIN_RUNTIME 文档和 generic-capability 计划状态",
      "status": "pending"
    },
    {
      "id": "worker-isolation-phase-8-tests",
      "content": "补齐 Worker 隔离单元/集成测试并运行 typecheck 与插件相关回归测试",
      "status": "pending"
    }
  ],
  "milestones": [
    {
      "id": "phase-8-complete",
      "title": "Phase 8: tests/scripts 质量规则 warn→error 收敛完成",
      "status": "completed",
      "summary": "## 阶段 8 测试/脚本质量规则 warn→error 收敛完成\n\n### 完成内容\n\n**基线**: tests/scripts 目标质量规则 397 条 warning（全部在 tests），scripts 为 0。\n\n**清理结果**:\n| 规则 | 修复前 | 修复后 |\n|------|--------|--------|\n| `@typescript-eslint/no-non-null-assertion` | 317 | 0 |\n| `@typescript-eslint/no-unused-vars` | 42 | 0 |\n| `@typescript-eslint/no-explicit-any` | 38 | 0 |\n| `prefer-const` | 0 | 0 |\n| `simple-import-sort/imports` | 0 | 0 |\n| `simple-import-sort/exports` | 0 | 0 |\n\n**配置固化**: `apps/server/eslint.config.mjs` 中 tests/scripts 规则块，6 条目标质量规则已从 `warn` 升为 `error`。移除过期注释。\n\n**验证**:\n- `pnpm run typecheck` → exit 0\n- `pnpm run test:unit` → 1313/1313 pass (124 files)\n- `pnpm exec eslint tests/**/*.ts scripts/**/*.ts` → exit 0，6 条目标规则全 0\n- integration 测试有 3 个既有断言失败（slot_condition_plugin, pipeline_edge_cases），非本阶段引入\n\n**主要修复模式**:\n- 抽取 `expectDefined()` / `expectArrayElement()` helper 替换 non-null assertions\n- 抽取 `captureRequests()` pattern 替换 `let captured: T | null = null` + `!`\n- `currentTick()` / `packRuntime()` / `packRuntimeOf()` helper 减少重复模式\n- 删除未使用 import/变量；`any` → `unknown` + guard",
      "relatedTodoIds": [
        "phase-7a-config-baseline",
        "phase-7a-counts",
        "phase-7b-assignment-member-access",
        "phase-7c-call-argument-return",
        "phase-7d-low-frequency",
        "phase-7e-disable-audit",
        "phase-7f-final-verify",
        "phase8-impl-baseline",
        "phase8-impl-non-null-batch",
        "phase8-impl-unused-any",
        "phase8-impl-verify-sync",
        "analyze-tests-scripts-warn-error",
        "append-tests-scripts-warn-error-plan"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "plan": ".limcode/plans/no-unsafe-type-assertion-convergence.plan.md"
      },
      "startedAt": "2026-05-24T16:15:36.183Z",
      "completedAt": "2026-05-24T19:35:00.000Z",
      "recordedAt": "2026-05-24T19:35:32.697Z",
      "nextAction": null
    }
  ],
  "risks": [],
  "log": [
    {
      "at": "2026-05-24T16:15:36.183Z",
      "type": "created",
      "message": "初始化项目进度"
    },
    {
      "at": "2026-05-24T16:15:36.183Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划文档：.limcode/plans/no-unsafe-type-assertion-convergence.plan.md"
    },
    {
      "at": "2026-05-24T16:17:38.376Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/no-unsafe-type-assertion-convergence.plan.md"
    },
    {
      "at": "2026-05-24T16:19:51.121Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/no-unsafe-type-assertion-convergence.plan.md"
    },
    {
      "at": "2026-05-24T19:35:32.697Z",
      "type": "milestone_recorded",
      "refId": "phase-8-complete",
      "message": "记录里程碑：Phase 8: tests/scripts 质量规则 warn→error 收敛完成"
    },
    {
      "at": "2026-05-24T19:47:38.584Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划文档：.limcode/plans/generic-capability-p3-batch1-batch2.plan.md"
    },
    {
      "at": "2026-05-24T20:07:58.546Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/generic-capability-p3-batch1-batch2.plan.md"
    },
    {
      "at": "2026-05-24T20:10:47.477Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/generic-capability-p3-batch1-batch2.plan.md"
    },
    {
      "at": "2026-05-24T21:30:55.320Z",
      "type": "artifact_changed",
      "refId": "design",
      "message": "同步设计文档：.limcode/design/worker-thread-plugin-isolation-design.md"
    },
    {
      "at": "2026-05-24T21:40:14.219Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划文档：.limcode/plans/worker-thread-plugin-isolation-plan.md"
    }
  ],
  "stats": {
    "milestonesTotal": 1,
    "milestonesCompleted": 1,
    "todosTotal": 8,
    "todosCompleted": 0,
    "todosInProgress": 0,
    "todosCancelled": 0,
    "activeRisks": 0
  },
  "render": {
    "rendererVersion": 1,
    "generatedAt": "2026-05-24T21:40:14.219Z",
    "bodyHash": "sha256:216d64a78474131a7630a2010af3fade280158739e7898ca04de89a3314a579d"
  }
}
<!-- LIMCODE_PROGRESS_METADATA_END -->
