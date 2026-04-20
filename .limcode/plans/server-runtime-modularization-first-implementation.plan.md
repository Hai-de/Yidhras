<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/server-runtime-modularization-first-boundary-design.md","contentHash":"sha256:abf83baca6064b9f36517ed6cad341167579ac62108bbf2cba42aaea06871afc"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 冻结模块边界与接口命名：补 PackRuntimeLocator / PackRuntimeControl / PackRuntimeObservation / RuntimeKernelFacade / PackRuntimeLookupPort 等契约草案，并明确迁移守则（新代码禁止扩张 context.sim）  `#plan-m1-boundary-freeze`
- [x] 拆出 PackRuntimeRegistryService 与 ActivePackRuntimeFacade，让 SimulationManager 收缩为 thin facade，同时保持 stable single active-pack contract 不变  `#plan-m2-runtime-registry-active-pack`
- [x] 拆出 RuntimeDatabaseBootstrap 与 PackCatalogService，收口 SimulationManager 的数据库准备与 pack catalog 职责，并补最小单测  `#plan-m2-simulation-bootstrap-catalog`
- [x] 为 AppContext 增加窄接口入口（runtimeBootstrap / activePackRuntime / packCatalog / packRuntimeLocator / runtimeKernel / pluginHost 等），并开始把上层 service/route 从 context.sim 迁移出去  `#plan-m3-app-context-migration`
- [x] 实现 PackScopeResolver 与 PackRuntimeLookupPort，收口 plugin runtime web / projection / asset resolve 对 pack runtime 的依赖，移除对 runtime internal object 的直接绑定  `#plan-m4-plugin-scope-resolver`
- [x] 补 ContextAssemblyPort 与 MemoryRuntimePort，统一 workflow / scheduler / plugin runtime 的 context/memory 读取路径  `#plan-m5-context-memory-ports`
- [x] 补 RuntimeKernelFacade、SchedulerObservationPort、SchedulerControlPort，并收口 operator/read-model 对 scheduler/runtime loop 的访问面  `#plan-m5-runtime-kernel-ports`
- [x] 补 unit/integration/e2e 回归测试与文档同步（ARCH.md、PLUGIN_RUNTIME.md），验证 stable contract 不回退且为后续 Rust world engine 预留 Host API 边界  `#plan-m6-regression-doc-sync`
<!-- LIMCODE_TODO_LIST_END -->

# server runtime 模块化优先边界收口实施计划

## 概述

本计划基于已确认设计《server runtime 模块化优先边界收口设计》，目标是在**不改变当前稳定 single active-pack contract** 的前提下，先完成 Node/TS 宿主内的 runtime 模块边界收口，再为后续 Rust world engine 演进预留稳定接口。

## 设计来源

- 源设计文档：`.limcode/design/server-runtime-modularization-first-boundary-design.md`
- 本计划严格以该设计中的模块职责、依赖方向、非目标与分阶段路线为准。

## 目标

1. 拆分 `SimulationManager`，避免其继续承担组合根、runtime kernel、pack runtime、catalog、query 等混合职责。
2. 把 `AppContext` 从暴露 `sim` 的超级入口，演进为受限依赖注入容器。
3. 为 pack runtime、runtime kernel、plugin host、context/memory 建立正式 port/facade。
4. 收口 plugin host 对 pack runtime 的依赖面，避免继续依赖 TS 内部对象。
5. 在保持 stable canonical routes/stable active-pack guard 不变的前提下，为未来 Rust world engine 预留 Host API 边界。

## 非目标

1. 不在本计划内推进 Rust FFI / sidecar / RPC 集成实现。
2. 不把默认 runtime model 切换为 multi-pack。
3. 不重写 scheduler 核心调度算法、plugin runtime 核心语义或 workflow 语义。
4. 不做一次性的大规模目录搬迁。
5. 不修改稳定 API 的 canonical 语义，只做边界收口与依赖治理。

## 实施策略

采用**小步重构 + 兼容 facade 过渡**：

- 先定义接口与迁移守则；
- 再拆 `SimulationManager` 的职责；
- 再逐步把上层依赖从 `context.sim` 迁出；
- 然后收口 plugin host 与 runtime kernel / context-memory 的正式接口；
- 最后做回归测试与文档同步。

整个过程要求：

- stable single active-pack 行为不变；
- experimental multi-pack 仍保持 default-off / experimental / operator/test-only；
- 新增代码不继续扩大 `SimulationManager` 与 `context.sim` 的职责面。

---

