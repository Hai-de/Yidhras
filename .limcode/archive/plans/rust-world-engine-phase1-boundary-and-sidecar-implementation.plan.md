<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/rust-world-engine-phase1-boundary-and-sidecar-design.md","contentHash":"sha256:e170764bf3aecc538807217a26077064ec6720af1266315217ee47ba1eb8af90"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 冻结 scheduler baseline 边界，并定义 world engine contracts、错误码、prepared-step / query / observability 类型与协议版本字段。  `#rust-plan-m1-baseline-contract`
- [x] 在 Node/TS host 中引入 WorldEnginePort / PackHostApi，并先以 TsWorldEngineAdapter 接管 sim 兼容实现。  `#rust-plan-m2-host-port-adapter`
- [x] 将 runtime loop 与 AppContext 的世界推进路径从 context.sim 迁移到 WorldEnginePort，同时限制新增 sim world-engine 调用。  `#rust-plan-m3-runtime-loop-migration`
- [x] 搭建本地 sidecar + JSON-RPC stub，完成 handshake / health / load / query / prepare / commit / abort 的基础协议与生命周期管理。  `#rust-plan-m4-sidecar-stub-transport`
- [x] 实现 Host-managed persistence 编排与 prepared commit 单飞行约束，补齐失败恢复与 tainted session 处理。  `#rust-plan-m5-host-persistence-orchestration`
- [x] 收口插件与 workflow 访问边界，补 contract/parity/integration 测试，并同步 ARCH / PLUGIN_RUNTIME / progress 文档。  `#rust-plan-m6-plugin-doc-regression`
<!-- LIMCODE_TODO_LIST_END -->

# Rust world engine 第一阶段边界与 sidecar 实施计划

> 来源设计文档：`.limcode/design/rust-world-engine-phase1-boundary-and-sidecar-design.md`

## 1. 计划目标

基于已确认的《Rust world engine 第一阶段边界与接入设计》，本计划的目标是在**不改变当前 stable single active-pack host contract**、且**不把 scheduler / plugin host / workflow host / AI gateway 迁入 Rust** 的前提下，分阶段完成以下工作：

1. 在宿主侧正式落地 `WorldEnginePort` / `PackHostApi` / world engine contracts；
2. 先以 **TS adapter** 替代 runtime loop 对 `context.sim` 的直接世界推进依赖；
3. 搭建 **本地 sidecar + JSON-RPC** 基础设施与 Rust stub；
4. 采用 **Host-managed persistence + prepared commit** 模型打通最小闭环；
5. 保证 plugin / workflow 继续只依赖 Host API，而不直接依赖 sidecar transport；
6. 通过 contract / parity / integration 测试验证第一阶段边界可执行。

---

## 2. 设计约束与实施原则

本计划严格遵循以下约束：

### 2.1 范围约束

Rust 第一阶段**只承接**：

- 世界规则执行
- 世界状态维护语义
- pack-scoped state query
- tick / revision 推进
- 领域事件与内核 observability 输出

Rust 第一阶段**不承接**：

- scheduler / ownership / rebalance
- decision runner / action dispatcher
- AI gateway / trace / audit 本体
- plugin host / plugin runtime
- prompt workflow orchestration
- Prisma / SQLite 直接访问

### 2.2 架构约束

- 新增世界内核能力统一挂在 `WorldEnginePort`，不得继续扩张 `context.sim.*`；
- plugin / workflow / context source 只能消费 `PackHostApi` 或既有 host-side ports；
- prepared step 采用 **pack-scoped single-flight**；
- stable active-pack contract 不回退；
- scheduler regression 作为独立问题跟踪，不在本计划中混修业务语义。

### 2.3 交付策略

- **contract 先行**，再做 host adapter；
- **TS adapter 先行**，再接 sidecar；
- **stub 先行**，再接最小真实 world engine 行为；
- **最小闭环先行**，不追求第一阶段覆盖全部状态模型与所有查询面。

---

## 3. 当前代码基线与主要改造点

根据现状，后续实施主要会涉及以下模块：

### 3.1 已有可复用边界

- `apps/server/src/core/pack_runtime_ports.ts`
- `apps/server/src/app/runtime/runtime_kernel_ports.ts`
- `apps/server/src/app/services/context_memory_ports.ts`
- `apps/server/src/app/services/app_context_ports.ts`
- `packages/contracts/src/*`

### 3.2 必须优先改造的位置

- `apps/server/src/app/runtime/simulation_loop.ts`
  - 当前仍直接调用 `context.sim.step(...)`
- `apps/server/src/app/context.ts`
  - 需要新增 `worldEngine` / `packHostApi` 注入位
