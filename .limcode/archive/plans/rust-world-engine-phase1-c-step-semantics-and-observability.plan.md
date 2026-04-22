<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/rust-world-engine-phase1-boundary-and-sidecar-design.md","contentHash":"sha256:e170764bf3aecc538807217a26077064ec6720af1266315217ee47ba1eb8af90"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 冻结 Phase 1C 范围：只增强 Rust sidecar prepare/commit/abort 的真实世界语义与 observability，不扩展到 objective_enforcement 之外的下一类 rule family，也不混入基础设施硬化。  `#rust-c-plan-p1-scope-freeze`
- [x] 审计当前 Phase 1B step 骨架与真实世界推进语义之间的差距，明确 session 内哪些状态变化应进入 prepareStep 的 delta/event/summary/observability。  `#rust-c-plan-p2-step-semantics-audit`
- [x] 设计并实现更真实的 PreparedWorldStep 语义：扩展 state_delta、summary 与 session before/after 关系，使 prepare/commit 能表达超出 set_clock 的世界推进结果。  `#rust-c-plan-p3-richer-delta-and-summary`
- [x] 为 Rust sidecar step 增强 emitted_events 与 observability：提供更可归因的 step diagnostics、影响实体信息与 transition reason，而不是仅保留最小骨架。  `#rust-c-plan-p4-event-and-observability`
- [x] 验证 Host-managed persistence、PackHostApi query、runtime loop 与 sidecar step 增强后的兼容性，确认 richer step 语义不会破坏 single-flight、abort/tainted 与现有宿主边界。  `#rust-c-plan-p5-host-parity-and-runtime-loop-validation`
- [x] 完成 Phase 1C 的 unit/integration/parity/failure-recovery 验证矩阵，并把仍不阻塞闭环的后续优化继续沉淀到 docs/ENHANCEMENTS.md。  `#rust-c-plan-p6-closeout-and-enhancements`
<!-- LIMCODE_TODO_LIST_END -->

# Rust world engine Phase 1C：step semantics and observability deepening

> 来源设计文档：`.limcode/design/rust-world-engine-phase1-boundary-and-sidecar-design.md`

## 1. 背景

当前仓库已经完成 Rust world engine 的两个关键阶段：

- **Phase 1A**：`objective_enforcement` 已成为 Rust-owned 的真实规则执行路径；
- **Phase 1B**：已形成 **Host snapshot hydrate -> Rust session/query -> prepare/commit/abort -> failure recovery** 的正式闭环，并已通过 unit/integration/cargo test/typecheck/lint 验证。

这意味着 Rust sidecar 现在已经不再只是 transport stub，而是具备：

1. Host 侧 world session snapshot / hydrate contract；
2. Rust session state 与 allowlist query；
3. Host-managed persistence 下的 prepare/commit/abort 编排；
4. single-flight / abort / tainted failure recovery。

但当前 `world.step.prepare` 的语义仍偏**最小骨架**：

- `state_delta` 仍主要体现 `set_clock`；
- `emitted_events` 只有最小骨架或空；
- `observability` 只有最小 diagnostics 骨架；
- `summary` 仍偏占位值；
- richer world transition 语义尚未真正进入 step contract。

因此，下一步不宜立刻扩大 Rust 覆盖面到 `objective_enforcement` 之外的下一类 rule family，而应先完成：

> **Phase 1C：继续增强 Rust sidecar `prepare/commit/abort` 的真实世界语义与 observability。**

---

## 2. 本阶段目标

Phase 1C 只做一件事：

**把 Phase 1B 已经跑通的 step 闭环，从“可用的结构骨架”提升为“更接近真实 world engine 的推进语义与可观测性表达”。**

具体目标：

1. 让 `PreparedWorldStep.state_delta` 能表达更真实的 world transition，而不是主要停留在 `set_clock`；
2. 让 `emitted_events` 更贴近 step 结果，而不是维持最小占位输出；
3. 让 `observability` 能提供更有价值的 step diagnostics，便于归因；
4. 让 `summary` 真正反映 mutation / entity / event 影响规模；
5. 保持 Host-managed persistence、single-flight、abort/tainted 语义不退化；
6. 不在本阶段提名或迁移 `objective_enforcement` 之外的下一类 rule family。

