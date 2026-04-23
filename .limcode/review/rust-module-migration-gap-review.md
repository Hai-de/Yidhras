# Rust 模块迁移剩余 TS 逻辑、宿主边界与后续深化审查
- 日期: 2026-04-22
- 概述: 审查当前项目中已切换/部分切换到 Rust 的模块，识别仍在 TS 的 runtime ownership、reference/fallback debt、已接受的宿主边界，以及真正需要后续深化的 Rust 缺口。日期：2025-02-14
- 状态: 已完成
- 总体结论: 需要后续跟进

## 评审范围

# Rust 模块迁移剩余 TS 逻辑、宿主边界与后续深化审查

- 日期：2025-02-14
- 目标：审查当前项目中已切换/部分切换到 Rust 的模块，识别仍在 TS 的 runtime ownership、reference/fallback debt、已接受的宿主边界，以及真正需要后续深化的 Rust 缺口。
- 范围：优先覆盖 world engine、scheduler decision kernel、memory trigger engine，以及它们在 server runtime 中的宿主协调层。

## 当前结论

- 审查进行中。

## 已审查模块

- 暂无

## 发现

- 暂无

## 建议后续动作

- 分模块核对：接口边界、fallback 路径、runtime loop/clock/持久化宿主职责、TS 与 Rust 的重复实现范围。

## 评审摘要

- 当前状态: 已完成
- 已审模块: apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts, apps/server/src/app/runtime/scheduler_decision_kernel.ts, apps/server/src/app/runtime/agent_scheduler.ts, apps/server/rust/scheduler_decision_sidecar/src/main.rs, apps/server/rust/scheduler_decision_sidecar/src/kernel.rs, apps/server/rust/scheduler_decision_sidecar/src/policy.rs, apps/server/rust/scheduler_decision_sidecar/src/models.rs, apps/server/src/memory/blocks/provider.ts, apps/server/src/memory/blocks/trigger_engine.ts, apps/server/src/context/sources/memory_blocks.ts, apps/server/rust/memory_trigger_sidecar/src/main.rs, apps/server/rust/memory_trigger_sidecar/src/engine.rs, apps/server/rust/memory_trigger_sidecar/src/source.rs, apps/server/rust/memory_trigger_sidecar/src/trigger.rs, apps/server/rust/memory_trigger_sidecar/src/logic_dsl.rs, apps/server/rust/memory_trigger_sidecar/src/models.rs, apps/server/rust/world_engine_sidecar/src/main.rs, apps/server/rust/world_engine_sidecar/src/session.rs, apps/server/rust/world_engine_sidecar/src/state.rs, apps/server/rust/world_engine_sidecar/src/step.rs, apps/server/rust/world_engine_sidecar/src/objective.rs, apps/server/src/app/runtime/world_engine_persistence.ts, apps/server/src/app/runtime/default_step_contributor.ts, apps/server/src/app/runtime/world_engine_ports.ts, apps/server/src/domain/rule/enforcement_engine.ts, apps/server/src/plugins/runtime.ts, apps/server/src/app/runtime/world_engine_contributors.ts
- 当前进度: 已记录 3 个里程碑；最新：M3
- 里程碑总数: 3
- 已完成里程碑: 3
- 问题总数: 7
- 问题严重级别分布: 高 2 / 中 5 / 低 0
- 最新结论: 当前项目中，已切 Rust 的模块大多只迁移了“纯计算/纯 session 内核”，而没有迁移“宿主运行时 ownership”。从完成度上看：scheduler decision kernel 与 memory trigger engine 的算法核心基本已迁移到 Rust，但 TS 仍必须保留作为 fallback 与 parity 基线，同时继续承担数据库副作用、上下文构造、结果落地与 worker/runtime 编排。world engine 的 Rust 会话核心也已存在，但需要和“未迁移缺口”分开理解：host persistence、可见时钟投影、plugin contributor lifecycle、PackHostApi 查询桥与 invocation apply 中，有一部分已应被视为 accepted TS-host-owned seam，而不是默认待迁移项。结论是：项目并不是“还有零散 TS 逻辑没切”，而是整体采用了“Rust sidecar core + TS host orchestration”的阶段性架构；其中 world engine 仍有少数需要继续决策或深化的 seam，但更大的现实是 TS host runtime kernel 仍是长期 owner。
- 下一步建议: 建议下一步单独建立一个模块总表，按 scheduler / memory trigger / world engine 三类列出：1) 已迁移到 Rust 的纯核心；2) 仍在 TS 的宿主职责；3) 是否因为 fallback/parity 必须保留 TS；4) 若要真正删除 TS 还缺哪些 phase2/phase3 能力。
- 总体结论: 需要后续跟进

## 评审发现

### Scheduler Rust 仅迁移纯 evaluate 内核

- ID: scheduler-kernel-host-boundary
- 严重级别: 中
- 分类: 可维护性
- 跟踪状态: 开放
- 相关里程碑: M1
- 说明:

  Rust sidecar 已覆盖 candidate 评估与 job draft 生成，但 worker lease、ownership、cursor、idempotency 去重、DB job 创建与 run snapshot 记录仍在 TS 宿主中完成。因此迁移结果是“Rust 纯函数内核 + TS 宿主运行时”，而不是完整 scheduler runtime ownership 迁移。
- 建议:

  如果目标是彻底去除 TS scheduler 内核依赖，需要先明确是否只迁移 evaluate kernel，还是连同 job materialization / worker coordination 一并迁移；当前边界需要文档化，否则容易误判迁移完成度。
- 证据:
  - `apps/server/src/app/runtime/agent_scheduler.ts:454-570#runAgentSchedulerForPartition`
  - `apps/server/rust/scheduler_decision_sidecar/src/kernel.rs:185-408#evaluate`
  - `apps/server/src/app/runtime/agent_scheduler.ts`
  - `apps/server/rust/scheduler_decision_sidecar/src/kernel.rs`

