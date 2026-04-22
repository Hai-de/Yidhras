# 项目进度
- Project: Yidhras
- Updated At: 2026-04-22T01:33:38.152Z
- Status: active
- Phase: implementation

## 当前摘要

<!-- LIMCODE_PROGRESS_SUMMARY_START -->
- 当前进度：20/20 个里程碑已完成；最新：PG18
- 当前焦点：第二批通用测试与命名技术债第一轮和第二轮治理均已完成，等待是否继续扩面清理剩余目录
- 最新结论：已完成第二批继续治理：三个中优先级 e2e 已完成归类与收口，memory/context/world_engine 相关剩余默认化命名债已继续压缩，death_note 的合法 scenario 语义保留边界已明确。
- 下一步：如继续推进，优先处理 world_engine_sidecar_client、memory_recording_pack_collection_bridge、context_orchestrator 等尚未治理的剩余命名点，并将例外清单继续补齐到更多目录。
<!-- LIMCODE_PROGRESS_SUMMARY_END -->

## 关联文档

<!-- LIMCODE_PROGRESS_ARTIFACTS_START -->
- 设计：`.limcode/design/第二批通用测试与命名技术债审计.md`
- 计划：`.limcode/plans/second-batch-medium-priority-e2e-and-remaining-naming-debt-remediation.plan.md`
- 审查：`.limcode/review/rust-migration-compatibility-debt-assessment.md`
<!-- LIMCODE_PROGRESS_ARTIFACTS_END -->

## 当前 TODO 快照

<!-- LIMCODE_PROGRESS_TODOS_START -->
- [x] 复核 agent-overview、audit-workflow-lineage、workflow-replay 三个中优先级 e2e，明确归类为 generic、mixed 或 scenario  `#phase-e1-medium-e2e-classification`
- [x] 对确认属于 generic 的中优先级 e2e 显式迁移到 example_pack；对 mixed 文件执行拆分  `#phase-e1-medium-e2e-migration`
- [x] 完成中优先级 e2e 迁移/拆分后的逐文件与聚合回归，确认不再依赖 death_note 默认 seed/active 语义  `#phase-e1-medium-e2e-validation`
- [x] 记录保留的 death_note scenario fixture/capability/prompt/asset 清单，并同步验证结果、风险与剩余后续项  `#phase-e2-exception-ledger-and-closeout`
- [x] 扩展扫描 unit/context、memory、world_engine integration 剩余目录中的 world-death-note、death_note、sim.init('death_note') 固定值并分类  `#phase-e2-expanded-naming-debt-audit`
- [x] 将确认属于默认化命名债的剩余硬编码替换为中性测试 pack、fixture metadata 派生值或共享常量  `#phase-e2-expanded-naming-debt-remediation`
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

### PG11 · Rust World Engine / Pack Runtime Core ownership deepening 完成
- 状态：completed
- 记录时间：2026-04-20T19:53:14.527Z
- 完成时间：2026-04-20T19:52:00.000Z
- 关联 TODO：pack-core-plan-m1-contract-freeze, pack-core-plan-m2-rust-session-mutation, pack-core-plan-m3-host-delta-apply, pack-core-plan-m4-query-observability, pack-core-plan-m5-validation-closeout
- 关联文档：
  - 设计：`.limcode/design/rust-world-engine-pack-runtime-core-ownership-deepening-design.md`
  - 计划：`.limcode/plans/rust-world-engine-pack-runtime-core-ownership-deepening-implementation.plan.md`
- 摘要:
已完成 Pack Runtime Core ownership deepening：冻结 delta taxonomy / metadata / query selector 基线；Rust sidecar prepared state 现可同时表达 entity_state upsert 与 rule_execution append 两类 core mutation；Host 默认 persistence 已具备正式 delta apply layer，可解释 upsert_entity_state / append_rule_execution / set_clock；并补齐 WORLD_CORE_DELTA_BUILT / APPLIED / ABORTED / WORLD_PREPARED_STATE_SUMMARY 诊断与对应 unit/integration/cargo/typecheck/lint 验证。
- 下一步：下一轮应在“继续加深 engine semantics”与“提名 objective 之外的新 rule family”之间做选择；当前建议优先评估 active-pack 真实业务最缺的 rule family 候选，再单独立项。

### PG12 · Memory Block / Context Trigger Engine Rust 迁移完成
- 状态：completed
- 记录时间：2026-04-20T22:17:19.075Z
- 完成时间：2026-04-20T22:17:19.075Z
- 关联 TODO：plan-memory-trigger-sidecar-scaffold, plan-rust-models-and-logic-dsl, plan-rust-source-kernel, plan-shadow-parity-and-fallback, plan-ts-memory-block-source-integration, plan-ts-sidecar-client-and-flag, plan-validation-and-cutover
- 关联文档：
  - 设计：`.limcode/design/memory-block-context-trigger-engine-rust-migration-design.md`
  - 计划：`.limcode/plans/memory-block-context-trigger-engine-rust-migration-implementation.plan.md`
