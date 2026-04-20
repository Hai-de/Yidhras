<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/rust-world-engine-pack-runtime-core-ownership-deepening-design.md","contentHash":"sha256:9e01f0ca59369c203406fb0d5cdede764c31040998c41c97a94e04ad8d90239d"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 冻结 Pack Runtime Core ownership matrix 与 delta taxonomy：收口 contracts、metadata、query allowlist 与 diagnostics 基线，确保 Rust/Host owner 边界一致。  `#pack-core-plan-m1-contract-freeze`
- [x] 深化 Rust session mutation model：让 prepareStep 不再主要停留在 clock/runtime_step，占位 staged state 能表达至少两类以上 core object mutation。  `#pack-core-plan-m2-rust-session-mutation`
- [x] 引入 Host delta apply layer：将 PreparedWorldStep.state_delta.operations 正式映射到 pack storage repo，并保持 single-flight / abort / tainted 语义不退化。  `#pack-core-plan-m3-host-delta-apply`
- [x] 扩展 core query 与 observability：补 selector/filter、before-after 调试摘要与 WORLD_CORE_DELTA_* 等诊断记录。  `#pack-core-plan-m4-query-observability`
- [x] 完成 unit/integration/cargo/vitest/typecheck/lint 验证矩阵，更新 ARCH/ENHANCEMENTS/progress，并据结果决定下一阶段继续做 engine semantics 还是提名新 rule family。  `#pack-core-plan-m5-validation-closeout`
<!-- LIMCODE_TODO_LIST_END -->

# Rust World Engine / Pack Runtime Core Ownership Deepening Implementation Plan

> 来源设计文档：`.limcode/design/rust-world-engine-pack-runtime-core-ownership-deepening-design.md`

## 1. 背景

当前仓库已完成 Rust world engine 的三轮关键收口：

- **Phase 1A**：`objective_enforcement` 已成为 Rust-owned 的真实规则执行路径；
- **Phase 1B**：Host snapshot hydrate、Rust session/query、prepare/commit/abort 与 failure recovery 已打通；
- **Phase 1C**：step semantics / observability 第一轮深化已完成，step 输出不再只有最小骨架。

但基于最新设计结论，当前仍存在一个核心问题：

> Rust sidecar 已像 world engine 一样存在，但还没有充分成为 **Pack Runtime Core** 的语义 owner。

具体表现为：

- `PreparedWorldStep.state_delta.operations` 已有形状，但还未成为真正的 Pack Runtime Core mutation protocol；
- `prepareStep(...)` 仍主要围绕 clock advance 与 `__world__/world.runtime_step`；
- Host persistence 还没有一个正式的 delta apply layer 去解释并落库 core delta；
- query / observability 读面虽然存在，但不足以支撑 core ownership 的调试、归因与 parity 验证；
- `objective_enforcement` 与统一 core transition model 的边界已被识别，但尚未形成稳定衔接策略。

因此，本计划的目标不是继续无边界扩大 Rust 覆盖面，而是：

> **把 Rust world engine 从“具备 sidecar 闭环的 step 执行器”推进为“真正拥有 Pack Runtime Core 变更语义的内核”。**

---

## 2. 本轮目标

本轮只聚焦一条主线：

1. 冻结 Pack Runtime Core ownership matrix；
2. 正式化 `PreparedWorldStep.state_delta.operations` 作为 core mutation protocol；
3. 深化 Rust session 的 staged mutation 语义；
4. 为 Host 建立正式的 delta apply layer；
5. 扩展 core query / observability 以支撑验证与归因；
6. 保持 scheduler / plugin host / workflow host / AI gateway 继续留在 Node/TS。

---

## 3. 范围与非范围

### 3.1 本轮范围

- `packages/contracts/src/world_engine.ts` 及相关 contract 的 Pack Runtime Core 收口；
- `apps/server/rust/world_engine_sidecar/src/` 中 session / prepared-state / query / diagnostics 的深化；
- `apps/server/src/app/runtime/world_engine_persistence.ts` 与相关 Host persistence seam 的正式化；
- pack runtime core repos 与 Host apply 映射层的实现；
- world engine unit/integration/runtime loop/failure recovery 测试矩阵补强；
- `docs/ARCH.md`、`docs/ENHANCEMENTS.md`、`.limcode/progress.md` 的同步。

