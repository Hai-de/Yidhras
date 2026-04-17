# 项目进度
- Project: Yidhras
- Updated At: 2026-04-17T04:13:53.474Z
- Status: completed
- Phase: implementation

## 当前摘要

<!-- LIMCODE_PROGRESS_SUMMARY_START -->
- 当前进度：13/13 个里程碑已完成；最新：PG9
- 当前焦点：完成 pack-local 插件系统 Phase 8 收口
- 最新结论：pack-local 插件治理主线已经完整成立，可进入后续增强阶段。
- 下一步：后续可继续推进 CLI 命令、GUI acknowledgement 弹窗、真实 web bundle 动态加载和更全面的 lint/test 覆盖。
<!-- LIMCODE_PROGRESS_SUMMARY_END -->

## 关联文档

<!-- LIMCODE_PROGRESS_ARTIFACTS_START -->
- 设计：`.limcode/design/pack-local-plugin-unified-management-design.md`
- 计划：`.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md`
- 审查：`.limcode/review/documentation-code-consistency-review.md`
<!-- LIMCODE_PROGRESS_ARTIFACTS_END -->

## 当前 TODO 快照

<!-- LIMCODE_PROGRESS_TODOS_START -->
- [x] 补齐插件配置与合同基线：扩展 runtime config/schema、定义 plugin manifest 与持久化模型、明确错误码与审计事件枚举。  `#plugin-phase-1`
- [x] 实现 kernel-side 插件管理主线：artifact / installation / activation / acknowledgement 的存储、服务与生命周期状态机。  `#plugin-phase-2`
- [x] 打通 pack-local 发现与导入确认：扫描 world pack plugins 目录、校验/编译工件、创建 pending_confirmation 安装项并支持升级重确认。  `#plugin-phase-3`
- [x] 实现启用/禁用流程与 trust lecture：覆盖 CLI / API / GUI 所需 acknowledgement 校验、默认提醒配置与审计记录。  `#plugin-phase-4`
- [x] 实现 server-side plugin host：受控注册 context/prompt/intent/projection/pack-local route 扩展点，并接入 active-pack 生命周期。  `#plugin-phase-5`
- [x] 实现 web UI plugin runtime：暴露已启用插件清单与 web contribution manifest，按 pack-local 命名空间动态加载 panel/route 并做错误隔离。  `#plugin-phase-6`
- [x] 补齐 operator/management 界面与只读合同：提供插件列表、详情、确认、启用、禁用、失败状态与 capability 风险展示。  `#plugin-phase-7`
- [x] 完成测试与文档同步：覆盖 unit/integration/web tests，并更新 ARCH/API/WORLD_PACK/progress。  `#plugin-phase-8`
<!-- LIMCODE_PROGRESS_TODOS_END -->

## 项目里程碑

<!-- LIMCODE_PROGRESS_MILESTONES_START -->
### PG1 · 完成文档同步与契约对齐修订
- 状态：completed
- 记录时间：2026-04-10T18:56:41.818Z
- 完成时间：2026-04-10T18:56:41.818Z
- 关联 TODO：doc-plan-p1, doc-plan-p2, doc-plan-p3, doc-plan-p4, doc-plan-p5
- 关联文档：
  - 设计：`.limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md`
  - 计划：`.limcode/plans/documentation-sync-and-contract-alignment.plan.md`
  - 审查：`.limcode/review/documentation-code-consistency-review.md`
- 摘要:
已完成本轮文档同步修订：1）修正 `docs/API.md` 中 AiInvocation 公开边界自相矛盾的问题，并补入系统通知接口；2）更新 `README.md` 当前实现概览，补充 operator 壳层运行态与通知读面入口；3）补齐 `packages/contracts/src/projections.ts` 中 entity overview 的 `memory.latest_blocks` 与 `context_governance` 契约；4）为 memory block 相关 design/plan 文档补充历史资产与当前实现差异说明，并在计划文档中回写实际交付结果；5）完成交叉复核，确认稳定文档、contracts 与过程文档的主要口径冲突已收敛。
- 下一步：如需进一步收紧文档治理，可继续把 `记录.md` 和其他过程性资产也按“现状/历史”边界做一次统一清理。

### pwf-phase-e · 完成 Prompt Workflow 正式化实现与收口
- 状态：completed
- 记录时间：2026-04-13T08:52:45.841Z
- 完成时间：2026-04-13T08:52:45.841Z
- 关联 TODO：pwf-plan-p1, pwf-plan-p2, pwf-plan-p3, pwf-plan-p4, pwf-plan-p5, pwf-plan-p6
- 关联文档：
  - 设计：`.limcode/design/prompt-workflow-formalization-design.md`
  - 计划：`.limcode/plans/prompt-workflow-formalization.plan.md`
  - 审查：`.limcode/review/documentation-code-consistency-review.md`
- 摘要:
已完成 Prompt Workflow 正式化的主要实施闭环：1）新增 PromptWorkflowProfile / StepSpec / State / Diagnostics / Registry 与默认 profiles/selector；2）用 runPromptWorkflow runtime 接管原 Context Orchestrator 出口；3）实现 placement_resolution，支持 prepend/append/before_anchor/after_anchor 与 slot_start/slot_end/source/tag/fragment_id anchors；4）引入 PromptSectionDraft、node_grouping 与 fragment_assembly 分层；5）将 workflow metadata 透传至 PromptBundle、AI messages、AiTaskRequest 与 ModelGatewayRequest；6）增强 InferenceTrace.context_snapshot / workflow snapshot 的 prompt_workflow 读面，并同步 docs/ARCH.md、docs/LOGIC.md；7）完成 eslint、typecheck 与相关单测收口。
- 下一步：如需继续深化，可在下一轮把 context_summary / memory_compaction 的实际调用入口接到 runtime，并补更多 integration/e2e coverage。