## Phase M1：边界冻结与接口命名落地

### 目标

将设计中的边界和接口转化为代码层的可实施契约，建立后续拆分的护栏。

### 主要任务

1. 明确并落地接口命名：
   - `PackRuntimeLocator`
   - `PackRuntimeControl`
   - `PackRuntimeObservation`
   - `RuntimeKernelFacade`
   - `SchedulerObservationPort`
   - `SchedulerControlPort`
   - `ContextAssemblyPort`
   - `MemoryRuntimePort`
   - `PackRuntimeLookupPort`
   - `PackScopeResolver`
2. 明确 `SimulationManager` 过渡期只允许保留兼容转发，不再新增职责。
3. 明确 `AppContext` 的迁移守则：
   - 新代码禁止新增 `context.sim.*` 扩张；
   - 优先从 operator/plugin/runtime 相关调用点开始迁移。
4. 记录 stable 与 experimental 边界：
   - stable active-pack guard 不解除；
   - experimental runtime lookup 不泄漏内部实现细节。

### 建议文件落点

- `apps/server/src/core/`：pack runtime 相关 port/interface
- `apps/server/src/app/`：runtime kernel / plugin host / context-memory facade 接口
- 先不强制目录搬迁，先让接口稳定下来

### 验收标准

- 接口命名与 owner 明确；
- 新增代码有统一迁移目标；
- 不再把新职责塞入 `SimulationManager`。

---

## Phase M2：拆分 `SimulationManager`

### 目标

将当前 `SimulationManager` 的混合职责拆成独立服务，并保留一个 thin facade 以降低迁移风险。

### M2A：提取 `RuntimeDatabaseBootstrap`

#### 拆分内容

从 `SimulationManager` 提取：

- `prepareDatabase()`
- `getSqliteRuntimePragmaSnapshot()`

#### 要求

- 对 SQLite runtime pragma 初始化行为保持现状；
- 现有日志、snapshot 语义、重复调用幂等性不变；
- `index.ts` 与其他启动流程可通过新对象访问数据库 bootstrap 能力。

#### 测试

- 单测覆盖 pragma apply 幂等性/缓存行为；
- 启动流程回归验证 snapshot 不回退。

### M2B：提取 `PackCatalogService`

#### 拆分内容

从 `SimulationManager` 提取：

- `listAvailablePacks()`
- `getPacksDir()`
- `resolvePackByIdOrFolder()`
- `findFolderNameByPackId()`

#### 要求

- pack folder 与 pack id 解析行为不变；
- active pack 快路径与磁盘 catalog fallback 保持一致；
- 为后续 plugin/projection/operator 的 scope 解析提供基础只读能力。

#### 测试

- packRef 解析单测；
- active pack / available packs / folder-name resolution 回归。

### M2C：提取 `PackRuntimeRegistryService`

#### 拆分内容

从 `SimulationManager` 提取：

- `getPackRuntimeRegistry()`
- `listLoadedPackRuntimeIds()`
- `getPackRuntimeHandle()`
- `registerPackRuntimeHost()` / `unregisterPackRuntimeHost()`
- `getExperimentalPackRuntimeStatusRecords()`
- `getPackRuntimeStatusSnapshot()`
- `loadExperimentalPackRuntime()`
- `unloadExperimentalPackRuntime()`

#### 要求

- 保持现有 `PackRuntimeRegistry` / `PackRuntimeHost` / `PackRuntimeHandle` 的语义；
- 保持 max loaded packs、active pack unload guard、experimental only 行为；
- 与 plugin runtime sync 的耦合保留在 service 层，而不是重新压回 `SimulationManager`。

#### 测试

- registry lookup/load/unload/status unit tests；
- experimental operator surface 相关 integration/e2e 回归。

### M2D：提取 `ActivePackRuntimeFacade`

#### 拆分内容

从 `SimulationManager` 提取：

- `init(packFolderName)`
- `getActivePack()`
- `resolvePackVariables()`
- `getStepTicks()` / `getRuntimeSpeedSnapshot()`
- `setRuntimeSpeedOverride()` / `clearRuntimeSpeedOverride()`
- `getCurrentTick()` / `getAllTimes()` / `step()`

#### 要求

- 继续作为 stable single active-pack facade；
- 与 stable canonical routes 的 contract 保持不变；
- 不把 experimental multi-pack 行为混入 active-pack stable facade。

#### 测试

- active pack init / tick / runtime speed / variable resolve 单测；
- stable clock/runtime/status 相关回归。

### M2E：保留 `SimulationManager` 为 thin facade

