# Rust 迁移历史兼容性债务评估

> 评估日期：2026-04-22
> 评估范围：apps/server 中因快速开发迁移至 Rust 迭代过程留下的兼容性债务
> 更新日期：2026-04-21
> 关联文档：
> - `.limcode/archive/design/rust-world-engine-phase1-boundary-and-sidecar-design.md`
> - `.limcode/archive/design/memory-block-context-trigger-engine-rust-migration-design.md`
> - `.limcode/archive/review/scheduler-core-decision-kernel-rust-migration-review.md`
> - `docs/ENHANCEMENTS.md` (Lines 288-338)

---

## 1. 债务总览

当前代码库中存在 **8 大类、15+ 处具体债务点**，分布在 TypeScript 服务端、Rust sidecar、共享契约和配置系统中。这些债务的核心特征是：**同一领域逻辑存在 TS/Rust 双轨实现，中间由 adapter/shim/bridge 弥合**。

> 2026-04-21 更新：本评估中“当前迭代可立即开始”的 Phase 1/2 收口项已完成；随后又完成 world engine legacy adapter 物理移除。本文保留原始债务识别与路线图，同时补充当前真实状态，防止文档与代码继续漂移。

| 类别 | 债务项数 | 影响面 | 处理紧迫度 | 当前状态 |
|------|---------|--------|-----------|-----------|
| 结构性 fallback 链 | 3 | 核心运行时 | 🔴 高 | 🟢 host/runtime 关键路径已改为显式未就绪错误 |
| TS shim / adapter | 2 | world engine 边界 | 🔴 高 | 🟢 LegacyTsWorldEngineAdapter 已物理移除；world engine 已 sidecar-only |
| 全局可变状态 | 1 | 数据一致性 | 🟡 中 | 🟢 已完成 coordinator 注入化 |
| 三元模式（ts/rust_shadow/rust_primary） | 2 | scheduler + memory | 🟡 中 | 🟡 scheduler 默认已切为 `rust_primary`，收敛仍待长期验证 |
| DTO 重复契约 | 3 | 维护成本 | 🟢 低 | ⚪ 未处理 |
| 兼容标记字段 | 2 | 契约纯净度 | 🟢 低 | 🟡 已从 TODO 收尾，但仍属长期清理主题 |
| 遗留 source adapter | 1 | 上下文组装 | 🟢 低 | 🟡 已脱离主路径，但未作为本轮重点展开 |
| 构建/部署缺口 | 1 | 生产就绪 | 🟡 中 | 🟢 已补 `check:rust` / `build:rust` 与 CI 接线 |

---

## 2. 债务逐项分析

### 2.1 结构性 fallback 链（🔴 高）

#### 2.1.1 `context.sim` 作为兼容性超级入口

- **原位置**：`apps/server/src/app/runtime/world_engine_ports.ts:81`
- **原代码**：
  ```ts
  const getActiveRuntimeFacade = (context: AppContext) => context.activePackRuntime ?? context.sim;
  ```
- **原问题**：新架构要求通过 `WorldEnginePort` 操作世界引擎，但 adapter 在 `activePackRuntime` 缺失时直接回退到遗留的 `context.sim`（即 `SimulationManager`），导致 `sim` 仍是事实上的终极 fallback。
- **更新状态（2026-04-21）**：
  - `world_engine_ports.ts` 与 `simulation_loop.ts` 的核心路径已不再静默 fallback 到 `context.sim`；
  - 当前在 `activePackRuntime` 缺失时会直接抛 `ACTIVE_PACK_RUNTIME_NOT_READY`；
  - 这意味着 host query / runtime loop 已不再依赖遗留终极兜底。
- **剩余风险**：`app_context_ports.ts` 等其他通用 facade 仍保留少量过渡 fallback，属于后续边界治理主题。

#### 2.1.2 `PackHostApi` 回退到完整 TS Adapter

- **原位置**：`apps/server/src/app/runtime/world_engine_ports.ts:624-640`
- **原代码**：
  ```ts
  export const createPackHostApi = (context: AppContext): PackHostApi => {
    const worldEngine = context.worldEngine ?? createTsWorldEngineAdapter(context);
    // ...
  };
  ```