- `apps/server/src/index.ts`
  - 需要把 world engine adapter / sidecar client 装配进 `AppContext`
- `packages/contracts/src/`
  - 需要新增 world engine contract、错误模型、prepared step 类型

### 3.3 后续联动模块

- runtime / operator / health 相关 route 或 service
- plugin runtime / workflow host 的查询调用面
- 文档：`docs/ARCH.md`、`docs/capabilities/PLUGIN_RUNTIME.md`
- 项目进度：`.limcode/progress.md`

---

## 4. 分阶段实施计划

## M1：基线冻结与 world engine contracts 正式化

### 目标

冻结 Rust 迁移线与 scheduler baseline 的边界，并正式定义 world engine 所需 contract、错误码与协议对象。

### 主要工作

1. 在 `packages/contracts/src/` 中新增 world engine 相关 contract 文件，建议至少包括：
   - `world_engine.ts` 或等价命名文件；
   - `PreparedWorldStep`
   - `WorldStateQuery` / `WorldStateQueryResult`
   - `WorldEngineHealthSnapshot`
   - `WorldEnginePackStatus`
   - `WorldDomainEvent`
   - `WorldEngineObservationRecord`
   - `WorldEngineErrorCode`
2. 为协议对象补统一约束：
   - bigint / tick / revision / cursor 全部字符串化；
   - `protocol_version` 字段；
   - mutating request 的 `pack_id` / `correlation_id` / `idempotency_key` 约定。
3. 明确 `WorldEnginePort` / `PackHostApi` 的 TS contract 位置与导出方式。
4. 建立 scheduler baseline 约束：
   - 只记录该问题为独立前置基线；
   - 不在 world engine contract 任务中修语义。

### 产出

- 可复用的 TypeScript contract 定义
- JSON-safe 协议类型与错误码表
- Host / sidecar 双方可共享的协议基线

### 验收标准

- `packages/contracts/src/` 可导出完整 world engine 类型；
- world engine contract 不依赖宿主内部对象；
- 错误码与 prepared-step 类型足以支撑后续 adapter / sidecar 开发。

---

## M2：宿主侧 `WorldEnginePort` / `PackHostApi` 与 TS adapter 落地

### 目标

先在 Node/TS host 中建立正式 world engine 端口，但底层仍由当前 TS runtime 提供兼容实现。

### 主要工作

1. 新增宿主侧 ports，例如：
   - `apps/server/src/app/runtime/world_engine_ports.ts`
   - `apps/server/src/app/runtime/pack_host_api.ts`
2. 实现 `TsWorldEngineAdapter`：
   - 底层仍委托当前 `sim` / active-pack runtime / pack runtime 相关能力；
   - 对外暴露 `prepareStep` / `commitPreparedStep` / `abortPreparedStep` / `queryState` / `getStatus` / `getHealth`。
3. 实现第一版 `PackHostApi`：
   - 只暴露受控 query / summary / current tick 能力；
   - 不开放 load / unload / step 控制面。
4. 在 `app_context_ports` 或等效模块中补 `getWorldEnginePort()` / `getPackHostApi()` 风格的正式 accessor。
5. `AppContext` 扩展注入位，但保留 `sim` 作为兼容 fallback。

### 实施注意

- `TsWorldEngineAdapter` 第一阶段允许内部调用旧对象，但要把穿透集中在 adapter 内，而不是继续散落在上层调用点；
- `prepareStep` / `commitPreparedStep` 需要先做宿主内模拟 staged model，保证未来 sidecar 接口形状不变。

### 验收标准

- `AppContext` 可获取 `worldEngine` / `packHostApi`；
- 上层新代码不再需要直接扩张 `sim.*`；
- TS adapter 在没有 Rust sidecar 时也能跑通最小 world step 闭环。

---

## M3：runtime loop / AppContext 迁移到 `WorldEnginePort`

### 目标

把 runtime loop 的世界推进主路径从 `context.sim.step(...)` 迁移到 `WorldEnginePort`，正式切断上层对 TS 世界内核内部对象的直接依赖。

### 主要工作

1. 改造 `apps/server/src/app/runtime/simulation_loop.ts`：
   - 将 `context.sim.step(context.sim.getStepTicks())` 替换为 `context.worldEngine.prepareStep(...) -> host persist -> commit/abort`；
   - 保留宿主 pre-step housekeeping 的兼容白名单逻辑，但不得新增 world-state mutation bypass。
2. 改造 `apps/server/src/index.ts`：
   - 装配 `worldEngine` / `packHostApi`；
   - 在启动流程中注入 active-pack 对应 world engine session。
