# Prompt Workflow System B 推进计划

> 父文档：`.limcode/design/prompt-workflow-system-b-advancement-design.md`（§13 实施顺序）
> 本计划将实施顺序细化为可独立验收的阶段，每阶段有明确的输入、产出和通过标准。

## 总体策略

完整切换——一次性替换 `inference/service.ts` 和 `task_prompt_builder.ts` 的调用路径，实现所有必要 executor，删除 System A processor 代码。无向后兼容负担。

架构：多轨汇合（模板轨 + 节点轨 + 快照轨），在 `placement_resolution` 步骤汇合，汇合后 pipeline 统一。

---

## Phase 1: 试点验证 ✅ 完成 (2026-05-03)

**目标**：用一个试点 executor 验证接口签名、状态变更模式、profile 集成、registry 调度、诊断记录、错误处理六个维度。

**范围**：

- 新建 `context/workflow/executors/token_budget_trim.ts`，实现 `PromptWorkflowStepExecutor` 接口
- 新建 `context/workflow/pipeline_runner.ts`，替换 `runPromptWorkflowV2`
- 桥接旧数据：`buildPromptTree()` → `createInitialPromptWorkflowState(tree)`
- 接线到 `inference/service.ts` 的 `executeRunInternal`
- 编写试点 executor 单元测试（token 预算内不裁剪、超预算裁剪、边界值）

**不涉及**：

- 其他 7 个 executor
- `buildPromptTree()` / `buildPromptBundleV2()` 内部逻辑修改
- alias_values 清理
- `task_prompt_builder.ts` 修改
- section_drafts 实际填充

**通过标准**：

- [ ] 试点 executor 单元测试通过
- [ ] 现有集成测试 `inference-workflow-core.spec.ts` 行为不变
- [ ] 试点 executor 正确记录 diagnostics trace
- [ ] Profile 的 `defaults.token_budget` 正确传递到 executor
- [ ] `spec.config` 可覆盖 profile defaults

**产出**：

- executor 实现模板和规范（供后续 executor 参照）
- 接口修正清单（如有）

---

## Phase 2: 汇合后 Pipeline ✅ 完成 (2026-05-03)

**目标**：实现所有汇合后 executor，完成 pipeline runner 的完整调度循环。

**范围**：

- 实现 `placement_resolution` executor（anchor 解析、priority 排序、fallback 警告）
- 实现 `fragment_assembly` executor（section_draft → PromptFragmentV2 → tree）
- 实现 `permission_filter` executor（ACL 权限过滤，继承 feature flag 门控）
- 实现 `bundle_finalize` executor（tree → PromptBundleV2）
- `PromptSectionDraftType` 补充：增加 `'system_policy'` 和 `'context_snapshot'`
- `PromptWorkflowStepTrace.before` / `after` 改为 `StepSnapshotSummary` + `notes`（§12.13 选 C）

> **实际执行差异**：`denied_reason` 结构化和 `track_traces` 实现在后续阶段完成（Phase 5 写入 track_traces，post-Phase-6 完成 denial 重构）。详见设计文档 §13 实施结果。

**不涉及**：

- 模板轨和节点轨的实际内容产出
- 调用路径修改（Phase 1 试点接线保留，Phase 5 统一）

**通过标准**：

- [ ] 所有汇合后 executor 单元测试通过
- [ ] `inference-workflow-core.spec.ts` 集成测试行为不变
- [ ] `placement_resolution` anchor fallback 正确记录警告到 diagnostics
- [ ] `permission_filter` feature flag 门控行为与当前 `applyPermissionFilter` 一致
- [ ] `denied_reason` 结构化后与现有消费者兼容

---

## Phase 3: 模板轨 ✅ 完成 (2026-05-03)

**目标**：实现 `runTemplateTrack`，复用 `buildPromptTree` 的 YAML slot 逻辑，产出已展开的 template section_drafts。

**范围**：

- 实现 `context/workflow/tracks/template_track.ts` — `runTemplateTrack(slotRegistry, context) → TrackResult<PromptSectionDraft[]>`
- 宏展开移入模板轨内部（调用 `renderNarrativeTemplate`），section 产出时文本已确定
- `output_contract` 无 `default_template` 时的动态内容生成逻辑归属模板轨
- 模板轨只为有 `default_template` 或 `template_context` 的 slot 生成 section_draft（§12.10 选 A）
- 轨道诊断写入 `TrackTrace`，合并到 `state.diagnostics.track_traces`

**不涉及**：

- 节点轨和快照轨
- Slot 定位系统（absolute/relative positioning）

**通过标准**：

- [ ] 模板轨产出的 section_drafts 与当前 `buildPromptTree` 的 fragment 内容等价
- [ ] 宏展开后文本不含 `{{ }}` 残留
- [ ] 无模板的 slot（如 `memory_short_term`）不产生 template section_draft
- [ ] TrackTrace 正确记录轨道产出摘要

---

## Phase 4: 节点轨 ✅ 完成 (2026-05-03)

**目标**：实现 `runNodeTrack`，将 ContextNode 投影为 section_drafts，替代 `memory_context` 的中心地位。

**范围**：

