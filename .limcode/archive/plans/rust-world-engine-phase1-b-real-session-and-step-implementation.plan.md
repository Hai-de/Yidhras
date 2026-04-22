<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/rust-world-engine-phase1-boundary-and-sidecar-design.md","contentHash":"sha256:e170764bf3aecc538807217a26077064ec6720af1266315217ee47ba1eb8af90"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 冻结 Phase 1B 范围：scheduler baseline 已独立处理，本阶段只推进 Rust world session / query / prepare-commit 真实化，不扩大到 scheduler、plugin/workflow host 或基础设施硬化。  `#rust-b-plan-p1-scope-freeze`
- [x] 正式化 Host->Rust 的 world session snapshot / hydrate contract，定义 Rust 第一阶段真正拥有的 pack-scoped core state 输入面与 query/step 所需共享类型。  `#rust-b-plan-p2-snapshot-contract`
- [x] 设计并接入 Host 侧 snapshot assembly / loadPack hydrate 编排，让 Rust sidecar 在加载 pack session 时获得真实核心世界态，而不是仅创建空 session。  `#rust-b-plan-p3-host-snapshot-loader`
- [x] 实现 Rust sidecar 的真实 session state 与 allowlist query（pack_summary/world_entities/entity_state/authority_grants/mediator_bindings/rule_execution_summary），并与 PackHostApi/WorldEnginePort 对齐。  `#rust-b-plan-p4-rust-query-runtime`
- [x] 把 world.step.prepare/commit/abort 从 stub 升级为真实 world step 编排：基于 Rust session 计算 delta/events/observability，并保持 Host-managed persistence 与 tainted/single-flight 语义不变。  `#rust-b-plan-p5-real-prepare-commit`
- [x] 补齐 contract/unit/integration/parity/failure-recovery 验证矩阵，确认 runtime loop 通过真实 Rust session/step 工作；基础设施硬化项仅记录在 docs/ENHANCEMENTS.md，不纳入本阶段实现。  `#rust-b-plan-p6-validation-closeout`
<!-- LIMCODE_TODO_LIST_END -->

# Rust world engine Phase 1B：real session / query / prepare-commit implementation

> 来源设计文档：`.limcode/design/rust-world-engine-phase1-boundary-and-sidecar-design.md`

## 1. 背景与本阶段目标

当前仓库已经完成 Rust world engine 第一阶段的边界收口与 A 收尾：

- `WorldEnginePort` / `PackHostApi` 已正式存在；
- runtime loop 已经通过 `executeWorldEnginePreparedStep(...)` 走 world engine 主路径；
- `objective_enforcement` 已成为 **Rust-owned 的真实规则执行路径**；
- sidecar transport、prepared commit、single-flight、tainted session 基础链路已具备；
- 文档已明确：Rust 第一阶段只替换 **world engine / pack runtime 内核**，不扩大到 scheduler / plugin host / workflow host / AI gateway。

但从当前实现看，Rust world engine 仍未真正成为 **world step + world state session owner**：

- `apps/server/rust/world_engine_sidecar/src/main.rs` 中的 `world.pack.load` / `world.state.query` / `world.step.prepare` / `world.step.commit` 仍以 stub 为主；
- `SessionState` 只保存 `mode/current_tick/current_revision/pending_prepared_token`，尚未持有真实 pack-scoped core state；
- `world.state.query` 还未以 Rust session 提供真实 allowlist 查询结果；
- `world.step.prepare` 还不会基于 Rust session 计算真实 `state_delta / emitted_events / observability`；
- `createTsWorldEngineAdapter().commitPreparedStep()` 仍最终回落到 TS `sim.step(...)`。

因此，本阶段选择 **方案 A**：

> **优先把 Rust world engine 从“边界 + sidecar + 单点 objective rule 执行”推进到“真实 pack session / query / prepare-commit step 内核”。**

## 2. 已确认前提

本阶段建立在以下用户确认与现有结论之上：

1. **scheduler baseline 已独立处理**，不再作为本计划的混入项；
2. **优先走方案 A**，先做 world step / session 真实化；
3. **基础设施硬化**（如 sidecar 启动方式、binary/CI/cache/本地 cargo 噪音治理等）**不纳入本阶段实现**，仅作为 deferred 项保留在 `docs/ENHANCEMENTS.md`；
4. Host-managed persistence 仍保持不变：Rust 不直接接管 Prisma / SQLite；
5. plugin/workflow 继续只通过 Host API / `PackHostApi` 访问世界态，不直接接 sidecar transport。

## 3. 本阶段完成标准

