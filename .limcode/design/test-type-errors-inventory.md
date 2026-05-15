# Test Type Errors Inventory

202 个 TypeScript 错误，来自 51 个文件（1 个归档，50 个活跃）。
生成日期: 2026-05-15

---

## 按错误码分类

| 代码 | 数量 | 说明 |
|------|------|------|
| TS2339 | 36 | 类型上不存在某属性 (e.g. `AppContext` 无 `clock`, 类型 `{}` 上不存在属性) |
| TS2304 | 19 | 找不到名称 (17 个在 archive, 2 个在活跃文件) |
| TS2741 | 19 | 类型缺少必需属性 (e.g. 缺少 `display_name`, `resolved_positions`, `perception_resolvers`) |
| TS2353 | 18 | 对象字面量指定了已知类型上不存在的属性 |
| TS2352 | 14 | 类型转换/断言不兼容 |
| TS7006 | 14 | 参数隐式 `any` (大部分在 archive 和 e2e graph-view) |
| TS18046 | 13 | `.nodes` 类型为"未知" (主要集中在 graph-view.spec.ts) |
| TS2322 | 12 | 类型分配不兼容 (AuthHeaders vs HeadersInit 等) |
| TS2345 | 12 | 参数类型不匹配 |
| TS2739 | 10 | 类型缺少多个属性 (ContextRun, PromptWorkflowState 等) |
| TS2783 | 9 | 多次指定 `Content-Type` 头 |
| TS2416 | 7 | 继承属性类型不兼容 (MemSchedulerStorage) |
| TS2305 | 5 | 模块未导出指定成员 |
| TS2540 | 4 | 无法赋值给只读属性 |
| TS2552 | 3 | 找不到名称，有相似拼写建议 |
| TS2561 | 2 | 对象字面量指定了不存在的属性 |
| TS2307 | 1 | 找不到模块或其类型声明 |
| TS2459 | 1 | 模块本地声明但未导出 |
| TS2551 | 1 | 属性名拼写建议 |
| TS2554 | 1 | 参数数量不匹配 |
| TS4104 | 1 | readonly 数组不能分配给可变类型 |

---

## 按文件分类

### 归档文件（可批量忽略）

| 错误数 | 文件 |
|--------|------|
| 22 | `apps/server/tests/archive/plugin_cli.spec.ts` — TS2304(19) + TS2345(2) + TS7006(1) |

### 活跃文件 (>5 个错误)

| 错误数 | 文件 | 主要码 |
|--------|------|--------|
| 22 | `tests/e2e/graph-view.spec.ts` | TS18046(13) + TS7006(9) |
| 14 | `tests/unit/runtime/world_engine_persistence.spec.ts` | TS2353(9) + TS2339(5) |
| 10 | `tests/unit/task_prompt_builder.spec.ts` | TS2353(5) + TS2345(3) + TS2339(2) |
| 8 | `tests/helpers/scheduler_storage.ts` | TS2416(7) + TS2352(1) |
| 6 | `tests/integration/conversation/pipeline_edge_cases.spec.ts` | TS2739, TS2741, TS2345 |
| 6 | `tests/unit/conversation/compaction_inference.spec.ts` | TS2352, TS2353, TS2741 |
| 6 | `tests/unit/token_budget_trim_executor.spec.ts` | TS2741, TS2739, TS2353 |

### 活跃文件 (3-5 个错误)

| 错误数 | 文件 | 主要码 |
|--------|------|--------|
| 5 | `tests/bench/inference.bench.ts` | TS2307, TS2561, TS2739, TS2741, TS2551 |
| 5 | `tests/e2e/plugin-dependency-flow.spec.ts` | TS2352(3) + TS2322(1) + TS18046(1) |
| 5 | `tests/integration/conversation/conversation_flow.spec.ts` | TS2739, TS2741 |
| 4 | `tests/e2e/trigger-event.spec.ts` | TS2783(4) |
| 4 | `tests/unit/ai_task_service.spec.ts` | TS2305(3) + TS7006(1) |
| 4 | `tests/unit/ai_tool_executor.spec.ts` | TS2352(3) + TS2540(1) |
| 4 | `tests/unit/authority_perception_context.spec.ts` | TS2305, TS2353, TS2554 |
| 4 | `tests/unit/context_module.spec.ts` | TS2739(2) + TS2540(1) + TS2353(1) + TS2339(1) |
| 4 | `tests/unit/objective_enforcement_engine_sidecar.spec.ts` | TS2339, TS2353, TS2352 |
| 4 | `tests/unit/objective_enforcement_sidecar_diagnostics.spec.ts` | TS2339, TS2353, TS2352 |
| 4 | `tests/unit/objective_enforcement_sidecar_fallback_policy.spec.ts` | TS2339, TS2353, TS2352 |
| 4 | `tests/unit/pack_access.spec.ts` | TS2339(2) + TS2540(1) + TS2352(1) |
| 4 | `tests/unit/prompt_permissions.spec.ts` | TS2345(4) |