---

## 3. 范围与非范围

### 3.1 本阶段范围

本阶段只包含：

- Rust sidecar `world.step.prepare` 语义增强；
- Rust sidecar `world.step.commit` / `world.step.abort` 与 richer prepared state 的对齐；
- `PreparedWorldStep` 的 richer `state_delta / emitted_events / observability / summary`；
- 与 `PackHostApi.queryWorldState(...)`、runtime loop、Host-managed persistence 的兼容性验证；
- unit / integration / parity / failure-recovery 的补强验证。

### 3.2 本阶段明确非范围

以下内容**不在 Phase 1C 内**：

1. 不扩展到 `objective_enforcement` 之外的下一类 rule family；
2. 不把 scheduler / plugin host / workflow host / AI gateway 迁入 Rust；
3. 不让 Rust 直接访问 Prisma / SQLite；
4. 不处理 sidecar binary / CI / cargo toolchain / 本地噪音治理这类基础设施硬化；
5. 不重新打开 FFI / remote RPC 路线讨论。

这些都已明确应继续保持在：

- 当前边界文档结论内；
- 或 `docs/ENHANCEMENTS.md` 的 deferred backlog 内。

---

## 4. 为什么现在先做 Phase 1C

相比立刻进入下一类 rule family，先做 Phase 1C 更合理，原因有三：

### 4.1 当前内核闭环已成立，但 step 语义还不够厚

Phase 1B 已经让 sidecar 具备“像 world engine 一样存在”的基础，但 step contract 还未足够表达真实世界推进结果。若现在直接扩 rule family，后续大概率还会反复修改 step contract 和 diagnostics 形状。

### 4.2 更丰富的 step observability 是后续 Rust 扩张的前置基线

如果没有更好的 step diagnostics，后面继续 Rust 化新的 rule family 时，问题归因会再次模糊在：

- session load 问题
- prepare 语义问题
- commit/persist 问题
- 还是具体 rule family 自身问题

### 4.3 当前最值得继续打磨的是 engine 本体，而不是迁移面扩张

既然 Phase 1B 已完成，当前最自然的问题已经不是“继续把谁迁进 Rust”，而是“现在这个 Rust world engine，是否已经足够像一个真正的 world engine”。

Phase 1C 的意义，就是把这个答案从“边界上是”推进到“语义和观测上也更像”。

---

## 5. 当前基线与语义缺口

### 5.1 当前已有能力

当前代码基线已经具备：

- `packages/contracts/src/world_engine.ts`
  - snapshot / hydrate / query / prepare / commit / abort contracts
- `apps/server/src/app/runtime/world_engine_snapshot.ts`
  - Host snapshot assembly
- `apps/server/src/app/runtime/world_engine_persistence.ts`
  - Host-managed persistence + single-flight + tainted recovery
- `apps/server/src/app/runtime/sidecar/world_engine_sidecar_client.ts`
  - sidecar transport client
- `apps/server/rust/world_engine_sidecar/src/main.rs`
  - session state / allowlist query / prepared state / commit/abort 骨架
- `tests/unit/runtime/*` + `tests/integration/world_engine_sidecar_*.spec.ts`
  - Phase 1B 验证矩阵

### 5.2 当前主要差距

#### 差距 1：`state_delta` 过轻

目前 step delta 仍以 `set_clock` 为主，不足以体现更真实的 state transition。

#### 差距 2：`emitted_events` 仍偏骨架

当前 emitted event 数量与形状还不足以成为后续 richer world transition 的正式输出面。

#### 差距 3：`observability` 还不够解释性

目前 observability 只提供最小骨架，不足以支持更强的 step debugging / attribution。

#### 差距 4：`summary` 仍偏占位

现在 `summary` 与真实 mutation/entity/event 影响规模尚未充分对应。

---

## 6. 实施顺序

建议按以下顺序推进：

