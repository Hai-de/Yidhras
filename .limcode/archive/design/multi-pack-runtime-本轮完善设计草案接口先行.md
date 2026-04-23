# Multi-pack runtime 本轮完善设计草案（接口先行）

## 1. 背景

当前项目已经具备 experimental multi-pack runtime 的基础骨架：

- runtime config / feature gate 已存在；
- `PackRuntimeRegistry / PackRuntimeHandle / PackRuntimeHost` 基础抽象已存在；
- experimental runtime operator API 第一版已存在；
- scheduler `(pack_id, partition_id)` pack-scoped scope 已存在；
- plugin runtime 已开始支持按 `packId` 的实验路径同步与 web surface。

但当前 multi-pack 仍停留在：

> **“能 load/unload 的 runtime registry”**

而尚未真正进入：

> **“可被 operator 消费、可被 projection/插件读面稳定消费、并且 pack-scope 清晰可验证的 experimental runtime”**

当前最明显的未收口问题包括：

1. narrative/entity overview 等 projection service 仍深度依赖 `activePack`；
2. inference/context contract 仍默认从 active-pack 读取 pack contract；
3. plugin runtime 虽已 pack-local 化一部分，但 route/context/测试护栏还不够彻底；
4. operator status 仍偏“registry 列表”，不够像完整的 per-pack runtime snapshot；
5. 大量消费面仍直接使用 `context.sim.getActivePack()` / `context.sim.getCurrentTick()`，而不是 pack-scope port。

因此，本轮不应继续扩大 registry 骨架，而应进入：

> **Phase 5C/5D 风格的消费面收口：pack-scoped projection / operator / plugin read surface。**

---

## 2. 本轮设计定位

本轮定位为：

> **在保持 stable single active-pack contract 不变的前提下，先把 experimental multi-pack runtime 的读面和隔离面做实。**

### 2.1 核心策略

- **接口先行**：先定义 pack-scoped contracts，再调整实现；
- **稳定/实验分层**：stable API 不破坏，experimental API 单独演进；
- **读面优先**：先收口 projection / operator / plugin read surface，不直接扩展到 inference run / workflow execution / action dispatch 主链；
- **pack-scope 明确化**：避免内部继续通过 active-pack 假设隐式决定 pack；
- **不扩张 `SimulationManager`**：继续通过 lookup / observation / control / scope resolver 等 port 演进。

---

## 3. 本轮目标

### 3.1 目标

本轮完成后，应达到：

1. narrative / entity overview / related projection service 具备 **真正 pack-scoped core service**；
2. experimental operator API 能返回 **更完整的 per-pack runtime snapshot**，而不是仅 registry 基础信息；
3. plugin runtime web surface / route scope / runtime snapshot 具备更明确的 **pack-local 隔离 contract**；
4. 为 inference/context 下一轮 multi-pack 化预留 **pack-scoped internal contract**，但不直接进入稳定对外 API；
5. 新实现优先依赖正式接口：
   - `PackRuntimeLookupPort`
   - `PackRuntimeObservation`
   - `PackRuntimeControl`
   - `PackScopeResolver`
   - 新增的 projection/operator/plugin pack-scope service contract
6. 补齐回归测试，证明：
   - experimental pack A/B 的读面不串；
   - stable active-pack contract 不回退。

### 3.2 非目标

本轮**不**做：

1. 不把 stable `/api/status` 改成多 pack 数组；
2. 不取消 stable `/api/packs/:packId/*` 的 active-pack guard；
3. 不直接把 inference / workflow / action dispatch 主执行链路 multi-pack 化；
4. 不把 `SimulationManager` 改造成新的万能 multi-pack owner；
5. 不承诺 experimental API 短期稳定冻结。

---

## 4. 设计原则：接口先行

## 4.1 为什么本轮要接口先行

当前问题不是“没有代码”，而是“已有代码仍沿用 single active-pack 假设”。

如果直接逐文件改实现，很容易出现：

