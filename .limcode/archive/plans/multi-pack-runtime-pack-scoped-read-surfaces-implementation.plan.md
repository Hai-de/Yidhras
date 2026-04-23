<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/multi-pack-runtime-本轮完善设计草案接口先行.md","contentHash":"sha256:25dd039bcb62ff2656382fba937a438899a0ac50894f6f005461e93d9c8678e0"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 冻结本轮 pack-scoped contracts：ProjectionMetadataResolver、ProjectionScopeAdapter、Narrative/Entity core service、Experimental runtime snapshot、PackScopedPluginRuntimeService、PackScopedInferenceContextBuilder internal contract  `#mpr-plan-p1`
- [x] 实现 projection pack-scope 核心层：将 narrative/entity overview 改为只依赖 `pack_id + pack metadata` 的 core service，不再直接读取 `activePack`  `#mpr-plan-p2`
- [x] 实现 stable/experimental scope adapter：统一 stable active-pack guard 与 experimental loaded-pack guard，供 projection/plugin/runtime routes 复用  `#mpr-plan-p3`
- [x] 增强 experimental runtime control-plane snapshot 与 `/api/experimental/runtime/packs*` 返回结构，补 active/loaded pack、health、clock、runtime speed、scheduler/plugin availability 摘要  `#mpr-plan-p4`
- [x] 收口 plugin runtime pack-local read surface：统一 stable/experimental web snapshot、asset resolve、refresh 路径到 pack-scoped service，并去掉不必要的 active-pack 反推  `#mpr-plan-p5`
- [x] 预留 inference/context internal pack-scope contract：引入 `buildInferenceContextForPack` / pack runtime contract resolver 接口或最小 adapter，不扩 public inference API  `#mpr-plan-p6`
- [x] 补齐 unit/integration tests：覆盖 stable/experimental scope、双 pack runtime 并存、projection 不串 pack、plugin runtime web/asset 不串 pack、stable `/api/status` 与 `/api/packs/:packId/*` 不回退  `#mpr-plan-p7`
- [x] 同步 ARCH/API/progress 等文档，明确本轮只强化 experimental read surfaces 与 internal contracts，不把 stable contract 升级为默认 multi-pack  `#mpr-plan-p8`
<!-- LIMCODE_TODO_LIST_END -->

# Multi-pack runtime 本轮完善实施计划

## 来源设计

- 设计文档：`.limcode/design/multi-pack-runtime-本轮完善设计草案接口先行.md`
- 本计划严格以该设计为准，遵循 **接口先行、稳定/实验分层、读面优先、执行链后置** 原则。

## 目标

在不破坏当前 **stable single active-pack** 合同的前提下，将当前 experimental multi-pack runtime 从“可 load/unload 的 registry”推进到“可被 operator / projection / plugin read surface 正式消费”的状态，并为下一轮 inference/workflow 扩展预留 internal contract。

本轮完成后应实现：

1. projection/read model 拥有真正的 **pack-scoped core service**；
2. experimental runtime operator 面拥有更完整的 **control-plane snapshot**；
3. plugin runtime web/read surface 拥有统一的 **pack-local contract**；
4. inference/context 拥有 **pack-scoped internal contract 入口**；
5. stable `/api/status`、stable `/api/packs/:packId/*`、`PACK_ROUTE_ACTIVE_PACK_MISMATCH` 保持不变。

## 非目标

本轮不做：

- 不把 `/api/status` 改成多 pack 数组；
- 不取消 stable active-pack guard；
- 不把 inference / workflow / action dispatch 主执行链路升级为 multi-pack；
- 不把 `SimulationManager` 继续扩张成 multi-pack 最终 owner；
- 不承诺 experimental API 短期冻结。

## 实施范围

### A. Projection / read model 收口

重点对象：

- `apps/server/src/packs/runtime/projections/narrative_projection_service.ts`
- `apps/server/src/packs/runtime/projections/entity_overview_service.ts`
- 相关 overview/operator 聚合服务
- `apps/server/src/packs/runtime/projections/active_pack_projection_guard.ts`

目标：

- 把现有 service 拆为：
  - **pack-scoped core service**：只收 `pack_id + pack metadata`
  - **scope adapter**：负责 stable/experimental 模式的 scope 判定
