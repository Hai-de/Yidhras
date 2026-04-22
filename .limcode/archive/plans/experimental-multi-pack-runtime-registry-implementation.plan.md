<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/experimental-multi-pack-runtime-registry-design.md","contentHash":"sha256:438736ec03f6f2a04049d0112517fea31180cfb9f94084e2ebd0103e250d8d14"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 建立 experimental multi-pack runtime registry 基础：feature flag、runtime config、PackRuntimeRegistry / PackRuntimeHandle / PackRuntimeHost 骨架  `#phase5a-runtime-registry-foundation`
- [x] 落 pack-local 隔离基础：clock、runtime speed、scheduler scope、startup/health 模型与 `(pack_id, partition_id)` 调度作用域  `#phase5b-pack-local-isolation`
- [x] 提供 experimental operator/test-only API：pack runtime load/unload/list/status/clock/scheduler 观察面  `#phase5c-experimental-operator-api`
- [x] 补 pack-local plugin runtime / projection / route scope 兼容层，确保不破坏当前单 active-pack 稳定 contract  `#phase5d-plugin-projection-compat`
- [x] 补实验性测试、文档与启用说明，明确默认关闭、风险边界与试用反馈路径  `#phase5e-tests-docs-rollout`
<!-- LIMCODE_TODO_LIST_END -->

# 实验性 Multi-Pack Runtime Registry 实施计划

## 0. 来源设计

- 本计划基于已确认设计：`.limcode/design/experimental-multi-pack-runtime-registry-design.md`
- 本轮目标不是把系统直接升级为默认多世界包平台，而是引入 **默认关闭、operator / test-only 的 experimental multi-pack runtime registry**。
- 当前单 active-pack 模式继续作为稳定模式；任何 multi-pack 能力都必须在不破坏稳定 contract 的前提下旁路引入。

## 1. 实施目标

本轮计划需要达成以下结果：

1. 后端具备一个实验性的 `PackRuntimeRegistry` 能力，而不是继续把多 pack 逻辑堆进 `SimulationManager`；
2. 每个 pack 拥有独立的 runtime handle，至少能表达：clock、runtime speed、scheduler、health、plugin runtime、projection scope；
3. multi-pack 运行模式通过 feature flag 和 runtime config 显式开启，默认关闭；
4. 提供一组 experimental operator/test-only API，用于：
   - list loaded packs
   - load/unload pack runtime
   - read per-pack status / clock / scheduler snapshot
5. 在 experimental 模式下明确 pack-local 隔离边界，尤其是：
   - `(pack_id, partition_id)` 调度作用域
   - per-pack health
   - plugin runtime scope
   - projection / route scope
6. 不破坏当前稳定 API 与单 active-pack 前提：
   - `/api/status`
   - `/api/packs/:packId/overview`
   - `/api/packs/:packId/projections/timeline`
   - `PACK_ROUTE_ACTIVE_PACK_MISMATCH`

## 2. 约束与原则

### 2.1 稳定模式优先

- 单 active-pack 仍是稳定模式；
- experimental multi-pack 默认关闭；
- 未开启实验开关时，系统行为必须与当前版本保持一致；
- 现有前端主导航、主业务页面、稳定 API contract 不应被第五阶段强制重构。

### 2.2 不继续膨胀 `SimulationManager`

- 不把 `SimulationManager` 直接改成“大一统多 pack 容器”；
- multi-pack 生命周期与 pack-local 运行状态，应下沉到新的 registry / host 模型；
- `SimulationManager` 可以保留为单 pack 兼容 facade，或 stable active-pack facade。

### 2.3 experimental API 与 stable API 分层

- stable API 保持现状；
- multi-pack 先走 `/api/experimental/...` 路线；
- experimental 返回值与行为在试验期允许演进，不承诺稳定；
- operator/test-only 面优先，用户主调用面延后。

### 2.4 先隔离，再扩散

实施顺序应遵循：

