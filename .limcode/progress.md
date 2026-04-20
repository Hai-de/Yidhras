# 项目进度
- Project: Yidhras
- Updated At: 2026-04-20T18:31:05.021Z
- Status: active
- Phase: implementation

## 当前摘要

<!-- LIMCODE_PROGRESS_SUMMARY_START -->
- 当前进度：12/12 个里程碑已完成；最新：PG10
- 当前焦点：Rust world engine Phase 1C 已完成，当前等待决定下一轮是继续加深 engine semantics，还是提名下一类 rule family。
- 最新结论：Phase 1C 已完成：richer delta/event/observability、Host compatibility、failure recovery 与验证矩阵均已收口。
- 下一步：决定下一阶段方向；当前不需要再继续扩展 Phase 1C。
<!-- LIMCODE_PROGRESS_SUMMARY_END -->

## 关联文档

<!-- LIMCODE_PROGRESS_ARTIFACTS_START -->
- 设计：`.limcode/design/rust-world-engine-phase1-boundary-and-sidecar-design.md`
- 计划：`.limcode/plans/rust-world-engine-phase1-c-step-semantics-and-observability.plan.md`
- 审查：`.limcode/review/multi-pack-runtime-experimental-assessment.md`
<!-- LIMCODE_PROGRESS_ARTIFACTS_END -->

## 当前 TODO 快照

<!-- LIMCODE_PROGRESS_TODOS_START -->
- [x] 冻结 Phase 1C 范围：只增强 Rust sidecar prepare/commit/abort 的真实世界语义与 observability，不扩展到 objective_enforcement 之外的下一类 rule family，也不混入基础设施硬化。  `#rust-c-plan-p1-scope-freeze`
- [x] 审计当前 Phase 1B step 骨架与真实世界推进语义之间的差距，明确 session 内哪些状态变化应进入 prepareStep 的 delta/event/summary/observability。  `#rust-c-plan-p2-step-semantics-audit`
- [x] 设计并实现更真实的 PreparedWorldStep 语义：扩展 state_delta、summary 与 session before/after 关系，使 prepare/commit 能表达超出 set_clock 的世界推进结果。  `#rust-c-plan-p3-richer-delta-and-summary`
- [x] 为 Rust sidecar step 增强 emitted_events 与 observability：提供更可归因的 step diagnostics、影响实体信息与 transition reason，而不是仅保留最小骨架。  `#rust-c-plan-p4-event-and-observability`
- [x] 验证 Host-managed persistence、PackHostApi query、runtime loop 与 sidecar step 增强后的兼容性，确认 richer step 语义不会破坏 single-flight、abort/tainted 与现有宿主边界。  `#rust-c-plan-p5-host-parity-and-runtime-loop-validation`
- [x] 完成 Phase 1C 的 unit/integration/parity/failure-recovery 验证矩阵，并把仍不阻塞闭环的后续优化继续沉淀到 docs/ENHANCEMENTS.md。  `#rust-c-plan-p6-closeout-and-enhancements`
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

### PG7 · Rust world engine Phase 1 边界与 sidecar 基础链路完成
- 状态：completed
- 记录时间：2026-04-20T12:46:10.603Z
- 完成时间：2026-04-20T12:46:10.603Z
- 关联 TODO：rust-plan-m1-baseline-contract, rust-plan-m2-host-port-adapter, rust-plan-m3-runtime-loop-migration, rust-plan-m4-sidecar-stub-transport, rust-plan-m5-host-persistence-orchestration, rust-plan-m6-plugin-doc-regression
- 关联文档：
  - 设计：`.limcode/design/rust-world-engine-phase1-boundary-and-sidecar-design.md`
  - 计划：`.limcode/plans/rust-world-engine-phase1-boundary-and-sidecar-implementation.plan.md`