### 3.2 明确非范围

以下事项不在本计划内：

1. 不推进 Scheduler Core Decision Kernel；
2. 不推进 Memory Block / Context Trigger Engine；
3. 不把 plugin host / workflow host / context assembly / AI gateway 迁入 Rust；
4. 不重开 FFI / remote RPC / 网络服务路线；
5. 不把 Rust 直接接入 Prisma 或 pack runtime sqlite；
6. 不把 `Event` 改为 pack-owned source-of-truth；
7. 不要求本轮完成下一类 rule family 提名；
8. 不强行把 `objective_enforcement` 直接并入统一 prepared-step transaction，除非只是 shape 对齐与自然副产物。

---

## 4. 关键实现对象

### 4.1 Pack Runtime Core owned 数据面

本轮默认 Rust session 继续只拥有以下 core state：

- `world_entities`
- `entity_states`
- `authority_grants`
- `mediator_bindings`
- `rule_execution_records`
- tick / revision transition semantics
- prepared core delta
- step/core observability

### 4.2 Host 继续拥有的数据面

- pack runtime sqlite transaction boundary
- repo-level persistence implementation
- scheduler / runtime loop orchestration
- plugin host / workflow host / context/memory
- `Event` bridge / audit / projection / operator read model
- failure policy / tainted recovery
- HTTP / CLI / operator API surface

---

## 5. 分阶段实施

## Phase M1：冻结 ownership matrix 与 delta contract

### 目标

把设计中的 ownership matrix、delta taxonomy、metadata/query/diagnostics 最小基线正式落到 contract 与宿主边界中，避免后续实现继续漂移。

### 主要工作

1. 审视并收口 `packages/contracts/src/world_engine.ts`：
   - 明确 `upsert_world_entity`
   - 明确 `upsert_entity_state`
   - 明确 `put_mediator_binding`
   - 明确 `put_authority_grant`
   - 明确 `append_rule_execution`
   - 明确 `set_clock`
2. 为 `WorldStateDeltaOperation.payload` 设计更稳定的最小字段约束：
   - `target_ref`
   - `namespace`
   - `payload.next`
   - `payload.previous`（按需）
   - `payload.reason`（按需）
3. 收口 `state_delta.metadata` 最小基线，建议至少包含：
   - `pack_id`
   - `reason`
   - `base_tick` / `next_tick`
   - `base_revision` / `next_revision`
   - `mutated_entity_ids`
   - `mutated_namespace_refs`
   - `delta_operation_count`
4. 审视 `WorldStateQuery` allowlist 是否需要提前扩最小 selector/filter 结构，避免后面实现时重新破坏 contract。
5. 明确新的 observability code 基线（即使先只在文档或常量层定义占位）：
   - `WORLD_CORE_DELTA_BUILT`
   - `WORLD_CORE_DELTA_APPLIED`
   - `WORLD_CORE_DELTA_ABORTED`
   - `WORLD_QUERY_ALLOWLIST_FILTERED`
   - `WORLD_PREPARED_STATE_SUMMARY`

### 预期涉及文件

- `packages/contracts/src/world_engine.ts`
- `packages/contracts/src/index.ts`（如需导出调整）
- `apps/server/src/app/runtime/world_engine_ports.ts`
- `docs/ARCH.md`（边界文字若需同步）

### 验收标准

- contract 层已足够表达设计中定义的 Pack Runtime Core mutation protocol；
- Rust/Host owner 边界在 contract 与文档上保持一致；
- 后续实现不需要再靠临时字段扩张 delta 语义。

---

## Phase M2：Rust session mutation deepening

### 目标

让 Rust sidecar 的 `prepareStep(...)` 从“clock advance + runtime_step tracing”演进为“真正对 Pack Runtime Core staged state 进行 mutation”。

### 主要工作

1. 重构 sidecar 内的 prepared state 表达，使其清晰区分：
   - committed session state
   - prepared staged state
   - prepared delta
   - prepared summary
   - prepared observability
2. 让 `prepareStep(...)` 至少能稳定表达**两类以上** core object mutation，而不是只更新 `__world__/world`：
   - `entity_states`
   - `rule_execution_records`
   - 或 `authority_grants` / `mediator_bindings` 中的受控变更
