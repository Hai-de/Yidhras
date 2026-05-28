# 项目进度
- Project: Yidhras
- Updated At: 2026-05-28T11:36:17.012Z
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
- 设计：`.limcode/design/rust-迁移收益评估基于现有代码与架构.md`
- 计划：`.limcode/plans/千年吸血鬼世界包后端实现计划.plan.md`
- 审查：`.limcode/review/千年吸血鬼世界包前端设计盲点分析.md`
<!-- LIMCODE_PROGRESS_ARTIFACTS_END -->

## 当前 TODO 快照

<!-- LIMCODE_PROGRESS_TODOS_START -->
- [x] 补全 config/capabilities.yaml - 声明全部 10 个 capability  `#1`
- [x] 补全 config/rules.yaml - 替代规则声明  `#2`
- [x] 补全 config/prompts.yaml - prompt slot 配置  `#3`
- [x] 更新 config/behavior_trees.yaml - both_depleted condition 定义  `#4`
- [x] 实现 perceive.* 和 invoke.* 处理器 + 更新 vampire-core 插件  `#5`
- [x] 验证并测试所有 capability 端点  `#6`
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
- 2026-05-26T20:59:24.592Z | artifact_changed | design | 同步设计文档：.limcode/design/serious-world-pack-basic-skeleton-draft.md
- 2026-05-26T21:02:39.646Z | artifact_changed | plan | 同步计划文档：.limcode/plans/千年吸血鬼世界包前端实现计划.plan.md
- 2026-05-27T00:36:48.283Z | artifact_changed | design | 同步设计文档：.limcode/design/vampire-appearance-extension.md
- 2026-05-27T09:10:08.257Z | artifact_changed | review | 同步审查文档：.limcode/review/千年吸血鬼世界包前端设计盲点分析.md
- 2026-05-27T17:07:54.700Z | artifact_changed | plan | 同步计划文档：.limcode/plans/千年吸血鬼世界包前端实现计划.plan.md
- 2026-05-27T17:49:51.561Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/千年吸血鬼世界包前端实现计划.plan.md
- 2026-05-27T18:31:28.388Z | artifact_changed | plan | 同步计划文档：.limcode/plans/千年吸血鬼世界包后端实现计划.plan.md
- 2026-05-27T18:42:17.531Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/千年吸血鬼世界包后端实现计划.plan.md
- 2026-05-28T11:36:17.012Z | artifact_changed | design | 同步设计文档：.limcode/design/rust-迁移收益评估基于现有代码与架构.md
<!-- LIMCODE_PROGRESS_LOG_END -->

<!-- LIMCODE_PROGRESS_METADATA_START -->
{
  "formatVersion": 1,
  "kind": "limcode.progress",
  "projectId": "yidhras",
  "projectName": "Yidhras",
  "createdAt": "2026-05-24T16:15:36.183Z",
  "updatedAt": "2026-05-28T11:36:17.012Z",
  "status": "active",
  "phase": "plan",
  "currentFocus": "no-unsafe-type-assertion 渐进收敛计划（追加 no-unsafe-* 系列）",
  "latestConclusion": "Phase 0-8 全部完成；no-unsafe-type-assertion + no-unsafe-* 系列 + 6 条 tests/scripts 质量规则已全部收敛并固化为 error",
  "currentBlocker": null,
  "nextAction": null,
  "activeArtifacts": {
    "design": ".limcode/design/rust-迁移收益评估基于现有代码与架构.md",
    "plan": ".limcode/plans/千年吸血鬼世界包后端实现计划.plan.md",
    "review": ".limcode/review/千年吸血鬼世界包前端设计盲点分析.md"
  },
  "todos": [
    {
      "id": "1",
      "content": "补全 config/capabilities.yaml - 声明全部 10 个 capability",
      "status": "completed"
    },
    {
      "id": "2",
      "content": "补全 config/rules.yaml - 替代规则声明",
      "status": "completed"
    },
    {
      "id": "3",
      "content": "补全 config/prompts.yaml - prompt slot 配置",
      "status": "completed"
    },
    {
      "id": "4",
      "content": "更新 config/behavior_trees.yaml - both_depleted condition 定义",
      "status": "completed"
    },
    {
      "id": "5",
      "content": "实现 perceive.* 和 invoke.* 处理器 + 更新 vampire-core 插件",
      "status": "completed"
    },
    {
      "id": "6",
      "content": "验证并测试所有 capability 端点",
      "status": "completed"
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
    },
    {
      "at": "2026-05-26T20:59:24.592Z",
      "type": "artifact_changed",
      "refId": "design",
      "message": "同步设计文档：.limcode/design/serious-world-pack-basic-skeleton-draft.md"
    },
    {
      "at": "2026-05-26T21:02:39.646Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划文档：.limcode/plans/千年吸血鬼世界包前端实现计划.plan.md"
    },
    {
      "at": "2026-05-27T00:36:48.283Z",
      "type": "artifact_changed",
      "refId": "design",
      "message": "同步设计文档：.limcode/design/vampire-appearance-extension.md"
    },
    {
      "at": "2026-05-27T09:10:08.257Z",
      "type": "artifact_changed",
      "refId": "review",
      "message": "同步审查文档：.limcode/review/千年吸血鬼世界包前端设计盲点分析.md"
    },
    {
      "at": "2026-05-27T17:07:54.700Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划文档：.limcode/plans/千年吸血鬼世界包前端实现计划.plan.md"
    },
    {
      "at": "2026-05-27T17:49:51.561Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/千年吸血鬼世界包前端实现计划.plan.md"
    },
    {
      "at": "2026-05-27T18:31:28.388Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划文档：.limcode/plans/千年吸血鬼世界包后端实现计划.plan.md"
    },
    {
      "at": "2026-05-27T18:42:17.531Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/千年吸血鬼世界包后端实现计划.plan.md"
    },
    {
      "at": "2026-05-28T11:36:17.012Z",
      "type": "artifact_changed",
      "refId": "design",
      "message": "同步设计文档：.limcode/design/rust-迁移收益评估基于现有代码与架构.md"
    }
  ],
  "stats": {
    "milestonesTotal": 1,
    "milestonesCompleted": 1,
    "todosTotal": 6,
    "todosCompleted": 6,
    "todosInProgress": 0,
    "todosCancelled": 0,
    "activeRisks": 0
  },
  "render": {
    "rendererVersion": 1,
    "generatedAt": "2026-05-28T11:36:17.012Z",
    "bodyHash": "sha256:5a7ac0937a87f4734e78661ee1dcd8d79ba9aafc825dbef6bf5ad778d3d7e09b"
  }
}
<!-- LIMCODE_PROGRESS_METADATA_END -->