### Scheduler TS 参考实现仍是 fallback 与 parity 基线

- ID: scheduler-ts-reference-still-required
- 严重级别: 中
- 分类: 测试
- 跟踪状态: 开放
- 相关里程碑: M1
- 说明:

  `rust_primary` 模式启动失败时会直接回退到 TS kernel，`rust_shadow` 模式则固定先跑 TS，再调用 Rust 计算 diff。这意味着 TS 内核在当前架构下仍是生产安全网和一致性判据，尚不能删除。
- 建议:

  只有在 Rust 获得足够稳定性证明，并替换 parity/fallback 策略后，TS scheduler kernel 才能真正下线。
- 证据:
  - `apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts:97-186#RustPrimarySchedulerDecisionKernelProvider`
  - `apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts:142-186#RustShadowSchedulerDecisionKernelProvider`
  - `apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts`

### Memory trigger Rust 仅覆盖触发求值核心

- ID: memory-trigger-host-boundary
- 严重级别: 中
- 分类: 可维护性
- 跟踪状态: 开放
- 相关里程碑: M2
- 说明:

  Rust sidecar 负责 trigger evaluation、activation status 与 runtime state 计算，但候选 block 拉取、evaluation context 组装、runtime state 回写数据库、以及 context node materialization 仍在 TS 宿主完成。因此迁移结果是“Rust evaluator + TS orchestration/materialization”。
- 建议:

  后续需明确 memory trigger 的目标边界：如果只迁移 evaluator，应将宿主职责写入设计/文档；若目标是完全去 TS，需要继续迁移 input preparation 与 result application seam。
- 证据:
  - `apps/server/src/context/sources/memory_blocks.ts:41-99#buildContextNodesFromMemoryBlocks`
  - `apps/server/rust/memory_trigger_sidecar/src/source.rs:13-99#evaluate`
  - `apps/server/src/context/sources/memory_blocks.ts`
  - `apps/server/rust/memory_trigger_sidecar/src/source.rs`

### Memory trigger TS 仍承担 fallback 与 parity 基线

- ID: memory-trigger-ts-reference-still-required
- 严重级别: 中
- 分类: 测试
- 跟踪状态: 开放
- 相关里程碑: M2
- 说明:

  `rust_primary` 捕获异常后直接返回 `evaluateWithTs`，`rust_shadow` 先跑 TS 再对比 Rust 输出 diff。这说明 TS trigger engine 在当前架构中仍是生产兜底与一致性参考，不能删除。
- 建议:

  只有当 Rust 输出稳定且 parity/fallback 策略被替换后，TS trigger engine 才能考虑真正退场。
- 证据:
  - `apps/server/src/memory/blocks/provider.ts:134-210#RustPrimaryMemoryTriggerEngineProvider`
  - `apps/server/src/memory/blocks/provider.ts:172-210#RustShadowMemoryTriggerEngineProvider`
  - `apps/server/src/memory/blocks/provider.ts`

### World engine 持久化与宿主状态同步仍在 TS

- ID: world-engine-host-persistence-still-ts
- 严重级别: 中
- 分类: 可维护性
- 跟踪状态: 开放
- 相关里程碑: M3
- 说明:

  Rust sidecar prepare/commit 只维护 sidecar session 内状态，真正写入 pack runtime storage 的 `upsert_entity_state` / `append_rule_execution` / `set_clock` 处理仍由 TS `world_engine_persistence.ts` 完成，而且 clock delta 由 TS host 投影为外部可见 truth。这在当前长期架构下更准确地应被视为 **host-owned persistence / projection seam**，而不是自动等价于“未完成迁移”。
- 建议:

  明确将 host-apply delta 与 host clock projection 记录为 accepted TS-host-owned seam。
- 证据:
  - `apps/server/rust/world_engine_sidecar/src/step.rs:181-487#handle_step_prepare`
  - `apps/server/src/app/runtime/world_engine_persistence.ts:154-382#executeWorldEnginePreparedStep`
  - `apps/server/rust/world_engine_sidecar/src/step.rs`
  - `apps/server/src/app/runtime/world_engine_persistence.ts`

### World engine 插件 contributor 体系仍只存在 TS

- ID: world-engine-plugin-contributor-boundary-unmigrated
- 严重级别: 中
- 分类: 可维护性
- 跟踪状态: 开放
- 相关里程碑: M3
- 说明:

  TS 中定义了 `StepContributor` / `RuleContributor` / `QueryContributor` registry，并由 plugin runtime 注册扩展能力；Rust sidecar 当前没有对应 contributor bridge，因此任何依赖 pack-local plugin 的 world engine 扩展都必须继续经过 TS 宿主体系。按当前长期战略，这应优先被视为 **accepted TS-host-owned extension model**。
- 建议:

  将 plugin contributor lifecycle 明确记录为 TS-host-only 默认模型；只有在未来单独立项且证明收益大于复杂度时，再评估 Rust-consumable bridge。
- 证据:
  - `apps/server/src/app/runtime/world_engine_contributors.ts:17-162#WorldEngineContributorRegistry`
  - `apps/server/src/plugins/runtime.ts:14-89#ServerPluginHostApi`
  - `apps/server/src/app/runtime/world_engine_contributors.ts`
  - `apps/server/src/plugins/runtime.ts`

### World engine 查询桥与 invocation 落地仍依赖 TS

- ID: world-engine-query-and-invocation-bridge-still-ts
- 严重级别: 中
- 分类: 可维护性
- 跟踪状态: 开放
- 相关里程碑: M3
- 说明:

  虽然 Rust sidecar 可响应 `world.state.query` 和 `world.rule.execute_objective`，但项目实际查询数据很多仍由 TS `createPackHostApi` 直连 repository 提供；objective sidecar 返回的 mutation/event plan 也仍由 TS enforcement engine 应用到 entity state 与 event bridge。按当前长期战略，更准确的描述应是：`PackHostApi` 是长期 host-mediated read contract，而 query / invocation apply 仍由 TS host 持有 owner。