- 摘要:
已完成独立 memory_trigger_sidecar、Rust trigger/source kernel、TS sidecar client、runtime config 与 memory_blocks source thin-shell 接线；并通过 TS/Rust 单元测试、模式/fallback 测试与真实 sidecar parity 测试。当前默认配置已切换为 rust_primary。
- 下一步：如无额外回归问题，可进入后续 Memory Block Runtime 完整 Rust ownership 深化或清理增强项。

### PG13 · Death Note 世界包 Phase A 闭环完成
- 状态：completed
- 记录时间：2026-04-21T22:00:18.388Z
- 完成时间：2026-04-21T22:00:18.388Z
- 关联 TODO：phase-a-pack-contract, phase-a-runtime-support
- 关联文档：
  - 设计：`.limcode/design/death-note-world-pack-content-expansion-design.md`
  - 计划：`.limcode/plans/death-note-world-pack-content-expansion-implementation.plan.md`
- 摘要:
已完成 death_note 正式 pack 的 Phase A：补齐正式 pack 的 memory_loop、认知状态字段、世界状态字段与最小 invocation 扩展；为 revise_judgement_plan 增加 runtime 记录承接，落地 self_note overlay 与 plan memory block；同步模板文件，并补充 world pack schema、rule-based provider 与 death-note memory loop 的针对性测试，相关 unit/integration 验证已通过。
- 下一步：进入 Phase B，先扩展 pack.ai.tasks / memory_loop 的对应配置与验证，再补 institutions / domains 与 objective side effects。

### PG14 · Death Note 世界包 Phase B 完成
- 状态：completed
- 记录时间：2026-04-21T22:11:40.455Z
- 完成时间：2026-04-21T22:11:40.455Z
- 关联 TODO：phase-b-ai-memory, phase-b-governance-entities, validation-and-docs
- 关联文档：
  - 设计：`.limcode/design/death-note-world-pack-content-expansion-design.md`
  - 计划：`.limcode/plans/death-note-world-pack-content-expansion-implementation.plan.md`
- 摘要:
已完成 Death Note 世界包 Phase B：补入 pack-level AI task / memory_loop 配置，加入最小 institutions 与 domains，并细化 collect_target_intel、raise_false_suspicion、publish_case_update 的 objective side effects。同步模板与文档，并通过 world_pack_schema、ai_gateway、prompt_workflow_sections、pack_runtime_materializer、world_engine_pack_host_api_read_surface、death-note-memory-loop 等针对性 unit/integration 验证。
- 下一步：进入 Phase C，评估并按门禁引入 target_dossiers / judgement_plans / investigation_threads 等 storage.pack_collections 初始模型。

### PG15 · Death Note 世界包内容扩展主线完成
- 状态：completed
- 记录时间：2026-04-21T22:16:58.304Z
- 完成时间：2026-04-21T22:16:58.304Z
- 关联 TODO：phase-a-pack-contract, phase-a-runtime-support, phase-b-ai-memory, phase-b-governance-entities, phase-c-storage-gate, validation-and-docs
- 关联文档：
  - 设计：`.limcode/design/death-note-world-pack-content-expansion-design.md`
  - 计划：`.limcode/plans/death-note-world-pack-content-expansion-implementation.plan.md`
- 摘要:
已完成 Death Note 世界包内容扩展计划全部阶段：Phase A 补齐正式 pack 的认知状态字段与 invocation，并为 revise_judgement_plan 落地 runtime 记录承接；Phase B 完成 pack-level AI task / memory_loop 扩展、institutions / domains 建模与 objective side effects 细化；Phase C 按门禁引入 target_dossiers、judgement_plans、investigation_threads 三类 pack storage collections，并通过 world_pack_schema、ai_gateway、prompt_workflow_sections、death-note-memory-loop、pack_runtime_install、pack_runtime_materializer、world_engine_pack_host_api_read_surface 等测试验证。
- 下一步：若继续迭代，应把新引入的 pack storage collections 从声明模型推进到真实写入链、projection 消费与 operator 可观测面。

### PG16 · Death Note 去特判与默认语义解耦完成
- 状态：completed
- 记录时间：2026-04-21T23:11:07.830Z
- 完成时间：2026-04-21T23:11:07.830Z
- 关联文档：
  - 设计：`.limcode/design/world-pack-boundary-convergence-and-death-note-doc-migration-design.md`
  - 计划：`.limcode/plans/world-pack-boundary-convergence-and-death-note-doc-migration-implementation.plan.md`