- **原问题**：`PackHostApi` 本应是轻量查询 facade，却可能在 `worldEngine` 未注入时实例化完整 `TsWorldEngineAdapter`，违背分层设计原则。
- **更新状态（2026-04-21）**：已完成。`createPackHostApi` 不再自己构建 TS adapter fallback；host read surface 通过 host-managed repository/runtime 查询提供，runtime-critical host operations 在 `activePackRuntime` 缺失时显式抛 `ACTIVE_PACK_RUNTIME_NOT_READY`。

#### 2.1.3 运行时循环的惰性 adapter 实例化

- **原位置**：`apps/server/src/app/runtime/simulation_loop.ts:27-29`
- **原代码**：
  ```ts
  const getWorldEngine = (context: AppContext) => {
    return context.worldEngine ?? createTsWorldEngineAdapter(context);
  };
  ```
- **原问题**：runtime loop 不强制要求 sidecar 存在，每次步进都可能 lazy-init TS adapter，即使没有显式配置也可能以“伪 sidecar”模式运行，掩盖配置错误。
- **更新状态（2026-04-21）**：已完成。`simulation_loop.ts` 现在要求 `context.worldEngine` 和 `context.activePackRuntime` 都明确就绪，否则直接报错。

---

### 2.2 TypeScript Shim / Adapter（🔴 高）

#### 2.2.1 `TsWorldEngineAdapter` — 最大的单体债务

- **原位置**：`apps/server/src/app/runtime/world_engine_ports.ts:306-622`
- **原规模**：~317 行，完整实现 `WorldEnginePort` 接口
- **原问题**：
  1. **语义伪装**：它通过 `adapter: 'ts_world_engine'` 元数据和 `ts-prepared:${packId}:${Date.now()}` token 格式假装自己是 sidecar，实则是对 `context.sim.step(...)` 的包装。
  2. **状态孤岛**：维护独立的 `pendingPreparedSteps` Map，与 Rust sidecar 的状态机无法互通。
  3. **步进语义不完整**：metadata 中硬编码 `mutated_core_collections: ['entity_states', 'rule_execution_records']`，实际只覆盖了 `__world__/world` + `rule_execution_records`，未涵盖完整的 pack runtime 核心（参见 `docs/ENHANCEMENTS.md:320-338`）。
- **更新状态（2026-04-21）**：已完成当前轮最终移除。
  - `createLegacyTsWorldEngineAdapter` 与 `createTsWorldEngineAdapter` 已从 `apps/server/src/app/runtime/world_engine_ports.ts` 物理删除；
  - `apps/server/src/index.ts` 已改为只装配 `createWorldEngineSidecarClient({...getWorldEngineConfig()})`；
  - 相关测试调用面已改写，不再依赖 `ts_world_engine` 适配层。
- **当前结论**：world engine 已不再保留 TS adapter shadow implementation；“只要 adapter 还在就无法确认 Rust sidecar 是唯一必经路径”这一风险已收敛。

---

### 2.3 全局可变状态（🟡 中）

#### 2.3.1 `singleFlightStates` 与 `taintedPackIds`

- **原位置**：`apps/server/src/app/runtime/world_engine_persistence.ts:50-51`
- **原代码**：
  ```ts
  const singleFlightStates = new Map<string, WorldEngineSingleFlightState>();
  const taintedPackIds = new Set<string>();
  ```
- **原问题**：模块级全局变量，未封装为 class 或注入服务，在测试中难以隔离，在多进程部署中无法共享。
- **更新状态（2026-04-21）**：已完成当前轮目标。`WorldEngineStepCoordinator` 已注入到 `AppContext`，`executeWorldEnginePreparedStep()` 主路径不再依赖默认模块级共享实例。
- **剩余说明**：为兼容部分旧测试辅助函数，模块内仍保留 default coordinator 访问函数，但正式运行路径已切到注入实例。

---

### 2.4 三元模式（ts / rust_shadow / rust_primary）（🟢 已解决）

> **2026-04-23 更新**：`ts` 与 `rust_shadow` 模式已从 scheduler 和 memory trigger 中物理移除。当前唯一支持的模式为 `rust_primary`，TS 参考实现保留为 `@deprecated` fallback，仅在 Rust sidecar 不可用时触发并打印 `console.warn`  deprecation 日志。

#### 2.4.1 Memory Trigger Engine