Phase 1B 完成时，应满足：

1. Rust sidecar 在 `loadPack` 后持有真实 **pack-scoped core session state**；
2. `world.state.query` 能从 Rust session 返回真实 allowlist 查询结果，而不是仅返回 stub summary；
3. `world.step.prepare` 能基于 Rust session 计算真实 `PreparedWorldStep`，包含：
   - `state_delta`
   - `emitted_events`
   - `observability`
   - `summary`
4. Host 仍负责 `prepare -> persist -> commit/abort` 编排；
5. `single-flight`、`tainted session`、`abort on persist failure` 等语义不退化；
6. runtime loop 已通过真实 Rust session/step 路径工作，而不再只是“形式上走 `WorldEnginePort`”；
7. 基础设施硬化需求仅进入 `docs/ENHANCEMENTS.md`，不阻塞 Phase 1B 收口。

## 4. 明确范围 / 非范围

### 4.1 本阶段范围

本阶段只推进以下内容：

- Host -> Rust 的 snapshot / hydrate contract
- Rust sidecar 的真实 pack session state
- Rust session 支撑的 allowlist query
- Rust session 支撑的 world step prepare/commit/abort
- Host-managed persistence 下的真实 delta/events/observability 编排
- runtime loop 与 `WorldEnginePort` 的真实 Rust step 接入验证
- 必要的 contract / unit / integration / parity / failure-recovery 测试

### 4.2 本阶段非范围

以下内容明确不在本计划内：

- scheduler 修复或 scheduler 迁移
- plugin host / plugin runtime 迁移到 Rust
- prompt workflow host 迁移到 Rust
- AI gateway / decision runner / action dispatcher 迁移到 Rust
- Rust 直接访问 Prisma / SQLite
- FFI/远程服务化方案切换
- sidecar binary/CI/cache/本地工具链噪音等基础设施硬化
- 任意扩大到“所有 rule family 的无限迁移”

## 5. 当前基线与关键缺口

### 5.1 当前可复用基础

当前已有可直接复用的模块包括：

- `packages/contracts/src/world_engine.ts`
  - world engine protocol / step / query / objective execution contracts
- `apps/server/src/app/runtime/world_engine_ports.ts`
  - `WorldEnginePort` / `PackHostApi` / `TsWorldEngineAdapter`
- `apps/server/src/app/runtime/world_engine_persistence.ts`
  - Host-managed persistence orchestration、single-flight、tainted session
- `apps/server/src/app/runtime/sidecar/world_engine_sidecar_client.ts`
  - stdio JSON-RPC sidecar client
- `apps/server/src/domain/rule/enforcement_engine.ts`
  - objective rule execution 的 Rust 调用桥接
- `apps/server/rust/world_engine_sidecar/src/main.rs`
  - 当前 sidecar skeleton 与 objective rule handler

### 5.2 必须解决的缺口

#### 缺口 1：没有正式的 world session snapshot / hydrate 输入面

虽然设计文档已经说明 Host-managed persistence 与 sidecar hydrate 思路，但当前 shared contract 中还缺少用于 `loadPack` 阶段的正式 **world session snapshot** 结构。

结果是：

- Rust sidecar 无法获得真实 pack runtime core state；
- sidecar session 只能创建空壳；
- query/step 无法建立在统一 session owner 之上。

#### 缺口 2：Rust sidecar session state 仍只是 tick/revision 壳

当前 Rust `SessionState` 不持有真实 world entities / entity states / mediator bindings / authority grants / rule execution summary 等核心数据，因此无法承担真实 world state owner 的角色。

#### 缺口 3：query 仍不是 Rust-owned read surface

`world.state.query` 当前仅回 stub summary；而 `PackHostApi` 虽有接口，当前真实数据仍主要来自 Host 侧 TS 路径。这与“Rust 成为 world state owner”的阶段目标不一致。

#### 缺口 4：prepare/commit 仍未承接真实 state transition

当前 `world.step.prepare` 只能生成空 `state_delta`，`world.step.commit` 只会推进字符串 tick/revision。这意味着 runtime loop 的 world step 还未进入 Rust world engine 实义实现阶段。

## 6. 总体实施顺序

建议严格按如下顺序推进：

1. **冻结 Phase 1B 范围与状态 owner 边界**
2. **补 session snapshot / hydrate contract**
3. **补 Host snapshot assembly / loadPack 编排**
4. **在 Rust sidecar 内实现真实 session state 与 query**
5. **把 prepare/commit/abort 升级为真实 step 语义**
6. **跑完整验证矩阵并收口 deferred enhancements**

原因：