- 摘要:
已完成 world engine contracts、宿主侧 WorldEnginePort / PackHostApi、runtime loop 迁移、Rust sidecar JSON-RPC stub、Host-managed persistence 与 tainted/single-flight 机制，并同步 ARCH / PLUGIN_RUNTIME 文档与针对性 unit tests。
- 下一步：若继续推进，可评估把更多真实 world rule execution 从 TsWorldEngineAdapter 迁入 Rust sidecar，并为 PackHostApi 扩展更稳定的只读查询面。

### PG8 · PG8 · Rust world engine A 完成：objective_enforcement parity 与收尾验证完成
- 状态：completed
- 记录时间：2026-04-20T15:17:58.461Z
- 完成时间：2026-04-20T15:17:58.461Z
- 关联 TODO：rust-a-plan-p1-scope-decision, rust-a-plan-p2-parity-audit, rust-a-plan-p3-parity-implementation, rust-a-plan-p4-breadth-boundary-hardening, rust-a-plan-p5-observability-and-failure-attribution, rust-a-plan-p6-validation-and-closeout
- 关联文档：
  - 设计：`.limcode/design/rust-world-engine-phase1-boundary-and-sidecar-design.md`
  - 计划：`.limcode/plans/rust-world-engine-phase1-a-completion-sequencing-and-validation.plan.md`
- 摘要:
完成 A 的 objective_enforcement Rust sidecar 迁移收口：补齐 objective execution parity、representative scenario 覆盖、explicit no-fallback policy、structured sidecar diagnostics，并通过 unit/integration 验证矩阵。A 现可在 Phase 1 内以 objective_enforcement parity 作为完成标准关闭；同时已将非阻塞后续增强项记录到 docs/ENHANCEMENTS.md。
- 下一步：如继续推进 Rust world engine，可在下一轮选择是否扩展到 objective_enforcement 之外的下一类 rule family；否则当前可将 A 视为在 Phase 1 范围内完成。

### PG9 · Rust world engine Phase 1B 完成：real session/query/prepare-commit 验证通过
- 状态：completed
- 记录时间：2026-04-20T17:16:59.920Z
- 完成时间：2026-04-20T17:00:00.000Z
- 关联 TODO：rust-b-plan-p1-scope-freeze, rust-b-plan-p2-snapshot-contract, rust-b-plan-p3-host-snapshot-loader, rust-b-plan-p4-rust-query-runtime, rust-b-plan-p5-real-prepare-commit, rust-b-plan-p6-validation-closeout
- 关联文档：
  - 设计：`.limcode/design/rust-world-engine-phase1-boundary-and-sidecar-design.md`
  - 计划：`.limcode/plans/rust-world-engine-phase1-b-real-session-and-step-implementation.plan.md`
- 摘要:
已完成 Phase 1B：Host snapshot/hydrate、Rust session state、allowlist query、prepare/commit/abort step 编排与验证矩阵全部收口。新增 sidecar runtime loop integration 与 failure recovery integration 测试，并通过 unit/integration、cargo test、server typecheck 与 eslint 验证。
- 下一步：如继续推进，可评估是否为 active-pack 真实业务提名下一类 rule family，或继续增强 sidecar step 的真实世界语义与更细 observability。

### PG10 · Rust world engine Phase 1C 完成：step semantics 与 observability 第一轮深化通过验证
- 状态：completed
- 记录时间：2026-04-20T18:30:55.199Z
- 完成时间：2026-04-20T18:30:00.000Z
- 关联 TODO：rust-c-plan-p1-scope-freeze, rust-c-plan-p2-step-semantics-audit, rust-c-plan-p3-richer-delta-and-summary, rust-c-plan-p4-event-and-observability, rust-c-plan-p5-host-parity-and-runtime-loop-validation, rust-c-plan-p6-closeout-and-enhancements
- 关联文档：
  - 设计：`.limcode/design/rust-world-engine-phase1-boundary-and-sidecar-design.md`
  - 计划：`.limcode/plans/rust-world-engine-phase1-c-step-semantics-and-observability.plan.md`