#### 要求

- 仅组合 `RuntimeDatabaseBootstrap`、`PackCatalogService`、`PackRuntimeRegistryService`、`ActivePackRuntimeFacade`；
- 新方法一律禁止继续加入；
- 后续迁移完成后可继续降级或删除。

### Phase M2 验收标准

- `SimulationManager` 已明显瘦身；
- 核心职责已有独立承载对象；
- 现有对外行为与测试结果保持一致。

---

## Phase M3：`AppContext` 去超级入口化

### 目标

让 `AppContext` 从“暴露大一统 sim 对象”演进为“受限依赖注入容器”。

### 主要任务

1. 在 `AppContext` 中新增窄接口字段，例如：
   - `runtimeBootstrap`
   - `activePackRuntime`
   - `packCatalog`
   - `packRuntimeLocator` / `packRuntimeRegistry`
   - `runtimeKernel`
   - `pluginHost`
   - `contextAssembly`
   - `memoryRuntime`
2. 保留 `sim` 作为过渡兼容层，但新代码禁止优先依赖它。
3. 从上层先迁移这些场景：
   - operator/read-model 服务
   - plugin runtime web / projection / experimental runtime service
   - startup/runtime orchestration 中明显属于独立模块的调用
4. 若可行，增加 review 规则或轻量 lint 守则，避免新增 `context.sim.*` 扩张。

### 迁移顺序建议

1. `experimental_multi_pack_runtime.ts`
2. `plugin_runtime_web.ts`
3. `index.ts` 启动装配处对 `sim` 的可替代访问
4. 其他 operator/read-model 服务

### 验收标准

- `AppContext` 中已存在新窄接口；
- 新代码优先经窄接口访问；
- `context.sim` 的新增扩张停止。

---

## Phase M4：收口 Plugin Host 对 Pack Runtime 的依赖

### 目标

让 plugin host 只依赖稳定 lookup port / scope resolver / Host API 预留契约，而不是 TS runtime internal objects。

### 主要任务

1. 实现 `PackRuntimeLookupPort`：
   - `getActivePackId()`
   - `hasPackRuntime(packId)`
   - `assertPackScope(packId, mode, feature)`
   - `getPackRuntimeSummary(packId)`
2. 实现 `PackScopeResolver`：
   - stable surface -> active-pack guard
   - experimental surface -> loaded runtime guard
   - 统一错误码、feature label、pack normalization 规则
3. 改造 plugin runtime 相关调用点：
   - `plugin_runtime_web.ts`
   - 相关 projection/runtime asset resolve 路径
   - 其他 pack scope 解析热点
4. 预留 `PackHostApi` 契约，但本阶段不要求完整实现 transport。

### 重点约束

- plugin host 不直接依赖 `SimulationManager`；
- plugin host 不依赖 `WorldPack` / `ChronosEngine` / `PackRuntimeHost` 内部结构；
- stable/experimental 现有行为不回退。

### 测试

- stable/external pack scope resolve 单测；
- plugin runtime web snapshot/asset resolve integration 回归；
- experimental runtime not found / active-pack mismatch 等错误路径回归。

### 验收标准

- plugin host 依赖面已收口；
- 更换 pack runtime 实现时，plugin host 不需要理解内部对象。

---

## Phase M5：补 Runtime Kernel 与 Context/Memory 正式接口

### M5A：Runtime Kernel Ports

#### 目标

把 scheduler / simulation loop / operator 读面统一到正式 facade/port，而不是分散函数直连。

#### 主要任务

1. 实现 `RuntimeKernelFacade`：
   - `start()`
   - `stop()`
   - `getLoopDiagnostics()`
   - `isRunning()`
   - `getHealthSnapshot()`
2. 实现 `SchedulerObservationPort`：
   - ownership snapshot
   - partition status
   - worker states
   - rebalance/operator diagnostics
3. 实现 `SchedulerControlPort`：
   - bootstrap reconcile
   - rebalance trigger
   - 未来 operator actions 预留
4. 将 operator/read-model 对 scheduler/runtime loop 的访问逐步经上述 port 收口。

#### 验收标准

- scheduler 作为 runtime kernel 的归属在代码结构上明确；
- 上层不再散读 runtime kernel internal functions。

### M5B：Context / Memory Ports

#### 目标

为 workflow / scheduler / plugin runtime 提供统一上下文与内存读取面。

#### 主要任务

1. 实现 `ContextAssemblyPort`：
   - `buildPromptVariableContext(...)`
   - `buildRuntimeContext(...)`
   - `buildPackScopedContext(...)`