- 没有 snapshot contract，就没有 Rust session 的稳定输入面；
- 没有 session，就没有 query / prepare 的真实 owner；
- 没有 query 稳定面，后续 step 调试和 parity 会缺少观测基线；
- 没有真实 prepare/commit，就还不算 Rust world engine 真正接手世界推进。

## 7. 分阶段实施计划

## Phase B-P1：冻结 Phase 1B 边界与 owner 模型

### 目标

把本阶段的“什么算完成”冻结清楚，避免重新发散到 rule-family 扩张或基础设施整修。

### 主要工作

1. 明确 Phase 1B 的唯一主目标：
   - **Rust 持有真实 pack session**；
   - **Rust 支撑真实 query**；
   - **Rust 支撑真实 prepare/commit step**。
2. 明确 owner 矩阵：
   - Rust：pack-scoped core state in-memory session、world step 计算、query、delta/events/observability 生成；
   - Host：snapshot 组装、事务持久化、event bridge、tainted/single-flight、runtime loop orchestration。
3. 明确本阶段不进入：
   - 下一类 rule family 扩张；
   - binary/CI/toolchain 等基础设施硬化；
   - scheduler/plugin/workflow/AI gateway 迁移。
4. 将基础设施硬化留在 `docs/ENHANCEMENTS.md`，不作为本阶段阻塞项。

### 产出

- 一份无歧义的 Phase 1B 完成定义
- 明确的 Host/Rust owner matrix

### 验收标准

- 后续实现不再把“是否继续扩 rule family”混入本阶段主任务；
- 所有 work item 都能直接映射到 session/query/prepare-commit 主线。

---

## Phase B-P2：正式化 world session snapshot / hydrate contract

### 目标

为 Rust session 提供正式、稳定、最小的输入面，使 sidecar 能在 `loadPack` 阶段获得真实 core world state。

### 主要工作

1. 在 `packages/contracts/src/world_engine.ts` 中新增或细化以下类型：
   - `WorldPackSnapshot`
   - `WorldPackClockSnapshot`
   - `WorldEntitySnapshot`
   - `WorldEntityStateSnapshot`
   - `WorldAuthorityGrantSnapshot`
   - `WorldMediatorBindingSnapshot`
   - `WorldRuleExecutionRecordSnapshot`（如果 query/step 需要）
   - `WorldPackHydrateRequest` / `WorldPackHydrateResult`
2. 明确字段序列化规则：
   - bigint / tick / revision 继续字符串化；
   - 所有 snapshot 结构 JSON-safe；
   - 不引入 Host 内部 class / runtime handle / Prisma object。
3. 明确 snapshot 只包含 **world engine 第一阶段真正拥有的数据面**：
   - pack runtime clock / revision
   - world entities
   - entity states
   - mediator bindings
   - authority grants
   - 必要的 rule execution summary / metadata
4. 不把以下数据混进 snapshot：
   - scheduler / decision jobs
   - workflow persistence
   - plugin registry
   - AI traces / audit 本体
   - operator projections

### 产出

- Host / sidecar 共用的 hydrate contract
- Rust session state 的正式输入面

### 验收标准

- 仅凭 contract 即可描述 Rust sidecar loadPack 所需最小数据面；
- contract 不耦合 TS 内部对象或数据库实现细节；
- query/step 所需的 Rust-owned core state 已全部可由 snapshot 提供。

---

## Phase B-P3：Host snapshot assembly 与 loadPack hydrate 编排

### 目标

让 Host 在 `loadPack` 时能够把 pack runtime core data 组装成 snapshot，并交给 Rust sidecar 初始化真实 session。

### 主要工作

1. 在 Host 侧新增 snapshot assembly 模块，建议位置类似：
   - `apps/server/src/app/runtime/world_engine_snapshot.ts`
   - 或 `apps/server/src/app/runtime/world_engine_snapshot_loader.ts`
2. 基于现有 storage repo 组装 snapshot：
   - `listPackWorldEntities(...)`
   - `listPackEntityStates(...)`
   - `listPackAuthorityGrants(...)`
   - `listPackMediatorBindings(...)`
   - `listPackRuleExecutionRecords(...)`
3. 扩展 `WorldEnginePort.loadPack(...)` 的宿主编排：
   - Host 先取 snapshot；
   - sidecar `world.pack.load` 接收 snapshot/hydrate payload；
   - sidecar 初始化真实 session；
   - Host 以返回的 `current_tick/current_revision/session_status` 建立一致性基线。
4. 保持 active / experimental scope gate 不变：
   - stable active-pack contract 不被放宽；
   - experimental 仍需通过已有 runtime registry / lookup gate。