- stable / experimental 逻辑混杂；
- projection service 一半走 active-pack，一半走 packId；
- plugin runtime 读面、route scope、web asset scope 的边界继续漂移；
- 下一轮 inference/context 接入时又要重拆一次。

因此本轮必须先冻结：

- 哪些服务是 **pack-scoped core service**；
- 哪些 route 是 **stable scope adapter**；
- 哪些 route 是 **experimental scope adapter**；
- 哪些能力只是 **internal contract**，暂不开放稳定 API。

### 4.2 本轮接口优先级

按优先级冻结以下合同：

1. **Projection contracts**
2. **Experimental operator snapshot contracts**
3. **Plugin runtime pack-scope contracts**
4. **Inference/context internal pack-scope contracts**

---

## 5. 本轮范围与模块分解

## 5.1 范围一：Projection / Read Model pack-scope 化

### 当前问题

当前下列服务本质仍依赖 active-pack：

- `narrative_projection_service.ts`
- `entity_overview_service.ts`
- 相关 overview/operator 聚合服务

表现为：

- metadata 从 `activePack` 读取；
- service 内部直接调用 stable active-pack guard；
- experimental route 只是绕路，不是真正复用同一个 pack-scoped core。

### 本轮目标

将 projection 相关逻辑拆成两层：

#### 层 A：Pack-scoped core service

输入必须显式带：

- `pack_id`
- `pack metadata`
- `scope mode`（仅内部可见时可选）

输出不得依赖 `context.sim.getActivePack()`。

#### 层 B：Scope adapter

- stable adapter：继续要求 `packId === active pack`
- experimental adapter：要求 `packId` 已进入 runtime registry

这样可以保证：

- stable contract 不变；
- experimental route 不复制核心逻辑；
- 后续若有更多 pack-scoped projection，可直接复用。

---

## 5.2 范围二：Experimental operator runtime snapshot 增强

### 当前问题

当前 `/api/experimental/runtime/packs` 与 `/status` 更像“registry 基础列表”，但不足以支撑实际 operator 试用。

缺少的典型信息包括：

- active vs experimental loaded 的关系
- per-pack runtime readiness
- per-pack plugin runtime presence
- scheduler summary presence
- health / clock / speed 的统一结构
- 更明确的 system health 与 pack runtime health 分层

### 本轮目标

增强 operator 读面，使其更接近：

> “一个 experimental runtime control plane 快照”

但仍保持只读、operator/test-only。

---

## 5.3 范围三：Plugin runtime pack-local read surface 收口

### 当前问题

plugin runtime 已具备：

- `refreshPackPluginRuntime(context, packId)`
- `syncExperimentalPackPluginRuntime(context, packId)`
- stable / experimental 两套 runtime web snapshot / asset 路径

但仍存在问题：

- 部分调用仍从 `activePack` 推导；
- route scope 与 runtime state 隔离语义没有完全固化；
- 缺少多 pack 并存下的针对性测试矩阵。

### 本轮目标

把 plugin runtime 读面明确成：

- stable active-pack plugin runtime surface
- experimental loaded-pack plugin runtime surface

并确保：

- snapshot 不串用；
- asset path 不串用；
- route scope mismatch 有明确 contract；
- pack runtime refresh 逻辑通过 lookup/scope，而不是默认 active-pack。

---

## 5.4 范围四：Inference / Context internal contract 预留

### 当前问题

`inference/context_builder.ts` 仍默认：

- active pack runtime
- active pack tick
- active pack prompts / ai / invocation rules

这不适合作为后续 multi-pack inference 的基础。

### 本轮目标

本轮不开放新的 public inference API，但先冻结 internal contract：

- `buildInferenceContextForPack(...)` 的输入/输出语义
- pack-scoped pack runtime contract 构造方式
- pack-scoped tick / prompts / ai / invocation rules 读取方式

目的是让下一轮 inference/workflow 真正进入 multi-pack 时，不需要重新拆 contract。

---

## 6. 接口设计