- **位置**：`apps/server/src/memory/blocks/provider.ts`
- **原状态**：
  - `ts`：纯 TypeScript 实现（`evaluateWithTs`）
  - `rust_primary`：Rust sidecar 为主，出错时 fallback 到 TS（`rust_fallback_to_ts`）
  - `rust_shadow`：双轨运行，TS 结果为准，Rust 结果仅用于 diff
- **更新状态（2026-04-23）**：
  - `TsMemoryTriggerEngineProvider` 与 `RustShadowMemoryTriggerEngineProvider` 已物理删除；
  - `canonicalize` / `isCanonicalEqual` / `countOutputDiffs` 已删除；
  - `evaluateWithTs` 保留为私有 deprecated fallback；
  - `createMemoryTriggerEngineProvider()` 不再接受 `mode` 参数，始终创建 `RustPrimaryMemoryTriggerEngineProvider`；
  - fallback 触发时打印 `TS_FALLBACK_DEPRECATION_WARNING`。
- **当前默认**：`rust_primary`（唯一有效值）

#### 2.4.2 Scheduler Decision Kernel

- **位置**：`apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts`
- **原状态**：与 memory trigger 同构的三元模式
- **更新状态（2026-04-23）**：
  - `TsSchedulerDecisionKernelProvider` 与 `RustShadowSchedulerDecisionKernelProvider` 已物理删除；
  - `getSchedulerDecisionKernelParityPreview` 已删除；
  - `evaluateSchedulerDecisionKernel` 标记为 `@deprecated`；
  - `createSchedulerDecisionKernelProvider()` 不再接受 `mode` 参数，始终创建 `RustPrimarySchedulerDecisionKernelProvider`；
  - fallback 触发时打印 deprecation warning。
- **当前默认**：`rust_primary`（唯一有效值）

#### 2.4.3 `canonicalize` / `isCanonicalEqual`

- **位置**：原 `apps/server/src/memory/blocks/provider.ts:23-41` 与 `scheduler_decision_kernel_provider.ts`
- **问题**：纯为 parity diff 存在的深度比较函数，无业务语义，仅在 `rust_shadow` 模式下使用。
- **更新状态（2026-04-23）**：已随 `rust_shadow` 模式一起物理删除。

---

### 2.5 DTO 重复契约（🟢 低）

#### 2.5.1 World Engine Contracts

- **TS 侧**：`packages/contracts/src/world_engine.ts`（~614 行 Zod schema）
- **Rust 侧**：`apps/server/rust/world_engine_sidecar/src/models.rs` + `protocol.rs`
- **问题**：无代码生成（codegen）或 protobuf 约束，完全手工维护。`serializeWorldPackSnapshotRecord`（contracts:515-613）存在的唯一目的就是将 Prisma/BigInt 记录转换为 sidecar 安全的 string-based JSON。

#### 2.5.2 Memory Trigger DTO

- **TS 侧**：`apps/server/src/memory/blocks/types.ts`
- **Rust 侧**：`apps/server/rust/memory_trigger_sidecar/src/models.rs`
- **问题**：几乎 1:1 镜像。`trigger_rate_ignored` 字段（models.rs:349）是兼容性补丁。

#### 2.5.3 Scheduler Decision Kernel DTO

- **TS 侧**：`apps/server/src/scheduler/decision_kernel_types.ts`（推断）
- **Rust 侧**：`apps/server/rust/scheduler_decision_sidecar/src/models.rs`
- **问题**：同构重复。

---

### 2.6 兼容标记字段（🟢 低）

#### 2.6.1 `bridge_mode`

- **位置**：
  - `packages/contracts/src/world_engine.ts:432`
  - `apps/server/src/domain/rule/objective_rule_resolver.ts:27`
- **语义**：`'objective_rule'` —— 仅用于标识结果来自 sidecar/bridge 路径，非领域概念。

#### 2.6.2 `compatibility_mode`

- **位置**：`apps/server/src/config/schema.ts:33-39`
- **取值**：`'full' | 'bridge_only' | 'off'`
- **语义**：prompt workflow profile 的迁移旋钮。`bridge_only` 表示部分渲染。

---

### 2.7 遗留 Source Adapter（🟢 低）

#### 2.7.1 Legacy Memory Source