### 活跃文件 (1-2 个错误)

| 错误数 | 文件 | 主要码 |
|--------|------|--------|
| 3 | `tests/e2e/access-policy-contracts.spec.ts` | TS2322 |
| 3 | `tests/e2e/experimental-projection-compat.spec.ts` | TS2552 |
| 3 | `tests/e2e/smoke-death-note-scenario-endpoints.spec.ts` | TS2322 |
| 3 | `tests/unit/ai_tool_loop_runner.spec.ts` | TS2459, TS2352, TS2741 |
| 3 | `tests/unit/objective_enforcement_sidecar_parity.spec.ts` | TS2339, TS2353 |
| 3 | `tests/unit/operator_grant.spec.ts` | TS2339, TS2352 |
| 3 | `tests/unit/rule_based_death_note_provider.spec.ts` | TS2741, TS2353 |
| 3 | `tests/unit/template_track.spec.ts` | TS2339 |
| 2 | `tests/e2e/adjust-snr.spec.ts` | TS2783 |
| 2 | `tests/unit/ai_cross_agent_tool.spec.ts` | TS2352, TS18046 |
| 2 | `tests/unit/memory_trigger_sidecar_parity.spec.ts` | TS2739 |
| 2 | `tests/unit/openai_adapter.spec.ts` | TS2561, TS2322 |
| 2 | `tests/unit/perception_resolver.spec.ts` | TS2345 |
| 2 | `tests/unit/post_merge_executors.spec.ts` | TS2741, TS2353 |
| 2 | `tests/unit/prompt_bundle_v2.spec.ts` | TS2353 |
| 1 | `tests/e2e/adjust-relationship.spec.ts` | TS2783 |
| 1 | `tests/e2e/audit-feed.spec.ts` | TS2783 |
| 1 | `tests/e2e/smoke-startup.spec.ts` | TS2322 |
| 1 | `tests/e2e/workflow-retry-semantics.spec.ts` | TS2783 |
| 1 | `tests/helpers/clock.ts` | TS2352 |
| 1 | `tests/unit/ai_task_decoder.spec.ts` | TS2322 |
| 1 | `tests/unit/anthropic_adapter.spec.ts` | TS2741 |
| 1 | `tests/unit/memory_block_store.spec.ts` | TS2739 |
| 1 | `tests/unit/placement_resolution.spec.ts` | TS2353 |
| 1 | `tests/unit/property_based.spec.ts` | TS4104 |
| 1 | `tests/unit/services/overview_projection.spec.ts` | TS2540 |
| 1 | `tests/unit/spatial_predicate.spec.ts` | TS2741 |
| 1 | `tests/unit/template_engine_plugin.spec.ts` | TS2305 |
| 1 | `tests/unit/world_engine_plugin_contributor_chain.spec.ts` | TS2741 |
| 1 | `tests/unit/world_pack_schema.spec.ts` | TS2339 |

---

## 可聚类修复方向

- **TS2783 (重复 Content-Type)**: 9 个，全在 e2e 文件中。可能是一个公共 HTTP helper 的类型声明问题。
- **TS2416 (SchedulerStorageAdapter 继承)**: 7 个集中在 `tests/helpers/scheduler_storage.ts`。`MemSchedulerStorage` 的 `getMigrationById` 方法签名与基类不匹配。
- **TS2305 (未导出成员)**: 5 个。模块导出的类型名或路径已变更。
- **TS2741 (缺少必需属性)**: 19 个，分散在 12 个文件。接口增加了新必需字段，测试固件未同步。
- **TS2339 (属性不存在)**: 36 个，最分散。主要集中在 `AppContext` 类型缺少某些属性、以及 `{}` 类型推断问题。
- **TS2353 (多余属性)**: 18 个。接口收缩了字段，测试仍传入旧字段。
- **TS2739 (缺少多个属性)**: 10 个。`ContextRun` / `PromptWorkflowState` 等类型增加了新必需字段。

---

其余错误过于分散，暂不强行聚类。