# 6.1 Projection pack-scope 接口

## 6.1.1 PackProjectionMetadataResolver

```ts
export interface PackProjectionMetadataSnapshot {
  id: string;
  name: string;
  version: string;
}

export interface PackProjectionMetadataResolver {
  resolve(packId: string, mode: 'stable' | 'experimental'): Promise<PackProjectionMetadataSnapshot>;
}
```

### 语义

- stable：要求 packId 通过 active-pack guard；
- experimental：要求 packId 已 loaded；
- 返回 metadata snapshot，供 projection core service 使用；
- core service 不再自己碰 `context.sim.getActivePack()`。

---

## 6.1.2 PackNarrativeProjectionService

```ts
export interface GetPackNarrativeProjectionInput {
  pack_id: string;
  pack: PackProjectionMetadataSnapshot;
}

export interface PackNarrativeProjectionService {
  getProjection(input: GetPackNarrativeProjectionInput): Promise<PackNarrativeProjectionSnapshot>;
}
```

### 语义

- 这是纯 pack-scoped core service；
- 不负责 stable/experimental scope 判断；
- 只负责按 `pack_id` 构造 narrative timeline。

---

## 6.1.3 PackEntityOverviewProjectionService

```ts
export interface GetPackEntityOverviewProjectionInput {
  pack_id: string;
  pack: PackProjectionMetadataSnapshot;
}

export interface PackEntityOverviewProjectionService {
  getProjection(input: GetPackEntityOverviewProjectionInput): Promise<PackEntityProjectionSnapshot>;
}
```

### 语义

- 纯 pack-scoped core service；
- stable/experimental scope 在 adapter 层解决；
- 后续 experimental `/overview` 与 stable `/overview` 共用它。

---

## 6.1.4 Stable / Experimental Projection Scope Adapter

```ts
export interface PackProjectionScopeAdapter {
  resolveStablePack(packId: string, feature: string): Promise<{
    pack_id: string;
    pack: PackProjectionMetadataSnapshot;
  }>;

  resolveExperimentalPack(packId: string, feature: string): Promise<{
    pack_id: string;
    pack: PackProjectionMetadataSnapshot;
  }>;
}
```

### 语义

- stable 继续走 active-pack guard；
- experimental 继续走 loaded-pack guard；
- route 层只关心 adapter，不直接拼 guard + metadata + service。

---

# 6.2 Experimental operator snapshot 接口

## 6.2.1 ExperimentalPackRuntimeSnapshot

```ts
export interface ExperimentalPackRuntimeSnapshot {
  pack_id: string;
  mode: 'active' | 'experimental_loaded';
  runtime_ready: boolean;
  status: 'loaded' | 'running' | 'paused' | 'stopped' | 'failed';
  message: string | null;
  current_tick: string;
  runtime_speed: {
    step_ticks: string;
    overridden: boolean;
  };
  scheduler: {
    summary_available: boolean;
    ownership_available: boolean;
    workers_available: boolean;
    operator_available: boolean;
  };
  plugin_runtime: {
    installed_enabled_plugin_count: number | null;
    web_surface_available: boolean;
  };
}
```

### 语义

- 给 operator page / test-only consumer 使用；
- 不是 public stable contract；
- 目标是降低试运行时的“只知道 loaded，不知道状态是否可用”的问题。

---

## 6.2.2 ExperimentalRuntimeControlPlaneSnapshot

```ts
export interface ExperimentalRuntimeControlPlaneSnapshot {
  system_health_level: 'ok' | 'degraded' | 'fail';
  runtime_ready: boolean;
  active_pack_id: string | null;
  loaded_pack_ids: string[];
  items: ExperimentalPackRuntimeSnapshot[];
  startup_errors: string[];
}
```

### 语义

- 增强 `/api/experimental/runtime/packs`；
- 把 registry 列表提升为 control-plane snapshot；
- system health 与 per-pack runtime health 同时可见。

---

# 6.3 Plugin runtime pack-scope 接口