1. 先建立 registry 与 runtime handle；
2. 先明确 pack-local isolation；
3. 再提供 operator API；
4. 最后再评估前端实验页与更宽泛的 contract 扩展。

## 3. 代码范围与主要落点

### 3.1 核心后端文件

预计主要涉及：

- `apps/server/src/core/simulation.ts`
- `apps/server/src/app/context.ts`
- `apps/server/src/app/services/system.ts`
- `apps/server/src/app/create_app.ts`
- `apps/server/src/app/runtime/startup.ts`
- `apps/server/src/app/runtime/scheduler_lease.ts`
- `apps/server/src/app/runtime/scheduler_ownership.ts`
- `apps/server/src/app/runtime/agent_scheduler.ts`
- `apps/server/src/plugins/runtime.ts`
- `apps/server/src/packs/runtime/projections/active_pack_projection_guard.ts`
- `apps/server/src/config/schema.ts`
- `apps/server/src/config/runtime_config.ts`

### 3.2 建议新增模块

建议新增并保持职责清晰：

- `apps/server/src/core/pack_runtime_registry.ts`
- `apps/server/src/core/pack_runtime_host.ts`
- `apps/server/src/core/pack_runtime_handle.ts`
- `apps/server/src/core/pack_runtime_health.ts`
- `apps/server/src/app/services/experimental_multi_pack_runtime.ts`
- `apps/server/src/app/runtime/multi_pack_scheduler_scope.ts`

如果最终命名调整，也应保持以下职责边界：

- registry：生命周期与全局索引
- host：pack-local runtime 宿主
- handle：对外只读句柄 / service contract
- experimental service：operator API 所需 read/write 面

### 3.3 测试与文档范围

预计涉及：

- `apps/server/tests/unit/**`
- `apps/server/tests/integration/**`
- `docs/ARCH.md`
- `docs/API.md`
- `docs/capabilities/PLUGIN_RUNTIME.md`
- `docs/guides/COMMANDS.md`
- `docs/guides/DB_OPERATIONS.md`
- 如有需要，补 experimental feature 使用说明

## 4. 分阶段实施

## Phase 5A：runtime registry 基础骨架

### 4.1 A1 — runtime config 与 feature flag 收口

目标：先把 experimental multi-pack 变成正式可控的 host policy。

实施内容：

1. 在 runtime config 中新增 experimental multi-pack 开关与基础参数，例如：
   - `features.experimental.multi_pack_runtime.enabled`
   - `features.experimental.multi_pack_runtime.operator_api_enabled`
   - `features.experimental.multi_pack_runtime.ui_enabled`
   - `runtime.multi_pack.max_loaded_packs`
   - `runtime.multi_pack.start_mode`
   - `runtime.multi_pack.bootstrap_packs`
2. 保守默认值：
   - 全部关闭；
   - `start_mode=manual`；
   - `bootstrap_packs=[]`
3. 提供 env / yaml override 与 runtime snapshot 展示。

完成标准：

- 未显式开启时，系统行为不变；
- experimental 模式的入口参数都可观测、可配置、可测试。

### 4.2 A2 — 建立 registry / host / handle 类型骨架

目标：先把运行时结构立起来。

实施内容：

1. 定义 `PackRuntimeRegistry` 接口与最小实现；
2. 定义 `PackRuntimeHandle` 的只读 contract；
3. 定义 `PackRuntimeHost` 的生命周期 contract：
   - load
   - start
   - stop
   - dispose
4. 为单 pack 模式保留兼容 facade，不强迫当前调用方一次性迁移。

完成标准：

- 代码中已经存在新的 multi-pack runtime abstraction；
- 没有把全部逻辑重新塞回 `SimulationManager`。

### 4.3 A3 — registry 生命周期与容量限制

目标：让 experimental runtime 可以安全管理多个 pack。

实施内容：

