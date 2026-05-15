# Active-pack 概念测试清理

## Context

`activePack` 概念已从所有源代码、合约和文档中移除（typecheck 零错误通过）。测试文件仍引用已删除的符号，需逐一更新。

## 测试辅助文件（已完成）

- `tests/fixtures/app-context.ts` — 已重写，移除 `activePackId` 选项、`getActivePack`/`getActivePackId` mock
- `tests/helpers/runtime.ts` — `activePackRef` → `packRef`（已批量替换）

## 按需修复模式

### 模式 A：mock 中的 `getActivePackId: () => '...'`

`PackRuntimeLookupPort` 接口不再有 `getActivePackId()`。删除该属性。

| 文件 | 行号 |
|------|------|
| `tests/unit/runtime/world_engine_pack_host_api.spec.ts` | 73 |
| `tests/unit/services/overview_projection.spec.ts` | 103 |
| `tests/unit/pack_runtime_registry.spec.ts` | 86, 256 |
| `tests/unit/ai_observability.spec.ts` | 59 |
| `tests/unit/ai_tool_executor.spec.ts` | 27 |
| `tests/unit/authority_perception_context.spec.ts` | 81 |
| `tests/unit/routes/clock_routes_projection.spec.ts` | 95 |
| `tests/unit/objective_enforcement_sidecar_fallback_policy.spec.ts` | 113 |
| `tests/unit/objective_enforcement_engine_sidecar.spec.ts` | 98 |
| `tests/unit/objective_enforcement_sidecar_diagnostics.spec.ts` | 97 |
| `tests/integration/world_pack_projection_flow.spec.ts` | 321 |
| `tests/integration/scheduler-run-level-aggregation.spec.ts` | 149 |

### 模式 B：mock 中的 `getActivePack: () => ({...})`

`SimulationManager` 不再暴露 `getActivePack`。改用 pack store 或 `getPackRuntimeHost(packId)?.getPack()`。

| 文件 | 行号 |
|------|------|
| `tests/archive/plugin_cli.spec.ts` | 102 |
| `tests/integration/death-note-memory-loop.spec.ts` | 30 |
| `tests/integration/plugin_runtime_experimental_pack_scope.spec.ts` | 73, 113 |
| `tests/integration/plugin_runtime_web.spec.ts` | 78, 175, 297 |
| `tests/integration/plugin_dependency_flow.spec.ts` | 87 |
| `tests/integration/world_pack_projection_flow.spec.ts` | 86, 90 |
| `tests/integration/plugin_runtime_refresh.spec.ts` | 75 |
| `tests/unit/runtime_bootstrap_and_pack_catalog.spec.ts` | 77 |
| `tests/unit/pack_runtime_registry.spec.ts` | 180, 304 |
| `tests/unit/objective_enforcement_sidecar_parity.spec.ts` | 47, 68 |
| `tests/unit/objective_enforcement_sidecar_fallback_policy.spec.ts` | 56 |
| `tests/unit/objective_enforcement_engine_sidecar.spec.ts` | 41 |
| `tests/unit/objective_enforcement_sidecar_diagnostics.spec.ts` | 40 |

### 模式 C：mock 中的 `activePackRuntime: {...}` 或 `activePack: {...} as AppContext['activePack']`

`AppContext` 不再有 `activePackRuntime` 或 `activePack` 属性。改用 `packRuntime` 参数或 `getPackRuntimeHost(packId)`。

| 文件 | 行号 |
|------|------|
| `tests/unit/operator_grant.spec.ts` | 34 |
| `tests/unit/objective_enforcement_sidecar_parity.spec.ts` | 67 |
| `tests/integration/world_pack_projection_flow.spec.ts` | 235-248 |
| `tests/integration/world_engine_sidecar_runtime_loop.spec.ts` | 71 |
| `tests/integration/world_engine_sidecar_failure_recovery.spec.ts` | 60 |
| `tests/integration/world_engine_pack_host_api_read_surface.spec.ts` | 80, 84 |

### 模式 D：导入已重命名/删除的函数

| 文件 | 需修复的导入 |
|------|-------------|
| `tests/integration/plugin_runtime_web.spec.ts` | `getActivePackPluginRuntimeWebSnapshot` → `getPackPluginRuntimeWebSnapshot`；`refreshActivePackPluginRuntime` → 已删除；`syncExperimentalPackPluginRuntime` → `syncPackPluginRuntime` |
| `tests/integration/plugin_dependency_flow.spec.ts` | `refreshActivePackPluginRuntime` → 已删除 |
| `tests/integration/plugin_runtime_refresh.spec.ts` | `refreshActivePackPluginRuntime` → 已删除 |

### 模式 E：`activePackRuntime` 参数名

快照捕获的参数已从 `activePackRuntime` 重命名为 `packRuntime`。

| 文件 | 行号 |
|------|------|
| `tests/integration/pack_snapshot.spec.ts` | 218, 238, 262, 286, 294, 314, 334, 373, 403 |

### 模式 F：已删除的错误码和常量

| 文件 | 需移除 |
|------|--------|
| `tests/integration/plugin_runtime_web.spec.ts` | `PACK_ROUTE_ACTIVE_PACK_MISMATCH` 断言 |
| `tests/integration/plugin_runtime_experimental_pack_scope.spec.ts` | `PACK_ROUTE_ACTIVE_PACK_MISMATCH` 断言、`active-pack` 测试标题 |
| `tests/e2e/experimental-projection-compat.spec.ts` | `ACTIVE_PACK_ROUTE_NAME`、`NON_ACTIVE_PACK_ROUTE_NAME` 常量；`PACK_ROUTE_ACTIVE_PACK_MISMATCH` 断言；`active-pack` 测试标题 |
| `tests/e2e/experimental-plugin-runtime-web.spec.ts` | `active-pack scoped` 测试标题 |
| `tests/e2e/world_pack_projection_endpoints.spec.ts` | `DEATH_NOTE_ACTIVE_PACK_ID` → `DEATH_NOTE_PACK_ID`；`PACK_ROUTE_ACTIVE_PACK_MISMATCH` 断言 |
| `tests/e2e/trigger-event.spec.ts` | `DEATH_NOTE_ACTIVE_PACK_ID` → `DEATH_NOTE_PACK_ID`；`PACK_ROUTE_ACTIVE_PACK_MISMATCH` 断言 |

### 模式 G：测试描述文本中的 `activePackRuntime`

| 文件 | 行号 |
|------|------|
| `tests/unit/ai_tool_executor.spec.ts` | 562（测试标题文本） |

## 统计

| 目录 | 受影响文件数 |
|------|------------|
| `tests/unit/` | 13 |
| `tests/integration/` | 10 |
| `tests/e2e/` | 4 |
| `tests/archive/` | 1（可跳过） |
| **合计** | **27**（不含 archive） |

## 验证

```bash
pnpm typecheck                           # 已通过
pnpm test:unit                           # 需这些修复后才能通过
pnpm --filter yidhras-server test:integration
pnpm --filter yidhras-server test:e2e
```