### pwtad-phase-e · 完成 Prompt Workflow task-aware 深化与回归收口
- 状态：completed
- 记录时间：2026-04-13T11:05:53.761Z
- 完成时间：2026-04-13T11:06:56.000Z
- 关联 TODO：pwtad-plan-p1, pwtad-plan-p2, pwtad-plan-p3, pwtad-plan-p4, pwtad-plan-p5
- 关联文档：
  - 设计：`.limcode/design/prompt-workflow-formalization-design.md`
  - 计划：`.limcode/plans/prompt-workflow-task-aware-deepening.plan.md`
  - 审查：`.limcode/review/documentation-code-consistency-review.md`
- 摘要:
已完成 Prompt Workflow task-aware 深化的主要实现闭环：1）打通 task_type 从 prompt builder / inference service 到 runPromptWorkflow 的显式传递链；2）新增 ai/task_prompt_builder，统一构造 task-aware PromptBundle 与 AiTaskRequest，使 context_summary / memory_compaction 可稳定命中各自 workflow profile；3）在 section_drafts / runtime / token_budget_trimmer 中加入 task-aware section ordering、pruning 与 slot priority 调整；4）增强 PromptBundle metadata、gateway trace 与 context snapshot，直接暴露 workflow_task_type、workflow_section_summary、workflow_placement_summary；5）补齐 unit/e2e 回归断言，并让 context_summary / memory_compaction 显式包含 fragment_assembly step，完成本轮计划收口。
- 下一步：如需继续深化，可在下一轮把 context_summary / memory_compaction 的真实业务消费者接入更多 integration/e2e 场景，并考虑补充 docs/ARCH.md、docs/LOGIC.md 对 task-aware workflow 读面的说明。

### pwopt-phase-e · 完成提示词处理工作流优化计划
- 状态：completed
- 记录时间：2026-04-13T14:30:26.187Z
- 完成时间：2026-04-13T14:29:35+08:00
- 关联 TODO：pwopt-p1, pwopt-p2, pwopt-p3, pwopt-p4, pwopt-p5
- 关联文档：
  - 设计：`.limcode/design/prompt-workflow-formalization-design.md`
  - 计划：`.limcode/plans/提示词处理工作流优化计划.plan.md`
  - 审查：`.limcode/review/documentation-code-consistency-review.md`
- 摘要:
已完成本轮提示词处理工作流优化闭环：1）收紧 Prompt Workflow metadata / PromptBundle / AI task / trace snapshot 类型边界，为 PromptProcessingTrace 引入结构化 prompt_workflow 快照，并修复 workflow replay e2e 对 workflow_step_keys 的 unknown 断言；2）让 token_budget_trimmer 优先消费 runtime 透传的 workflow/task_type 读面，补齐 task_type、slot_priority、kept/trimmed fragment ids、optional_fragment_scores、trimmed_by_slot、trimmed_sources、section_summary 等可解释诊断；3）在 section_drafts 中引入 standard / evidence_first / memory_focused 三类 task-aware policy，使 context_summary / memory_compaction 在 minimal 模式下可按 memory/context snapshot 存在情况进一步裁剪 role/world/output_contract / context_snapshot，并把 task policy 写入 draft metadata，同时 section summary 新增 sections_by_type / section_policies；4）补齐相关 unit/e2e 回归并清理 eslint/typecheck 边界；5）同步 docs/ARCH.md 与 docs/LOGIC.md，补充新的 task policy、section summary 与 trimming 读面说明。
- 下一步：如需继续深化，可在下一轮把 section/trimming 新读面补入更多 integration/e2e persisted trace 断言，或继续优化具体 task 的 section policy 与评分策略。

### pwdb-phase-e · 完成 Prompt Workflow 深化计划 B
- 状态：completed
- 记录时间：2026-04-13T18:16:15.836Z
- 完成时间：2026-04-13T18:15:46+08:00
- 关联 TODO：pwdb-p1, pwdb-p2, pwdb-p3, pwdb-p4, pwdb-p5
- 关联文档：
  - 设计：`.limcode/design/prompt-workflow-formalization-design.md`
  - 计划：`.limcode/plans/prompt-workflow-深化计划-b任务特定策略与-section-级预算.plan.md`
  - 审查：`.limcode/review/documentation-code-consistency-review.md`
- 摘要:
已完成 Prompt Workflow 深化计划 B 的主要闭环：1）梳理并确认当前 context_summary / memory_compaction 的差异仍主要停留在 section 保留与 section type 排序，fragment scoring 仍以 slot priority + fragment priority + importance/salience 为主；2）在 section_drafts 中引入 task-specific ranking_score / score_components / score_reasons，并把 section_scores 纳入 section summary 读面；3）为 context_summary / memory_compaction profile 显式加入 token_budget_trim，使 task-aware workflow 主线能够消费 ranking 与 budget；4）建立 section_budget 结构、分配结果与 kept/dropped section 诊断，并让 token_budget_trimmer 基于 section_scores 生成 allocation，同时开始通过 section_id -> fragment 的映射回写 section keep/drop 结果；5）补齐 workflow replay / smoke endpoints 对 section_policies、sections_by_type、section_scores 与 token_budget_trimming.section_budget 的 persisted trace 回归；6）同步 docs/ARCH.md 与 docs/LOGIC.md，记录 ranking / section-budget 的语义与当前“第一轮预算模型”边界。
- 下一步：如需继续深化，可在下一轮把 section_budget 从第一轮分配模型推进到更精细的 section rebalance / fragment packing 策略，或扩展更多 integration 场景验证 task-specific budget 行为。