3. 改造 `apps/server/src/app/context.ts`：
   - 新增 `worldEngine` / `packHostApi` 字段；
   - 明确 `sim` 为过渡兼容字段，禁止继续作为新增世界内核入口。
4. 对 runtime kernel / health / operator 视图做最小同步：
   - 让健康视图能组合 `runtimeKernel` + `worldEngine.getHealth()` 的结果；
   - 确保 runtime loop diagnostics 不退化。
5. 搜索并迁移新增 world-engine 相关上层调用点，避免继续从 route/service 直接碰 `sim`。

### 验收标准

- runtime loop 不再直接调用 `context.sim.step(...)`；
- runtime 主流程可通过 `WorldEnginePort` 正常推进；
- `AppContext` 对 world-engine 的正式注入位生效；
- 未新增新的 `sim.*` world-engine 调用扩张。

---

## M4：本地 sidecar + JSON-RPC stub 与生命周期管理

### 目标

建立可运行的本地 sidecar 基础设施，先打通 transport、协议握手与 stub 行为，再逐步承接真实 world engine 逻辑。

### 主要工作

1. 创建 Rust sidecar 工程骨架：
   - 建议位于 `apps/server/rust/`、`crates/world_engine_sidecar/` 或等效位置；
   - 提供本地可启动的 JSON-RPC server。
2. 实现第一批协议方法：
   - `world.protocol.handshake`
   - `world.health.get`
   - `world.pack.load`
   - `world.pack.unload`
   - `world.state.query`
   - `world.step.prepare`
   - `world.step.commit`
   - `world.step.abort`
3. 实现 Node/TS 侧 sidecar client：
   - 子进程启动/停止；
   - 握手与版本校验；
   - request/response 封装；
   - 错误码映射；
   - correlation id 透传。
4. 增加 sidecar 生命周期守护：
   - 启动失败 fast fail；
   - crash 后 tainted / reload 策略；
   - 本地开发环境的日志与调试输出。
5. 让 `WorldEnginePort` 可以切换实现：
   - `TsWorldEngineAdapter`
   - `SidecarWorldEngineClient`

### 验收标准

- 本地可启动 sidecar 子进程；
- host 可成功握手并完成 health/load/query/prepare/commit/abort roundtrip；
- 协议不暴露公网端口；
- sidecar client 与 adapter 可按配置切换。

---

## M5：Host-managed persistence 与 prepared commit 编排

### 目标

将设计中的 prepared commit 模型落为可执行的宿主事务编排，确保 sidecar 内存态与 Host 持久态的一致性有清晰恢复路径。

### 主要工作

1. 实现 Host persistence adapter：
   - 接收 `PreparedWorldStep`；
   - 在数据库事务中落 state delta、领域事件、必要 outbox/read model；
   - 返回 `persisted_revision` 或等效确认标识。
2. 在 host 侧补齐 pack-scoped single-flight 约束：
   - 每个 pack 同时只允许一个 prepared step；
   - 冲突时返回 `PREPARED_STEP_CONFLICT` 或等价错误。
3. 实现三类失败恢复：
   - 持久化失败 -> `abortPreparedStep`
   - prepare 后 sidecar crash -> reload/hydrate
   - persist success 但 commit 应答丢失 -> tainted session + reload
4. 让 `WorldEnginePort` 的 commit 语义在 TS adapter 与 sidecar 实现上保持一致。
5. 将 observability / events 的回传纳入事务或事务后编排策略，至少保证：
   - 事件不会因为 prepare 成功而提前被当作 committed；
   - observability 可记录 prepare/commit/abort/tainted 状态。

### 验收标准

- prepared step 能稳定走完 `prepare -> persist -> commit`；
- 失败时能走 `abort` 或 `reload`，而不是留下不可解释的中间态；
- pack-scoped single-flight 有明确保护；
- runtime loop 失败处理与 diagnostics 可反映持久化/commit 故障原因。

---

## M6：插件边界收口、测试矩阵与文档同步

### 目标

完成第一阶段边界收口的最后一轮治理：确保 plugin/workflow 不越过 Host API，建立 contract/parity/integration 测试，并同步文档与项目进度。

### 主要工作

1. 检查 plugin / workflow / context source 的访问路径：
   - 确保它们只通过 `PackHostApi` / 既有 host ports 获取世界态；
   - 禁止直接依赖 raw sidecar client / transport handle。
2. 建立测试矩阵：
   - contract tests：协议类型、错误码、字符串化约束；
   - TS adapter parity tests：TS adapter 行为基线；
   - sidecar parity tests：同一 fixture 下比较 step/state/event 输出；
   - prepare/commit failure tests：abort / tainted / reload 路径；
   - integration tests：stable active-pack contract 不回退。