3. 为 prepared state 增加更明确的 before/after 摘要能力：
   - affected entity ids
   - affected namespace refs
   - before/after tick/revision
   - delta operation count
4. 保持 `commitPreparedStep(...)` / `abortPreparedStep(...)` 与 richer staged state 对齐：
   - commit 后 session committed state 正确推进
   - abort 后 staged state 干净回滚
5. 视实现复杂度，把当前 Rust 单文件逐步拆分为内部模块，但不强制把结构重构本身变成主要目标。

### 预期涉及文件

- `apps/server/rust/world_engine_sidecar/src/main.rs`
- 以及可能新增的 `apps/server/rust/world_engine_sidecar/src/*.rs`

### 验收标准

- `prepareStep(...)` 返回的 delta 不再主要是 clock-only；
- prepared state 能体现至少两类以上 Pack Runtime Core object mutation；
- commit/abort 后 session 状态一致性与已有 failure recovery 不退化。

---

## Phase M3：Host delta apply layer 正式化

### 目标

把 Host persistence 从“返回 persisted_revision 的 orchestrator”升级为“解释 core delta 并落 pack runtime repo 的正式 apply layer”。

### 主要工作

1. 在 `world_engine_persistence.ts` 周边引入正式 apply seam，例如：
   - `PackRuntimeCoreDeltaPersistencePort`
   - 或 `applyPreparedWorldStateDelta(...)`
2. 建立 delta op 到 repo 的受控映射：
   - `upsert_world_entity` -> `entity_repo`
   - `upsert_entity_state` -> `entity_state_repo`
   - `put_authority_grant` -> `authority_repo`
   - `put_mediator_binding` -> `mediator_repo`
   - `append_rule_execution` -> `rule_execution_repo`
   - `set_clock` -> runtime/clock persistence facade
3. 保持 Host 只做 apply，不重新发明 mutation semantics：
   - Host 不自行补写新的隐式 mutation
   - Host 只解释 delta contract 并落库
4. 让 apply 层受现有 single-flight / abort / tainted 机制保护：
   - apply fail -> abort
   - abort fail -> tainted
   - 单 pack 仍只允许一个 in-flight prepared step
5. 如有必要，把当前 pack storage repo 做最小必要增强，支撑 idempotent upsert / append 语义。

### 预期涉及文件

- `apps/server/src/app/runtime/world_engine_persistence.ts`
- `apps/server/src/packs/storage/*.ts`
- `apps/server/src/packs/runtime/*.ts`（如 clock/runtime facade 需要配合）

### 验收标准

- Host persistence 不再只是回传 revision；
- 至少两类以上 Pack Runtime Core delta op 能通过 Host apply 层真实落库；
- single-flight / abort / tainted / runtime loop compatibility 继续成立。

---

## Phase M4：扩展 core query 与 observability

### 目标

让 query/diagnostics 不只是“能查到东西”，而是足以支撑 Pack Runtime Core ownership 的调试、归因与 before-after 验证。

### 主要工作

1. 扩 `queryState(...)` allowlist 的 selector/filter：
   - `world_entities`：`entity_kind` / `entity_type` / `ids`
   - `entity_state`：更多 namespace summary / state existence / runtime-step summary
   - `authority_grants`：`source_entity_id` / `capability_key` / `mediated_by_entity_id` / `status`
   - `mediator_bindings`：`mediator_id` / `subject_entity_id` / `binding_kind` / `status`
   - `rule_execution_summary`：recent limit / by rule / by subject/target / by status
2. 为 sidecar 与 Host apply 增加 core-delta-oriented diagnostics：
   - delta built
   - delta applied
   - delta aborted
   - allowlist filtered
   - prepared state summary
3. 让 integration tests 能观察：
   - step 前后 core query 差异
   - delta op 数量与 affected entities 对齐
   - Host apply 失败与 observability code 对齐
4. 必要时为 `PackHostApi.queryWorldState(...)` 增补更稳定的 summary 输出，以便上层仍通过受控读面访问。

### 预期涉及文件

- `packages/contracts/src/world_engine.ts`
- `apps/server/src/app/runtime/world_engine_ports.ts`
- `apps/server/rust/world_engine_sidecar/src/*.rs`
- `apps/server/src/app/runtime/sidecar/world_engine_sidecar_client.ts`

### 验收标准