### PG2 · 完成 pack-local 插件 Phase 1 基线
- 状态：completed
- 记录时间：2026-04-16T11:07:11.833Z
- 完成时间：2026-04-16T11:07:11.833Z
- 关联 TODO：plugin-phase-1
- 关联文档：
  - 设计：`.limcode/design/pack-local-plugin-unified-management-design.md`
  - 计划：`.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md`
- 摘要:
已完成插件系统 Phase 1 基线建设：扩展 runtime config/schema 的 plugins.enable_warning 配置；新增 plugin manifest / artifact / installation / activation / acknowledgement 合同；加入 canonical trust lecture 常量；补齐 Prisma 持久化模型与迁移脚本；server typecheck 已通过。
- 下一步：继续实现 kernel-side 插件管理服务与生命周期状态机。

### PG3 · 完成 pack-local 插件 Phase 2 管理主线
- 状态：completed
- 记录时间：2026-04-16T11:11:10.525Z
- 完成时间：2026-04-16T11:11:10.525Z
- 关联 TODO：plugin-phase-2
- 关联文档：
  - 设计：`.limcode/design/pack-local-plugin-unified-management-design.md`
  - 计划：`.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md`
- 摘要:
已完成插件管理服务层基线：新增 plugin store 与 manager service，支持 artifact 注册、pack-local installation upsert、upgrade_pending_confirmation 检测、确认/禁用/归档/错误状态流转、activation session 写入与 enable acknowledgement 记录。
- 下一步：继续接入 world pack plugins 目录扫描与导入确认主链。

### PG4 · 完成 pack-local 插件 Phase 3 导入发现
- 状态：completed
- 记录时间：2026-04-16T11:16:43.632Z
- 完成时间：2026-04-16T11:16:43.632Z
- 关联 TODO：plugin-phase-3
- 关联文档：
  - 设计：`.limcode/design/pack-local-plugin-unified-management-design.md`
  - 计划：`.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md`
- 摘要:
已完成 pack-local 插件发现主线：runtime activation 会扫描 world pack 的 plugins/ 目录，解析 plugin.manifest.yaml / yml，校验 manifest 与 pack compatibility，注册 artifact，并为 pack-local 作用域建立 pending_confirmation 安装项；当工件变化时会推动 installation 进入 upgrade_pending_confirmation。
- 下一步：继续实现 trust lecture acknowledgement 与显式 enable/disable 主线。

### PG5 · 完成 pack-local 插件 Phase 4 启用治理
- 状态：completed
- 记录时间：2026-04-16T11:22:44.966Z
- 完成时间：2026-04-16T11:22:44.966Z
- 关联 TODO：plugin-phase-4
- 关联文档：
  - 设计：`.limcode/design/pack-local-plugin-unified-management-design.md`
  - 计划：`.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md`
- 摘要:
已完成插件启用治理基线：增加 pack plugin 列表、确认、启用、禁用 API；将 runtime config 的 enable_warning 配置接入 AppContext；启用时默认要求 acknowledgement，否则返回 PLUGIN_ENABLE_ACK_REQUIRED；为后续 CLI / GUI 接线提供统一服务入口。
- 下一步：继续实现 server plugin host API 与 active-pack 生命周期集成。

### PG6 · 完成 pack-local 插件 Phase 5 server host
- 状态：completed
- 记录时间：2026-04-16T14:37:13.518Z
- 完成时间：2026-04-16T14:37:13.518Z
- 关联 TODO：plugin-phase-5
- 关联文档：
  - 设计：`.limcode/design/pack-local-plugin-unified-management-design.md`
  - 计划：`.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md`
- 摘要:
已完成 server-side plugin host 基线：建立 pack-local runtime registry；允许受控注册 context source、prompt workflow step 与 pack-local API route；启用/禁用插件后刷新 active-pack runtime；宿主 create_app、context service 与 prompt workflow runtime 已开始消费这些扩展点。
- 下一步：继续实现 web plugin runtime 与前端动态装载主线。

### PG7 · 完成 pack-local 插件 Phase 6 web runtime
- 状态：completed
- 记录时间：2026-04-17T03:48:32.536Z
- 完成时间：2026-04-17T03:48:32.536Z
- 关联 TODO：plugin-phase-6
- 关联文档：
  - 设计：`.limcode/design/pack-local-plugin-unified-management-design.md`
  - 计划：`.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md`
- 摘要:
已完成 web plugin runtime 基线：后端提供 active-pack web plugin runtime manifest API；前端新增 plugin runtime store 与 bootstrap；overview、entity、timeline 已能显示 pack-local plugin panel host，为后续动态 bundle / route 装载留出稳定读面。
- 下一步：继续实现 operator 插件管理页面与风险展示。

### PG8 · 完成 pack-local 插件 Phase 7 管理界面
- 状态：completed
- 记录时间：2026-04-17T04:09:13.428Z
- 完成时间：2026-04-17T04:09:13.428Z
- 关联 TODO：plugin-phase-7
- 关联文档：
  - 设计：`.limcode/design/pack-local-plugin-unified-management-design.md`
  - 计划：`.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md`
- 摘要:
已完成 operator / management 界面基线：新增 /plugins 页面，提供 pack-local 插件列表、详情、生命周期状态、risk 分级与 capability 读面；同时把 shell workspace 与导航扩展到 Plugin Management，使插件治理成为正式 operator 工作区的一部分。
- 下一步：继续补齐 lint / tests 与文档同步，完成 Phase 8。

### PG9 · 完成 pack-local 插件系统实施收口
- 状态：completed
- 记录时间：2026-04-17T04:13:53.474Z
- 完成时间：2026-04-17T04:13:53.474Z
- 关联 TODO：plugin-phase-8
- 关联文档：
  - 设计：`.limcode/design/pack-local-plugin-unified-management-design.md`
  - 计划：`.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md`