2. 实现 `MemoryRuntimePort`：
   - `queryOverlayEntries(...)`
   - `listMemoryBlocks(...)`
   - `getMemoryRuntimeSnapshot(...)`
3. 收敛散落的 context/memory helper 使用路径，减少各处 ad-hoc 拼装。

#### 验收标准

- workflow / scheduler / plugin runtime 的上下文读取路径更统一；
- context/memory 的 owner 与调用面明确。

---

## Phase M6：测试回归与文档同步

### 测试策略

#### Unit

- `RuntimeDatabaseBootstrap`
- `PackCatalogService`
- `PackRuntimeRegistryService`
- `ActivePackRuntimeFacade`
- `PackScopeResolver`
- runtime kernel/context-memory ports 的最小契约测试

#### Integration

- startup/init 行为未回退
- experimental runtime load/unload/status 行为不变
- scheduler/operator 观察面通过新 port 读取
- plugin runtime web/projection/asset scope 解析不回退

#### E2E

- stable active-pack 路由仍保持 canonical contract
- experimental operator/test-only surface 仍 default-off
- plugin runtime surface 在 stable/experimental 模式下行为一致且错误码稳定

### 文档同步

1. 更新 `docs/ARCH.md`
   - 明确 Rust 演进只指向 world engine / pack runtime 边界；
   - scheduler / plugin host / workflow host 继续留在 Node/TS。
2. 更新 `docs/capabilities/PLUGIN_RUNTIME.md`
   - 明确 plugin runtime 由 Node/TS host 承接；
   - 与 pack runtime 通过 lookup port / scope resolver / Host API 交互。
3. 如有必要，在 `.limcode/progress.md` 中记录本阶段里程碑与风险。

### 验收标准

- 测试矩阵覆盖关键回归面；
- 架构文档与实现边界一致。

---

## 依赖与实施顺序总结

建议严格按以下顺序推进：

1. **M1 边界冻结**
2. **M2 拆 SimulationManager**
3. **M3 AppContext 去超级入口化**
4. **M4 Plugin Host 依赖收口**
5. **M5 Runtime Kernel / Context-Memory ports**
6. **M6 回归测试与文档同步**

原因：

- M2 是最大收益、最低业务风险的切入口；
- M3 为全面迁移提供注入位；
- M4 是未来 Rust world engine 前最关键的边界治理；
- M5 则是在前面边界收口后，把剩余 runtime surfaces 正式化。

---

## 风险控制

### 风险 1：重构面过大导致行为漂移

- 采用 thin facade 过渡；
- 每拆出一个组件就补最小单测；
- 优先维持行为等价，不在拆分阶段顺带改业务语义。

### 风险 2：stable contract 被 experimental surface 拖动

- stable active-pack facade 与 experimental runtime registry service 分离；
- 所有 stable canonical route 回归必须保留。

### 风险 3：`context.sim` 又被继续扩张

- 评审中明确禁止；
- 新接口先进入 `AppContext`，给后续调用提供替代路径。

### 风险 4：plugin host 继续耦合 internal objects

- 在 M4 优先完成 lookup port / scope resolver；
- 不允许新增对 `getPackRuntimeHandle()` 等 internal access 的直接耦合路径。

### 风险 5：目录迁移噪音过大

- 本计划先做接口与职责收口，不强求立即迁目录；
- 目录优化放到边界稳定之后再做。

---

## 完成定义 / Done Definition

当以下条件满足时，本计划可视为完成：

1. `SimulationManager` 已收缩为 thin facade 或已接近可删除状态；
2. `AppContext` 已具备正式窄接口，且新代码不再扩张 `context.sim`；
3. plugin host 通过 `PackRuntimeLookupPort` / `PackScopeResolver` 访问 pack runtime；
4. runtime kernel 与 context/memory 至少已有正式 facade/port 可供上层依赖；
5. stable single active-pack contract 保持不变；
6. 文档明确 Rust 后续只替换 pack runtime/world engine，不扩大到 plugin host / scheduler / workflow host；
7. unit/integration/e2e 关键回归通过。

---

## 实施后建议的下一步

本计划完成后，再进入下一轮决策：

1. 是否开始 world engine 的 Rust 最小替换面设计；
2. 选择 FFI / sidecar / RPC 中哪一种集成路径；
3. 定义 `PackHostApi` 的首批可执行 contract。

在本计划执行完成前，不建议提前推进 Rust 内核接入实现。