- 摘要:
已完成 Phase 1C：Rust sidecar `prepare/commit/abort` 现已支持 richer `state_delta`、`world.step.prepared` emitted event、`WORLD_STEP_PREPARED/COMMITTED/ABORTED` 结构化 diagnostics，以及 `__world__/world` runtime_step state upsert。并验证 Host-managed persistence、runtime loop、failure recovery、single-flight、PackHostApi query 与 richer step output 兼容，未破坏现有宿主边界。
- 下一步：下一轮再决定是继续加深 world engine 语义厚度，还是提名 objective_enforcement 之外的下一类 rule family。
<!-- LIMCODE_PROGRESS_MILESTONES_END -->

## 风险与阻塞

<!-- LIMCODE_PROGRESS_RISKS_START -->
<!-- 暂无风险 -->
<!-- LIMCODE_PROGRESS_RISKS_END -->

## 最近更新

<!-- LIMCODE_PROGRESS_LOG_START -->
- 2026-04-20T17:04:22.134Z | updated | rust-b-plan-p6-validation-closeout | 已完成针对性验证第一轮：cargo test、runtime unit tests、server typecheck 与相关 eslint 均通过。
- 2026-04-20T17:16:59.850Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/rust-world-engine-phase1-b-real-session-and-step-implementation.plan.md
- 2026-04-20T17:16:59.920Z | milestone_recorded | PG9 | 记录里程碑：Rust world engine Phase 1B 完成：real session/query/prepare-commit 验证通过
- 2026-04-20T17:16:59.930Z | updated | rust-b-plan-p6-validation-closeout | 已完成验证矩阵：新增 sidecar runtime loop integration 与 failure recovery integration，并通过 unit/integration/cargo test/typecheck/lint。
- 2026-04-20T17:43:41.816Z | artifact_changed | docs-sync | 已同步 TODO.md、docs/ARCH.md、docs/capabilities/PLUGIN_RUNTIME.md、docs/capabilities/PROMPT_WORKFLOW.md 与 docs/ENHANCEMENTS.md，使其与 Rust world engine Phase 1B 完成状态对齐。
- 2026-04-20T18:00:23.049Z | artifact_changed | plan | 同步计划文档：.limcode/plans/rust-world-engine-phase1-c-step-semantics-and-observability.plan.md
- 2026-04-20T18:05:32.767Z | updated | rust-c-plan-p1-scope-freeze | 开始执行 Phase 1C，当前先冻结范围：只推进 sidecar step semantics 与 observability，不扩展到下一类 rule family 或基础设施硬化。
- 2026-04-20T18:05:43.451Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/rust-world-engine-phase1-c-step-semantics-and-observability.plan.md
- 2026-04-20T18:07:42.415Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/rust-world-engine-phase1-c-step-semantics-and-observability.plan.md
- 2026-04-20T18:07:51.074Z | updated | rust-c-plan-p2-step-semantics-audit | 已完成第一轮审计：contracts 已允许 richer delta op/event/observation，但 Rust sidecar 仍只返回 set_clock + 空 events/observability + 占位 summary；TS compat adapter 也保持最小骨架，说明本轮可优先在 Rust sidecar 内补强而不破坏 Host owner 边界。
- 2026-04-20T18:10:49.766Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/rust-world-engine-phase1-c-step-semantics-and-observability.plan.md
- 2026-04-20T18:15:02.574Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/rust-world-engine-phase1-c-step-semantics-and-observability.plan.md
- 2026-04-20T18:15:09.832Z | updated | rust-c-plan-p3-richer-delta-and-summary | 已完成 P3：Rust sidecar step 现会把 runtime_step 写入 `__world__/world` state，并返回 richer delta metadata 与非占位 mutated_entity_count；相关 sidecar client/runtime loop 测试已通过。
- 2026-04-20T18:21:49.175Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/rust-world-engine-phase1-c-step-semantics-and-observability.plan.md
- 2026-04-20T18:21:56.000Z | updated | rust-c-plan-p4-event-and-observability | 已完成 P4：Rust sidecar prepare/commit/abort 已新增 emitted_events 与 structured observability，覆盖 prepared/committed/aborted 三类 transition diagnostics；相关 tests 已通过。
- 2026-04-20T18:24:44.807Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/rust-world-engine-phase1-c-step-semantics-and-observability.plan.md
- 2026-04-20T18:25:01.142Z | updated | rust-c-plan-p5-host-parity-and-runtime-loop-validation | 已完成 P5：world_engine_persistence、failure recovery integration、runtime loop integration 与 sidecar client tests 在 richer step output 下全部通过，确认 Host owner 边界与 abort/tainted 语义未退化。
- 2026-04-20T18:30:03.028Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/rust-world-engine-phase1-c-step-semantics-and-observability.plan.md
- 2026-04-20T18:30:55.199Z | milestone_recorded | PG10 | 记录里程碑：Rust world engine Phase 1C 完成：step semantics 与 observability 第一轮深化通过验证
- 2026-04-20T18:31:05.021Z | updated | rust-c-plan-p6-closeout-and-enhancements | 已完成 P6：vitest、tsc、eslint、cargo test 均已通过，并同步更新 docs/ENHANCEMENTS.md 中的后续增强候选。
<!-- LIMCODE_PROGRESS_LOG_END -->

