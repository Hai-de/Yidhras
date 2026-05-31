# 消除循环依赖 — 分批重构方案

dependency-cruiser 初始检测出 **121** 处模块级循环依赖。本文档记录执行进度。

**约束**：单人开发，可大范围重构/重写，不向后兼容，开发数据不重要。

---

## 执行进度

```
121 → 93 → 78（消除 43 处，~35%）→ 37（消除 84 处，~69%）
```

| # | 阶段 | 内容 | 消除 | 累计 |
|---|------|------|------|------|
| 1 | 1.1 仓库桶拆分 | `types.ts` + `factory.ts`，7 repo 移除 AppContext 导入 | 8 | 113 |
| 2 | 1.2 共享类型 | `InferenceActorRef` → `inference/shared_types.ts` | 2 | 111 |
| 3 | 1.3 Bootstrap | `CliConfig`/`RuntimeState` → `bootstrap/token_interfaces.ts` | 2 | 109 |
| 4 | 1.4 Contracts | 共享类型 → `packages/contracts/ai_shared_common.ts` | 1 | 108 |
| 5 | 1.5 AI Types | `ai/types.ts` 直接从 `@yidhras/contracts` 导入 | 1 | 107 |
| 6 | 2.1 Plugin 类型 | `PluginInferenceRequest`/`PluginInferenceResult` → `plugins/types.ts` | 3 | 104 |
| 7 | 文件拆分 | `WorldEngineStepCoordinator` → `world_engine_coordinator.ts` | 4 | 100 |
| 8 | 类型移动 | `HealthLevel` → `core/pack_runtime_health.ts` | 2 | 98 |
| 9 | 4.2 Tokenizer | `PromptTokenizer` → `tokenizers/tiktoken_adapter.ts` | 1 | 97 |
| 10 | 4.3 Bundle | `PromptBundleV2` → `prompt_bundle_types.ts` | 2 | 95 |
| 11 | 3 DI | `context/service.ts` 注入 `memoryService` + `pluginRuntime` | 2 | 93 |
| 12 | DbContext | 11 个委托文件 `AppContext` → `DbContext`，仓库 `as never` → `as DbContext` | 15 | **78** |
| 13 | 5.1 端口工厂拆分 | `context_memory_ports.ts` → 纯类型；工厂 → `context_memory_port_factory.ts` | — | 78 |
| 14 | 5.2 Workflow 类型 | `workflow_types.ts` 不再导入 `InferenceService`，使用 `WorkflowInferencePort` | ~37 | **41** |
| 15 | 5.3 Agent 动态导入 | `agent.ts` 对 `entity_overview_service` 改用动态导入 | — | 41 |
| 16 | 5.4 Domain 类型提取 | `InvocationRequest` → `domain/invocation/types.ts`，打破 domain 互循环 | 2 | **39** |
| 17 | 5.5 Workflow 推理端口 | `WorkflowInferencePort` → `inference/workflow_inference_port.ts` | 2 | **37** |

---

## 新增文件

| 文件 | 用途 |
|------|------|
| `apps/server/src/utils/db_context.ts` | `DbContext` — 最小化 Prisma 上下文接口 |
| `apps/server/src/app/services/repositories/types.ts` | `Repositories` 纯类型接口 |
| `apps/server/src/app/services/repositories/factory.ts` | `createPrismaRepositories` 工厂 |
| `apps/server/src/inference/shared_types.ts` | `InferenceActorRef`、`InferenceActorRole` |
| `apps/server/src/inference/prompt_bundle_types.ts` | `PromptBundleV2`、`PromptBundleToAiMessagesAdapter` |
| `apps/server/src/bootstrap/token_interfaces.ts` | `CliConfig`、`RuntimeState` |
| `apps/server/src/app/runtime/world_engine_coordinator.ts` | `WorldEngineStepCoordinator` + `WorldEngineSingleFlightState` |
| `packages/contracts/src/ai_shared_common.ts` | `PromptProcessingTrace`、`PromptWorkflowSnapshot` 等 |
| `apps/server/src/app/services/context/context_memory_port_factory.ts` | `createContextAssemblyPort` / `createMemoryRuntimePort` 工厂 |
| `apps/server/src/inference/workflow_inference_port.ts` | `WorkflowInferencePort` — 最小化推理服务端口，避免导入循环 |
| `apps/server/src/domain/invocation/types.ts` | `InvocationRequest` / `InvocationDispatchResult` 共享类型 |