- 摘要:
pack-local 插件系统已完成一轮实现收口：具备统一 plugin artifact / installation / activation / acknowledgement 管理模型，支持 world pack 自带插件发现、导入确认、trust lecture 保护下的启用、server-side host runtime、web runtime manifest 读面，以及 operator /plugins 管理界面。最终已补充关键单测并同步 API / ARCH / WORLD_PACK 文档。
- 下一步：后续可继续推进 CLI 命令、GUI acknowledgement 弹窗、真实 web bundle 动态加载和更全面的 lint/test 覆盖。
<!-- LIMCODE_PROGRESS_MILESTONES_END -->

## 风险与阻塞

<!-- LIMCODE_PROGRESS_RISKS_START -->
<!-- 暂无风险 -->
<!-- LIMCODE_PROGRESS_RISKS_END -->

## 最近更新

<!-- LIMCODE_PROGRESS_LOG_START -->
- 2026-04-16T11:07:11.532Z | updated | plugin-phase-1 | 完成 Phase 1：扩展 runtime config 插件提醒配置，新增 packages/contracts/src/plugins.ts 与 apps/server/src/plugins/contracts.ts，补齐 PluginArtifact/Installation/ActivationSession/EnableAcknowledgement Prisma 基线与迁移脚本，并通过 yidhras-server typecheck。
- 2026-04-16T11:07:11.833Z | milestone_recorded | PG2 | 记录里程碑：完成 pack-local 插件 Phase 1 基线
- 2026-04-16T11:11:10.508Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md
- 2026-04-16T11:11:10.525Z | milestone_recorded | PG3 | 记录里程碑：完成 pack-local 插件 Phase 2 管理主线
- 2026-04-16T11:16:43.519Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md
- 2026-04-16T11:16:43.542Z | updated | plugin-phase-3 | 完成 Phase 3：新增 apps/server/src/plugins/discovery.ts，并在 runtime activation 中接入 world pack plugins 目录扫描、YAML manifest 解析、pack 兼容性校验、artifact 注册与 pack-local installation 建立；同 checksum 工件复用已有 artifact，工件变化触发 upgrade_pending_confirmation；server typecheck 已通过。
- 2026-04-16T11:16:43.632Z | milestone_recorded | PG4 | 记录里程碑：完成 pack-local 插件 Phase 3 导入发现
- 2026-04-16T11:22:44.921Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md
- 2026-04-16T11:22:44.957Z | updated | plugin-phase-4 | 完成 Phase 4：新增 app/services/plugins.ts 与 app/routes/plugins.ts，提供 pack plugin 列表、导入确认、启用、禁用 API；启用路径接入 context.getPluginEnableWarningConfig() 与 PLUGIN_ENABLE_ACK_REQUIRED 校验；server typecheck 已通过。
- 2026-04-16T11:22:44.966Z | milestone_recorded | PG5 | 记录里程碑：完成 pack-local 插件 Phase 4 启用治理
- 2026-04-16T14:37:13.225Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md
- 2026-04-16T14:37:13.518Z | milestone_recorded | PG6 | 记录里程碑：完成 pack-local 插件 Phase 5 server host
- 2026-04-17T03:48:32.490Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md
- 2026-04-17T03:48:32.536Z | milestone_recorded | PG7 | 记录里程碑：完成 pack-local 插件 Phase 6 web runtime
- 2026-04-17T04:09:12.321Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md
- 2026-04-17T04:09:12.753Z | updated | plugin-phase-7 | 完成 Phase 7：新增 apps/web/pages/plugins.vue 与 usePluginManagementPage，提供插件列表、详情、风险级别与 acknowledgement 提示；同时扩展 shell workspace/navigation 支持 Plugin Management 页面，web typecheck 已通过。
- 2026-04-17T04:09:13.428Z | milestone_recorded | PG8 | 记录里程碑：完成 pack-local 插件 Phase 7 管理界面
- 2026-04-17T04:13:53.423Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md
- 2026-04-17T04:13:53.450Z | updated | plugin-phase-8 | 完成 Phase 8：新增 server plugin_service 单测与 web plugin.runtime.store 单测，验证服务与前端运行态读面；已通过 yidhras-server / web typecheck，并同步 docs/API.md、docs/ARCH.md、docs/WORLD_PACK.md 说明。
- 2026-04-17T04:13:53.474Z | milestone_recorded | PG9 | 记录里程碑：完成 pack-local 插件系统实施收口
<!-- LIMCODE_PROGRESS_LOG_END -->