<!-- LIMCODE_PROGRESS_METADATA_START -->
{
  "formatVersion": 1,
  "kind": "limcode.progress",
  "projectId": "yidhras",
  "projectName": "Yidhras",
  "createdAt": "2026-04-17T21:05:29.611Z",
  "updatedAt": "2026-04-20T18:31:05.021Z",
  "status": "active",
  "phase": "implementation",
  "currentFocus": "Rust world engine Phase 1C 已完成，当前等待决定下一轮是继续加深 engine semantics，还是提名下一类 rule family。",
  "latestConclusion": "Phase 1C 已完成：richer delta/event/observability、Host compatibility、failure recovery 与验证矩阵均已收口。",
  "currentBlocker": null,
  "nextAction": "决定下一阶段方向；当前不需要再继续扩展 Phase 1C。",
  "activeArtifacts": {
    "design": ".limcode/design/rust-world-engine-phase1-boundary-and-sidecar-design.md",
    "plan": ".limcode/plans/rust-world-engine-phase1-c-step-semantics-and-observability.plan.md",
    "review": ".limcode/review/multi-pack-runtime-experimental-assessment.md"
  },
  "todos": [
    {
      "id": "rust-c-plan-p1-scope-freeze",
      "content": "冻结 Phase 1C 范围：只增强 Rust sidecar prepare/commit/abort 的真实世界语义与 observability，不扩展到 objective_enforcement 之外的下一类 rule family，也不混入基础设施硬化。",
      "status": "completed"
    },
    {
      "id": "rust-c-plan-p2-step-semantics-audit",
      "content": "审计当前 Phase 1B step 骨架与真实世界推进语义之间的差距，明确 session 内哪些状态变化应进入 prepareStep 的 delta/event/summary/observability。",
      "status": "completed"
    },
    {
      "id": "rust-c-plan-p3-richer-delta-and-summary",
      "content": "设计并实现更真实的 PreparedWorldStep 语义：扩展 state_delta、summary 与 session before/after 关系，使 prepare/commit 能表达超出 set_clock 的世界推进结果。",
      "status": "completed"
    },
    {
      "id": "rust-c-plan-p4-event-and-observability",
      "content": "为 Rust sidecar step 增强 emitted_events 与 observability：提供更可归因的 step diagnostics、影响实体信息与 transition reason，而不是仅保留最小骨架。",
      "status": "completed"
    },
    {
      "id": "rust-c-plan-p5-host-parity-and-runtime-loop-validation",
      "content": "验证 Host-managed persistence、PackHostApi query、runtime loop 与 sidecar step 增强后的兼容性，确认 richer step 语义不会破坏 single-flight、abort/tainted 与现有宿主边界。",
      "status": "completed"
    },
    {
      "id": "rust-c-plan-p6-closeout-and-enhancements",
      "content": "完成 Phase 1C 的 unit/integration/parity/failure-recovery 验证矩阵，并把仍不阻塞闭环的后续优化继续沉淀到 docs/ENHANCEMENTS.md。",
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
    },
    {
      "id": "PG7",
      "title": "Rust world engine Phase 1 边界与 sidecar 基础链路完成",
      "status": "completed",
      "summary": "已完成 world engine contracts、宿主侧 WorldEnginePort / PackHostApi、runtime loop 迁移、Rust sidecar JSON-RPC stub、Host-managed persistence 与 tainted/single-flight 机制，并同步 ARCH / PLUGIN_RUNTIME 文档与针对性 unit tests。",
      "relatedTodoIds": [
        "rust-plan-m1-baseline-contract",
        "rust-plan-m2-host-port-adapter",
        "rust-plan-m3-runtime-loop-migration",
        "rust-plan-m4-sidecar-stub-transport",
        "rust-plan-m5-host-persistence-orchestration",
        "rust-plan-m6-plugin-doc-regression"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/rust-world-engine-phase1-boundary-and-sidecar-design.md",
        "plan": ".limcode/plans/rust-world-engine-phase1-boundary-and-sidecar-implementation.plan.md"
      },
      "completedAt": "2026-04-20T12:46:10.603Z",
      "recordedAt": "2026-04-20T12:46:10.603Z",
      "nextAction": "若继续推进，可评估把更多真实 world rule execution 从 TsWorldEngineAdapter 迁入 Rust sidecar，并为 PackHostApi 扩展更稳定的只读查询面。"
    },
    {
      "id": "PG8",
      "title": "PG8 · Rust world engine A 完成：objective_enforcement parity 与收尾验证完成",
      "status": "completed",
      "summary": "完成 A 的 objective_enforcement Rust sidecar 迁移收口：补齐 objective execution parity、representative scenario 覆盖、explicit no-fallback policy、structured sidecar diagnostics，并通过 unit/integration 验证矩阵。A 现可在 Phase 1 内以 objective_enforcement parity 作为完成标准关闭；同时已将非阻塞后续增强项记录到 docs/ENHANCEMENTS.md。",
      "relatedTodoIds": [
        "rust-a-plan-p1-scope-decision",
        "rust-a-plan-p2-parity-audit",
        "rust-a-plan-p3-parity-implementation",
        "rust-a-plan-p4-breadth-boundary-hardening",
        "rust-a-plan-p5-observability-and-failure-attribution",
        "rust-a-plan-p6-validation-and-closeout"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/rust-world-engine-phase1-boundary-and-sidecar-design.md",
        "plan": ".limcode/plans/rust-world-engine-phase1-a-completion-sequencing-and-validation.plan.md"
      },
      "completedAt": "2026-04-20T15:17:58.461Z",
      "recordedAt": "2026-04-20T15:17:58.461Z",
      "nextAction": "如继续推进 Rust world engine，可在下一轮选择是否扩展到 objective_enforcement 之外的下一类 rule family；否则当前可将 A 视为在 Phase 1 范围内完成。"
    },
    {
      "id": "PG9",
      "title": "Rust world engine Phase 1B 完成：real session/query/prepare-commit 验证通过",
      "status": "completed",
      "summary": "已完成 Phase 1B：Host snapshot/hydrate、Rust session state、allowlist query、prepare/commit/abort step 编排与验证矩阵全部收口。新增 sidecar runtime loop integration 与 failure recovery integration 测试，并通过 unit/integration、cargo test、server typecheck 与 eslint 验证。",
      "relatedTodoIds": [
        "rust-b-plan-p1-scope-freeze",
        "rust-b-plan-p2-snapshot-contract",
        "rust-b-plan-p3-host-snapshot-loader",
        "rust-b-plan-p4-rust-query-runtime",
        "rust-b-plan-p5-real-prepare-commit",
        "rust-b-plan-p6-validation-closeout"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/rust-world-engine-phase1-boundary-and-sidecar-design.md",
        "plan": ".limcode/plans/rust-world-engine-phase1-b-real-session-and-step-implementation.plan.md"
      },
      "completedAt": "2026-04-20T17:00:00.000Z",
      "recordedAt": "2026-04-20T17:16:59.920Z",
      "nextAction": "如继续推进，可评估是否为 active-pack 真实业务提名下一类 rule family，或继续增强 sidecar step 的真实世界语义与更细 observability。"
    },
    {
      "id": "PG10",
      "title": "Rust world engine Phase 1C 完成：step semantics 与 observability 第一轮深化通过验证",
      "status": "completed",
      "summary": "已完成 Phase 1C：Rust sidecar `prepare/commit/abort` 现已支持 richer `state_delta`、`world.step.prepared` emitted event、`WORLD_STEP_PREPARED/COMMITTED/ABORTED` 结构化 diagnostics，以及 `__world__/world` runtime_step state upsert。并验证 Host-managed persistence、runtime loop、failure recovery、single-flight、PackHostApi query 与 richer step output 兼容，未破坏现有宿主边界。",
      "relatedTodoIds": [
        "rust-c-plan-p1-scope-freeze",
        "rust-c-plan-p2-step-semantics-audit",
        "rust-c-plan-p3-richer-delta-and-summary",
        "rust-c-plan-p4-event-and-observability",
        "rust-c-plan-p5-host-parity-and-runtime-loop-validation",
        "rust-c-plan-p6-closeout-and-enhancements"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/rust-world-engine-phase1-boundary-and-sidecar-design.md",
        "plan": ".limcode/plans/rust-world-engine-phase1-c-step-semantics-and-observability.plan.md"
      },
      "completedAt": "2026-04-20T18:30:00.000Z",
      "recordedAt": "2026-04-20T18:30:55.199Z",
      "nextAction": "下一轮再决定是继续加深 world engine 语义厚度，还是提名 objective_enforcement 之外的下一类 rule family。"
    }
  ],
  "risks": [],
  "log": [
    {
      "at": "2026-04-20T17:04:22.134Z",
      "type": "updated",
      "refId": "rust-b-plan-p6-validation-closeout",
      "message": "已完成针对性验证第一轮：cargo test、runtime unit tests、server typecheck 与相关 eslint 均通过。"
    },
    {
      "at": "2026-04-20T17:16:59.850Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/rust-world-engine-phase1-b-real-session-and-step-implementation.plan.md"
    },
    {
      "at": "2026-04-20T17:16:59.920Z",
      "type": "milestone_recorded",
      "refId": "PG9",
      "message": "记录里程碑：Rust world engine Phase 1B 完成：real session/query/prepare-commit 验证通过"
    },
    {
      "at": "2026-04-20T17:16:59.930Z",
      "type": "updated",
      "refId": "rust-b-plan-p6-validation-closeout",
      "message": "已完成验证矩阵：新增 sidecar runtime loop integration 与 failure recovery integration，并通过 unit/integration/cargo test/typecheck/lint。"
    },
    {
      "at": "2026-04-20T17:43:41.816Z",
      "type": "artifact_changed",
      "refId": "docs-sync",
      "message": "已同步 TODO.md、docs/ARCH.md、docs/capabilities/PLUGIN_RUNTIME.md、docs/capabilities/PROMPT_WORKFLOW.md 与 docs/ENHANCEMENTS.md，使其与 Rust world engine Phase 1B 完成状态对齐。"
    },
    {
      "at": "2026-04-20T18:00:23.049Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划文档：.limcode/plans/rust-world-engine-phase1-c-step-semantics-and-observability.plan.md"
    },
    {
      "at": "2026-04-20T18:05:32.767Z",
      "type": "updated",
      "refId": "rust-c-plan-p1-scope-freeze",
      "message": "开始执行 Phase 1C，当前先冻结范围：只推进 sidecar step semantics 与 observability，不扩展到下一类 rule family 或基础设施硬化。"
    },
    {
      "at": "2026-04-20T18:05:43.451Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/rust-world-engine-phase1-c-step-semantics-and-observability.plan.md"
    },
    {
      "at": "2026-04-20T18:07:42.415Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/rust-world-engine-phase1-c-step-semantics-and-observability.plan.md"
    },
    {
      "at": "2026-04-20T18:07:51.074Z",
      "type": "updated",
      "refId": "rust-c-plan-p2-step-semantics-audit",
      "message": "已完成第一轮审计：contracts 已允许 richer delta op/event/observation，但 Rust sidecar 仍只返回 set_clock + 空 events/observability + 占位 summary；TS compat adapter 也保持最小骨架，说明本轮可优先在 Rust sidecar 内补强而不破坏 Host owner 边界。"
    },
    {
      "at": "2026-04-20T18:10:49.766Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/rust-world-engine-phase1-c-step-semantics-and-observability.plan.md"
    },
    {
      "at": "2026-04-20T18:15:02.574Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/rust-world-engine-phase1-c-step-semantics-and-observability.plan.md"
    },
    {
      "at": "2026-04-20T18:15:09.832Z",
      "type": "updated",
      "refId": "rust-c-plan-p3-richer-delta-and-summary",
      "message": "已完成 P3：Rust sidecar step 现会把 runtime_step 写入 `__world__/world` state，并返回 richer delta metadata 与非占位 mutated_entity_count；相关 sidecar client/runtime loop 测试已通过。"
    },
    {
      "at": "2026-04-20T18:21:49.175Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/rust-world-engine-phase1-c-step-semantics-and-observability.plan.md"
    },
    {
      "at": "2026-04-20T18:21:56.000Z",
      "type": "updated",
      "refId": "rust-c-plan-p4-event-and-observability",
      "message": "已完成 P4：Rust sidecar prepare/commit/abort 已新增 emitted_events 与 structured observability，覆盖 prepared/committed/aborted 三类 transition diagnostics；相关 tests 已通过。"
    },
    {
      "at": "2026-04-20T18:24:44.807Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/rust-world-engine-phase1-c-step-semantics-and-observability.plan.md"
    },
    {
      "at": "2026-04-20T18:25:01.142Z",
      "type": "updated",
      "refId": "rust-c-plan-p5-host-parity-and-runtime-loop-validation",
      "message": "已完成 P5：world_engine_persistence、failure recovery integration、runtime loop integration 与 sidecar client tests 在 richer step output 下全部通过，确认 Host owner 边界与 abort/tainted 语义未退化。"
    },
    {
      "at": "2026-04-20T18:30:03.028Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/rust-world-engine-phase1-c-step-semantics-and-observability.plan.md"
    },
    {
      "at": "2026-04-20T18:30:55.199Z",
      "type": "milestone_recorded",
      "refId": "PG10",
      "message": "记录里程碑：Rust world engine Phase 1C 完成：step semantics 与 observability 第一轮深化通过验证"
    },
    {
      "at": "2026-04-20T18:31:05.021Z",
      "type": "updated",
      "refId": "rust-c-plan-p6-closeout-and-enhancements",
      "message": "已完成 P6：vitest、tsc、eslint、cargo test 均已通过，并同步更新 docs/ENHANCEMENTS.md 中的后续增强候选。"
    }
  ],
  "stats": {
    "milestonesTotal": 12,
    "milestonesCompleted": 12,
    "todosTotal": 6,
    "todosCompleted": 6,
    "todosInProgress": 0,
    "todosCancelled": 0,
    "activeRisks": 0
  },
  "render": {
    "rendererVersion": 1,
    "generatedAt": "2026-04-20T18:31:05.021Z",
    "bodyHash": "sha256:63563d1ae83cbc8c868d4c39094c1e8539d81e6535e0db0b75df1134d9ed31b7"
  }
}
<!-- LIMCODE_PROGRESS_METADATA_END -->