- **位置**：
  - `apps/server/src/context/sources/legacy_memory.ts`
  - `apps/server/src/context/source_registry.ts:64-69`
- **标识**：`createLegacyMemorySourceAdapter`，kind 为 `'legacy-memory-selection'`
- **问题**：旧内存选择路径与新 memory-block-runtime source 并存。新特性可能无意间依赖旧路径。
- **更新状态（2026-04-21）**：本轮未把它当作主处理目标，但主业务 TODO 已不再把它当作当前阻断项。

---

### 2.8 构建/部署缺口（🟡 中）

#### 2.8.1 `cargo run` 运行时启动

- **原位置**：三个 sidecar client 均通过 `child_process.spawn('cargo', ['run', '--quiet', ...])` 启动
- **原问题**：
  1. `apps/server/package.json` 中无 Rust 构建脚本。
  2. 首次启动或代码变更后有显著编译延迟。
  3. 生产部署需手动预构建，CI 流程未捕获。
- **更新状态（2026-04-21）**：
  - `apps/server/package.json` 已补 `check:rust` 与 `build:rust`；
  - `server-tests.yml` 已在 integration 前执行 `check:rust`；
  - `server-smoke.yml` 已在 smoke 前执行 `build:rust`；
  - 三个 sidecar client 现都支持 binary path 优先，保留 cargo fallback 作为开发态兜底。
- **结论**：此项已从“缺口”转为“仍保留开发态 fallback 的受控治理状态”。

#### 2.8.2 混合默认配置

- **位置**：`apps/server/src/config/runtime_config.ts`
- **原现状**：
  - `scheduler.agent.decision_kernel.mode: 'ts'`
  - `scheduler.memory.trigger_engine.mode: 'rust_primary'`
- **更新状态（2026-04-21）**：
  - `scheduler.agent.decision_kernel.mode: 'rust_primary'`
  - `scheduler.memory.trigger_engine.mode: 'rust_primary'`
  - `world_engine.mode` 已从 `apps/server/src/config/schema.ts` 和 `apps/server/src/config/runtime_config.ts` 中移除；当前 world engine 只保留 `timeout_ms` / `binary_path` / `auto_restart` 配置。
- **问题**：系统仍处于过渡期，但默认值层面的“半迁移误导”已显著下降，world engine 领域已经先一步完成 single-track 收口。

#### 2.8.3 环境变量驱动的 Sidecar 切换

- **原位置**：`apps/server/src/index.ts:127-131`
- **原代码**：
  ```ts
  appContext.worldEngine = process.env.WORLD_ENGINE_USE_SIDECAR === '1'
    ? new WorldEngineSidecarClient()
    : createTsWorldEngineAdapter(appContext, ...);
  ```
- **原问题**：sidecar 启用由环境变量而非运行时配置 schema 控制，导致配置变更需要重启进程，且无法通过 API/配置热更新。
- **更新状态（2026-04-21）**：
  - `index.ts` 已改用 `getWorldEngineConfig()` 并只装配 sidecar client；
  - `WORLD_ENGINE_USE_SIDECAR` 保留为受控 deprecated 兼容层，只在 `runtime_config.ts` 中发出 warning，不再改变 world engine 有效行为；
  - `WORLD_ENGINE_MODE` 已从 runtime config 解析与 snapshot 中移除。

---

## 3. 处理方案

### 3.1 原则

1. **明确单轨目标**：World Engine、Memory Trigger、Scheduler Kernel 最终都应由 Rust sidecar 承载。TS 实现是过渡手段，不是长期双轨。
2. **先收敛再移除**：在移除 adapter 之前，先让单轨模式在默认配置下稳定运行足够长时间。
3. **契约先稳**：在清理 TS shim 之前，确保 Rust/TS 边界的 JSON-RPC 契约稳定且被测试覆盖。
4. **日志先于删除**：任何被移除的兼容路径，先改为在调用时打 `warn` 日志，观察一个迭代周期后再物理删除。

### 3.2 四阶段路线图

#### 阶段一：配置收口（当前迭代可开始）

**目标**：让运行时行为由配置系统单一控制，消除环境变量和隐式 fallback。