- 实现 `context/workflow/tracks/node_track.ts` — `runNodeTrack(context_run, context) → TrackResult<PromptSectionDraft[]>`
- 内部步骤（硬编码顺序，§12.11 选 A）：
  1. memory_projection — 将记忆源投影为 ContextNode
  2. node_working_set_filter — 策略过滤（`policy_gate`/`visibility_blocked`），归入节点轨内部
  3. summary_compaction — 摘要压缩
  4. node_grouping（仅 `memory_compaction` task_type）
- 节点轨产出的 section_drafts：`slot` 字段驱动路由，`section_type` 为元数据（§12.3 选 A）
- `memory_context` 降级：不再作为 prompt 构建的中心数据源
- 轨道诊断写入 `TrackTrace`

**不涉及**：

- 多轮对话轨道
- `PromptFragmentSlot` 与 `SectionDraftType` 的映射算法（已在 Phase 2 `fragment_assembly` 中处理）

**通过标准**：

- [ ] 节点轨产出的 section_drafts 与当前 `memory_injector` + `policy_filter` + `memory_summary` 行为等价
- [ ] `policy_gate === 'deny'` 或 `visibility_blocked` 的节点不出现在 working_set
- [ ] `memory_compaction` task_type 正确触发 node_grouping
- [ ] `intent_grounding_assist` task_type 节点轨产出空 section_drafts
- [ ] TrackTrace 正确记录策略过滤决策和摘要压缩阈值

---

## Phase 5: 调用路径统一 + 轻量路径 ✅ 完成 (2026-05-03)

**目标**：统一两条调用路径，实现 profile 级别的轨道跳过配置（轻量路径机制）。

**范围**：

- 统一 `inference/service.ts`（路径 A）和 `ai/task_prompt_builder.ts`（路径 B）→ 同一入口
- `task_prompt_builder.ts` 不再自己构建 prompt，改为接收已构建好的 `PromptBundleV2`
- 实现 `tracks` 配置（§12.8 选 A）：
  - `PromptWorkflowProfile` 增加 `tracks?: { template?: boolean; node?: boolean; snapshot?: boolean }`
  - 调用方根据 profile.tracks 决定执行哪些轨道
  - 未被启用的轨道不执行，产出空 `section_drafts`
  - 三个内置 profile 默认所有轨道启用
- 快照轨实现（轻量，将 `pack_state` / `variable_context` 序列化为 section_draft）
- 命名别名清理：
  - `buildInferenceContextV2` → `buildExtendedInferenceContext`
  - 删除 `buildAiTaskRequestFromInferenceContext` 空壳
  - 删除 `context_builder.ts:659-699` 硬编码 alias_values fallback

**通过标准**：

- [ ] 两条调用路径产出的 `PromptBundleV2` 完全一致（给定相同输入）
- [ ] `intent_grounding_assist` task_type 可配置跳过节点轨
- [ ] profile.tracks 配置正确控制轨道执行
- [ ] alias 清理后现有测试通过

---

## Phase 6: 清理 ✅ 完成 (2026-05-03)

**目标**：删除 System A 所有废弃代码，简化类型系统。

**范围**：

- 删除 `inference/processors/` 下的 5 个 processor：
  - `macro_expansion.ts`
  - `memory_injector.ts`
  - `policy_filter.ts`
  - `memory_summary.ts`
  - `token_budget_trimmer.ts`
- 删除 `PromptTreeProcessor` 接口（`inference/prompt_processors.ts`）
- 删除 `runPromptWorkflowV2`（`context/workflow/runtime.ts`）
- 删除 `ai_message_projection` step kind（§12.7 选 B）
- `applyPermissionFilter` 保留为共享工具函数，由 `permission_filter` executor 调用
- `buildPromptTree` / `buildPromptBundleV2` 保留定义；`buildPromptBundleV2` 由 `bundle_finalize` executor 调用，`buildPromptTree` 在 `task_prompt_builder.ts` 回退移除后无调用方

**通过标准**：

- [ ] 所有现有集成测试和 e2e 测试通过
- [ ] TypeScript 编译无错误
- [ ] ESLint 无错误
- [ ] 无 dead import 残留

---

## 阶段依赖关系

```
Phase 1 (试点) ──→ Phase 2 (汇合后 pipeline)
                       │
                       ├──→ Phase 3 (模板轨)
                       │
                       └──→ Phase 4 (节点轨)
                                │
                                └──→ Phase 5 (路径统一 + 轻量路径)
                                         │
                                         └──→ Phase 6 (清理)
```

Phase 3 和 Phase 4 可并行开发（分别依赖 Phase 2，互相独立）。

---

## 不在本次推进范围

以下需求来自 TODO.md 但需要独立架构设计，不在 System B 推进范围内：

| 需求 | 原因 |
|------|------|
| 多轮对话 | 需要跨请求持久化和增量上下文构建，超出 `PromptWorkflowState` 生命周期模型 |
| Slot 定位系统（绝对/相对位置） | 需要独立的 slot 间位置关系设计 |
| 宏/函数嵌套与作用域 | 需要独立的宏系统设计，与 pipeline 解耦 |
| 图灵完备的插槽函数 | 与声明式 pipeline 架构有根本性差异，需双模块路线设计 |
| 结构化语法解析器、NLP、规则引擎等 | 属于 DataCleaner 插件拓展，独立于 Prompt Workflow |