## 关键修改

| 文件 | 变更 |
|------|------|
| 7 个 `*Repository.ts` | `as never` → `as DbContext`（ctx 模式），移除 `AppContext` 导入 |
| `repositories/index.ts` | 改为 re-export barrel（`types.ts` + `factory.ts`） |
| `app/context.ts` | `Repositories` → `types.ts`；`WorldEngineStepCoordinator` → `coordinator.ts`；`PluginInferenceRequest` → `plugins/types.ts`；`HealthLevel` → `pack_runtime_health.ts`；新增 `pluginRuntime?` 内联端口 |
| 11 个委托文件 | `AppContext`/`AppInfrastructure` 参数 → `DbContext` |
| `context/service.ts` | DI：移除 `createMemoryService`/`createPrismaLongMemoryBlockStore`/`pluginRuntimeRegistry` 直接导入 |
| `plugins/runtime.ts` | `PluginInferenceRequest`/`PluginInferenceResult` 从 `types.ts` 导入并 re-export |
| `memory/{types,blocks/types}.ts` | `InferenceActorRef` 从 `inference/shared_types.ts` 导入 |
| `inference/prompt_bundle_v2.ts` | 改为 re-export barrel |
| `inference/prompt_tree.ts` | `PromptWorkflowMetadata` 直接从 `@yidhras/contracts` 导入 |
| `ai/types.ts` | `PromptBundleMetadata` 直接从 `@yidhras/contracts` 导入 |
| contracts `ai_shared_{metadata,trace}.ts` | 共享类型迁移到 `ai_shared_common.ts` |
| `context_memory_ports.ts` | 移除所有值导入，仅保留类型接口 |
| `context_memory_port_factory.ts` | 新建，容纳工厂函数 `createContextAssemblyPort` / `createMemoryRuntimePort` |
| `workflow_types.ts` | `InferenceService` → `WorkflowInferencePort`（打破 inference/service.ts 循环） |
| `workflow_decision_step.ts` | `InferenceService` → `WorkflowInferencePort` |
| `job_runner.ts` | `InferenceService` → `WorkflowInferencePort` |
| `agent.ts` | `entity_overview_service` 改用动态导入 |
| `enforcement_engine.ts` | `InvocationRequest` 从 `invocation/types.ts` 导入 |
| `sidecar_objective_execution.ts` | `InvocationRequest` 从 `invocation/types.ts` 导入 |
| `invocation_dispatcher.ts` | 类型移至 `types.ts` 并 re-export |
| `bootstrap/providers/context.ts` | 回填 `pluginRuntime: pluginRuntimeRegistry` 到上下文 |
| `inference/context/pipeline.ts` | 移除 `createContextAssemblyPort` 导入，改用 `context.contextAssembly` 断言 |

---

## 剩余 37 处分布

| 集群 | 数量 | 根因 |
|------|------|------|
| Agent/投影/推理工作流 | ~12 | `AgentRepository.ts` → (动态导入) `agent.ts` 的链式循环。depcruise 跟随动态导入，但这些是有意为之的运行时循环打破模式 |
| 上下文/内存类型循环 | ~6 | `context_memory_ports.ts` ↔ `context/service.ts` ↔ `memory/service.ts` 纯类型级循环 |
| 内部小循环 | ~4 | behavior tree evaluator ↔ nodes（动态导入），domain 互循环（已修复 2 处） |
| 仓库/类型自循环 | ~4 | `types.ts` ↔ `workflow_step_repository.ts` ↔ `workflow_types.ts` ↔ `app/context.ts` |
| Operator | ~3 | `operator_*` → `audit/logger.ts` → `app/context.ts` → `IdentityOperatorRepository.ts` |
| AI Gateway | ~3 | `ai/gateway.ts` → `app/context.ts` → ... → `ai/task_service.ts` → `ai/gateway.ts` |
| 其他传递链 | ~5 | social/access_policy, pack_scope_resolver, audit 等 |

## 已验证

```bash
pnpm depcruise          # 37 warnings, 0 errors
pnpm typecheck          # 5 个预存错误，无新增
pnpm lint               # 预存错误，无新增
```