| 行动项 | 文件 | 预计改动量 | 当前状态 |
|--------|------|-----------|-----------|
| 将 `WORLD_ENGINE_USE_SIDECAR` 移入 `RuntimeConfigSchema` | `config/schema.ts`, `config/runtime_config.ts` | 小 | ✅ 已完成，且旧变量已降级为 deprecated compat |
| 为 `scheduler.agent.decision_kernel.mode` 添加 `rust_primary` 选项，并在本地环境测试 | `config/runtime_config.ts`, `scheduler_decision_kernel_provider.ts` | 中 | ✅ 已完成 |
| 在 `index.ts` 中改用 `getRuntimeConfig()` 读取 sidecar 开关 | `index.ts` | 小 | ✅ 已完成，且 world engine 已改为 sidecar-only 装配 |
| 在 `world_engine_ports.ts` 的 fallback 链中增加 `warn` 日志 | `world_engine_ports.ts`, `simulation_loop.ts` | 小 | ✅ 已升级为更严格的显式报错 |

#### 阶段二：状态封装 + Shim 显式化（下一迭代）

**目标**：让遗留实现“显式可见”，而不是隐性伪装。

| 行动项 | 文件 | 预计改动量 | 当前状态 |
|--------|------|-----------|-----------|
| 将 `singleFlightStates`/`taintedPackIds` 封装为 `WorldEngineStepStateManager` 类，注入到 `AppContext` | `world_engine_persistence.ts`, `context.ts` | 中 | ✅ 已完成注入化 |
| 重命名 `createTsWorldEngineAdapter` → `createLegacyWorldEngineAdapter`，并在 health/metadata 中明确标注 `legacy: true` | `world_engine_ports.ts` | 小 | ✅ 已完成并进一步物理移除，无需再保留 legacy 命名层 |
| 移除 `PackHostApi` 中的 `createTsWorldEngineAdapter` fallback，要求调用方必须注入 `worldEngine` | `world_engine_ports.ts:624` | 小 | ✅ 已完成 |
| 在 `runtime_loop.ts` 中移除 `getWorldEngine` 的 lazy-init，强制要求 `context.worldEngine` 已设置 | `simulation_loop.ts` | 小 | ✅ 已完成 |

#### 阶段三：三元模式收敛（Rust 验证后）

**目标**：每个组件只保留一种默认模式，fallback/shadow 变为显式调试选项。

| 行动项 | 前提条件 | 预计改动量 | 当前状态 |
|--------|---------|-----------|-----------|
| Memory Trigger：默认锁定 `rust_primary`，移除 `ts` 和 `rust_shadow` 的 Provider 类 | Rust sidecar 连续 2 周无 fallback 触发 | 中 | ✅ 已完成（2026-04-23），Provider 类与 parity 代码已物理删除 |
| Scheduler Kernel：完成 Rust 实现验证后，默认切换为 `rust_primary` | 需先补充 scheduler kernel Rust 侧的缺失功能 | 大 | ✅ 已完成（2026-04-23），TS/shadow Provider 已物理删除 |
| World Engine：当 Rust sidecar 覆盖全部 `mutated_core_collections` 后，移除 `LegacyWorldEngineAdapter` | 需完成 `docs/ENHANCEMENTS.md:320-338` 中的语义深化 | 大 | ✅ 已完成，legacy world engine adapter 已物理删除 |
| 移除 `canonicalize`/`isCanonicalEqual` | shadow 模式移除后 | 小 | ✅ 已完成（2026-04-23），随 shadow 模式一起删除 |

#### 阶段四：清理兼容标记（长期）

| 行动项 | 预计改动量 | 当前状态 |
|--------|-----------|-----------|
| 从 `WorldRuleExecuteObjectiveResult` 中移除 `bridge_mode` | 小 | ⚪ 未开始 |
| 从 `PromptWorkflowProfileDefaultsSchema` 中移除 `compatibility_mode` | 小 | ⚪ 未开始 |
| 移除 `legacy_memory.ts` 和 `source_registry.ts` 中的 `'legacy-memory-selection'` 注册 | 中 | ⚪ 未开始 |
| 将 Rust sidecar 的 `cargo run` 改为预构建二进制路径，在 `package.json` 中加入 `build:rust` 脚本 | 中 | ✅ 已完成 |

---

## 4. 风险与阻断因素