- 杜绝 core service 继续直接依赖 `context.sim.getActivePack()`。

### B. Experimental runtime control-plane snapshot

重点对象：

- `apps/server/src/app/services/experimental_multi_pack_runtime.ts`
- `apps/server/src/app/routes/experimental_runtime.ts`
- 必要时新增 `experimental_runtime_control_plane_service.ts`

目标：

- 增强 `/api/experimental/runtime/packs`
- 增强 `/api/experimental/runtime/packs/:packId/status`
- 统一返回 active/loaded pack、health、clock、runtime speed、scheduler/plugin availability 摘要
- 保持 operator/test-only 语义。

### C. Plugin runtime pack-local read surface

重点对象：

- `apps/server/src/app/services/plugin_runtime_web.ts`
- `apps/server/src/plugins/runtime.ts`
- `apps/server/src/app/services/plugins.ts`
- 必要时新增 `pack_scoped_plugin_runtime_service.ts`

目标：

- 统一 stable/experimental plugin runtime web snapshot 与 asset resolve 路径
- refresh 逻辑显式按 `packId` 驱动
- 减少 active-pack 反推
- 补齐双 pack 并存场景下的隔离护栏。

### D. Inference / context internal contract 预留

重点对象：

- `apps/server/src/inference/context_builder.ts`
- 必要时新增 `pack_scoped_inference_context_builder.ts`

目标：

- 冻结 `buildInferenceContextForPack(...)` / pack runtime contract resolver 的 internal contract
- 暂不对外开放新的稳定 API
- 不改变当前默认 active-pack inference 行为。

## 接口先行实施顺序

### Phase 1：冻结接口与适配边界

先定义并在代码中落接口/类型，而不是先散改实现：

- `PackProjectionMetadataSnapshot`
- `PackProjectionMetadataResolver`
- `PackNarrativeProjectionService`
- `PackEntityOverviewProjectionService`
- `PackProjectionScopeAdapter`
- `ExperimentalPackRuntimeSnapshot`
- `ExperimentalRuntimeControlPlaneSnapshot`
- `PackScopedPluginRuntimeService`
- `PackScopedInferenceContextBuilder`
- `PackRuntimeContractResolver`

验收要点：

- stable / experimental 的边界由 adapter 决定；
- core service 不直接依赖 active-pack；
- internal-only contract 与 public stable contract 明确分离。

### Phase 2：Projection pack-scope core service 落地

实施内容：

1. 从 narrative/entity overview 现有实现中抽出纯 core service；
2. metadata 统一由 resolver 提供；
3. stable route 继续走 active-pack guard；
4. experimental route 改走 loaded-pack guard；
5. 让 stable/experimental 共用相同 core implementation。

验收要点：

- experimental `/api/experimental/packs/:packId/overview` / timeline 不再依赖 active pack metadata；
- stable `/api/packs/:packId/*` 行为不变。

### Phase 3：Experimental operator snapshot 增强

实施内容：

1. 把 registry 列表提升为 control-plane snapshot；
2. 区分：
   - `active_pack_id`
   - `loaded_pack_ids`
   - per-pack runtime health
   - runtime speed / clock
   - scheduler availability
   - plugin runtime availability
3. 将 `/packs/:packId/status` 统一为 per-pack runtime snapshot 子集。

验收要点：

- operator 能看懂 loaded pack 是否真正 ready；
- system health 与 pack runtime status 信息同时可见。

### Phase 4：Plugin runtime pack-local read surface 收口

实施内容：

1. 定义 pack-scoped plugin runtime service；
2. 统一 stable/experimental web snapshot 获取路径；
3. 统一 asset resolve 路径；
4. refresh 逻辑经 lookup/scope 决定，而不是默认 active pack；
5. 校验 route scope mismatch 语义未回退。

验收要点：

- 双 pack 并存下 plugin runtime snapshot 不串；
- asset path / installation scope 不串；
- stable 行为不变。

### Phase 5：Inference/context internal contract 预留

实施内容：

1. 引入 pack-scoped inference context builder interface；
2. 抽出 pack runtime contract resolver；
3. 允许 future experimental loaded pack 构造 context contract；
4. 当前 stable inference 仍默认 active pack。

验收要点：