3. 同步文档：
   - `docs/ARCH.md`：Rust 演进范围、Host-managed persistence、sidecar + JSON-RPC 路径；
   - `docs/capabilities/PLUGIN_RUNTIME.md`：plugin runtime 留在 Node/TS，插件通过 Host API 取世界态；
   - `.limcode/progress.md`：记录里程碑、风险与 scheduler baseline 独立问题。
4. 如需要，对已有测试工作流或脚本增加 sidecar 模式执行入口。

### 验收标准

- 插件侧未出现 raw sidecar 依赖；
- contract / parity / integration 测试覆盖关键闭环；
- stable active-pack contract 不回退；
- 架构文档与实现边界一致。

---

## 5. 依赖顺序与原因

建议严格按照以下顺序推进：

1. **M1 基线冻结与 contracts 正式化**
2. **M2 宿主 ports 与 TS adapter**
3. **M3 runtime loop / AppContext 迁移**
4. **M4 sidecar stub 与 transport**
5. **M5 Host persistence orchestration**
6. **M6 插件边界、测试与文档同步**

原因：

- M1 决定后续所有实现的接口地基；
- M2 让 world engine 能在没有 Rust 的情况下先形成正式宿主边界；
- M3 是真正切断 `context.sim` 直连的关键步骤；
- M4 在宿主边界稳定后接 sidecar，能降低协议反复改动；
- M5 是将设计从“能调用”提升到“可一致性恢复”的关键闭环；
- M6 用于保证 plugin/文档/测试不会把边界再次打穿。

---

## 6. 风险控制

### 风险 1：contract 过早失稳，导致 host 与 sidecar 双边反复改

- 在 M1 先冻结最小字段集；
- 第一阶段严格限制 query 面与数据模型范围；
- 所有协议对象放到 shared contracts 中统一演进。

### 风险 2：TS adapter 只是换壳，没有真正切断 `sim` 渗透

- 明确要求所有新增世界推进路径都通过 `WorldEnginePort`；
- 兼容穿透只能留在 adapter 内部，不得继续散落到上层。

### 风险 3：prepared commit 实现复杂，导致 runtime loop 不稳定

- 第一阶段强制 pack single-flight；
- commit 不确定时直接 tainted + reload；
- 先在 TS adapter 层把 orchestration 流程跑稳。

### 风险 4：sidecar 基础设施影响现有 stable 运行路径

- sidecar 作为可切换实现引入；
- 初期保留 TS adapter fallback；
- 以 feature flag / config 控制启用。

### 风险 5：插件或 workflow 为了方便直接接 sidecar client

- `PackHostApi` 作为唯一受控查询面；
- 评审中禁止 raw transport 注入到插件层；
- 增加针对性测试与文档说明。

### 风险 6：scheduler regression 污染 Rust 回归判断

- 作为独立 baseline 问题跟踪；
- Rust 计划内不混修；
- parity 与 integration 结果需与 scheduler 独立失败区分记录。

---

## 7. 完成定义 / Done Definition

当以下条件满足时，本计划可视为完成：

1. `packages/contracts/src/` 已正式提供 world engine contracts、错误码与协议对象；
2. `AppContext` 已具备正式 `worldEngine` / `packHostApi` 注入位；
3. runtime loop 的世界推进主路径已迁移到 `WorldEnginePort`；
4. `TsWorldEngineAdapter` 与 `SidecarWorldEngineClient` 可切换运行；
5. sidecar 已支持 `handshake / health / load / query / prepare / commit / abort`；
6. Host-managed persistence 与 prepared commit 单飞行约束已落地；
7. plugin / workflow 未直接依赖 raw sidecar client；
8. contract / parity / integration / failure-recovery 测试通过关键回归；
9. `docs/ARCH.md`、`docs/capabilities/PLUGIN_RUNTIME.md`、`.limcode/progress.md` 已同步到最新边界结论。

---

## 8. 实施后建议的下一步

本计划完成后，再进入下一轮决策：

1. 是否将更多真实世界规则执行逻辑从 TS adapter 迁入 Rust 实现；
2. 是否扩展 experimental multi-pack 下的 sidecar session 管理；
3. 是否需要为 sidecar 引入更强的持久化恢复协议或 outbox 协调机制；
4. 是否在协议稳定后评估 FFI 作为性能优化路径，而不是第一阶段默认方案。

在本计划完成前，不建议提前扩大 Rust 范围到 scheduler / plugin host / workflow host / AI gateway。