1. 支持：
   - list loaded packs
   - lookup by packId
   - load pack runtime
   - unload pack runtime
2. 加入 `max_loaded_packs` 防线；
3. 明确重复 load / unload 不存在 pack 的行为；
4. 为 operator 侧返回明确错误与状态码。

完成标准：

- registry 能管理多个 pack runtime；
- 有基础容量保护；
- 生命周期操作具备清晰错误语义。

## Phase 5B：pack-local 隔离基础

### 4.4 B1 — pack-local clock 与 runtime speed

目标：建立每个 pack 的独立时间语义。

实施内容：

1. 把 clock 从全局唯一 active-pack 思路抽离成 pack-local；
2. 每个 `PackRuntimeHost` 持有独立：
   - `ChronosEngine`
   - runtime speed policy
   - pause/resume state
3. 保留 stable active-pack facade 对当前默认 pack 的兼容映射。

完成标准：

- 多个 pack 可以各自维护时间；
- 单 pack 兼容路径不受影响。

### 4.5 B2 — scheduler scope 升级为 `(pack_id, partition_id)`

目标：避免多 pack 共用全局 partition 造成调度污染。

实施内容：

1. 梳理并改造以下对象的作用域：
   - lease
   - cursor
   - ownership
   - worker runtime state
   - rebalance recommendation
   - migration backlog
2. 定义 pack-scoped scheduler key 规则；
3. 保持单 pack 模式下原有行为兼容。

完成标准：

- scheduler 不再只依赖裸 `partition_id`；
- pack A/B 的 scheduler state 不会互相覆盖。

### 4.6 B3 — startup / health 模型拆层

目标：从“系统 + 一个当前 pack”升级为“系统 + 多个 pack runtime”。

实施内容：

1. 区分：
   - system health
   - per-pack runtime health
2. 为 experimental API 提供 per-pack health 视图；
3. 保持 `/api/status` 的 stable contract 不变。

完成标准：

- experimental 模式下可以区分 system health 与某个 pack runtime 的健康状态；
- 旧 `/api/status` 不被破坏。

## Phase 5C：experimental operator / test-only API

### 4.7 C1 — runtime registry operator API

目标：让试验用户能操作 runtime registry。

实施内容：

1. 新增 experimental 路由：
   - `GET /api/experimental/runtime/packs`
   - `POST /api/experimental/runtime/packs/:packId/load`
   - `POST /api/experimental/runtime/packs/:packId/unload`
2. 明确只在 feature flag 打开时可用；
3. 失败时返回清晰 experimental 错误码。

完成标准：

- operator / test-only 用户可以显式加载/卸载 pack runtime；
- 未开启 experimental 时，这些接口不可用。

### 4.8 C2 — per-pack 只读状态 API

目标：先观察，再逐步扩容能力面。

实施内容：

1. 新增 experimental 只读接口：
   - `GET /api/experimental/runtime/packs/:packId/status`
   - `GET /api/experimental/runtime/packs/:packId/clock`
   - `GET /api/experimental/runtime/packs/:packId/scheduler/*`
2. 返回 pack-local：
   - health
   - clock
   - runtime speed
   - scheduler summary / ownership / workers / runs
3. 保持这些接口与当前 stable operator/status 面分层。

完成标准：

- 实验用户可以按 pack 观测运行时；
- stable `/api/status` 与现有 scheduler surface 不被迫整体改造。

## Phase 5D：plugin runtime / projection / route scope 兼容层

### 4.9 D1 — plugin runtime pack-local 化

目标：先让 plugin runtime 不互相污染。

实施内容：

1. 梳理 plugin runtime manifest / route / cache 当前 active-pack 假设；
2. 为 experimental 模式增加 pack-local route namespace；
3. pack-local web manifest / asset host 明确以 `packId` 为 scope。

完成标准：

- pack A/B 插件运行时不会混用；
- 未开启 experimental 时仍走当前稳定路径。

### 4.10 D2 — projection / query scope 兼容层