- 摘要:
已完成 death_note 与宿主核心的关键边界治理：rule_based provider 不再按 world-death-note 直接分支，而是改由 pack.ai.tasks.agent_decision.metadata.rule_based_profile 驱动；death_note pack 与模板已声明 notebook_investigation_reference_v1；runtime_config 与 runtime_scaffold 的默认绑定已从 death_note 切换为中性 example_pack bundled example 模板；同时新增 example_pack 的 YAML/README/CHANGELOG 模板资源，并通过 rule_based_death_note_provider、runtime_config、world_pack_schema 等针对性单测验证。
- 下一步：下一步可继续清理测试与辅助资源中的 death_note 命名技术债，或评估把当前 reference profile 启发式进一步下沉为更通用的可插拔扩展能力。

### PG17 · 第二批通用测试与命名技术债第一轮治理完成
- 状态：completed
- 记录时间：2026-04-22T00:45:18.200Z
- 完成时间：2026-04-22T00:45:26.000Z
- 关联 TODO：phase-d1-generic-e2e-explicit-pack, phase-d1-validation, phase-d2-hybrid-e2e-split, phase-d3-naming-debt-audit-and-cleanup, phase-d3-closeout-and-doc-sync
- 关联文档：
  - 设计：`.limcode/design/第二批通用测试与命名技术债审计.md`
  - 计划：`.limcode/plans/second-batch-generic-tests-and-naming-debt-remediation.plan.md`
- 摘要:
已完成第二批治理的 D1-D3：5 个高优先级 generic e2e 已显式迁移到 example_pack；smoke-endpoints 已拆分为 generic runtime smoke 与 death_note scenario smoke 两个文件；experimental-runtime 与 experimental-plugin-runtime-web 已明确 generic/scenario 边界；并将部分 unit/runtime 默认化命名债替换为中性测试 pack id，同时保留合法 death_note scenario fixture 命名。
- 下一步：后续若继续扩面，应审查 agent-overview、audit-workflow-lineage、workflow-replay 三个中优先级 e2e 是否适合继续 generic 化，并在 unit/integration 中按目录推进剩余 world-death-note 默认化硬编码清理。

### PG18 · 第二批中优先级 e2e 与剩余命名债扩面治理完成
- 状态：completed
- 记录时间：2026-04-22T01:33:08.888Z
- 完成时间：2026-04-22T01:33:08.000Z
- 关联 TODO：phase-e1-medium-e2e-classification, phase-e1-medium-e2e-migration, phase-e1-medium-e2e-validation, phase-e2-expanded-naming-debt-audit, phase-e2-expanded-naming-debt-remediation, phase-e2-exception-ledger-and-closeout
- 关联文档：
  - 设计：`.limcode/design/第二批通用测试与命名技术债审计.md`
  - 计划：`.limcode/plans/second-batch-medium-priority-e2e-and-remaining-naming-debt-remediation.plan.md`
- 摘要:
已完成第二轮扩面治理：agent-overview 明确保留为 death_note scenario；audit-workflow-lineage 与 workflow-replay 通过引入调度基线隔离稳定验证 replay/lineage 框架合同；并继续清理 memory/context/world_engine 相关测试中的默认化命名债，引入中性测试 pack id 或共享 pack ref 常量，同时保留 authority/perception、world engine integration 与 plugin/runtime 路径中的合法 death_note scenario 语义。
- 下一步：后续若继续扩面，可继续在尚未触达的 world_engine_sidecar_client、memory_recording_pack_collection_bridge、context_orchestrator 等文件中区分默认化命名债与合法 scenario 命名，并按目录逐步收口。
<!-- LIMCODE_PROGRESS_MILESTONES_END -->

## 风险与阻塞

<!-- LIMCODE_PROGRESS_RISKS_START -->
<!-- 暂无风险 -->
<!-- LIMCODE_PROGRESS_RISKS_END -->

## 最近更新