5. 如需兼容过渡：
   - `TsWorldEngineAdapter` 也应尽量对齐同一套 `loadPack` contract 形状；
   - 但不要求其内部完全复刻 Rust session 实现。

### 产出

- Host 侧真实 snapshot assembly
- sidecar loadPack hydrate 闭环

### 验收标准

- `loadPack` 后的 Rust session 不再是空壳；
- reload/hydrate 路径可以在 tainted session 场景下重复使用；
- Host 不需要把数据库句柄或宿主对象暴露给 sidecar。

---

## Phase B-P4：实现 Rust session state 与 allowlist query

### 目标

让 Rust sidecar 成为 **真实 world state read owner**，至少在第一阶段允许的查询面上成立。

### 主要工作

1. 重构 `apps/server/rust/world_engine_sidecar/src/main.rs`：
   - 将 session / query / step / objective handler 拆分为多个模块，避免 `main.rs` 继续膨胀；
   - 建议拆为：`session.rs`、`query.rs`、`step.rs`、`objective.rs`、`rpc.rs` 等。
2. 扩展 Rust `SessionState`，至少持有：
   - `mode`
   - `current_tick`
   - `current_revision`
   - `pending_prepared_token`
   - world entities
   - entity states
   - authority grants
   - mediator bindings
   - 必要的 rule execution summary / metadata
3. 实现真实 allowlist query：
   - `pack_summary`
   - `world_entities`
   - `entity_state`
   - `authority_grants`
   - `mediator_bindings`
   - `rule_execution_summary`
4. 保持 query surface 收敛：
   - 不开放任意查询；
   - 不暴露 Rust 内部存储结构；
   - 查询结果形状保持与 shared contract 一致。
5. 校验 Host API 对齐：
   - `PackHostApi.queryWorldState(...)` 在 sidecar 模式下直接消费真实 Rust query；
   - stable read surface integration 不退化。

### 产出

- Rust-owned 的 session read model
- 真实 `world.state.query` 实现

### 验收标准

- `PackHostApi` 在 sidecar 模式下能读到真实 world session 数据；
- integration test 能验证所有 allowlist query 都由 Rust session 返回有效结果；
- Host 不再需要为这些 query 继续兜底生成平行结果。

---

## Phase B-P5：把 prepare/commit/abort 升级为真实 world step 语义

### 目标

让 runtime loop 的世界推进真正落到 Rust world engine，而不是仅走一个空协议壳。

### 主要工作

1. 在 Rust sidecar 中实现真实 `world.step.prepare`：
   - 基于 session 当前 tick/revision 和 `step_ticks` 计算下一步；
   - 执行第一阶段要求的世界推进逻辑；
   - 产出真实 `PreparedWorldStep`：
     - `state_delta`
     - `emitted_events`
     - `observability`
     - `summary`
2. `prepare` 阶段应满足：
   - 不直接持久化；
   - 每 pack 只允许一个 in-flight prepared step；
   - prepared state 与 committed state 分离。
3. 在 Rust sidecar 中实现真实 `world.step.commit`：
   - 接受 Host `persisted_revision`；
   - 将 prepared session state 正式提升为 committed；
   - 更新当前 tick/revision；
   - 清理 pending prepared token。
4. 在 Rust sidecar 中实现 `world.step.abort`：
   - 丢弃 staged result；
   - 恢复到 prepare 前 session 状态；
   - 不留下不可解释中间态。
5. 保持 Host 侧 orchestration 不变：
   - `executeWorldEnginePreparedStep(...)` 仍是 prepare->persist->commit/abort 的唯一编排入口；
   - `single-flight` / `tainted session` / persist failure / abort failure 路径继续有效。
6. 过渡策略：
   - `TsWorldEngineAdapter` 可继续作为 fallback/compat 实现存在；
   - 但 runtime loop 的目标验证路径应切换为真实 Rust sidecar session/step。

### 产出

- 真实 world step 的 Rust prepare/commit/abort 实现
- runtime loop 与 Rust session 的实义闭环

### 验收标准

- `world.step.prepare` 不再只返回空 `operations: []`；
- commit 后 session state / query 结果能反映 world step 的真实推进；
- 持久化失败能 abort；abort 失败能 taint；reload 后可恢复；
- runtime loop 的 world step 已可明确归因到 Rust sidecar 内核而非 TS `sim.step()` 语义壳。

---

## Phase B-P6：验证矩阵与收尾

### 目标

确认 Phase 1B 不是“看起来接上了”，而是真正具备 query/step/session 闭环能力。