目标：在不破坏 stable API 的前提下，提供 experimental per-pack 读面。

实施内容：

1. 保留 stable active-pack guard；
2. 为 experimental 模式提供显式 `packId` 只读 projection/query；
3. 不急于把 stable `/api/packs/:packId/overview` 改成任意 pack 查询。

完成标准：

- experimental 用户能按 pack 查询 runtime/projection；
- 当前 canonical API 仍保持稳定。

## Phase 5E：测试、文档与试运行策略

### 4.11 E1 — 测试补齐

目标：为 experimental runtime registry 建立基础回归面。

实施内容：

1. 单元测试覆盖：
   - feature flag / config
   - registry load/unload/list
   - per-pack handle contract
   - scheduler scope key 规则
2. 集成测试覆盖：
   - 同时 load 两个 pack
   - per-pack clock / scheduler 隔离
   - plugin/runtime status 不串用
   - stable active-pack API 在未开启 experimental 时行为不变

完成标准：

- 至少有一组最小但可信的 experimental 回归基线；
- 能证明未开启 experimental 时稳定模式未被破坏。

### 4.12 E2 — 文档与风险说明

目标：把“实验性、默认关闭、试用反馈”写清楚。

实施内容：

1. 更新 `ARCH.md`：说明 multi-pack 是 experimental runtime registry；
2. 更新 `API.md`：明确 stable API 与 experimental API 分层；
3. 更新 `PLUGIN_RUNTIME.md`：补充 pack-local runtime scope 说明；
4. 更新 `COMMANDS.md` / `DB_OPERATIONS.md`：补开关、容量限制、调优与试验说明；
5. 明确：
   - 默认关闭
   - operator / test-only
   - 需要试验用户反馈
   - 不承诺短期稳定 contract

完成标准：

- 文档与设计一致；
- 试验用户知道如何开启、观察、回退。

## 5. 验收标准

本计划完成后，应满足以下验收条件：

1. 当前单 active-pack 稳定模式保持不变；
2. multi-pack 只在显式 experimental 开关下可用；
3. 存在可管理多个 pack runtime 的 registry / host / handle 结构；
4. 每个 pack 至少具备独立 clock / runtime speed / scheduler scope / health 语义；
5. experimental operator API 可用于 load/unload/list/status/clock/scheduler 观察；
6. plugin runtime 与 projection/query 至少具备基础 pack-local 隔离路径；
7. stable API 与 experimental API 分层清晰；
8. 文档明确该能力仍为 experimental。

## 6. 风险与应对

### 6.1 把 experimental 做成默认模式

应对：

- feature flag 默认关闭；
- 未开启时不暴露 operator API；
- 不修改 stable contract。

### 6.2 `SimulationManager` 再次膨胀

应对：

- 通过 registry / host / handle 分层承接；
- `SimulationManager` 只做兼容 facade 或 stable path。

### 6.3 scheduler / plugin / projection scope 混乱

应对：

- 先定义 pack-local scope，再实现接口；
- 不在 scope 未明时大面积开放多 pack 查询。

### 6.4 前端被迫全栈返工

应对：

- 前端先只做 experimental 只读页；
- 不直接推进主导航与主工作区重构。

## 7. 实施顺序建议

推荐顺序：

1. **先做 feature flag 与 registry 骨架**；
2. **再做 pack-local clock / scheduler / health 隔离**；
3. **再开 experimental operator API**；
4. **再补 plugin runtime / projection 的兼容层**；
5. **最后补测试、文档与试运行说明**。

## 8. 计划完成后的下一步

本实验阶段完成后，再根据试验反馈决定：

- 是否继续保持 experimental；
- 是否升级为 beta；
- 是否需要把某些 read-only 能力纳入稳定 contract；
- 是否值得进入真正的平台 / 容器化路线。

在得到足够反馈前，不应把多世界包同时运行视为已成熟的默认系统能力。