- query allowlist 足以支撑 Pack Runtime Core before-after 验证；
- diagnostics 能帮助区分 prepare / apply / commit / abort 的失败归因；
- 不因扩 query/diagnostics 打穿 Host API 边界。

---

## Phase M5：验证矩阵、文档收尾与下一阶段决策

### 目标

为本轮 Pack Runtime Core ownership deepening 提供可关闭的验证证据，并明确下一阶段是继续 engine semantics 还是提名新 rule family。

### 验证矩阵

#### 1. Rust / contract tests
- core delta op schema tests
- metadata/query/diagnostics schema tests
- cargo test

#### 2. TS unit tests
- `world_engine_persistence` apply/orchestration tests
- delta mapping tests
- query allowlist / filter tests
- sidecar client contract tests

#### 3. integration tests
- runtime loop through Host-managed persistence
- failure recovery / abort / tainted
- PackHostApi query before/after consistency
- core object mutation persistence verification

#### 4. validation commands
- `cargo test`
- `vitest`（unit/integration 相关矩阵）
- `tsc --noEmit`
- `eslint`

### 文档收尾

1. 更新 `docs/ARCH.md`
   - 明确 Pack Runtime Core ownership deeper state 已完成到什么程度；
   - 明确 Host apply layer 与 Rust owner 的边界。
2. 更新 `docs/ENHANCEMENTS.md`
   - 将仍不阻塞闭环的后续 engine semantics / objective alignment / further rule-family ideas 转入 backlog。
3. 如实施过程中形成明确里程碑，更新 `.limcode/progress.md`。

### 下一阶段决策门槛

当本轮完成后，再决定：

1. **继续加深 engine semantics**
   - 如果 Pack Runtime Core mutation/apply/query 仍不够厚；
2. **提名 objective 之外的新 rule family**
   - 前提是 core ownership 已稳定，不会再次大改 delta/persistence/query contract。

### 验收标准

- 验证矩阵通过；
- 文档与 progress 同步完成；
- 下一阶段路线选择具备清晰前提，而不是继续边做边想。

---

## 6. 风险与控制

### 风险 1：范围漂移到 scheduler / memory / workflow
**控制：** 本轮只围绕 World Engine / Pack Runtime Core 实施，不把其他 TODO 主线混入。

### 风险 2：delta contract 过宽，演化为内部协议 dump
**控制：** 所有 op 均围绕 Pack Runtime Core owned 面，保持 JSON-safe、repo-applicable、无宿主内部对象泄漏。

### 风险 3：Host apply layer 重新变成语义 owner
**控制：** Host 只解释并落库 delta，不自己决定 mutation semantics。

### 风险 4：objective execution 与 prepared step delta 继续分叉
**控制：** 本轮至少对齐 shape 与边界结论，避免继续出现第三套 mutation expression。

### 风险 5：Rust sidecar 结构继续膨胀
**控制：** 如实现复杂度明显上升，应同步拆出内部模块；结构治理服务于语义清晰，但不喧宾夺主。

---

## 7. Done Definition

当以下条件满足时，可认为本计划完成：

1. Pack Runtime Core ownership matrix 已冻结；
2. `PreparedWorldStep.state_delta.operations` 已成为正式 core mutation protocol；
3. Rust `prepareStep(...)` 可表达超出 clock-only 的真实 core mutation；
4. Host 已具备正式 delta apply layer，并通过 repo 持久化 core delta；
5. query allowlist 已能支撑 core debugging / before-after 验证；
6. single-flight / abort / tainted / runtime loop compatibility 未退化；
7. `objective_enforcement` 与 core delta model 的边界已有明确结论；
8. 已形成下一阶段继续 engine semantics 或提名新 rule family 的清晰决策前提。

---

## 8. 本计划完成后的下一步建议

本计划完成后，再进入下一轮决策：

1. **继续做更深的 Pack Runtime Core / engine semantics**
   - 如果当前 active-pack 真实业务仍主要受限于 core mutation 厚度；
2. **提名 objective 之外的下一类 rule family**
   - 前提是 core ownership / delta / apply / query 已足够稳定；
3. **把 objective execution 纳入更统一的 prepared-step transaction model**
   - 仅在前两项基线稳定后再评估。

在本计划完成前，不建议直接转向 Scheduler Core 或 Memory Trigger 主线，也不建议提前打开新的 rule family breadth 扩张。
