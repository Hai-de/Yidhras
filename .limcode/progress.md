# 项目进度
- Project: Yidhras
- Updated At: 2026-04-07T21:41:50.690Z
- Status: active
- Phase: implementation

## 当前摘要

<!-- LIMCODE_PROGRESS_SUMMARY_START -->
- 当前进度：2/2 个里程碑已完成；最新：PG2
- 当前焦点：legacy overview removal completed
- 最新结论：已彻底删除 `/api/agent/:id/overview`：后端路由、相关兼容 meta 与对应成功路径 e2e 均已清理；design/API/ARCH/LOGIC/TODO/progress 已同步为“已删除历史接口”，当前 entity overview 唯一 canonical route 为 `/api/entities/:id/overvie…
- 下一步：如继续推进，优先评估 `/api/policy/*` 是否长期保留为 debug surface，或进一步外提到独立 access-policy 子系统。
<!-- LIMCODE_PROGRESS_SUMMARY_END -->

## 关联文档

<!-- LIMCODE_PROGRESS_ARTIFACTS_START -->
- 设计：`.limcode/design/world-pack-unified-governance-framework-design.md`
- 计划：`.limcode/plans/world-pack-final-backend-closure.plan.md`
<!-- LIMCODE_PROGRESS_ARTIFACTS_END -->

## 当前 TODO 快照

<!-- LIMCODE_PROGRESS_TODOS_START -->
- [x] 明确 pack runtime storage 收尾策略，并锁定从 sidecar JSON 过渡到 runtime.sqlite engine-owned collections 的实施边界  `#wfbc1_storage_decision`
- [x] 收口 pack runtime storage 实现，将 world_entities/entity_states/authority_grants/mediator_bindings/rule_execution_records 迁移到真实 runtime.sqlite 持久化  `#wfbc2_storage_sqlite`
- [x] 收口 `/api/packs/:packId/overview` 与 `/api/packs/:packId/projections/timeline` 的 packId 语义，并补强 Event bridge 的 pack-scoped 过滤/关联契约  `#wfbc3_pack_api_bridge`
- [x] 冻结兼容接口 `/api/agent/:id/overview` 与 `/api/policy/*` 的最终定位、文档表述与退场条件  `#wfbc4_compat_freeze`
- [x] 提供 Operator 高级视图所需的后端证据/接口契约；前端页面与交互实现明确交由前端团队  `#wfbc5_operator_backend_contract`
- [x] 完成 typecheck/tests 与 design/progress/ARCH/API 同步，确保代码状态、计划与文档一致  `#wfbc6_validation_docs`
<!-- LIMCODE_PROGRESS_TODOS_END -->

## 项目里程碑

<!-- LIMCODE_PROGRESS_MILESTONES_START -->
### PG1 · 完成 world-pack post-governance closure
- 状态：completed
- 记录时间：2026-04-07T07:04:13.646Z
- 完成时间：2026-04-07T07:04:13.646Z
- 关联 TODO：g1_ownership_matrix, g2_module_closure, g3_death_note_mediator, g4_validation_docs
- 关联文档：
  - 设计：`.limcode/design/world-pack-unified-governance-framework-design.md`
  - 计划：`.limcode/plans/world-pack-post-governance-closure.plan.md`
- 摘要:
完成 unified governance framework 的三项尾项收口：明确 ownership matrix 当前中间态；新增 canonical PackManifestLoader 并将 world/* 降级为兼容命名桥，同时显式化 /api/narrative/timeline、/api/agent/:id/overview、/api/policy/* 的兼容角色；将 death_note 默认样板改为显式 mediator 表达并同步所有模板副本。
- 下一步：如需继续演进，可评估是否彻底移除 /api/narrative/timeline、/api/agent/:id/overview、/api/policy/* 与 world/* 兼容命名层。

### PG2 · 完成 world-pack final backend closure
- 状态：completed
- 记录时间：2026-04-07T21:12:31.934Z
- 完成时间：2026-04-07T21:12:31.934Z
- 关联 TODO：wfbc1_storage_decision, wfbc2_storage_sqlite, wfbc3_pack_api_bridge, wfbc4_compat_freeze, wfbc5_operator_backend_contract, wfbc6_validation_docs
- 关联文档：
  - 设计：`.limcode/design/world-pack-unified-governance-framework-design.md`
  - 计划：`.limcode/plans/world-pack-final-backend-closure.plan.md`
- 摘要:
完成 world-pack unified governance framework 的后端收尾：engine-owned runtime collections 已真实落地到 pack-local runtime.sqlite；`/api/packs/:packId/overview` 与 `/api/packs/:packId/projections/timeline` 已收口为显式单 active-pack 合同，并新增 `PACK_ROUTE_ACTIVE_PACK_MISMATCH`；objective enforcement 与 trigger_event 均已补齐 pack-scoped Event bridge metadata；`/api/agent/:id/overview` 与 `/api/policy/*` 已冻结为 compatibility/debug surface；同时补齐 Authority Inspector / Rule Execution Timeline / Perception Diff 所需的后端合同，明确前端实现交由前端团队。
- 下一步：如继续推进，优先由前端团队基于后端合同实现 Authority Inspector / Rule Execution Timeline / Perception Diff 页面。
<!-- LIMCODE_PROGRESS_MILESTONES_END -->

## 风险与阻塞

<!-- LIMCODE_PROGRESS_RISKS_START -->
<!-- 暂无风险 -->
<!-- LIMCODE_PROGRESS_RISKS_END -->

## 最近更新

<!-- LIMCODE_PROGRESS_LOG_START -->
- 2026-04-07T11:07:29.896Z | artifact_changed | plan | 同步计划文档：.limcode/plans/world-pack-final-backend-closure.plan.md
- 2026-04-07T11:08:02.044Z | artifact_changed | plan | 创建新的后端收尾计划：.limcode/plans/world-pack-final-backend-closure.plan.md
- 2026-04-07T11:08:02.044Z | updated | 根据当前设计与代码对照结果，切换到 world-pack final backend closure 规划阶段；明确 Operator 高级视图仅补齐后端 contract，前端实现交由前端团队。
- 2026-04-07T11:09:11.996Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/world-pack-final-backend-closure.plan.md
- 2026-04-07T11:41:44.504Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/world-pack-final-backend-closure.plan.md
- 2026-04-07T11:42:03.114Z | updated | 完成 pack runtime storage 第一轮收尾：engine-owned runtime collections 迁移到真实 runtime.sqlite 表，保留 storage-plan.json 作为 install/compile metadata sidecar；typecheck 与 unit tests 通过。
- 2026-04-07T11:42:03.114Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/world-pack-final-backend-closure.plan.md
- 2026-04-07T11:42:03.114Z | artifact_changed | docs | 同步 docs/ARCH.md 与 docs/API.md，记录 runtime.sqlite 与 sidecar metadata 的最新边界。
- 2026-04-07T12:39:51.813Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/world-pack-final-backend-closure.plan.md
- 2026-04-07T12:40:47.582Z | updated | 完成 wfbc3 pack API / Event bridge 收口：新增 active-pack projection guard、明确 PACK_ROUTE_ACTIVE_PACK_MISMATCH 语义，并为 objective enforcement 与 trigger_event 统一补齐 pack-scoped event impact_data。
- 2026-04-07T12:40:47.582Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/world-pack-final-backend-closure.plan.md
- 2026-04-07T12:40:47.582Z | updated | 完成相关验证：typecheck、unit tests，以及 world_pack_projection_endpoints / trigger-event / smoke e2e 通过。
- 2026-04-07T21:06:35.657Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/world-pack-final-backend-closure.plan.md
- 2026-04-07T21:12:12.268Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/world-pack-final-backend-closure.plan.md
- 2026-04-07T21:12:31.934Z | milestone_recorded | PG2 | 记录里程碑：完成 world-pack final backend closure
- 2026-04-07T21:31:07.661Z | artifact_changed | design | 同步设计文档：将 `/api/agent/:id/overview` 统一标记为待删除历史遗留接口
- 2026-04-07T21:31:07.661Z | artifact_changed | docs | 同步 docs/API.md、docs/ARCH.md、docs/LOGIC.md、TODO.md、记录.md，统一 legacy overview 路由口径
- 2026-04-07T21:41:50.690Z | updated | 彻底删除 `/api/agent/:id/overview`：移除后端路由与相关兼容实现，并清理对应 e2e 成功路径断言。
- 2026-04-07T21:41:50.690Z | artifact_changed | design | 同步设计文档：将 `/api/agent/:id/overview` 更新为已删除历史接口
- 2026-04-07T21:41:50.690Z | artifact_changed | docs | 同步 docs/API.md、docs/ARCH.md、docs/LOGIC.md、TODO.md、记录.md，统一 legacy overview 已删除口径
<!-- LIMCODE_PROGRESS_LOG_END -->

<!-- LIMCODE_PROGRESS_METADATA_START -->
{
  "formatVersion": 1,
  "kind": "limcode.progress",
  "projectId": "yidhras",
  "projectName": "Yidhras",
  "createdAt": "2026-04-07T06:16:54.583Z",
  "updatedAt": "2026-04-07T21:41:50.690Z",
  "status": "active",
  "phase": "implementation",
  "currentFocus": "legacy overview removal completed",
  "latestConclusion": "已彻底删除 `/api/agent/:id/overview`：后端路由、相关兼容 meta 与对应成功路径 e2e 均已清理；design/API/ARCH/LOGIC/TODO/progress 已同步为“已删除历史接口”，当前 entity overview 唯一 canonical route 为 `/api/entities/:id/overview`。",
  "currentBlocker": null,
  "nextAction": "如继续推进，优先评估 `/api/policy/*` 是否长期保留为 debug surface，或进一步外提到独立 access-policy 子系统。",
  "activeArtifacts": {
    "design": ".limcode/design/world-pack-unified-governance-framework-design.md",
    "plan": ".limcode/plans/world-pack-final-backend-closure.plan.md"
  },
  "todos": [
    {
      "id": "wfbc1_storage_decision",
      "content": "明确 pack runtime storage 收尾策略，并锁定从 sidecar JSON 过渡到 runtime.sqlite engine-owned collections 的实施边界",
      "status": "completed"
    },
    {
      "id": "wfbc2_storage_sqlite",
      "content": "收口 pack runtime storage 实现，将 world_entities/entity_states/authority_grants/mediator_bindings/rule_execution_records 迁移到真实 runtime.sqlite 持久化",
      "status": "completed"
    },
    {
      "id": "wfbc3_pack_api_bridge",
      "content": "收口 `/api/packs/:packId/overview` 与 `/api/packs/:packId/projections/timeline` 的 packId 语义，并补强 Event bridge 的 pack-scoped 过滤/关联契约",
      "status": "completed"
    },
    {
      "id": "wfbc4_compat_freeze",
      "content": "冻结兼容接口 `/api/agent/:id/overview` 与 `/api/policy/*` 的最终定位、文档表述与退场条件",
      "status": "completed"
    },
    {
      "id": "wfbc5_operator_backend_contract",
      "content": "提供 Operator 高级视图所需的后端证据/接口契约；前端页面与交互实现明确交由前端团队",
      "status": "completed"
    },
    {
      "id": "wfbc6_validation_docs",
      "content": "完成 typecheck/tests 与 design/progress/ARCH/API 同步，确保代码状态、计划与文档一致",
      "status": "completed"
    }
  ],
  "milestones": [
    {
      "id": "PG1",
      "title": "完成 world-pack post-governance closure",
      "status": "completed",
      "summary": "完成 unified governance framework 的三项尾项收口：明确 ownership matrix 当前中间态；新增 canonical PackManifestLoader 并将 world/* 降级为兼容命名桥，同时显式化 /api/narrative/timeline、/api/agent/:id/overview、/api/policy/* 的兼容角色；将 death_note 默认样板改为显式 mediator 表达并同步所有模板副本。",
      "relatedTodoIds": [
        "g1_ownership_matrix",
        "g2_module_closure",
        "g3_death_note_mediator",
        "g4_validation_docs"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/world-pack-unified-governance-framework-design.md",
        "plan": ".limcode/plans/world-pack-post-governance-closure.plan.md"
      },
      "completedAt": "2026-04-07T07:04:13.646Z",
      "recordedAt": "2026-04-07T07:04:13.646Z",
      "nextAction": "如需继续演进，可评估是否彻底移除 /api/narrative/timeline、/api/agent/:id/overview、/api/policy/* 与 world/* 兼容命名层。"
    },
    {
      "id": "PG2",
      "title": "完成 world-pack final backend closure",
      "status": "completed",
      "summary": "完成 world-pack unified governance framework 的后端收尾：engine-owned runtime collections 已真实落地到 pack-local runtime.sqlite；`/api/packs/:packId/overview` 与 `/api/packs/:packId/projections/timeline` 已收口为显式单 active-pack 合同，并新增 `PACK_ROUTE_ACTIVE_PACK_MISMATCH`；objective enforcement 与 trigger_event 均已补齐 pack-scoped Event bridge metadata；`/api/agent/:id/overview` 与 `/api/policy/*` 已冻结为 compatibility/debug surface；同时补齐 Authority Inspector / Rule Execution Timeline / Perception Diff 所需的后端合同，明确前端实现交由前端团队。",
      "relatedTodoIds": [
        "wfbc1_storage_decision",
        "wfbc2_storage_sqlite",
        "wfbc3_pack_api_bridge",
        "wfbc4_compat_freeze",
        "wfbc5_operator_backend_contract",
        "wfbc6_validation_docs"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/world-pack-unified-governance-framework-design.md",
        "plan": ".limcode/plans/world-pack-final-backend-closure.plan.md"
      },
      "completedAt": "2026-04-07T21:12:31.934Z",
      "recordedAt": "2026-04-07T21:12:31.934Z",
      "nextAction": "如继续推进，优先由前端团队基于后端合同实现 Authority Inspector / Rule Execution Timeline / Perception Diff 页面。"
    }
  ],
  "risks": [],
  "log": [
    {
      "at": "2026-04-07T11:07:29.896Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划文档：.limcode/plans/world-pack-final-backend-closure.plan.md"
    },
    {
      "at": "2026-04-07T11:08:02.044Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "创建新的后端收尾计划：.limcode/plans/world-pack-final-backend-closure.plan.md"
    },
    {
      "at": "2026-04-07T11:08:02.044Z",
      "type": "updated",
      "message": "根据当前设计与代码对照结果，切换到 world-pack final backend closure 规划阶段；明确 Operator 高级视图仅补齐后端 contract，前端实现交由前端团队。"
    },
    {
      "at": "2026-04-07T11:09:11.996Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/world-pack-final-backend-closure.plan.md"
    },
    {
      "at": "2026-04-07T11:41:44.504Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/world-pack-final-backend-closure.plan.md"
    },
    {
      "at": "2026-04-07T11:42:03.114Z",
      "type": "updated",
      "message": "完成 pack runtime storage 第一轮收尾：engine-owned runtime collections 迁移到真实 runtime.sqlite 表，保留 storage-plan.json 作为 install/compile metadata sidecar；typecheck 与 unit tests 通过。"
    },
    {
      "at": "2026-04-07T11:42:03.114Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/world-pack-final-backend-closure.plan.md"
    },
    {
      "at": "2026-04-07T11:42:03.114Z",
      "type": "artifact_changed",
      "refId": "docs",
      "message": "同步 docs/ARCH.md 与 docs/API.md，记录 runtime.sqlite 与 sidecar metadata 的最新边界。"
    },
    {
      "at": "2026-04-07T12:39:51.813Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/world-pack-final-backend-closure.plan.md"
    },
    {
      "at": "2026-04-07T12:40:47.582Z",
      "type": "updated",
      "message": "完成 wfbc3 pack API / Event bridge 收口：新增 active-pack projection guard、明确 PACK_ROUTE_ACTIVE_PACK_MISMATCH 语义，并为 objective enforcement 与 trigger_event 统一补齐 pack-scoped event impact_data。"
    },
    {
      "at": "2026-04-07T12:40:47.582Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/world-pack-final-backend-closure.plan.md"
    },
    {
      "at": "2026-04-07T12:40:47.582Z",
      "type": "updated",
      "message": "完成相关验证：typecheck、unit tests，以及 world_pack_projection_endpoints / trigger-event / smoke e2e 通过。"
    },
    {
      "at": "2026-04-07T21:06:35.657Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/world-pack-final-backend-closure.plan.md"
    },
    {
      "at": "2026-04-07T21:12:12.268Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/world-pack-final-backend-closure.plan.md"
    },
    {
      "at": "2026-04-07T21:12:31.934Z",
      "type": "milestone_recorded",
      "refId": "PG2",
      "message": "记录里程碑：完成 world-pack final backend closure"
    },
    {
      "at": "2026-04-07T21:31:07.661Z",
      "type": "artifact_changed",
      "refId": "design",
      "message": "同步设计文档：将 `/api/agent/:id/overview` 统一标记为待删除历史遗留接口"
    },
    {
      "at": "2026-04-07T21:31:07.661Z",
      "type": "artifact_changed",
      "refId": "docs",
      "message": "同步 docs/API.md、docs/ARCH.md、docs/LOGIC.md、TODO.md、记录.md，统一 legacy overview 路由口径"
    },
    {
      "at": "2026-04-07T21:41:50.690Z",
      "type": "updated",
      "message": "彻底删除 `/api/agent/:id/overview`：移除后端路由与相关兼容实现，并清理对应 e2e 成功路径断言。"
    },
    {
      "at": "2026-04-07T21:41:50.690Z",
      "type": "artifact_changed",
      "refId": "design",
      "message": "同步设计文档：将 `/api/agent/:id/overview` 更新为已删除历史接口"
    },
    {
      "at": "2026-04-07T21:41:50.690Z",
      "type": "artifact_changed",
      "refId": "docs",
      "message": "同步 docs/API.md、docs/ARCH.md、docs/LOGIC.md、TODO.md、记录.md，统一 legacy overview 已删除口径"
    }
  ],
  "stats": {
    "milestonesTotal": 2,
    "milestonesCompleted": 2,
    "todosTotal": 6,
    "todosCompleted": 6,
    "todosInProgress": 0,
    "todosCancelled": 0,
    "activeRisks": 0
  },
  "render": {
    "rendererVersion": 1,
    "generatedAt": "2026-04-07T21:41:50.690Z",
    "bodyHash": "sha256:95ffdd5caef813e835e61e0d2668e5916f3fb1c55dae03dce6aea5f7fdda8791"
  }
}
<!-- LIMCODE_PROGRESS_METADATA_END -->