- 建议:

  将 query seam 与 invocation side-effect seam 重新分类为：长期 TS-host-owned contract、或仅在有明确性能/安全收益时才进入的可选 Rust deepening candidate；避免继续用“默认待迁移缺口”描述它们。
- 证据:
  - `apps/server/src/app/runtime/world_engine_ports.ts:138-314#createPackHostApi`
  - `apps/server/src/domain/rule/enforcement_engine.ts:240-324#enforceInvocationRequest`
  - `apps/server/src/app/runtime/world_engine_ports.ts`
  - `apps/server/src/domain/rule/enforcement_engine.ts`

## 评审里程碑

### M1 · Scheduler decision kernel：核心算法已迁移，但 TS 仍保留参考实现与宿主编排

- 状态: 已完成
- 记录时间: 2026-04-22T07:31:52.976Z
- 已审模块: apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts, apps/server/src/app/runtime/scheduler_decision_kernel.ts, apps/server/src/app/runtime/agent_scheduler.ts, apps/server/rust/scheduler_decision_sidecar/src/main.rs, apps/server/rust/scheduler_decision_sidecar/src/kernel.rs, apps/server/rust/scheduler_decision_sidecar/src/policy.rs, apps/server/rust/scheduler_decision_sidecar/src/models.rs
- 摘要:

  已审查 scheduler decision kernel 迁移边界。Rust sidecar 已实现 `scheduler.kernel.evaluate` 的纯内核判定逻辑，覆盖 periodic/event-driven candidate 合并、cooldown/recovery suppression、排序与 job draft 生成；但 TS 侧仍保留完整参考内核，并且 runtime 中真正的 lease、ownership、cursor、DB job materialization、idempotency 去重、run snapshot 记录仍全部由 TS 宿主承担。当前 TS 保留的主要原因不是 Rust 内核完全缺功能，而是：1) `rust_primary` 需要失败时回退到 TS；2) `rust_shadow` 需要和 TS 参考实现做 parity diff；3) sidecar 只负责纯 evaluate，不拥有 scheduler runtime 的数据库副作用与 worker 协调。
- 结论:

  Scheduler decision kernel 的“算法内核”基本已迁移到 Rust，但“系统运行权责”没有迁移；TS 仍是参考实现、fallback 基线和宿主编排层。
- 证据:
  - `apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts:97-186#RustPrimarySchedulerDecisionKernelProvider`
  - `apps/server/src/app/runtime/scheduler_decision_kernel.ts:272-434#evaluateSchedulerDecisionKernel`
  - `apps/server/src/app/runtime/agent_scheduler.ts:454-570#runAgentSchedulerForPartition`
  - `apps/server/rust/scheduler_decision_sidecar/src/main.rs:26-70#handle_request`
  - `apps/server/rust/scheduler_decision_sidecar/src/kernel.rs:185-408#evaluate`
- 下一步建议:

  继续审查 memory trigger engine，区分“纯触发引擎已迁移”和“上下文构造/落地仍在 TS”的范围。
- 问题:
  - [中] 可维护性: Scheduler Rust 仅迁移纯 evaluate 内核
  - [中] 测试: Scheduler TS 参考实现仍是 fallback 与 parity 基线

### M2 · Memory trigger engine：触发求值已迁移，但 TS 仍保留上下文接线与参考实现

- 状态: 已完成
- 记录时间: 2026-04-22T07:32:17.888Z
- 已审模块: apps/server/src/memory/blocks/provider.ts, apps/server/src/memory/blocks/trigger_engine.ts, apps/server/src/context/sources/memory_blocks.ts, apps/server/rust/memory_trigger_sidecar/src/main.rs, apps/server/rust/memory_trigger_sidecar/src/engine.rs, apps/server/rust/memory_trigger_sidecar/src/source.rs, apps/server/rust/memory_trigger_sidecar/src/trigger.rs, apps/server/rust/memory_trigger_sidecar/src/logic_dsl.rs, apps/server/rust/memory_trigger_sidecar/src/models.rs
- 摘要:

  已审查 memory trigger engine。Rust sidecar 已实现 keyword / logic / recent_source trigger 求值、activation score/status 计算、runtime state 更新，以及 source evaluate 输出结构，整体上已迁移掉纯触发引擎逻辑；但 TS 侧仍保留完整 `evaluateWithTs` 参考实现，并且 memory evaluation context 构造、候选 memory block 拉取、runtime state 持久化、materialization 到 context node 的桥接仍在 TS 宿主中完成。当前 TS 之所以仍必须存在，一方面是 `rust_primary` 的失败回退与 `rust_shadow` 的 parity diff，另一方面是 sidecar 并不拥有上游上下文装配与下游宿主落地。
- 结论:

  Memory trigger 的“规则求值核心”已迁移到 Rust，但“输入构造 + 输出落地 + fallback/parity 基线”仍在 TS，因此 TS 不能删除。
- 证据:
  - `apps/server/src/memory/blocks/provider.ts:54-229#createMemoryTriggerEngineProvider`
  - `apps/server/src/memory/blocks/trigger_engine.ts:202-281#evaluateMemoryBlockActivation`
  - `apps/server/src/context/sources/memory_blocks.ts:41-99#buildContextNodesFromMemoryBlocks`
  - `apps/server/rust/memory_trigger_sidecar/src/source.rs:13-99#evaluate`
  - `apps/server/rust/memory_trigger_sidecar/src/engine.rs:88-190#evaluate_memory_block_activation`
- 下一步建议:

  继续审查 world engine，重点区分 Rust session/query/prepare/commit 已覆盖范围，与 TS 宿主持久化、clock sync、plugin contributor、query host seam 尚未迁移的部分。