### 验证矩阵

#### 1. Contract validation

- snapshot/hydrate contract schema parse
- query/step/result schema validation
- TypeScript/Rust 双侧序列化一致性

#### 2. Unit tests

- Host snapshot assembly tests
- Rust sidecar query handler tests
- Rust sidecar prepare/commit/abort state machine tests
- tainted/single-flight failure tests

#### 3. Integration tests

- `PackHostApi` 通过 sidecar 读取真实 allowlist query
- runtime loop 通过 Rust sidecar 执行真实 world step
- prepare persist failure -> abort
- commit acknowledgement异常 -> tainted + reload

#### 4. Parity / consistency tests

- 在同一 fixture 下比较：
  - loadPack 后的 session query 结果
  - step 前后 query 变化
  - emitted events / observability summary
- 明确哪些结果要求与 TS adapter 完全一致，哪些允许记录为第一阶段受控差异。

#### 5. Boundary validation

确认以下边界仍然成立：

- Host 仍负责 persistence
- Rust 不直接访问 Prisma / SQLite
- plugin/workflow 不持有 raw sidecar client
- scheduler baseline 不混入本阶段问题归因
- 基础设施硬化项没有偷偷进入当前实现范围

### 收尾要求

1. 若实现过程中发现新的 sidecar 启动、binary、CI、toolchain、cache、输出噪音等问题：
   - 统一记录到 `docs/ENHANCEMENTS.md`
   - 不作为 Phase 1B 阻塞项
2. 若发现 objective_enforcement 之外确有新的 rule family 需要迁移：
   - 不在本计划内顺手扩张
   - 另立 bounded continuation step

### 验收标准

- query / step / session 的真实 Rust owner 路径已通过关键验证；
- Host-managed persistence、single-flight、tainted session 机制未退化；
- 基础设施硬化项已明确 deferred，而不是混入当前里程碑。

## 8. 风险与控制

### 风险 1：session snapshot 过宽，重新把宿主边界打穿

**控制：**

- snapshot 只包含 world engine owned core state；
- 不把 scheduler/workflow/plugin/audit 数据混入 hydrate payload；
- 所有输入面由 shared contract 严格约束。

### 风险 2：query 与 step 同时推进，导致调试困难

**控制：**

- 先完成 snapshot + query，再推进 prepare/commit；
- 让 query 成为 step 前后的最小观测基线。

### 风险 3：prepare/commit 实现后与 Host persistence 编排脱节

**控制：**

- 不改 Host-managed persistence owner；
- 所有 step 都继续经过 `executeWorldEnginePreparedStep(...)`；
- 失败恢复继续依赖 single-flight + tainted 机制。

### 风险 4：为了赶进度重新回退到 TS `sim.step()` 主语义

**控制：**

- 将“runtime loop 通过真实 Rust step 工作”列为本阶段完成标准；
- TS adapter 仅作 fallback/compat，不作为主验收路径。

### 风险 5：基础设施硬化重新抢占主线

**控制：**

- binary/CI/cache/toolchain 一律 defer 到 `docs/ENHANCEMENTS.md`；
- 只有阻断开发的最小修补才允许处理，且不得改写本阶段目标。

## 9. Done Definition

本计划完成时，应同时满足：

1. `packages/contracts/src/world_engine.ts` 已正式提供 session snapshot / hydrate 相关 contract；
2. Host 已能在 `loadPack` 阶段组装并下发真实 pack core snapshot；
3. Rust sidecar 已持有真实 pack-scoped session state；
4. `world.state.query` 已实现 allowlist 查询而非 stub；
5. `world.step.prepare/commit/abort` 已具备真实 world step 语义；
6. runtime loop 已通过真实 Rust session/step 路径推进；
7. Host-managed persistence、single-flight、tainted session 与 failure-recovery 仍成立；
8. 验证矩阵通过；
9. 基础设施硬化项仅进入 `docs/ENHANCEMENTS.md`，未混入本阶段主里程碑。

## 10. 本计划完成后的建议下一步

当 Phase 1B 完成后，再进入下一轮判断：

1. 是否需要为 active-pack 真实业务再提名 **下一类 rule family**；
2. 是否需要扩展更丰富的 world query surface，但仍保持 allowlist；
3. 是否在协议和内核稳定后，再独立规划 binary/CI/toolchain 等基础设施硬化；
4. 是否需要进一步压缩 `TsWorldEngineAdapter` 的兼容角色。

在 Phase 1B 完成前，不建议提前扩大到 scheduler/plugin/workflow/AI gateway，或把基础设施硬化混入当前主线。