1. **冻结 Phase 1C 范围**
2. **审计当前 step 骨架与 richer semantics 差距**
3. **增强 `state_delta` 与 `summary`**
4. **增强 `emitted_events` 与 `observability`**
5. **验证 runtime loop / Host-managed persistence 兼容性**
6. **完成收尾验证与 enhancement 归档**

原因：

- 不先冻结范围，容易在实现过程中又扩到下一类 rule family；
- 不先补 `state_delta` / `summary`，后续 event/observability 会缺少统一语义基线；
- 不先验证 runtime loop / persistence 兼容性，rich semantics 可能破坏现有闭环。

---

## 7. 分阶段计划

## Phase C-P1：冻结范围与 done definition

### 目标

把本阶段的目标明确限定为“step semantics and observability deepening”，防止再次扩张迁移面。

### 主要工作

1. 明确本阶段不提名新 rule family；
2. 明确本阶段只增强：
   - `prepareStep`
   - `commitPreparedStep`
   - `abortPreparedStep`
   - `state_delta`
   - `emitted_events`
   - `observability`
   - `summary`
3. 明确 Host / Rust owner 不变：
   - Rust 负责 step 语义与内存态 session
   - Host 负责 persistence / event bridge / orchestration / failure policy

### 验收标准

- 所有实现变更都能直接映射到 step 语义与 observability 主线；
- 没有把新 rule family 或基础设施硬化偷偷带进来。

---

## Phase C-P2：step semantics audit

### 目标

系统性梳理当前 Phase 1B 的 step contract 与真实 world transition 表达之间的差距。

### 审计维度

1. `state_delta` 当前有哪些 operation 只是占位；
2. 哪些 session-owned state 在 step 前后应该显式进入 delta；
3. `summary` 应该如何映射：
   - mutation count
   - affected entities
   - event count
4. 当前 `observability` 缺少哪些关键信息：
   - transition reason
   - before/after tick/revision
   - affected entity ids
   - delta size
5. 当前 emitted event 是否只是“证明 prepare 被执行”，还是已能表达更贴近世界推进的领域变化。

### 产出

- 一份 step semantics gap checklist
- 更明确的 richer prepared step shape

### 验收标准

- 能明确指出哪些字段必须进入本轮实现；
- 能区分“当前必须补”的语义与“未来 enhancement”。

---

## Phase C-P3：增强 `state_delta` 与 `summary`

### 目标

让 `PreparedWorldStep` 首先在结构上更像真正的 world transition 结果。

### 主要工作

1. 扩展 `state_delta.operations` 的语义使用：
   - 在 `set_clock` 之外，明确纳入更真实的 state change 记录；
   - 仍只限于当前 Rust session 真正拥有的数据面。
2. 让 `summary` 与实际输出对齐：
   - `applied_rule_count`
   - `event_count`
   - `mutated_entity_count`
3. 如有必要，为 `state_delta.metadata` 增加更明确的 transition context：
   - `reason`
   - `base_revision`
   - `next_revision`
   - `pack_id`

### 验收标准

- `prepareStep` 返回的 delta 不再主要是 clock-only；
- `summary` 不再是纯占位值，而与真实输出一致；
- commit 后 query 可以反映 richer delta 所对应的 session 变化。

---

## Phase C-P4：增强 `emitted_events` 与 `observability`

### 目标

让 step 输出更容易被宿主、测试和后续 review 理解与归因。

### 主要工作

1. 为 `emitted_events` 提供更贴近 step 结果的结构：
   - 让事件不只证明“prepare 执行过”，而是表达更接近 world transition 的结果。
2. 为 `observability` 增加更解释性的记录，例如：
   - `WORLD_STEP_PREPARED`
   - `WORLD_STEP_COMMITTED`
   - `WORLD_STEP_ABORTED`
   - transition reason
   - affected entity count
   - before/after tick/revision
3. 若需要，增加 query-before/after 相关的 diagnostics summary，但保持 JSON-safe 且不过宽。

### 验收标准