- 问题:
  - [中] 可维护性: Memory trigger Rust 仅覆盖触发求值核心
  - [中] 测试: Memory trigger TS 仍承担 fallback 与 parity 基线

### M3 · World engine：Rust sidecar 已接管 session/step 骨架，但宿主运行时与扩展边界仍留在 TS

- 状态: 已完成
- 记录时间: 2026-04-22T07:32:52.637Z
- 已审模块: apps/server/rust/world_engine_sidecar/src/main.rs, apps/server/rust/world_engine_sidecar/src/session.rs, apps/server/rust/world_engine_sidecar/src/state.rs, apps/server/rust/world_engine_sidecar/src/step.rs, apps/server/rust/world_engine_sidecar/src/objective.rs, apps/server/src/app/runtime/world_engine_persistence.ts, apps/server/src/app/runtime/default_step_contributor.ts, apps/server/src/app/runtime/world_engine_ports.ts, apps/server/src/domain/rule/enforcement_engine.ts, apps/server/src/plugins/runtime.ts, apps/server/src/app/runtime/world_engine_contributors.ts
- 摘要:

  已审查 world engine 迁移边界。Rust sidecar 已覆盖 pack load/unload、status/query、prepare/commit/abort、objective rule execution 等 session 内逻辑，并维护自己的 in-sidecar prepared session state；但 TS 仍保留大量项目必需能力：1) world step host persistence（实体状态/规则执行记录落库）；2) runtime loop 对 world engine 的调用编排；3) active runtime clock 与宿主 tick 读取；4) query host seam 直接从 TS repo 查询 pack runtime 数据；5) plugin step/rule/query contributor registry 仅存在于 TS；6) invocation enforcement 后续 mutation/event bridge 仍在 TS。换言之，Rust world engine 目前更像“pack-scoped session core + objective execution core”，并未完成完整 runtime ownership 迁移。
- 结论:

  World engine 仍高度依赖 TS host runtime kernel；但其中 host persistence、可见时钟投影、plugin contributor lifecycle 与部分 query/invocation seam 不应再被一刀切描述为“未迁完”，而应区分 accepted TS-host-owned seam 与后续可选 Rust 深化候选。
- 证据:
  - `apps/server/rust/world_engine_sidecar/src/main.rs:22-69#handle_request`
  - `apps/server/rust/world_engine_sidecar/src/step.rs:181-487#handle_step_prepare`
  - `apps/server/src/app/runtime/world_engine_persistence.ts:154-382#executeWorldEnginePreparedStep`
  - `apps/server/src/app/runtime/world_engine_ports.ts:138-314#createPackHostApi`
  - `apps/server/src/domain/rule/enforcement_engine.ts:240-324#enforceInvocationRequest`
- 下一步建议:

  收口全局结论，给出按模块统计的“已迁移核心 / 未迁移宿主能力 / TS 仍不可删原因”总表。
- 问题:
  - [高] 可维护性: World engine 持久化与宿主状态同步仍在 TS
  - [高] 可维护性: World engine 插件 contributor 体系仍只存在 TS
  - [中] 可维护性: World engine 查询桥与 invocation 落地仍依赖 TS

## 最终结论

当前项目中，已切 Rust 的模块大多只迁移了“纯计算/纯 session 内核”，而没有迁移“宿主运行时 ownership”。从完成度上看：scheduler decision kernel 与 memory trigger engine 的算法核心基本已迁移到 Rust，但 TS 仍必须保留作为 fallback 与 parity 基线，同时继续承担数据库副作用、上下文构造、结果落地与 worker/runtime 编排。world engine 的 Rust 会话核心也已存在，但应避免把所有仍在 TS 的部分都机械地归为“未迁移缺口”：host persistence、宿主可见时钟、plugin contributor lifecycle、PackHostApi 查询桥与部分 invocation apply 已越来越明确地属于 TS host runtime kernel。结论是：项目并不是“还有零散 TS 逻辑没切”，而是整体采用了“Rust sidecar core + TS host orchestration”的阶段性架构；其中真正需要继续决策或深化的，是少数可选 Rust deepening seam 与 fallback/reference debt，而不是默认目标是删除所有 TS host seam。

## 评审快照