<!-- LIMCODE_PROGRESS_METADATA_START -->
{
  "formatVersion": 1,
  "kind": "limcode.progress",
  "projectId": "yidhras",
  "projectName": "Yidhras",
  "createdAt": "2026-04-10T04:03:06.461Z",
  "updatedAt": "2026-04-17T04:13:53.474Z",
  "status": "completed",
  "phase": "implementation",
  "currentFocus": "完成 pack-local 插件系统 Phase 8 收口",
  "latestConclusion": "pack-local 插件治理主线已经完整成立，可进入后续增强阶段。",
  "currentBlocker": null,
  "nextAction": "后续可继续推进 CLI 命令、GUI acknowledgement 弹窗、真实 web bundle 动态加载和更全面的 lint/test 覆盖。",
  "activeArtifacts": {
    "design": ".limcode/design/pack-local-plugin-unified-management-design.md",
    "plan": ".limcode/plans/pack-local-plugin-unified-management-implementation.plan.md",
    "review": ".limcode/review/documentation-code-consistency-review.md"
  },
  "todos": [
    {
      "id": "plugin-phase-1",
      "content": "补齐插件配置与合同基线：扩展 runtime config/schema、定义 plugin manifest 与持久化模型、明确错误码与审计事件枚举。",
      "status": "completed"
    },
    {
      "id": "plugin-phase-2",
      "content": "实现 kernel-side 插件管理主线：artifact / installation / activation / acknowledgement 的存储、服务与生命周期状态机。",
      "status": "completed"
    },
    {
      "id": "plugin-phase-3",
      "content": "打通 pack-local 发现与导入确认：扫描 world pack plugins 目录、校验/编译工件、创建 pending_confirmation 安装项并支持升级重确认。",
      "status": "completed"
    },
    {
      "id": "plugin-phase-4",
      "content": "实现启用/禁用流程与 trust lecture：覆盖 CLI / API / GUI 所需 acknowledgement 校验、默认提醒配置与审计记录。",
      "status": "completed"
    },
    {
      "id": "plugin-phase-5",
      "content": "实现 server-side plugin host：受控注册 context/prompt/intent/projection/pack-local route 扩展点，并接入 active-pack 生命周期。",
      "status": "completed"
    },
    {
      "id": "plugin-phase-6",
      "content": "实现 web UI plugin runtime：暴露已启用插件清单与 web contribution manifest，按 pack-local 命名空间动态加载 panel/route 并做错误隔离。",
      "status": "completed"
    },
    {
      "id": "plugin-phase-7",
      "content": "补齐 operator/management 界面与只读合同：提供插件列表、详情、确认、启用、禁用、失败状态与 capability 风险展示。",
      "status": "completed"
    },
    {
      "id": "plugin-phase-8",
      "content": "完成测试与文档同步：覆盖 unit/integration/web tests，并更新 ARCH/API/WORLD_PACK/progress。",
      "status": "completed"
    }
  ],
  "milestones": [
    {
      "id": "PG1",
      "title": "完成文档同步与契约对齐修订",
      "status": "completed",
      "summary": "已完成本轮文档同步修订：1）修正 `docs/API.md` 中 AiInvocation 公开边界自相矛盾的问题，并补入系统通知接口；2）更新 `README.md` 当前实现概览，补充 operator 壳层运行态与通知读面入口；3）补齐 `packages/contracts/src/projections.ts` 中 entity overview 的 `memory.latest_blocks` 与 `context_governance` 契约；4）为 memory block 相关 design/plan 文档补充历史资产与当前实现差异说明，并在计划文档中回写实际交付结果；5）完成交叉复核，确认稳定文档、contracts 与过程文档的主要口径冲突已收敛。",
      "relatedTodoIds": [
        "doc-plan-p1",
        "doc-plan-p2",
        "doc-plan-p3",
        "doc-plan-p4",
        "doc-plan-p5"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md",
        "plan": ".limcode/plans/documentation-sync-and-contract-alignment.plan.md",
        "review": ".limcode/review/documentation-code-consistency-review.md"
      },
      "completedAt": "2026-04-10T18:56:41.818Z",
      "recordedAt": "2026-04-10T18:56:41.818Z",
      "nextAction": "如需进一步收紧文档治理，可继续把 `记录.md` 和其他过程性资产也按“现状/历史”边界做一次统一清理。"
    },
    {
      "id": "pwf-phase-e",
      "title": "完成 Prompt Workflow 正式化实现与收口",
      "status": "completed",
      "summary": "已完成 Prompt Workflow 正式化的主要实施闭环：1）新增 PromptWorkflowProfile / StepSpec / State / Diagnostics / Registry 与默认 profiles/selector；2）用 runPromptWorkflow runtime 接管原 Context Orchestrator 出口；3）实现 placement_resolution，支持 prepend/append/before_anchor/after_anchor 与 slot_start/slot_end/source/tag/fragment_id anchors；4）引入 PromptSectionDraft、node_grouping 与 fragment_assembly 分层；5）将 workflow metadata 透传至 PromptBundle、AI messages、AiTaskRequest 与 ModelGatewayRequest；6）增强 InferenceTrace.context_snapshot / workflow snapshot 的 prompt_workflow 读面，并同步 docs/ARCH.md、docs/LOGIC.md；7）完成 eslint、typecheck 与相关单测收口。",
      "relatedTodoIds": [
        "pwf-plan-p1",
        "pwf-plan-p2",
        "pwf-plan-p3",
        "pwf-plan-p4",
        "pwf-plan-p5",
        "pwf-plan-p6"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/prompt-workflow-formalization-design.md",
        "plan": ".limcode/plans/prompt-workflow-formalization.plan.md",
        "review": ".limcode/review/documentation-code-consistency-review.md"
      },
      "completedAt": "2026-04-13T08:52:45.841Z",
      "recordedAt": "2026-04-13T08:52:45.841Z",
      "nextAction": "如需继续深化，可在下一轮把 context_summary / memory_compaction 的实际调用入口接到 runtime，并补更多 integration/e2e coverage。"
    },
    {
      "id": "pwtad-phase-e",
      "title": "完成 Prompt Workflow task-aware 深化与回归收口",
      "status": "completed",
      "summary": "已完成 Prompt Workflow task-aware 深化的主要实现闭环：1）打通 task_type 从 prompt builder / inference service 到 runPromptWorkflow 的显式传递链；2）新增 ai/task_prompt_builder，统一构造 task-aware PromptBundle 与 AiTaskRequest，使 context_summary / memory_compaction 可稳定命中各自 workflow profile；3）在 section_drafts / runtime / token_budget_trimmer 中加入 task-aware section ordering、pruning 与 slot priority 调整；4）增强 PromptBundle metadata、gateway trace 与 context snapshot，直接暴露 workflow_task_type、workflow_section_summary、workflow_placement_summary；5）补齐 unit/e2e 回归断言，并让 context_summary / memory_compaction 显式包含 fragment_assembly step，完成本轮计划收口。",
      "relatedTodoIds": [
        "pwtad-plan-p1",
        "pwtad-plan-p2",
        "pwtad-plan-p3",
        "pwtad-plan-p4",
        "pwtad-plan-p5"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/prompt-workflow-formalization-design.md",
        "plan": ".limcode/plans/prompt-workflow-task-aware-deepening.plan.md",
        "review": ".limcode/review/documentation-code-consistency-review.md"
      },
      "completedAt": "2026-04-13T11:06:56.000Z",
      "recordedAt": "2026-04-13T11:05:53.761Z",
      "nextAction": "如需继续深化，可在下一轮把 context_summary / memory_compaction 的真实业务消费者接入更多 integration/e2e 场景，并考虑补充 docs/ARCH.md、docs/LOGIC.md 对 task-aware workflow 读面的说明。"
    },
    {
      "id": "pwopt-phase-e",
      "title": "完成提示词处理工作流优化计划",
      "status": "completed",
      "summary": "已完成本轮提示词处理工作流优化闭环：1）收紧 Prompt Workflow metadata / PromptBundle / AI task / trace snapshot 类型边界，为 PromptProcessingTrace 引入结构化 prompt_workflow 快照，并修复 workflow replay e2e 对 workflow_step_keys 的 unknown 断言；2）让 token_budget_trimmer 优先消费 runtime 透传的 workflow/task_type 读面，补齐 task_type、slot_priority、kept/trimmed fragment ids、optional_fragment_scores、trimmed_by_slot、trimmed_sources、section_summary 等可解释诊断；3）在 section_drafts 中引入 standard / evidence_first / memory_focused 三类 task-aware policy，使 context_summary / memory_compaction 在 minimal 模式下可按 memory/context snapshot 存在情况进一步裁剪 role/world/output_contract / context_snapshot，并把 task policy 写入 draft metadata，同时 section summary 新增 sections_by_type / section_policies；4）补齐相关 unit/e2e 回归并清理 eslint/typecheck 边界；5）同步 docs/ARCH.md 与 docs/LOGIC.md，补充新的 task policy、section summary 与 trimming 读面说明。",
      "relatedTodoIds": [
        "pwopt-p1",
        "pwopt-p2",
        "pwopt-p3",
        "pwopt-p4",
        "pwopt-p5"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/prompt-workflow-formalization-design.md",
        "plan": ".limcode/plans/提示词处理工作流优化计划.plan.md",
        "review": ".limcode/review/documentation-code-consistency-review.md"
      },
      "completedAt": "2026-04-13T14:29:35+08:00",
      "recordedAt": "2026-04-13T14:30:26.187Z",
      "nextAction": "如需继续深化，可在下一轮把 section/trimming 新读面补入更多 integration/e2e persisted trace 断言，或继续优化具体 task 的 section policy 与评分策略。"
    },
    {
      "id": "pwdb-phase-e",
      "title": "完成 Prompt Workflow 深化计划 B",
      "status": "completed",
      "summary": "已完成 Prompt Workflow 深化计划 B 的主要闭环：1）梳理并确认当前 context_summary / memory_compaction 的差异仍主要停留在 section 保留与 section type 排序，fragment scoring 仍以 slot priority + fragment priority + importance/salience 为主；2）在 section_drafts 中引入 task-specific ranking_score / score_components / score_reasons，并把 section_scores 纳入 section summary 读面；3）为 context_summary / memory_compaction profile 显式加入 token_budget_trim，使 task-aware workflow 主线能够消费 ranking 与 budget；4）建立 section_budget 结构、分配结果与 kept/dropped section 诊断，并让 token_budget_trimmer 基于 section_scores 生成 allocation，同时开始通过 section_id -> fragment 的映射回写 section keep/drop 结果；5）补齐 workflow replay / smoke endpoints 对 section_policies、sections_by_type、section_scores 与 token_budget_trimming.section_budget 的 persisted trace 回归；6）同步 docs/ARCH.md 与 docs/LOGIC.md，记录 ranking / section-budget 的语义与当前“第一轮预算模型”边界。",
      "relatedTodoIds": [
        "pwdb-p1",
        "pwdb-p2",
        "pwdb-p3",
        "pwdb-p4",
        "pwdb-p5"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/prompt-workflow-formalization-design.md",
        "plan": ".limcode/plans/prompt-workflow-深化计划-b任务特定策略与-section-级预算.plan.md",
        "review": ".limcode/review/documentation-code-consistency-review.md"
      },
      "completedAt": "2026-04-13T18:15:46+08:00",
      "recordedAt": "2026-04-13T18:16:15.836Z",
      "nextAction": "如需继续深化，可在下一轮把 section_budget 从第一轮分配模型推进到更精细的 section rebalance / fragment packing 策略，或扩展更多 integration 场景验证 task-specific budget 行为。"
    },
    {
      "id": "PG2",
      "title": "完成 pack-local 插件 Phase 1 基线",
      "status": "completed",
      "summary": "已完成插件系统 Phase 1 基线建设：扩展 runtime config/schema 的 plugins.enable_warning 配置；新增 plugin manifest / artifact / installation / activation / acknowledgement 合同；加入 canonical trust lecture 常量；补齐 Prisma 持久化模型与迁移脚本；server typecheck 已通过。",
      "relatedTodoIds": [
        "plugin-phase-1"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/pack-local-plugin-unified-management-design.md",
        "plan": ".limcode/plans/pack-local-plugin-unified-management-implementation.plan.md"
      },
      "completedAt": "2026-04-16T11:07:11.833Z",
      "recordedAt": "2026-04-16T11:07:11.833Z",
      "nextAction": "继续实现 kernel-side 插件管理服务与生命周期状态机。"
    },
    {
      "id": "PG3",
      "title": "完成 pack-local 插件 Phase 2 管理主线",
      "status": "completed",
      "summary": "已完成插件管理服务层基线：新增 plugin store 与 manager service，支持 artifact 注册、pack-local installation upsert、upgrade_pending_confirmation 检测、确认/禁用/归档/错误状态流转、activation session 写入与 enable acknowledgement 记录。",
      "relatedTodoIds": [
        "plugin-phase-2"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/pack-local-plugin-unified-management-design.md",
        "plan": ".limcode/plans/pack-local-plugin-unified-management-implementation.plan.md"
      },
      "completedAt": "2026-04-16T11:11:10.525Z",
      "recordedAt": "2026-04-16T11:11:10.525Z",
      "nextAction": "继续接入 world pack plugins 目录扫描与导入确认主链。"
    },
    {
      "id": "PG4",
      "title": "完成 pack-local 插件 Phase 3 导入发现",
      "status": "completed",
      "summary": "已完成 pack-local 插件发现主线：runtime activation 会扫描 world pack 的 plugins/ 目录，解析 plugin.manifest.yaml / yml，校验 manifest 与 pack compatibility，注册 artifact，并为 pack-local 作用域建立 pending_confirmation 安装项；当工件变化时会推动 installation 进入 upgrade_pending_confirmation。",
      "relatedTodoIds": [
        "plugin-phase-3"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/pack-local-plugin-unified-management-design.md",
        "plan": ".limcode/plans/pack-local-plugin-unified-management-implementation.plan.md"
      },
      "completedAt": "2026-04-16T11:16:43.632Z",
      "recordedAt": "2026-04-16T11:16:43.632Z",
      "nextAction": "继续实现 trust lecture acknowledgement 与显式 enable/disable 主线。"
    },
    {
      "id": "PG5",
      "title": "完成 pack-local 插件 Phase 4 启用治理",
      "status": "completed",
      "summary": "已完成插件启用治理基线：增加 pack plugin 列表、确认、启用、禁用 API；将 runtime config 的 enable_warning 配置接入 AppContext；启用时默认要求 acknowledgement，否则返回 PLUGIN_ENABLE_ACK_REQUIRED；为后续 CLI / GUI 接线提供统一服务入口。",
      "relatedTodoIds": [
        "plugin-phase-4"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/pack-local-plugin-unified-management-design.md",
        "plan": ".limcode/plans/pack-local-plugin-unified-management-implementation.plan.md"
      },
      "completedAt": "2026-04-16T11:22:44.966Z",
      "recordedAt": "2026-04-16T11:22:44.966Z",
      "nextAction": "继续实现 server plugin host API 与 active-pack 生命周期集成。"
    },
    {
      "id": "PG6",
      "title": "完成 pack-local 插件 Phase 5 server host",
      "status": "completed",
      "summary": "已完成 server-side plugin host 基线：建立 pack-local runtime registry；允许受控注册 context source、prompt workflow step 与 pack-local API route；启用/禁用插件后刷新 active-pack runtime；宿主 create_app、context service 与 prompt workflow runtime 已开始消费这些扩展点。",
      "relatedTodoIds": [
        "plugin-phase-5"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/pack-local-plugin-unified-management-design.md",
        "plan": ".limcode/plans/pack-local-plugin-unified-management-implementation.plan.md"
      },
      "completedAt": "2026-04-16T14:37:13.518Z",
      "recordedAt": "2026-04-16T14:37:13.518Z",
      "nextAction": "继续实现 web plugin runtime 与前端动态装载主线。"
    },
    {
      "id": "PG7",
      "title": "完成 pack-local 插件 Phase 6 web runtime",
      "status": "completed",
      "summary": "已完成 web plugin runtime 基线：后端提供 active-pack web plugin runtime manifest API；前端新增 plugin runtime store 与 bootstrap；overview、entity、timeline 已能显示 pack-local plugin panel host，为后续动态 bundle / route 装载留出稳定读面。",
      "relatedTodoIds": [
        "plugin-phase-6"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/pack-local-plugin-unified-management-design.md",
        "plan": ".limcode/plans/pack-local-plugin-unified-management-implementation.plan.md"
      },
      "completedAt": "2026-04-17T03:48:32.536Z",
      "recordedAt": "2026-04-17T03:48:32.536Z",
      "nextAction": "继续实现 operator 插件管理页面与风险展示。"
    },
    {
      "id": "PG8",
      "title": "完成 pack-local 插件 Phase 7 管理界面",
      "status": "completed",
      "summary": "已完成 operator / management 界面基线：新增 /plugins 页面，提供 pack-local 插件列表、详情、生命周期状态、risk 分级与 capability 读面；同时把 shell workspace 与导航扩展到 Plugin Management，使插件治理成为正式 operator 工作区的一部分。",
      "relatedTodoIds": [
        "plugin-phase-7"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/pack-local-plugin-unified-management-design.md",
        "plan": ".limcode/plans/pack-local-plugin-unified-management-implementation.plan.md"
      },
      "completedAt": "2026-04-17T04:09:13.428Z",
      "recordedAt": "2026-04-17T04:09:13.428Z",
      "nextAction": "继续补齐 lint / tests 与文档同步，完成 Phase 8。"
    },
    {
      "id": "PG9",
      "title": "完成 pack-local 插件系统实施收口",
      "status": "completed",
      "summary": "pack-local 插件系统已完成一轮实现收口：具备统一 plugin artifact / installation / activation / acknowledgement 管理模型，支持 world pack 自带插件发现、导入确认、trust lecture 保护下的启用、server-side host runtime、web runtime manifest 读面，以及 operator /plugins 管理界面。最终已补充关键单测并同步 API / ARCH / WORLD_PACK 文档。",
      "relatedTodoIds": [
        "plugin-phase-8"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/pack-local-plugin-unified-management-design.md",
        "plan": ".limcode/plans/pack-local-plugin-unified-management-implementation.plan.md"
      },
      "completedAt": "2026-04-17T04:13:53.474Z",
      "recordedAt": "2026-04-17T04:13:53.474Z",
      "nextAction": "后续可继续推进 CLI 命令、GUI acknowledgement 弹窗、真实 web bundle 动态加载和更全面的 lint/test 覆盖。"
    }
  ],
  "risks": [],
  "log": [
    {
      "at": "2026-04-16T11:07:11.532Z",
      "type": "updated",
      "refId": "plugin-phase-1",
      "message": "完成 Phase 1：扩展 runtime config 插件提醒配置，新增 packages/contracts/src/plugins.ts 与 apps/server/src/plugins/contracts.ts，补齐 PluginArtifact/Installation/ActivationSession/EnableAcknowledgement Prisma 基线与迁移脚本，并通过 yidhras-server typecheck。"
    },
    {
      "at": "2026-04-16T11:07:11.833Z",
      "type": "milestone_recorded",
      "refId": "PG2",
      "message": "记录里程碑：完成 pack-local 插件 Phase 1 基线"
    },
    {
      "at": "2026-04-16T11:11:10.508Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md"
    },
    {
      "at": "2026-04-16T11:11:10.525Z",
      "type": "milestone_recorded",
      "refId": "PG3",
      "message": "记录里程碑：完成 pack-local 插件 Phase 2 管理主线"
    },
    {
      "at": "2026-04-16T11:16:43.519Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md"
    },
    {
      "at": "2026-04-16T11:16:43.542Z",
      "type": "updated",
      "refId": "plugin-phase-3",
      "message": "完成 Phase 3：新增 apps/server/src/plugins/discovery.ts，并在 runtime activation 中接入 world pack plugins 目录扫描、YAML manifest 解析、pack 兼容性校验、artifact 注册与 pack-local installation 建立；同 checksum 工件复用已有 artifact，工件变化触发 upgrade_pending_confirmation；server typecheck 已通过。"
    },
    {
      "at": "2026-04-16T11:16:43.632Z",
      "type": "milestone_recorded",
      "refId": "PG4",
      "message": "记录里程碑：完成 pack-local 插件 Phase 3 导入发现"
    },
    {
      "at": "2026-04-16T11:22:44.921Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md"
    },
    {
      "at": "2026-04-16T11:22:44.957Z",
      "type": "updated",
      "refId": "plugin-phase-4",
      "message": "完成 Phase 4：新增 app/services/plugins.ts 与 app/routes/plugins.ts，提供 pack plugin 列表、导入确认、启用、禁用 API；启用路径接入 context.getPluginEnableWarningConfig() 与 PLUGIN_ENABLE_ACK_REQUIRED 校验；server typecheck 已通过。"
    },
    {
      "at": "2026-04-16T11:22:44.966Z",
      "type": "milestone_recorded",
      "refId": "PG5",
      "message": "记录里程碑：完成 pack-local 插件 Phase 4 启用治理"
    },
    {
      "at": "2026-04-16T14:37:13.225Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md"
    },
    {
      "at": "2026-04-16T14:37:13.518Z",
      "type": "milestone_recorded",
      "refId": "PG6",
      "message": "记录里程碑：完成 pack-local 插件 Phase 5 server host"
    },
    {
      "at": "2026-04-17T03:48:32.490Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md"
    },
    {
      "at": "2026-04-17T03:48:32.536Z",
      "type": "milestone_recorded",
      "refId": "PG7",
      "message": "记录里程碑：完成 pack-local 插件 Phase 6 web runtime"
    },
    {
      "at": "2026-04-17T04:09:12.321Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md"
    },
    {
      "at": "2026-04-17T04:09:12.753Z",
      "type": "updated",
      "refId": "plugin-phase-7",
      "message": "完成 Phase 7：新增 apps/web/pages/plugins.vue 与 usePluginManagementPage，提供插件列表、详情、风险级别与 acknowledgement 提示；同时扩展 shell workspace/navigation 支持 Plugin Management 页面，web typecheck 已通过。"
    },
    {
      "at": "2026-04-17T04:09:13.428Z",
      "type": "milestone_recorded",
      "refId": "PG8",
      "message": "记录里程碑：完成 pack-local 插件 Phase 7 管理界面"
    },
    {
      "at": "2026-04-17T04:13:53.423Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md"
    },
    {
      "at": "2026-04-17T04:13:53.450Z",
      "type": "updated",
      "refId": "plugin-phase-8",
      "message": "完成 Phase 8：新增 server plugin_service 单测与 web plugin.runtime.store 单测，验证服务与前端运行态读面；已通过 yidhras-server / web typecheck，并同步 docs/API.md、docs/ARCH.md、docs/WORLD_PACK.md 说明。"
    },
    {
      "at": "2026-04-17T04:13:53.474Z",
      "type": "milestone_recorded",
      "refId": "PG9",
      "message": "记录里程碑：完成 pack-local 插件系统实施收口"
    }
  ],
  "stats": {
    "milestonesTotal": 13,
    "milestonesCompleted": 13,
    "todosTotal": 8,
    "todosCompleted": 8,
    "todosInProgress": 0,
    "todosCancelled": 0,
    "activeRisks": 0
  },
  "render": {
    "rendererVersion": 1,
    "generatedAt": "2026-04-17T04:13:53.474Z",
    "bodyHash": "sha256:2d9c91ba90aade8a6d0ea3bbbf30327c764eaedba1c28a31223446d4afc509ca"
  }
}
<!-- LIMCODE_PROGRESS_METADATA_END -->