<!-- LIMCODE_PROGRESS_LOG_START -->
- 2026-04-22T00:24:02.577Z | updated | phase-d1-generic-e2e-explicit-pack | 已将 smoke-startup、overview-summary、scheduler-runtime-status、scheduler-queries、access-policy-contracts 五个 generic e2e 显式迁移到 activePackRef/seededPackRefs = example_pack。
- 2026-04-22T00:24:02.577Z | updated | phase-d1-validation | 已完成上述五个 generic e2e 的逐文件回归验证，确认不再依赖 death_note 默认 seed/active 语义。
- 2026-04-22T00:42:28.368Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/second-batch-generic-tests-and-naming-debt-remediation.plan.md
- 2026-04-22T00:42:42.877Z | updated | phase-d2-hybrid-e2e-split | 已将 smoke-endpoints 拆分为 smoke-generic-runtime-endpoints 与 smoke-death-note-scenario-endpoints，并将 experimental-runtime / experimental-plugin-runtime-web 的 generic 与 scenario 边界显式化。
- 2026-04-22T00:42:42.877Z | updated | phase-d2-validation | 已完成第二批 generic + 混合拆分后的 9 个 e2e 文件联合回归，共 10 个测试通过。
- 2026-04-22T00:45:06.921Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/second-batch-generic-tests-and-naming-debt-remediation.plan.md
- 2026-04-22T00:45:18.200Z | milestone_recorded | PG17 | 记录里程碑：第二批通用测试与命名技术债第一轮治理完成
- 2026-04-22T00:45:33.791Z | updated | phase-d3-naming-debt-audit-and-cleanup | 已将 world_engine_persistence、world_engine_snapshot、context_memory_blocks_source_rust_modes 等 unit/runtime 测试中的默认化 world-death-note 硬编码替换为中性测试 pack id，并保留合法 death_note scenario 命名。
- 2026-04-22T00:45:33.791Z | milestone_recorded | PG17 | 记录里程碑：第二批通用测试与命名技术债第一轮治理完成
- 2026-04-22T01:01:56.718Z | artifact_changed | plan | 同步计划文档：.limcode/plans/second-batch-medium-priority-e2e-and-remaining-naming-debt-remediation.plan.md
- 2026-04-22T01:03:10.393Z | artifact_changed | plan | 同步计划文档：.limcode/plans/second-batch-medium-priority-e2e-and-remaining-naming-debt-remediation.plan.md
- 2026-04-22T01:03:10.393Z | updated | phase-e1-start | 开始执行第二轮继续治理计划，当前先复核三个中优先级 e2e 的 generic/mixed/scenario 归类。
- 2026-04-22T01:03:21.695Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/second-batch-medium-priority-e2e-and-remaining-naming-debt-remediation.plan.md
- 2026-04-22T01:28:26.886Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/second-batch-medium-priority-e2e-and-remaining-naming-debt-remediation.plan.md
- 2026-04-22T01:28:49.173Z | updated | phase-e1-medium-e2e | 已完成 agent-overview、audit-workflow-lineage、workflow-replay 三个中优先级 e2e 的归类与处理，其中后两者通过引入调度基线隔离消除 replay_recovery job 被调度噪音干扰的问题。
- 2026-04-22T01:28:49.173Z | updated | phase-e1-medium-e2e-validation | 已完成三个中优先级 e2e 的逐文件回归，确认当前归类下可稳定通过。
- 2026-04-22T01:32:54.434Z | artifact_changed | plan | 同步计划 TODO 快照：.limcode/plans/second-batch-medium-priority-e2e-and-remaining-naming-debt-remediation.plan.md
- 2026-04-22T01:33:08.888Z | milestone_recorded | PG18 | 记录里程碑：第二批中优先级 e2e 与剩余命名债扩面治理完成
- 2026-04-22T01:33:38.152Z | updated | phase-e2-expanded-naming-debt-remediation | 已继续清理 memory_block_trigger_engine、memory_block_store、memory_trigger_engine_provider、world_engine_sidecar_runtime_loop、world_engine_sidecar_failure_recovery、world_engine_pack_host_api_read_surface 等测试中的默认化命名债，并保留 authority/perception、plugin/runtime、world engine 集成里的合法 death_note scenario 语义。
- 2026-04-22T01:33:38.152Z | milestone_recorded | PG18 | 记录里程碑：第二批中优先级 e2e 与剩余命名债扩面治理完成
<!-- LIMCODE_PROGRESS_LOG_END -->