| 风险 | 影响 | 缓解措施 | 当前状态 |
|------|------|---------|-----------|
| 直接移除 `TsWorldEngineAdapter` 导致本地开发无法启动（若无 Rust 工具链） | 高 | 已通过 sidecar binary path 优先 + `check:rust` / `build:rust` / CI 接线降低风险；开发态仍可用 cargo fallback，但不再有 TS world engine 兜底 | 🟡 持续观测开发环境体验 |
| `rust_primary` 模式存在未发现的边界 case | 高 | TS fallback 已标记为 @deprecated 并打印 warn；若发现边界 case，优先修复 Rust sidecar 而非回退到 TS | 🟡 持续观测，fallback 保留为最后手段 |
| `singleFlightStates` 全局状态在并发测试中污染 | 中 | 阶段二封装为注入服务后自然解决；在此之前保持 `fileParallelism: false` | ✅ 当前主路径已解决 |
| DTO 手动维护导致契约漂移 | 中 | 短期接受；长期引入 JSON Schema 或 protobuf 作为单一真相源 | ⚪ 仍待长期处理 |
| scheduler decision kernel Rust 化未完成 | 高 | 需先完成 Rust 实现，才能进入阶段三 | ❌ 此条已过期；当前默认已切为 `rust_primary`，应转为“持续观测 rust_primary 稳定性” |

---

## 5. 结论

本次评估共识别 **8 大类兼容性债务**。截至 2026-04-21，本轮“历史兼容债务收尾”实现与后续 legacy adapter 清理已完成以下关键工作：

- `world_engine` 配置已全量接线到 `WorldEngineSidecarClient`，`binary_path / timeout_ms / auto_restart` 真实生效；
- `WORLD_ENGINE_USE_SIDECAR` 已降级为 warning-only 的 deprecated compat 层，不再改变 world engine 有效行为；
- `WORLD_ENGINE_MODE` 与 `world_engine.mode` 已从 schema/runtime_config/snapshot 中移除；
- `WorldEngineStepCoordinator` 已完成 `AppContext` 注入化，正式运行路径不再依赖默认共享实例；
- `PackHostApi` / `simulation_loop` / host runtime 关键路径已不再静默 fallback 到 `context.sim`；
- `createLegacyTsWorldEngineAdapter` / `createTsWorldEngineAdapter` 已物理删除，`apps/server/src/index.ts` 已改为 sidecar-only world engine 启动装配；
- `check:rust` / `build:rust` 与 CI 接线已补齐，sidecar 构建治理从“运行时发现”升级为“CI 前置发现”；
- 与 legacy adapter 移除相关的受影响 unit/integration、lint 与 typecheck 已通过验证。

### 当前优先级判断

- **最高优先级**：world engine legacy adapter 清理已完成，不再是当前阻断。
- **中等优先级**：继续观察 `rust_primary` 默认模式在 scheduler / memory / world engine 周边的长期稳定性。
- **长期主题**：DTO 单一真相源、兼容标记字段清理、遗留 source adapter 彻底移除。

### 2026-04-23 补充更新

本轮进一步完成 scheduler / memory trigger 的 TS/shadow 模式清理：

- `ts` 与 `rust_shadow` 模式已从 config schema、provider factory、types、tests、call sites 中物理移除；
- 唯一有效模式为 `rust_primary`；TS 参考实现保留为 `@deprecated` private fallback，触发时打印 deprecation warning；
- `canonicalize` / `isCanonicalEqual` / `countOutputDiffs` / `getSchedulerDecisionKernelParityPreview` 已删除；
- `source_registry.ts` fallback 默认值从 `'ts'` 改为 `'rust_primary'`；
- `agent_scheduler.ts` / `memory_blocks.ts` 调用面不再传递 `mode` 参数；
- 相关 tests 已更新，typecheck / lint / unit tests / integration tests 已通过。

### 当前最关键的后续动作

1. ~~在 `docs/ARCH.md` 或 `docs/ENHANCEMENTS.md` 中更新 Rust 迁移状态矩阵~~ ✅ 已完成同步。
2. **继续审计 `default_step_contributor.ts` / `world_engine_contributors.ts` / plugin runtime contributor API**，判断它们是 sidecar host contract 还是仅为已删除 TS adapter 服务的遗留层。
3. **将本轮实现结果同步到项目级 progress / TODO 快照**，保持文档与代码状态一致。