## 6.3.1 PluginRuntimeScopeMode

```ts
export type PluginRuntimeScopeMode = 'stable' | 'experimental';
```

---

## 6.3.2 PackScopedPluginRuntimeService

```ts
export interface GetPackPluginRuntimeSnapshotInput {
  pack_id: string;
  mode: PluginRuntimeScopeMode;
}

export interface ResolvePackPluginAssetInput {
  pack_id: string;
  plugin_id: string;
  installation_id: string;
  asset_path: string;
  mode: PluginRuntimeScopeMode;
}

export interface PackScopedPluginRuntimeService {
  getRuntimeWebSnapshot(input: GetPackPluginRuntimeSnapshotInput): Promise<ActivePackPluginRuntimeWebSnapshot>;
  resolveEnabledPluginWebAsset(input: ResolvePackPluginAssetInput): Promise<ResolvedPluginWebAsset>;
  refreshPackRuntime(packId: string): Promise<void>;
}
```

### 语义

- stable / experimental 只是在 scope adapter 上分流；
- 底层都按 `pack_id` 执行；
- refresh 不默认 active pack，而是显式 packId。

---

# 6.4 Inference / Context internal contract

## 6.4.1 PackScopedInferenceContextBuilder

```ts
export interface BuildInferenceContextForPackInput extends InferenceRequestInput {
  pack_id: string;
  mode: 'stable' | 'experimental';
}

export interface PackScopedInferenceContextBuilder {
  buildForPack(context: AppContext, input: BuildInferenceContextForPackInput): Promise<InferenceContext>;
}
```

### 语义

- internal only，本轮先不公开成稳定 API；
- 为下一轮 multi-pack inference/workflow 做 contract 预留；
- stable 调用未来可退化为：`pack_id = activePack`。

---

## 6.4.2 PackRuntimeContractResolver

```ts
export interface PackRuntimeContractResolver {
  resolvePackRuntimeContract(context: AppContext, input: {
    pack_id: string;
    mode: 'stable' | 'experimental';
  }): Promise<InferencePackRuntimeContract>;
}
```

### 语义

- 不再默认从 `context.sim.getActivePack()` 读取；
- 允许 future experimental loaded pack 构造 context contract。

---

## 7. Route 合同

# 7.1 保持不变的 stable routes

以下 stable routes 本轮不改 contract：

- `GET /api/status`
- `GET /api/packs/:packId/overview`
- `GET /api/packs/:packId/projections/timeline`
- stable plugin runtime web surfaces

并继续保证：

- `PACK_ROUTE_ACTIVE_PACK_MISMATCH` 成立；
- active-pack stable 模式不被 experimental 影响。

---

# 7.2 增强但不转正的 experimental routes

## 7.2.1 `GET /api/experimental/runtime/packs`

### 当前语义

- registry loaded pack list

### 本轮增强后语义

返回 `ExperimentalRuntimeControlPlaneSnapshot`：

```json
{
  "success": true,
  "data": {
    "system_health_level": "ok",
    "runtime_ready": true,
    "active_pack_id": "example_pack",
    "loaded_pack_ids": ["example_pack", "pack_b"],
    "items": [
      {
        "pack_id": "example_pack",
        "mode": "active",
        "runtime_ready": true,
        "status": "running",
        "message": null,
        "current_tick": "42",
        "runtime_speed": {
          "step_ticks": "1",
          "overridden": false
        },
        "scheduler": {
          "summary_available": true,
          "ownership_available": true,
          "workers_available": true,
          "operator_available": true
        },
        "plugin_runtime": {
          "installed_enabled_plugin_count": 2,
          "web_surface_available": true
        }
      }
    ],
    "startup_errors": []
  }
}
```

---

## 7.2.2 `GET /api/experimental/runtime/packs/:packId/status`

增强成直接返回 `ExperimentalPackRuntimeSnapshot`。

---

## 7.2.3 `GET /api/experimental/packs/:packId/overview`

不改 URL 语义，但内部改为：