- `observability` 能帮助区分 prepare / commit / abort / no-op / invalid-prepared-state 等路径；
- `emitted_events` 与 `summary`、`state_delta` 之间语义一致；
- richer diagnostics 不会打穿 Host API 边界。

---

## Phase C-P5：Host / runtime loop / persistence compatibility validation

### 目标

确保 richer step semantics 不破坏现有闭环。

### 主要工作

1. 验证 `executeWorldEnginePreparedStep(...)` 在 richer prepared step 下仍成立；
2. 验证 `persist failed -> abort` 与 `abort failed -> tainted` 路径不回退；
3. 验证 runtime loop 仍能通过 world engine 主路径运行；
4. 验证 `PackHostApi.queryWorldState(...)` 在 step 前后可观察到合理变化。

### 验收标准

- Host-managed persistence 兼容；
- runtime loop 不回退到 `context.sim.step(...)`；
- richer step 语义没有破坏 single-flight / tainted / abort 路径。

---

## Phase C-P6：验证矩阵与收尾

### 目标

为 Phase 1C 提供可关闭的验证证据，并将仍不阻塞的想法沉淀到 enhancement backlog。

### 验证矩阵

#### 1. unit tests
- richer prepared step output tests
- summary accuracy tests
- observability/event shape tests

#### 2. integration tests
- runtime loop sidecar step integration
- failure recovery compatibility
- query before/after step consistency

#### 3. parity / consistency tests
- TS adapter vs sidecar 在当前受控语义上的差异记录
- 明确哪些 richer step 结果是 Rust-first contract，而非要求 1:1 模拟旧 TS 内核

#### 4. validation commands
- `cargo test`
- `vitest` 相关 unit/integration tests
- `tsc --noEmit`
- `eslint`

### 收尾要求

- 仍不阻塞的想法继续进入 `docs/ENHANCEMENTS.md`；
- 如果本轮结束后仍要扩 rule family，应单独立下一阶段计划，而不是把它揉进 Phase 1C。

### 验收标准

- 验证矩阵通过；
- 当前 richer step semantics 已有清晰可依赖的 contract 与测试证据；
- 文档 / progress / enhancement backlog 同步完成。

---

## 8. 风险与控制

### 风险 1：为了丰富 step 语义而扩大 Rust owner 范围
**控制：** richer semantics 只针对 Rust 当前已拥有的 session state，不引入新的宿主 owned data。

### 风险 2：observability 过宽导致协议膨胀
**控制：** diagnostics 仍保持 JSON-safe、allowlisted、以 attribution 为主，不演化成任意 trace dump。

### 风险 3：rich delta 打破 Host persistence 假设
**控制：** 保持 Host-managed persistence owner 不变，所有 richer semantics 必须通过现有 orchestrator 验证。

### 风险 4：Phase 1C 被下一类 rule family 提名打断
**控制：** 明确把新 rule family 决策推迟到 Phase 1C 结束后。

---

## 9. Done Definition

当以下条件满足时，可视为 Phase 1C 完成：

1. `prepareStep` 能生成 richer `state_delta`；
2. `summary` 已能更真实反映实际影响规模；
3. `emitted_events` 与 `observability` 已具备更强解释性；
4. Host-managed persistence / single-flight / tainted recovery 仍成立；
5. runtime loop / query / integration / failure-recovery 验证通过；
6. 非阻塞增强项已继续沉淀到 `docs/ENHANCEMENTS.md`；
7. 尚未提名新的 rule family，或已明确延后到下一计划。

---

## 10. 本计划完成后的下一步建议

当 Phase 1C 完成后，再进入下一轮决策：

1. **继续提名下一类 rule family**
   - 前提：当前 step semantics 足够稳定，可支撑更复杂 Rust 迁移面；
2. **继续做更深的 engine semantics**
   - 如果 active-pack 真实业务仍主要受限于 step 本体表达力；
3. **继续保持基础设施硬化 deferred**
   - 除非 sidecar binary / CI / toolchain 已成为阻塞项。

在 Phase 1C 完成前，不建议直接扩大到 `objective_enforcement` 之外的新 rule family。