```json
{
  "formatVersion": 4,
  "kind": "limcode.review",
  "reviewRunId": "review-mo9qf087-pphb3r",
  "createdAt": "2026-04-22T00:00:00.000Z",
  "updatedAt": "2026-04-22T07:33:15.782Z",
  "finalizedAt": "2026-04-22T07:33:15.782Z",
  "status": "completed",
  "overallDecision": "needs_follow_up",
  "header": {
    "title": "Rust 模块迁移剩余 TS 逻辑、宿主边界与后续深化审查",
    "date": "2026-04-22",
    "overview": "审查当前项目中已切换/部分切换到 Rust 的模块，识别仍在 TS 的 runtime ownership、reference/fallback debt、已接受的宿主边界，以及真正需要后续深化的 Rust 缺口。日期：2025-02-14"
  },
  "scope": {
    "markdown": "# Rust 模块迁移剩余 TS 逻辑、宿主边界与后续深化审查\n\n- 日期：2025-02-14\n- 目标：审查当前项目中已切换/部分切换到 Rust 的模块，识别仍在 TS 的 runtime ownership、reference/fallback debt、已接受的宿主边界，以及真正需要后续深化的 Rust 缺口。\n- 范围：优先覆盖 world engine、scheduler decision kernel、memory trigger engine，以及它们在 server runtime 中的宿主协调层。\n\n## 当前结论\n\n- 审查进行中。\n\n## 已审查模块\n\n- 暂无\n\n## 发现\n\n- 暂无\n\n## 建议后续动作\n\n- 分模块核对：接口边界、fallback 路径、runtime loop/clock/持久化宿主职责、TS 与 Rust 的重复实现范围。"
  },
  "summary": {
    "latestConclusion": "当前项目中，已切 Rust 的模块大多只迁移了“纯计算/纯 session 内核”，而没有迁移“宿主运行时 ownership”。从完成度上看：scheduler decision kernel 与 memory trigger engine 的算法核心基本已迁移到 Rust，但 TS 仍必须保留作为 fallback 与 parity 基线，同时继续承担数据库副作用、上下文构造、结果落地与 worker/runtime 编排。world engine 的 Rust 会话核心也已存在，但应避免把所有仍在 TS 的部分都机械地归为“未迁移缺口”：host persistence、宿主可见时钟、plugin contributor lifecycle、PackHostApi 查询桥与部分 invocation apply 已越来越明确地属于 TS host runtime kernel。结论是：项目并不是“还有零散 TS 逻辑没切”，而是整体采用了“Rust sidecar core + TS host orchestration”的阶段性架构；其中真正需要继续决策或深化的，是少数可选 Rust deepening seam 与 fallback/reference debt，而不是默认目标是删除所有 TS host seam。",
    "recommendedNextAction": "建议下一步单独建立一个模块总表，按 scheduler / memory trigger / world engine 三类列出：1) 已迁移到 Rust 的纯核心；2) 仍在 TS 的宿主职责；3) 是否因为 fallback/parity 必须保留 TS；4) 若要真正删除 TS 还缺哪些 phase2/phase3 能力。",
    "reviewedModules": [
      "apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts",
      "apps/server/src/app/runtime/scheduler_decision_kernel.ts",
      "apps/server/src/app/runtime/agent_scheduler.ts",
      "apps/server/rust/scheduler_decision_sidecar/src/main.rs",
      "apps/server/rust/scheduler_decision_sidecar/src/kernel.rs",
      "apps/server/rust/scheduler_decision_sidecar/src/policy.rs",
      "apps/server/rust/scheduler_decision_sidecar/src/models.rs",
      "apps/server/src/memory/blocks/provider.ts",
      "apps/server/src/memory/blocks/trigger_engine.ts",
      "apps/server/src/context/sources/memory_blocks.ts",
      "apps/server/rust/memory_trigger_sidecar/src/main.rs",
      "apps/server/rust/memory_trigger_sidecar/src/engine.rs",
      "apps/server/rust/memory_trigger_sidecar/src/source.rs",
      "apps/server/rust/memory_trigger_sidecar/src/trigger.rs",
      "apps/server/rust/memory_trigger_sidecar/src/logic_dsl.rs",
      "apps/server/rust/memory_trigger_sidecar/src/models.rs",
      "apps/server/rust/world_engine_sidecar/src/main.rs",
      "apps/server/rust/world_engine_sidecar/src/session.rs",
      "apps/server/rust/world_engine_sidecar/src/state.rs",
      "apps/server/rust/world_engine_sidecar/src/step.rs",
      "apps/server/rust/world_engine_sidecar/src/objective.rs",
      "apps/server/src/app/runtime/world_engine_persistence.ts",
      "apps/server/src/app/runtime/default_step_contributor.ts",
      "apps/server/src/app/runtime/world_engine_ports.ts",
      "apps/server/src/domain/rule/enforcement_engine.ts",
      "apps/server/src/plugins/runtime.ts",
      "apps/server/src/app/runtime/world_engine_contributors.ts"
    ]
  },
  "stats": {
    "totalMilestones": 3,
    "completedMilestones": 3,
    "totalFindings": 7,
    "severity": {
      "high": 2,
      "medium": 5,
      "low": 0
    }
  },
  "milestones": [
    {
      "id": "M1",
      "title": "Scheduler decision kernel：核心算法已迁移，但 TS 仍保留参考实现与宿主编排",
      "status": "completed",
      "recordedAt": "2026-04-22T07:31:52.976Z",
      "summaryMarkdown": "已审查 scheduler decision kernel 迁移边界。Rust sidecar 已实现 `scheduler.kernel.evaluate` 的纯内核判定逻辑，覆盖 periodic/event-driven candidate 合并、cooldown/recovery suppression、排序与 job draft 生成；但 TS 侧仍保留完整参考内核，并且 runtime 中真正的 lease、ownership、cursor、DB job materialization、idempotency 去重、run snapshot 记录仍全部由 TS 宿主承担。当前 TS 保留的主要原因不是 Rust 内核完全缺功能，而是：1) `rust_primary` 需要失败时回退到 TS；2) `rust_shadow` 需要和 TS 参考实现做 parity diff；3) sidecar 只负责纯 evaluate，不拥有 scheduler runtime 的数据库副作用与 worker 协调。",
      "conclusionMarkdown": "Scheduler decision kernel 的“算法内核”基本已迁移到 Rust，但“系统运行权责”没有迁移；TS 仍是参考实现、fallback 基线和宿主编排层。",
      "evidence": [
        {
          "path": "apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts",
          "lineStart": 97,
          "lineEnd": 186,
          "symbol": "RustPrimarySchedulerDecisionKernelProvider"
        },
        {
          "path": "apps/server/src/app/runtime/scheduler_decision_kernel.ts",
          "lineStart": 272,
          "lineEnd": 434,
          "symbol": "evaluateSchedulerDecisionKernel"
        },
        {
          "path": "apps/server/src/app/runtime/agent_scheduler.ts",
          "lineStart": 454,
          "lineEnd": 570,
          "symbol": "runAgentSchedulerForPartition"
        },
        {
          "path": "apps/server/rust/scheduler_decision_sidecar/src/main.rs",
          "lineStart": 26,
          "lineEnd": 70,
          "symbol": "handle_request"
        },
        {
          "path": "apps/server/rust/scheduler_decision_sidecar/src/kernel.rs",
          "lineStart": 185,
          "lineEnd": 408,
          "symbol": "evaluate"
        }
      ],
      "reviewedModules": [
        "apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts",
        "apps/server/src/app/runtime/scheduler_decision_kernel.ts",
        "apps/server/src/app/runtime/agent_scheduler.ts",
        "apps/server/rust/scheduler_decision_sidecar/src/main.rs",
        "apps/server/rust/scheduler_decision_sidecar/src/kernel.rs",
        "apps/server/rust/scheduler_decision_sidecar/src/policy.rs",
        "apps/server/rust/scheduler_decision_sidecar/src/models.rs"
      ],
      "recommendedNextAction": "继续审查 memory trigger engine，区分“纯触发引擎已迁移”和“上下文构造/落地仍在 TS”的范围。",
      "findingIds": [
        "scheduler-kernel-host-boundary",
        "scheduler-ts-reference-still-required"
      ]
    },
    {
      "id": "M2",
      "title": "Memory trigger engine：触发求值已迁移，但 TS 仍保留上下文接线与参考实现",
      "status": "completed",
      "recordedAt": "2026-04-22T07:32:17.888Z",
      "summaryMarkdown": "已审查 memory trigger engine。Rust sidecar 已实现 keyword / logic / recent_source trigger 求值、activation score/status 计算、runtime state 更新，以及 source evaluate 输出结构，整体上已迁移掉纯触发引擎逻辑；但 TS 侧仍保留完整 `evaluateWithTs` 参考实现，并且 memory evaluation context 构造、候选 memory block 拉取、runtime state 持久化、materialization 到 context node 的桥接仍在 TS 宿主中完成。当前 TS 之所以仍必须存在，一方面是 `rust_primary` 的失败回退与 `rust_shadow` 的 parity diff，另一方面是 sidecar 并不拥有上游上下文装配与下游宿主落地。",
      "conclusionMarkdown": "Memory trigger 的“规则求值核心”已迁移到 Rust，但“输入构造 + 输出落地 + fallback/parity 基线”仍在 TS，因此 TS 不能删除。",
      "evidence": [
        {
          "path": "apps/server/src/memory/blocks/provider.ts",
          "lineStart": 54,
          "lineEnd": 229,
          "symbol": "createMemoryTriggerEngineProvider"
        },
        {
          "path": "apps/server/src/memory/blocks/trigger_engine.ts",
          "lineStart": 202,
          "lineEnd": 281,
          "symbol": "evaluateMemoryBlockActivation"
        },
        {
          "path": "apps/server/src/context/sources/memory_blocks.ts",
          "lineStart": 41,
          "lineEnd": 99,
          "symbol": "buildContextNodesFromMemoryBlocks"
        },
        {
          "path": "apps/server/rust/memory_trigger_sidecar/src/source.rs",
          "lineStart": 13,
          "lineEnd": 99,
          "symbol": "evaluate"
        },
        {
          "path": "apps/server/rust/memory_trigger_sidecar/src/engine.rs",
          "lineStart": 88,
          "lineEnd": 190,
          "symbol": "evaluate_memory_block_activation"
        }
      ],
      "reviewedModules": [
        "apps/server/src/memory/blocks/provider.ts",
        "apps/server/src/memory/blocks/trigger_engine.ts",
        "apps/server/src/context/sources/memory_blocks.ts",
        "apps/server/rust/memory_trigger_sidecar/src/main.rs",
        "apps/server/rust/memory_trigger_sidecar/src/engine.rs",
        "apps/server/rust/memory_trigger_sidecar/src/source.rs",
        "apps/server/rust/memory_trigger_sidecar/src/trigger.rs",
        "apps/server/rust/memory_trigger_sidecar/src/logic_dsl.rs",
        "apps/server/rust/memory_trigger_sidecar/src/models.rs"
      ],
      "recommendedNextAction": "继续审查 world engine，重点区分 Rust session/query/prepare/commit 已覆盖范围，与 TS 宿主持久化、clock sync、plugin contributor、query host seam 尚未迁移的部分。",
      "findingIds": [
        "memory-trigger-host-boundary",
        "memory-trigger-ts-reference-still-required"
      ]
    },
    {
      "id": "M3",
      "title": "World engine：Rust sidecar 已接管 session/step 骨架，但宿主运行时与扩展边界仍留在 TS",
      "status": "completed",
      "recordedAt": "2026-04-22T07:32:52.637Z",
      "summaryMarkdown": "已审查 world engine 迁移边界。Rust sidecar 已覆盖 pack load/unload、status/query、prepare/commit/abort、objective rule execution 等 session 内逻辑，并维护自己的 in-sidecar prepared session state；但 TS 仍保留大量项目必需能力：1) world step host persistence（实体状态/规则执行记录落库）；2) runtime loop 对 world engine 的调用编排；3) active runtime clock 与宿主 tick 读取；4) query host seam 直接从 TS repo 查询 pack runtime 数据；5) plugin step/rule/query contributor registry 仅存在于 TS；6) invocation enforcement 后续 mutation/event bridge 仍在 TS。换言之，Rust world engine 目前更像“pack-scoped session core + objective execution core”，并未完成完整 runtime ownership 迁移。",
      "conclusionMarkdown": "World engine 仍高度依赖 TS host runtime kernel；但其中 host persistence、可见时钟投影、plugin contributor lifecycle 与部分 query/invocation seam 不应再被一刀切描述为“未迁完”，而应区分 accepted TS-host-owned seam 与后续可选 Rust 深化候选。",
      "evidence": [
        {
          "path": "apps/server/rust/world_engine_sidecar/src/main.rs",
          "lineStart": 22,
          "lineEnd": 69,
          "symbol": "handle_request"
        },
        {
          "path": "apps/server/rust/world_engine_sidecar/src/step.rs",
          "lineStart": 181,
          "lineEnd": 487,
          "symbol": "handle_step_prepare"
        },
        {
          "path": "apps/server/src/app/runtime/world_engine_persistence.ts",
          "lineStart": 154,
          "lineEnd": 382,
          "symbol": "executeWorldEnginePreparedStep"
        },
        {
          "path": "apps/server/src/app/runtime/world_engine_ports.ts",
          "lineStart": 138,
          "lineEnd": 314,
          "symbol": "createPackHostApi"
        },
        {
          "path": "apps/server/src/domain/rule/enforcement_engine.ts",
          "lineStart": 240,
          "lineEnd": 324,
          "symbol": "enforceInvocationRequest"
        }
      ],
      "reviewedModules": [
        "apps/server/rust/world_engine_sidecar/src/main.rs",
        "apps/server/rust/world_engine_sidecar/src/session.rs",
        "apps/server/rust/world_engine_sidecar/src/state.rs",
        "apps/server/rust/world_engine_sidecar/src/step.rs",
        "apps/server/rust/world_engine_sidecar/src/objective.rs",
        "apps/server/src/app/runtime/world_engine_persistence.ts",
        "apps/server/src/app/runtime/default_step_contributor.ts",
        "apps/server/src/app/runtime/world_engine_ports.ts",
        "apps/server/src/domain/rule/enforcement_engine.ts",
        "apps/server/src/plugins/runtime.ts",
        "apps/server/src/app/runtime/world_engine_contributors.ts"
      ],
      "recommendedNextAction": "收口全局结论，给出按模块统计的“已迁移核心 / 未迁移宿主能力 / TS 仍不可删原因”总表。",
      "findingIds": [
        "world-engine-host-persistence-still-ts",
        "world-engine-plugin-contributor-boundary-unmigrated",
        "world-engine-query-and-invocation-bridge-still-ts"
      ]
    }
  ],
  "findings": [
    {
      "id": "scheduler-kernel-host-boundary",
      "severity": "medium",
      "category": "maintainability",
      "title": "Scheduler Rust 仅迁移纯 evaluate 内核",
      "descriptionMarkdown": "Rust sidecar 已覆盖 candidate 评估与 job draft 生成，但 worker lease、ownership、cursor、idempotency 去重、DB job 创建与 run snapshot 记录仍在 TS 宿主中完成。因此迁移结果是“Rust 纯函数内核 + TS 宿主运行时”，而不是完整 scheduler runtime ownership 迁移。",
      "recommendationMarkdown": "如果目标是彻底去除 TS scheduler 内核依赖，需要先明确是否只迁移 evaluate kernel，还是连同 job materialization / worker coordination 一并迁移；当前边界需要文档化，否则容易误判迁移完成度。",
      "evidence": [
        {
          "path": "apps/server/src/app/runtime/agent_scheduler.ts",
          "lineStart": 454,
          "lineEnd": 570,
          "symbol": "runAgentSchedulerForPartition"
        },
        {
          "path": "apps/server/rust/scheduler_decision_sidecar/src/kernel.rs",
          "lineStart": 185,
          "lineEnd": 408,
          "symbol": "evaluate"
        },
        {
          "path": "apps/server/src/app/runtime/agent_scheduler.ts"
        },
        {
          "path": "apps/server/rust/scheduler_decision_sidecar/src/kernel.rs"
        }
      ],
      "relatedMilestoneIds": [
        "M1"
      ],
      "trackingStatus": "open"
    },
    {
      "id": "scheduler-ts-reference-still-required",
      "severity": "medium",
      "category": "test",
      "title": "Scheduler TS 参考实现仍是 fallback 与 parity 基线",
      "descriptionMarkdown": "`rust_primary` 模式启动失败时会直接回退到 TS kernel，`rust_shadow` 模式则固定先跑 TS，再调用 Rust 计算 diff。这意味着 TS 内核在当前架构下仍是生产安全网和一致性判据，尚不能删除。",
      "recommendationMarkdown": "只有在 Rust 获得足够稳定性证明，并替换 parity/fallback 策略后，TS scheduler kernel 才能真正下线。",
      "evidence": [
        {
          "path": "apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts",
          "lineStart": 97,
          "lineEnd": 186,
          "symbol": "RustPrimarySchedulerDecisionKernelProvider"
        },
        {
          "path": "apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts",
          "lineStart": 142,
          "lineEnd": 186,
          "symbol": "RustShadowSchedulerDecisionKernelProvider"
        },
        {
          "path": "apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts"
        }
      ],
      "relatedMilestoneIds": [
        "M1"
      ],
      "trackingStatus": "open"
    },
    {
      "id": "memory-trigger-host-boundary",
      "severity": "medium",
      "category": "maintainability",
      "title": "Memory trigger Rust 仅覆盖触发求值核心",
      "descriptionMarkdown": "Rust sidecar 负责 trigger evaluation、activation status 与 runtime state 计算，但候选 block 拉取、evaluation context 组装、runtime state 回写数据库、以及 context node materialization 仍在 TS 宿主完成。因此迁移结果是“Rust evaluator + TS orchestration/materialization”。",
      "recommendationMarkdown": "后续需明确 memory trigger 的目标边界：如果只迁移 evaluator，应将宿主职责写入设计/文档；若目标是完全去 TS，需要继续迁移 input preparation 与 result application seam。",
      "evidence": [
        {
          "path": "apps/server/src/context/sources/memory_blocks.ts",
          "lineStart": 41,
          "lineEnd": 99,
          "symbol": "buildContextNodesFromMemoryBlocks"
        },
        {
          "path": "apps/server/rust/memory_trigger_sidecar/src/source.rs",
          "lineStart": 13,
          "lineEnd": 99,
          "symbol": "evaluate"
        },
        {
          "path": "apps/server/src/context/sources/memory_blocks.ts"
        },
        {
          "path": "apps/server/rust/memory_trigger_sidecar/src/source.rs"
        }
      ],
      "relatedMilestoneIds": [
        "M2"
      ],
      "trackingStatus": "open"
    },
    {
      "id": "memory-trigger-ts-reference-still-required",
      "severity": "medium",
      "category": "test",
      "title": "Memory trigger TS 仍承担 fallback 与 parity 基线",
      "descriptionMarkdown": "`rust_primary` 捕获异常后直接返回 `evaluateWithTs`，`rust_shadow` 先跑 TS 再对比 Rust 输出 diff。这说明 TS trigger engine 在当前架构中仍是生产兜底与一致性参考，不能删除。",
      "recommendationMarkdown": "只有当 Rust 输出稳定且 parity/fallback 策略被替换后，TS trigger engine 才能考虑真正退场。",
      "evidence": [
        {
          "path": "apps/server/src/memory/blocks/provider.ts",
          "lineStart": 134,
          "lineEnd": 210,
          "symbol": "RustPrimaryMemoryTriggerEngineProvider"
        },
        {
          "path": "apps/server/src/memory/blocks/provider.ts",
          "lineStart": 172,
          "lineEnd": 210,
          "symbol": "RustShadowMemoryTriggerEngineProvider"
        },
        {
          "path": "apps/server/src/memory/blocks/provider.ts"
        }
      ],
      "relatedMilestoneIds": [
        "M2"
      ],
      "trackingStatus": "open"
    },
    {
      "id": "world-engine-host-persistence-still-ts",
      "severity": "high",
      "category": "maintainability",
      "title": "World engine 持久化与宿主状态同步仍在 TS",
      "descriptionMarkdown": "Rust sidecar prepare/commit 只维护 sidecar session 内状态，真正写入 pack runtime storage 的 `upsert_entity_state` / `append_rule_execution` / `set_clock` 处理仍由 TS `world_engine_persistence.ts` 完成，而且 clock delta 只被提取没有完全统一成 Rust-owned host clock。因此 world engine 尚未真正拥有 runtime persistence 与宿主状态推进。",
      "recommendationMarkdown": "若目标是 Rust 主导 world runtime，需要优先明确 persistence ownership：是继续 host-apply delta，还是将 pack runtime storage 写入也迁到 Rust。未明确前，TS 无法删除。",
      "evidence": [
        {
          "path": "apps/server/rust/world_engine_sidecar/src/step.rs",
          "lineStart": 181,
          "lineEnd": 487,
          "symbol": "handle_step_prepare"
        },
        {
          "path": "apps/server/src/app/runtime/world_engine_persistence.ts",
          "lineStart": 154,
          "lineEnd": 382,
          "symbol": "executeWorldEnginePreparedStep"
        },
        {
          "path": "apps/server/rust/world_engine_sidecar/src/step.rs"
        },
        {
          "path": "apps/server/src/app/runtime/world_engine_persistence.ts"
        }
      ],
      "relatedMilestoneIds": [
        "M3"
      ],
      "trackingStatus": "open"
    },
    {
      "id": "world-engine-plugin-contributor-boundary-unmigrated",
      "severity": "high",
      "category": "maintainability",
      "title": "World engine 插件 contributor 体系仍只存在 TS",
      "descriptionMarkdown": "TS 中定义了 `StepContributor` / `RuleContributor` / `QueryContributor` registry，并由 plugin runtime 注册扩展能力；Rust sidecar 当前没有对应 contributor bridge，因此任何依赖 pack-local plugin 的 world engine 扩展都必须继续经过 TS 宿主体系。",
      "recommendationMarkdown": "在 world engine 宣称迁移完成前，需要先决定 plugin contributor 是继续留在 TS host，还是建立 Rust sidecar 可消费的扩展协议。",
      "evidence": [
        {
          "path": "apps/server/src/app/runtime/world_engine_contributors.ts",
          "lineStart": 17,
          "lineEnd": 162,
          "symbol": "WorldEngineContributorRegistry"
        },
        {
          "path": "apps/server/src/plugins/runtime.ts",
          "lineStart": 14,
          "lineEnd": 89,
          "symbol": "ServerPluginHostApi"
        },
        {
          "path": "apps/server/src/app/runtime/world_engine_contributors.ts"
        },
        {
          "path": "apps/server/src/plugins/runtime.ts"
        }
      ],
      "relatedMilestoneIds": [
        "M3"
      ],
      "trackingStatus": "open"
    },
    {
      "id": "world-engine-query-and-invocation-bridge-still-ts",
      "severity": "medium",
      "category": "maintainability",
      "title": "World engine 查询桥与 invocation 落地仍依赖 TS",
      "descriptionMarkdown": "虽然 Rust sidecar 可响应 `world.state.query` 和 `world.rule.execute_objective`，但项目实际查询数据很多仍由 TS `createPackHostApi` 直连 repository 提供；objective sidecar 返回的 mutation/event plan 也仍由 TS enforcement engine 应用到 entity state 与 event bridge。Rust 当前没有接手完整 query host seam 和 invocation side effects。",
      "recommendationMarkdown": "需要分别梳理 query seam 与 invocation side-effect seam，确认哪些必须长期保留在 TS，哪些属于 Rust phase2/phase3 缺口。",
      "evidence": [
        {
          "path": "apps/server/src/app/runtime/world_engine_ports.ts",
          "lineStart": 138,
          "lineEnd": 314,
          "symbol": "createPackHostApi"
        },
        {
          "path": "apps/server/src/domain/rule/enforcement_engine.ts",
          "lineStart": 240,
          "lineEnd": 324,
          "symbol": "enforceInvocationRequest"
        },
        {
          "path": "apps/server/src/app/runtime/world_engine_ports.ts"
        },
        {
          "path": "apps/server/src/domain/rule/enforcement_engine.ts"
        }
      ],
      "relatedMilestoneIds": [
        "M3"
      ],
      "trackingStatus": "open"
    }
  ],
  "render": {
    "rendererVersion": 4,
    "bodyHash": "sha256:e238b64bbe88e0ee87349a32aa87729798d6a9e0c62129c5f4daedd6deff8e02",
    "generatedAt": "2026-04-22T07:33:15.782Z",
    "locale": "zh-CN"
  }
}
```