1. 先走 experimental scope adapter
2. 再调用 pack-scoped core projection service

---

## 7.2.4 `GET /api/experimental/packs/:packId/projections/timeline`

同上。

---

## 7.2.5 Experimental plugin runtime web routes

保持 URL 不变，但内部统一走 `PackScopedPluginRuntimeService`。

---

## 8. 实现边界建议

## 8.1 应优先新增/重构的模块

建议新增或明确以下模块职责：

- `pack_projection_scope_adapter.ts`
- `pack_projection_metadata_resolver.ts`
- `pack_narrative_projection_service.ts`（纯 core service）
- `pack_entity_overview_projection_service.ts`（纯 core service）
- `experimental_runtime_control_plane_service.ts`
- `pack_scoped_plugin_runtime_service.ts`
- `pack_scoped_inference_context_builder.ts`（internal only，可先只定义接口和最小 adapter）

---

## 8.2 预计受影响文件

重点会触达：

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

---

## 9. 测试矩阵

## 9.1 Unit tests

至少补：

1. projection scope adapter
   - stable success
   - stable mismatch
   - experimental loaded success
   - experimental unloaded fail

2. projection core service
   - 不依赖 activePack 也能工作

3. experimental runtime control plane snapshot
   - active pack + loaded pack 混合场景
   - plugin/scheduler availability summary 正确

4. plugin runtime scoped service
   - stable scope
   - experimental scope
   - asset path / installation scope 不串

5. pack-scoped inference context builder contract
   - stable active pack mode
   - experimental loaded pack mode（即使先只做最小 mock）

---

## 9.2 Integration tests

至少补：

1. 同时 load 两个 pack runtime
2. `/api/experimental/runtime/packs` 能看到 active + loaded packs
3. `/api/experimental/packs/:packId/overview` 与 timeline 不串 pack
4. experimental plugin runtime web snapshot 不串 pack
5. stable `/api/packs/:packId/*` 仍然要求 active-pack
6. stable `/api/status` 不变

---

## 10. 风险与控制

## 风险 1：stable/experimental 逻辑混杂

**控制：** 强制引入 scope adapter，不允许 route 直接拼 guard + service + metadata。

## 风险 2：projection core service 仍偷偷读 activePack

**控制：** core service 输入只接收 `pack_id + pack metadata`，不接收 `activePack`。

## 风险 3：plugin runtime 多 pack 隔离不彻底

**控制：** 补针对 A/B pack 并存的 integration tests，特别是 web asset / route scope / runtime snapshot。

## 风险 4：提前把 inference 执行链范围带大

**控制：** 本轮只冻结 internal contract，不扩 public run API。

---

## 11. 本轮实施建议顺序

### Step 1
冻结 projection / operator / plugin / inference internal contracts。

### Step 2
重构 projection 为 pack-scoped core + scope adapter。

### Step 3
增强 experimental runtime control-plane snapshot。

### Step 4
收口 plugin runtime pack-scope service。

### Step 5
补 inference/context internal builder contract。

### Step 6
补 unit/integration tests，并同步 ARCH/API/progress。

---

## 12. 验收标准

本轮完成后，需满足：

1. experimental multi-pack runtime 不再只是 load/unload registry；
2. narrative/entity overview 等核心 read surface 已具备 pack-scoped core service；
3. plugin runtime web surface 具备明确 pack-local contract 与测试护栏；
4. operator 能看到更完整的 per-pack runtime snapshot；
5. stable active-pack API 与 `/api/status` 不被破坏；
6. inference/context 的 pack-scoped internal contract 已预留，便于下一轮继续推进。

---

## 13. 下一轮入口

本轮结束后，下一轮才建议评估是否进入：

1. pack-scoped inference run
2. pack-scoped workflow execution
3. pack-scoped action dispatch / invocation path
4. experimental UI inspector / pack selector
5. 是否有某些 experimental read surface 可以逐步进入 stable contract

当前不应越级直接进入执行链 multi-pack 化。