- internal contract 已固化；
- 不新增 public inference API；
- 不改变现有 inference 行为。

### Phase 6：测试与文档同步

实施内容：

#### Unit tests

- scope adapter：stable success/mismatch、experimental loaded/unloaded
- projection core service：无需 activePack 亦可工作
- control-plane snapshot：active + loaded pack 混合场景
- plugin runtime scoped service：stable/experimental 双模式
- inference/context internal contract：最小 builder/adapter contract

#### Integration tests

- 同时 load 两个 pack runtime
- `/api/experimental/runtime/packs` 正确返回 active + loaded packs
- experimental overview / timeline 不串 pack
- experimental plugin runtime web snapshot / asset 不串 pack
- stable `/api/packs/:packId/*` 仍要求 active-pack
- stable `/api/status` 不变

#### 文档同步

- `docs/ARCH.md`
- `docs/API.md`
- `.limcode/progress.md`
- 如有必要补 capability 文档中的 multi-pack 说明

验收要点：

- 本轮设计与实现口径一致；
- stable contract 不被误写成默认 multi-pack；
- progress 明确本轮只强化 experimental read surfaces 与 internal contracts。

## 文件级改动建议

### 优先新增/重构模块

建议新增或拆出以下模块，以避免继续在 route/service 内混写：

- `apps/server/src/packs/runtime/projections/pack_projection_scope_adapter.ts`
- `apps/server/src/packs/runtime/projections/pack_projection_metadata_resolver.ts`
- `apps/server/src/packs/runtime/projections/pack_narrative_projection_service.ts`
- `apps/server/src/packs/runtime/projections/pack_entity_overview_projection_service.ts`
- `apps/server/src/app/services/experimental_runtime_control_plane_service.ts`
- `apps/server/src/app/services/pack_scoped_plugin_runtime_service.ts`
- `apps/server/src/inference/pack_scoped_inference_context_builder.ts`

### 重点受影响文件

- `apps/server/src/packs/runtime/projections/narrative_projection_service.ts`
- `apps/server/src/packs/runtime/projections/entity_overview_service.ts`
- `apps/server/src/packs/runtime/projections/active_pack_projection_guard.ts`
- `apps/server/src/app/routes/experimental_runtime.ts`
- `apps/server/src/app/services/experimental_multi_pack_runtime.ts`
- `apps/server/src/app/services/plugin_runtime_web.ts`
- `apps/server/src/plugins/runtime.ts`
- `apps/server/src/app/services/plugins.ts`
- `apps/server/src/inference/context_builder.ts`
- `apps/server/src/app/services/system.ts`

## 风险与控制

### 风险 1：stable / experimental 逻辑继续混杂

控制：

- route 层禁止直接拼 guard + metadata + core service
- 强制先走 scope adapter

### 风险 2：projection core service 偷偷继续读 activePack

控制：

- core service 只接收 `pack_id + pack metadata`
- review / tests 明确覆盖“无 activePack 依赖”

### 风险 3：plugin runtime 在双 pack 场景下仍串用

控制：

- integration tests 明确覆盖：
  - runtime web snapshot
  - asset resolve
  - route scope mismatch

### 风险 4：范围膨胀到执行链 multi-pack 化

控制：

- inference/context 只冻结 internal contract
- 不动 public run/workflow/action dispatch API

## 验收标准

本计划完成后，必须满足：

1. experimental multi-pack runtime 不再只是 load/unload registry；
2. narrative/entity overview 等 read surface 已具备 pack-scoped core service；
3. experimental operator API 能返回更完整的 per-pack runtime snapshot；
4. plugin runtime web/read surface 具备明确 pack-local contract 与测试护栏；
5. stable `/api/status`、stable `/api/packs/:packId/*`、`PACK_ROUTE_ACTIVE_PACK_MISMATCH` 不被破坏；
6. inference/context 的 pack-scoped internal contract 已预留，为下一轮执行链扩展做准备。

## 完成后下一步

完成本轮后，再根据试运行结果决定是否推进：

1. pack-scoped inference run
2. pack-scoped workflow execution
3. pack-scoped action dispatch / invocation path
4. experimental UI inspector / pack selector
5. 部分 experimental read surface 是否具备进入 stable contract 的条件