<!-- LIMCODE_PROGRESS_METADATA_START -->
{
  "formatVersion": 1,
  "kind": "limcode.progress",
  "projectId": "yidhras",
  "projectName": "Yidhras",
  "createdAt": "2026-04-17T21:05:29.611Z",
  "updatedAt": "2026-04-22T01:33:38.152Z",
  "status": "active",
  "phase": "implementation",
  "currentFocus": "第二批通用测试与命名技术债第一轮和第二轮治理均已完成，等待是否继续扩面清理剩余目录",
  "latestConclusion": "已完成第二批继续治理：三个中优先级 e2e 已完成归类与收口，memory/context/world_engine 相关剩余默认化命名债已继续压缩，death_note 的合法 scenario 语义保留边界已明确。",
  "currentBlocker": null,
  "nextAction": "如继续推进，优先处理 world_engine_sidecar_client、memory_recording_pack_collection_bridge、context_orchestrator 等尚未治理的剩余命名点，并将例外清单继续补齐到更多目录。",
  "activeArtifacts": {
    "design": ".limcode/design/第二批通用测试与命名技术债审计.md",
    "plan": ".limcode/plans/second-batch-medium-priority-e2e-and-remaining-naming-debt-remediation.plan.md",
    "review": ".limcode/review/rust-migration-compatibility-debt-assessment.md"
  },
  "todos": [
    {
      "id": "phase-e1-medium-e2e-classification",
      "content": "复核 agent-overview、audit-workflow-lineage、workflow-replay 三个中优先级 e2e，明确归类为 generic、mixed 或 scenario",
      "status": "completed"
    },
    {
      "id": "phase-e1-medium-e2e-migration",
      "content": "对确认属于 generic 的中优先级 e2e 显式迁移到 example_pack；对 mixed 文件执行拆分",
      "status": "completed"
    },
    {
      "id": "phase-e1-medium-e2e-validation",
      "content": "完成中优先级 e2e 迁移/拆分后的逐文件与聚合回归，确认不再依赖 death_note 默认 seed/active 语义",
      "status": "completed"
    },
    {
      "id": "phase-e2-exception-ledger-and-closeout",
      "content": "记录保留的 death_note scenario fixture/capability/prompt/asset 清单，并同步验证结果、风险与剩余后续项",
      "status": "completed"
    },
    {
      "id": "phase-e2-expanded-naming-debt-audit",
      "content": "扩展扫描 unit/context、memory、world_engine integration 剩余目录中的 world-death-note、death_note、sim.init('death_note') 固定值并分类",
      "status": "completed"
    },
    {
      "id": "phase-e2-expanded-naming-debt-remediation",
      "content": "将确认属于默认化命名债的剩余硬编码替换为中性测试 pack、fixture metadata 派生值或共享常量",
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
    },
    {
      "id": "PG11",
      "title": "Rust World Engine / Pack Runtime Core ownership deepening 完成",
      "status": "completed",
      "summary": "已完成 Pack Runtime Core ownership deepening：冻结 delta taxonomy / metadata / query selector 基线；Rust sidecar prepared state 现可同时表达 entity_state upsert 与 rule_execution append 两类 core mutation；Host 默认 persistence 已具备正式 delta apply layer，可解释 upsert_entity_state / append_rule_execution / set_clock；并补齐 WORLD_CORE_DELTA_BUILT / APPLIED / ABORTED / WORLD_PREPARED_STATE_SUMMARY 诊断与对应 unit/integration/cargo/typecheck/lint 验证。",
      "relatedTodoIds": [
        "pack-core-plan-m1-contract-freeze",
        "pack-core-plan-m2-rust-session-mutation",
        "pack-core-plan-m3-host-delta-apply",
        "pack-core-plan-m4-query-observability",
        "pack-core-plan-m5-validation-closeout"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/rust-world-engine-pack-runtime-core-ownership-deepening-design.md",
        "plan": ".limcode/plans/rust-world-engine-pack-runtime-core-ownership-deepening-implementation.plan.md"
      },
      "completedAt": "2026-04-20T19:52:00.000Z",
      "recordedAt": "2026-04-20T19:53:14.527Z",
      "nextAction": "下一轮应在“继续加深 engine semantics”与“提名 objective 之外的新 rule family”之间做选择；当前建议优先评估 active-pack 真实业务最缺的 rule family 候选，再单独立项。"
    },
    {
      "id": "PG12",
      "title": "Memory Block / Context Trigger Engine Rust 迁移完成",
      "status": "completed",
      "summary": "已完成独立 memory_trigger_sidecar、Rust trigger/source kernel、TS sidecar client、runtime config 与 memory_blocks source thin-shell 接线；并通过 TS/Rust 单元测试、模式/fallback 测试与真实 sidecar parity 测试。当前默认配置已切换为 rust_primary。",
      "relatedTodoIds": [
        "plan-memory-trigger-sidecar-scaffold",
        "plan-rust-models-and-logic-dsl",
        "plan-rust-source-kernel",
        "plan-shadow-parity-and-fallback",
        "plan-ts-memory-block-source-integration",
        "plan-ts-sidecar-client-and-flag",
        "plan-validation-and-cutover"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/memory-block-context-trigger-engine-rust-migration-design.md",
        "plan": ".limcode/plans/memory-block-context-trigger-engine-rust-migration-implementation.plan.md"
      },
      "completedAt": "2026-04-20T22:17:19.075Z",
      "recordedAt": "2026-04-20T22:17:19.075Z",
      "nextAction": "如无额外回归问题，可进入后续 Memory Block Runtime 完整 Rust ownership 深化或清理增强项。"
    },
    {
      "id": "PG13",
      "title": "Death Note 世界包 Phase A 闭环完成",
      "status": "completed",
      "summary": "已完成 death_note 正式 pack 的 Phase A：补齐正式 pack 的 memory_loop、认知状态字段、世界状态字段与最小 invocation 扩展；为 revise_judgement_plan 增加 runtime 记录承接，落地 self_note overlay 与 plan memory block；同步模板文件，并补充 world pack schema、rule-based provider 与 death-note memory loop 的针对性测试，相关 unit/integration 验证已通过。",
      "relatedTodoIds": [
        "phase-a-pack-contract",
        "phase-a-runtime-support"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/death-note-world-pack-content-expansion-design.md",
        "plan": ".limcode/plans/death-note-world-pack-content-expansion-implementation.plan.md"
      },
      "completedAt": "2026-04-21T22:00:18.388Z",
      "recordedAt": "2026-04-21T22:00:18.388Z",
      "nextAction": "进入 Phase B，先扩展 pack.ai.tasks / memory_loop 的对应配置与验证，再补 institutions / domains 与 objective side effects。"
    },
    {
      "id": "PG14",
      "title": "Death Note 世界包 Phase B 完成",
      "status": "completed",
      "summary": "已完成 Death Note 世界包 Phase B：补入 pack-level AI task / memory_loop 配置，加入最小 institutions 与 domains，并细化 collect_target_intel、raise_false_suspicion、publish_case_update 的 objective side effects。同步模板与文档，并通过 world_pack_schema、ai_gateway、prompt_workflow_sections、pack_runtime_materializer、world_engine_pack_host_api_read_surface、death-note-memory-loop 等针对性 unit/integration 验证。",
      "relatedTodoIds": [
        "phase-b-ai-memory",
        "phase-b-governance-entities",
        "validation-and-docs"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/death-note-world-pack-content-expansion-design.md",
        "plan": ".limcode/plans/death-note-world-pack-content-expansion-implementation.plan.md"
      },
      "completedAt": "2026-04-21T22:11:40.455Z",
      "recordedAt": "2026-04-21T22:11:40.455Z",
      "nextAction": "进入 Phase C，评估并按门禁引入 target_dossiers / judgement_plans / investigation_threads 等 storage.pack_collections 初始模型。"
    },
    {
      "id": "PG15",
      "title": "Death Note 世界包内容扩展主线完成",
      "status": "completed",
      "summary": "已完成 Death Note 世界包内容扩展计划全部阶段：Phase A 补齐正式 pack 的认知状态字段与 invocation，并为 revise_judgement_plan 落地 runtime 记录承接；Phase B 完成 pack-level AI task / memory_loop 扩展、institutions / domains 建模与 objective side effects 细化；Phase C 按门禁引入 target_dossiers、judgement_plans、investigation_threads 三类 pack storage collections，并通过 world_pack_schema、ai_gateway、prompt_workflow_sections、death-note-memory-loop、pack_runtime_install、pack_runtime_materializer、world_engine_pack_host_api_read_surface 等测试验证。",
      "relatedTodoIds": [
        "phase-a-pack-contract",
        "phase-a-runtime-support",
        "phase-b-ai-memory",
        "phase-b-governance-entities",
        "phase-c-storage-gate",
        "validation-and-docs"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/death-note-world-pack-content-expansion-design.md",
        "plan": ".limcode/plans/death-note-world-pack-content-expansion-implementation.plan.md"
      },
      "completedAt": "2026-04-21T22:16:58.304Z",
      "recordedAt": "2026-04-21T22:16:58.304Z",
      "nextAction": "若继续迭代，应把新引入的 pack storage collections 从声明模型推进到真实写入链、projection 消费与 operator 可观测面。"
    },
    {
      "id": "PG16",
      "title": "Death Note 去特判与默认语义解耦完成",
      "status": "completed",
      "summary": "已完成 death_note 与宿主核心的关键边界治理：rule_based provider 不再按 world-death-note 直接分支，而是改由 pack.ai.tasks.agent_decision.metadata.rule_based_profile 驱动；death_note pack 与模板已声明 notebook_investigation_reference_v1；runtime_config 与 runtime_scaffold 的默认绑定已从 death_note 切换为中性 example_pack bundled example 模板；同时新增 example_pack 的 YAML/README/CHANGELOG 模板资源，并通过 rule_based_death_note_provider、runtime_config、world_pack_schema 等针对性单测验证。",
      "relatedTodoIds": [],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/world-pack-boundary-convergence-and-death-note-doc-migration-design.md",
        "plan": ".limcode/plans/world-pack-boundary-convergence-and-death-note-doc-migration-implementation.plan.md"
      },
      "completedAt": "2026-04-21T23:11:07.830Z",
      "recordedAt": "2026-04-21T23:11:07.830Z",
      "nextAction": "下一步可继续清理测试与辅助资源中的 death_note 命名技术债，或评估把当前 reference profile 启发式进一步下沉为更通用的可插拔扩展能力。"
    },
    {
      "id": "PG17",
      "title": "第二批通用测试与命名技术债第一轮治理完成",
      "status": "completed",
      "summary": "已完成第二批治理的 D1-D3：5 个高优先级 generic e2e 已显式迁移到 example_pack；smoke-endpoints 已拆分为 generic runtime smoke 与 death_note scenario smoke 两个文件；experimental-runtime 与 experimental-plugin-runtime-web 已明确 generic/scenario 边界；并将部分 unit/runtime 默认化命名债替换为中性测试 pack id，同时保留合法 death_note scenario fixture 命名。",
      "relatedTodoIds": [
        "phase-d1-generic-e2e-explicit-pack",
        "phase-d1-validation",
        "phase-d2-hybrid-e2e-split",
        "phase-d3-naming-debt-audit-and-cleanup",
        "phase-d3-closeout-and-doc-sync"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/第二批通用测试与命名技术债审计.md",
        "plan": ".limcode/plans/second-batch-generic-tests-and-naming-debt-remediation.plan.md"
      },
      "completedAt": "2026-04-22T00:45:26.000Z",
      "recordedAt": "2026-04-22T00:45:18.200Z",
      "nextAction": "后续若继续扩面，应审查 agent-overview、audit-workflow-lineage、workflow-replay 三个中优先级 e2e 是否适合继续 generic 化，并在 unit/integration 中按目录推进剩余 world-death-note 默认化硬编码清理。"
    },
    {
      "id": "PG18",
      "title": "第二批中优先级 e2e 与剩余命名债扩面治理完成",
      "status": "completed",
      "summary": "已完成第二轮扩面治理：agent-overview 明确保留为 death_note scenario；audit-workflow-lineage 与 workflow-replay 通过引入调度基线隔离稳定验证 replay/lineage 框架合同；并继续清理 memory/context/world_engine 相关测试中的默认化命名债，引入中性测试 pack id 或共享 pack ref 常量，同时保留 authority/perception、world engine integration 与 plugin/runtime 路径中的合法 death_note scenario 语义。",
      "relatedTodoIds": [
        "phase-e1-medium-e2e-classification",
        "phase-e1-medium-e2e-migration",
        "phase-e1-medium-e2e-validation",
        "phase-e2-expanded-naming-debt-audit",
        "phase-e2-expanded-naming-debt-remediation",
        "phase-e2-exception-ledger-and-closeout"
      ],
      "relatedReviewMilestoneIds": [],
      "relatedArtifacts": {
        "design": ".limcode/design/第二批通用测试与命名技术债审计.md",
        "plan": ".limcode/plans/second-batch-medium-priority-e2e-and-remaining-naming-debt-remediation.plan.md"
      },
      "completedAt": "2026-04-22T01:33:08.000Z",
      "recordedAt": "2026-04-22T01:33:08.888Z",
      "nextAction": "后续若继续扩面，可继续在尚未触达的 world_engine_sidecar_client、memory_recording_pack_collection_bridge、context_orchestrator 等文件中区分默认化命名债与合法 scenario 命名，并按目录逐步收口。"
    }
  ],
  "risks": [],
  "log": [
    {
      "at": "2026-04-22T00:24:02.577Z",
      "type": "updated",
      "refId": "phase-d1-generic-e2e-explicit-pack",
      "message": "已将 smoke-startup、overview-summary、scheduler-runtime-status、scheduler-queries、access-policy-contracts 五个 generic e2e 显式迁移到 activePackRef/seededPackRefs = example_pack。"
    },
    {
      "at": "2026-04-22T00:24:02.577Z",
      "type": "updated",
      "refId": "phase-d1-validation",
      "message": "已完成上述五个 generic e2e 的逐文件回归验证，确认不再依赖 death_note 默认 seed/active 语义。"
    },
    {
      "at": "2026-04-22T00:42:28.368Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/second-batch-generic-tests-and-naming-debt-remediation.plan.md"
    },
    {
      "at": "2026-04-22T00:42:42.877Z",
      "type": "updated",
      "refId": "phase-d2-hybrid-e2e-split",
      "message": "已将 smoke-endpoints 拆分为 smoke-generic-runtime-endpoints 与 smoke-death-note-scenario-endpoints，并将 experimental-runtime / experimental-plugin-runtime-web 的 generic 与 scenario 边界显式化。"
    },
    {
      "at": "2026-04-22T00:42:42.877Z",
      "type": "updated",
      "refId": "phase-d2-validation",
      "message": "已完成第二批 generic + 混合拆分后的 9 个 e2e 文件联合回归，共 10 个测试通过。"
    },
    {
      "at": "2026-04-22T00:45:06.921Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/second-batch-generic-tests-and-naming-debt-remediation.plan.md"
    },
    {
      "at": "2026-04-22T00:45:18.200Z",
      "type": "milestone_recorded",
      "refId": "PG17",
      "message": "记录里程碑：第二批通用测试与命名技术债第一轮治理完成"
    },
    {
      "at": "2026-04-22T00:45:33.791Z",
      "type": "updated",
      "refId": "phase-d3-naming-debt-audit-and-cleanup",
      "message": "已将 world_engine_persistence、world_engine_snapshot、context_memory_blocks_source_rust_modes 等 unit/runtime 测试中的默认化 world-death-note 硬编码替换为中性测试 pack id，并保留合法 death_note scenario 命名。"
    },
    {
      "at": "2026-04-22T00:45:33.791Z",
      "type": "milestone_recorded",
      "refId": "PG17",
      "message": "记录里程碑：第二批通用测试与命名技术债第一轮治理完成"
    },
    {
      "at": "2026-04-22T01:01:56.718Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划文档：.limcode/plans/second-batch-medium-priority-e2e-and-remaining-naming-debt-remediation.plan.md"
    },
    {
      "at": "2026-04-22T01:03:10.393Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划文档：.limcode/plans/second-batch-medium-priority-e2e-and-remaining-naming-debt-remediation.plan.md"
    },
    {
      "at": "2026-04-22T01:03:10.393Z",
      "type": "updated",
      "refId": "phase-e1-start",
      "message": "开始执行第二轮继续治理计划，当前先复核三个中优先级 e2e 的 generic/mixed/scenario 归类。"
    },
    {
      "at": "2026-04-22T01:03:21.695Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/second-batch-medium-priority-e2e-and-remaining-naming-debt-remediation.plan.md"
    },
    {
      "at": "2026-04-22T01:28:26.886Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/second-batch-medium-priority-e2e-and-remaining-naming-debt-remediation.plan.md"
    },
    {
      "at": "2026-04-22T01:28:49.173Z",
      "type": "updated",
      "refId": "phase-e1-medium-e2e",
      "message": "已完成 agent-overview、audit-workflow-lineage、workflow-replay 三个中优先级 e2e 的归类与处理，其中后两者通过引入调度基线隔离消除 replay_recovery job 被调度噪音干扰的问题。"
    },
    {
      "at": "2026-04-22T01:28:49.173Z",
      "type": "updated",
      "refId": "phase-e1-medium-e2e-validation",
      "message": "已完成三个中优先级 e2e 的逐文件回归，确认当前归类下可稳定通过。"
    },
    {
      "at": "2026-04-22T01:32:54.434Z",
      "type": "artifact_changed",
      "refId": "plan",
      "message": "同步计划 TODO 快照：.limcode/plans/second-batch-medium-priority-e2e-and-remaining-naming-debt-remediation.plan.md"
    },
    {
      "at": "2026-04-22T01:33:08.888Z",
      "type": "milestone_recorded",
      "refId": "PG18",
      "message": "记录里程碑：第二批中优先级 e2e 与剩余命名债扩面治理完成"
    },
    {
      "at": "2026-04-22T01:33:38.152Z",
      "type": "updated",
      "refId": "phase-e2-expanded-naming-debt-remediation",
      "message": "已继续清理 memory_block_trigger_engine、memory_block_store、memory_trigger_engine_provider、world_engine_sidecar_runtime_loop、world_engine_sidecar_failure_recovery、world_engine_pack_host_api_read_surface 等测试中的默认化命名债，并保留 authority/perception、plugin/runtime、world engine 集成里的合法 death_note scenario 语义。"
    },
    {
      "at": "2026-04-22T01:33:38.152Z",
      "type": "milestone_recorded",
      "refId": "PG18",
      "message": "记录里程碑：第二批中优先级 e2e 与剩余命名债扩面治理完成"
    }
  ],
  "stats": {
    "milestonesTotal": 20,
    "milestonesCompleted": 20,
    "todosTotal": 6,
    "todosCompleted": 6,
    "todosInProgress": 0,
    "todosCancelled": 0,
    "activeRisks": 0
  },
  "render": {
    "rendererVersion": 1,
    "generatedAt": "2026-04-22T01:33:38.152Z",
    "bodyHash": "sha256:187729dc4bf13fe44384053f4142d89d3b4b9271d0a59730ca99c01d7d630bd5"
  }
}
<!-- LIMCODE_PROGRESS_METADATA_END -->
