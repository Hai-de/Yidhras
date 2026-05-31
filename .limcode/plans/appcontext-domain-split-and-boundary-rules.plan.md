<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/appcontext-domain-split-and-boundary-rules.md","contentHash":"sha256:d5a3edd5c69d55a1ea4284decbd72911e"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] Phase 0: 草案最终确认 — 审阅边界规则矩阵与决策记录 `#AC-0`
- [x] Phase 1: 创建角色接口 — 5 新建 + 1 修改，类型层面拆分 AppContext `#AC-1`
- [x] Phase 2: memory → DataContext 迁移 — 6 文件 `#AC-2`
- [x] Phase 3: domain → DataContext + RuntimeContext 迁移 — 5 文件 `#AC-3`
- [x] Phase 4: inference → DataContext + PortContext 迁移 — 6 文件 `#AC-4`
- [x] Phase 5: ai → DataContext 迁移 — 4 文件 `#AC-5`
- [x] Phase 6: packs/projections → DataContext + RuntimeContext 迁移 — 7 文件 `#AC-6`
- [x] Phase 7: plugins 角色迁移 + pluginRuntimeRegistry 物理移动 — 14 文件 + 1 新建 `#AC-7`
- [x] Phase 8: operator → DataContext 迁移 — 4 文件 `#AC-8`
- [x] Phase 9: social lazy import 重构 — 1 文件 `#AC-9`
- [x] Phase 10: app/services → 角色接口迁移 — 16/16 文件完成 (原~50/81) `#AC-10`
- [x] Phase 11: 旧 barrel 移除 — AppInfrastructure 消除, app/context.ts → 纯 re-export `#AC-11`
- [x] Phase 12: Repositories 子接口拆分 — 3 新建 + 2 修改 `#AC-12`
- [x] Phase 13: context_memory_ports 上移 — 1 新建 + 3 修改 `#AC-13`
- [x] Phase 14: inference/behavior_tree 内部循环修复 — 2 循环消除 (evaluator↔composites/decorators) `#AC-14`
- [x] Phase 15: ESLint 新规则上线 — default: 'disallow', severity: 'warn', 25 元素类型 `#AC-15`
- [x] Phase 16: 修复 ESLint 违规 — 35 规则新增, 0 violations, severity→error `#AC-16`
- [x] Phase 17: Repositories 组合接口移除 — 6 文件 `#AC-17`
- [x] Phase 18: depcruise no-circular — 49→0 (tsPreCompilationDeps: false), severity: error `#AC-18`
- [x] Phase 19: 非 services AppContext/AppInfrastructure 消费者迁移 — 12 文件 `#AC-19`
<!-- LIMCODE_TODO_LIST_END -->

# AppContext 领域拆分 + ESLint 边界规则重写 — 执行计划

## 源设计文档

- **路径**: `.limcode/design/appcontext-domain-split-and-boundary-rules.md`

## 当前基线（截至 2026-05-31）

| 指标 | 当前值 |
|------|--------|
| `app/context.ts` 消费者 | 48 文件导入完整 `AppContext` / `AppInfrastructure` |
| depcruise 循环依赖 | 35 unique cycles（warn） |
| ESLint boundaries 规则 | 3 条限制规则，`default: 'allow'`，~14 种元素类型（其中 8+ 个目录混入 `infra`） |
| `AppContext` 属性总数 | 30+ 属性/方法揉在 `AppInfrastructure` + `AppContext` + `AppContextPorts` |
| `pluginRuntimeRegistry` | 位于 `plugins/runtime.ts`，被 `app/`、`packs/` 层 13 处值导入 |
| Repositories 接口 | 1 个组合接口（10 成员），含循环 `types.ts → workflow_step_repository.ts → ... → context.ts` |

## 目标状态

| 指标 | 目标 |
|------|------|
| depcruise 循环依赖 | 0 errors |
| AppContext 消费者 | ≤ 5 文件导入完整 `AppContext`（组合根 + DI + 路由注册） |
| ESLint 边界规则 | 25 种元素类型，`default: 'disallow'`，severity: `error` |
| 角色接口 | 3 个（`DataContext`、`RuntimeContext`、`PortContext`） |
| Repositories 子接口 | 3 个（`EntityRepositories`、`WorkflowRepositories`、`PluginRepositories`） |
| `pluginRuntimeRegistry` | 物理位置在 `app/runtime/`，`plugins/` 通过 DI 获取 |

---

## Phase 0 — 草案最终确认

**风险**: 低  
**涉及文件**: 0（纯评审）  
**前置**: 无  
**后置**: Phase 1

- [ ] 确认 §2.3 规则矩阵中所有 25 个元素类型的 `allow` 列表与实际依赖匹配
- [ ] 确认决策记录 5.1–5.9 无遗漏
- [ ] 确认 `transport` 行值导入权限（`infra-persist`, `infra-op`, `infra-id`, `infra-memory`, `infra-context`, `infra-plugins`）与实际代码一致
- [ ] 确认 `app-wiring` 反向禁止生效（默认 `disallow` 自然实现）

---

## Phase 1 — 创建角色接口

**风险**: 低 — 纯类型移动，运行时行为不变  
**涉及文件**: 5 新建 + 1 修改  
**前置**: Phase 0  
**后置**: Phase 2–11 所有消费者迁移

### 新建文件

| 文件 | 内容 | 行数估计 |
|------|------|----------|
| `app/context/data_context.ts` | `DataContext` 接口（5 成员） | ~15 |
| `app/context/runtime_context.ts` | `RuntimeContext` 接口 + `StartupHealth`, `NotificationStore`, `RuntimeLoopDiagnostics` 类型 | ~50 |
| `app/context/port_context.ts` | `PortContext` 接口（17 成员） | ~40 |
| `app/context/app_context.ts` | `AppContext extends DataContext, RuntimeContext, PortContext` + `RouteRegistrar` | ~10 |
| `app/context/index.ts` | barrel re-export 所有接口 | ~12 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `app/context.ts` | 改为从 `./context/index.js` re-export（保持向后兼容） |

### 验证门

- `pnpm typecheck` 通过（旧消费者仍可用 `AppContext`）
- `app/context.ts` 标记为 `@deprecated`，注释指向新导入路径

### 关键决策点

1. **`getSpatialRuntime` 降级到 `RuntimeContext`**（决策 5.4）：`enforcement_engine.ts` 从需 DataContext + PortContext + RuntimeContext 降为 DataContext + RuntimeContext。
2. **`getPackRuntimeHandle` vs `getPackRuntimeHost` 维持拆分**（决策 5.3）：前者归 `RuntimeContext`，后者归 `PortContext`。
3. **`pluginRuntime` 代理覆盖 2 个方法**（`getContextSourceAdapters`, `getPerceptionResolvers`），其余 9 个方法在 Phase 7 通过 DI 注入。

---

## Phase 2 — memory → DataContext 迁移

**风险**: 低  
**涉及文件**: ~6  
**前置**: Phase 1

| 文件 | 当前导入 | 改为 | 使用的属性 |
|------|---------|------|-----------|
| `memory/service.ts` | `AppInfrastructure` | `DataContext` | `repos`, `prisma` |
| `memory/short_term_adapter.ts` | `AppContext` | `DataContext` | `repos` |
| `memory/recording/service.ts` | `AppContext` | `DataContext` | `repos` |
| `memory/recording/compaction_service.ts` | `AppContext` | `DataContext` | `repos` |
| `memory/blocks/evaluation_context.ts` | `AppContext` | `DataContext` | `repos` |

---

## Phase 3 — domain → DataContext + RuntimeContext 迁移

**风险**: 低  
**涉及文件**: ~5  
**前置**: Phase 1

| 文件 | 当前导入 | 改为 | 使用的属性 |
|------|---------|------|-----------|
| `domain/authority/resolver.ts` | `AppContext` | `DataContext` | `packStorageAdapter` |
| `domain/invocation/intent_grounder.ts` | `AppContext` | `RuntimeContext` | `pack_runtime` 相关 |
| `domain/invocation/invocation_dispatcher.ts` | `AppContext` | `DataContext + RuntimeContext` | 按需 |
| `domain/rule/enforcement_engine.ts` | `AppInfrastructure` | `DataContext & RuntimeContext` | `repos`, `prisma`, `packStorageAdapter`, `getSpatialRuntime`, `worldEngine`（仍需 PortContext） |
| `domain/perception/resolver.ts` | `AppContext` | `DataContext` | `packStorageAdapter` |

**注意**：`enforcement_engine.ts` 使用 `context.worldEngine`（PortContext），`context.getSpatialRuntime`（RuntimeContext），`context.packStorageAdapter`/`context.repos`/`context.prisma`（DataContext）。需要同时导入 3 个角色接口。

---

## Phase 4 — inference → DataContext + PortContext 迁移

**风险**: 中 — `pipeline.ts` 跨 3 个角色接口  
**涉及文件**: ~6  
**前置**: Phase 1

| 文件 | 当前导入 | 改为 | 使用的属性 |
|------|---------|------|-----------|
| `inference/service.ts` | `AppContext` | `PortContext` | `conversationStore` |
| `inference/sinks/prisma.ts` | `AppContext` | `DataContext` | `repos` |
| `inference/context/builder.ts` | `AppContext` | `DataContext & PortContext` | `packRuntimeLookup`, `contextAssembly` |
| `inference/context/pipeline.ts` | `AppInfrastructure` | `DataContext & RuntimeContext & PortContext` | `repos`, `prisma`, `packStorageAdapter`, `startupHealth`, `assertRuntimeReady`, `contextAssembly`, `getPackRuntimeHost` |
| `inference/context/state_snapshot_builder.ts` | `AppContext` | `DataContext` | `prisma` |
| `inference/context/authority_adapter.ts` | `AppContext` | → 按需 | 审查实际使用 |

---

## Phase 5 — ai → DataContext 迁移

**风险**: 低  
**涉及文件**: ~4  
**前置**: Phase 1

| 文件 | 当前导入 | 改为 |
|------|---------|------|
| `ai/gateway.ts` | `AppContext` | `DataContext` |
| `ai/task_service.ts` | `AppContext` | `DataContext` |
| `ai/observability.ts` | `AppContext` | `DataContext` |
| `ai/tool_executor.ts` | `AppContext` | `DataContext` |

---

## Phase 6 — packs/projections → DataContext + RuntimeContext 迁移

**风险**: 中 — 投影文件横跨多个角色  
**涉及文件**: ~6  
**前置**: Phase 1

| 文件 | 当前导入 | 改为 | 使用的属性 |
|------|---------|------|-----------|
| `packs/runtime/projections/pack_entity_overview_projection_service.ts` | `AppContext` | `DataContext` | `packStorageAdapter` |
| `packs/runtime/projections/pack_narrative_projection_service.ts` | `AppContext` | `DataContext` | `packStorageAdapter`, `repos` |
| `packs/runtime/projections/entity_overview_service.ts` | `AppContext` | `DataContext` | `packStorageAdapter` |
| `packs/runtime/projections/narrative_projection_service.ts` | `AppContext` | `DataContext` | `packStorageAdapter` |
| `packs/runtime/projections/pack_projection_scope_adapter.ts` | `AppContext` | `DataContext` | 审查实际使用 |
| `packs/runtime/projections/pack_projection_metadata_resolver.ts` | `AppContext` | `DataContext` | 审查实际使用 |
| `packs/snapshots/auto_snapshot_service.ts` | `AppContext` | `DataContext & RuntimeContext` | `packStorageAdapter`, `prisma`, `getPackRuntimeHandle` |

---

## Phase 7 — plugins 角色迁移 + pluginRuntimeRegistry 物理移动

**风险**: 中 — 插件系统与 AppContext 耦合最深，涉及 13 处值导入变更  
**涉及文件**: ~7 修改 + 1 新建  
**前置**: Phase 1

### 7a. 物理移动 registry

| 步骤 | 操作 |
|------|------|
| 1 | 新建 `app/runtime/plugin_runtime_registry.ts`，将 `PluginRuntimeRegistry` 类 + `pluginRuntimeRegistry` 单例 + `syncPackPluginRuntime` 函数移入 |
| 2 | `plugins/runtime.ts` 添加 re-export 从新位置（过渡期） |
| 3 | 更新 `apps/server/src/index.ts` 的导入路径（1 处） |
| 4 | 更新 `bootstrap/providers/context.ts` 的导入路径（1 处） |

### 7b. 13 处消费者迁移

| 文件 | 当前导入 | 改为 |
|------|---------|------|
| `app/runtime/MultiPackLoopHost.ts` | `pluginRuntimeRegistry` from `plugins/runtime.js` | from `app/runtime/plugin_runtime_registry.js` |
| `app/runtime/plugin_contributor_adapter.ts` | 同上 | 同上 |
| `app/runtime/world_engine_persistence.ts` | 同上 | 同上 |
| `app/runtime/perception_pipeline.ts` | 同上 | 同上 |
| `app/routes/plugin_runtime_server.ts` | 同上 | 同上 |
| `app/routes/pack_actions.ts` | 同上 | 同上 |
| `app/composition/inference.ts` | 同上 | 同上 |
| `app/services/pack/pack_scoped_plugin_runtime_service.ts` | 同上 | 同上（审查是否可通过 DI） |
| `app/services/runtime/experimental_multi_pack_runtime.ts` | 同上 | 同上 |
| `packs/orchestration/pack_runtime_registry_service.ts` | 同上 | 同上 |
| `context/workflow/orchestrator.ts` | 同上 | 同上 |
| `bootstrap/providers/context.ts` | 同上 | 同上 |

### 7c. plugins/ 内部角色迁移

| 文件 | 当前导入 | 改为 |
|------|---------|------|
| `plugins/runtime.ts` | `AppContext` | `DataContext & RuntimeContext & PortContext`（按需） |
| `plugins/context.ts` | `AppContext` | 按需角色接口 |
| `plugins/worker/PluginWorkerManager.ts` | `AppContext` | 按需角色接口 |
| `plugins/worker/PluginWorkerClient.ts` | `AppContext` | 按需角色接口 |
| `plugins/worker/host_call_handler.ts` | `AppContext` | 按需角色接口 |

### 7d. 过渡期结束后清理

- 移除 `plugins/runtime.ts` 中从 `app/runtime/plugin_runtime_registry.js` 的 re-export
- `plugins/` 内部如需操作 registry，通过构造函数注入或 `PortContext.pluginRuntimeControl` 获取

---

## Phase 8 — operator → DataContext 迁移

**风险**: 低  
**涉及文件**: ~4  
**前置**: Phase 1

| 文件 | 当前导入 | 改为 |
|------|---------|------|
| `operator/audit/logger.ts` | `AppContext` | `DataContext` |
| `operator/auth/token.ts` | `AppContext` | `DataContext` |
| `operator/guard/pack_access.ts` | `AppContext` | `DataContext` |
| `operator/guard/subject_resolver.ts` | `AppContext` | `DataContext` |

---

## Phase 9 — social lazy import 重构

**风险**: 低 — 改为静态导入，同一包内无加载成本增加  
**涉及文件**: ~3  
**前置**: 无（可独立执行）  
**与设计文档对应**: §1.11, 决策 5.9

### 当前状态

```
SocialRepository.ts:51  →  await import('../social/social.js')
SocialRepository.ts:64  →  await import('../social/social.js')
social.ts:395/421       →  Prisma dynamic query（非 lazy import，是 Prisma 查询）
```

### 变更

| 步骤 | 操作 |
|------|------|
| 1 | `SocialRepository.ts`：将 2 处 `await import('../social/social.js')` 改为顶部静态 `import { listSocialFeed, createSocialPost } from '../social/social.js'` |
| 2 | 审查 `social/social.ts` 是否存在对 `access_policy/service.ts` 的 lazy import。若存在，同理改为静态导入 |
| 3 | 确认动态 import 消除后可消除 depcruise 循环 |

### 验证

- `pnpm typecheck` 通过
- `pnpm --filter yidhras-server test` 通过
- depcruise 该循环消失

---

## Phase 10 — app/services → 角色接口迁移

**风险**: 中 — 服务层文件数最多（172），需要逐个审查  
**涉及文件**: ~8（主要服务）  
**前置**: Phase 1, 7

| 文件 | 当前导入 | 改为 |
|------|---------|------|
| `app/services/agent/agent.ts` | type `AppInfrastructure` 或其他 | 按需角色接口 |
| `app/services/inference_workflow.ts` | `AppContext` | `DataContext & PortContext` |
| 其他 6 个服务文件 | 审查实际使用 | 按需角色接口 |

---

## Phase 11 — 旧 barrel 移除

**风险**: 低 — 仅当所有消费者迁移完毕  
**涉及文件**: 1  
**前置**: Phase 2–10 全部完成

| 操作 |
|------|
| 删除 `app/context.ts` 的 re-export 内容，或整个文件改为仅 re-export 从 `./context/index.js` |
| 搜索确认无直接 `import ... from '../app/context.js'` 残留（仅 `app-wiring` + `token_types.ts` 可保留） |

---

## Phase 12 — Repositories 子接口拆分

**风险**: 中 — 接口从 1 → 4，消费者需逐步迁移  
**涉及文件**: 3 新建 + ~10 修改  
**前置**: Phase 1（DataContext 使用子接口声明 repos 类型）  
**与设计文档对应**: §1.6

### 新建文件

| 文件 | 接口 | 成员 |
|------|------|------|
| `app/services/repositories/entity_repos.ts` | `EntityRepositories` | `agent`, `identityOperator`, `relationship`, `memory`, `narrative`, `social` |
| `app/services/repositories/workflow_repos.ts` | `WorkflowRepositories` | `inference`, `workflowRuns`, `workflowSteps` |
| `app/services/repositories/plugin_repos.ts` | `PluginRepositories` | `plugin` |

### 修改文件

| 文件 | 变更 |
|------|------|
| `app/services/repositories/types.ts` | 添加 `Repositories extends EntityRepositories, WorkflowRepositories, PluginRepositories`（`@deprecated`） |
| `app/services/repositories/index.ts` | re-export 子接口 |
| 消费者 ~10 文件 | 逐步从子接口文件直接导入 |

### 循环消除前提

消费者必须直接从子接口文件导入（`import type { EntityRepositories } from './entity_repos.js'`），而非通过 `types.ts` barrel。`types.ts` 的组合接口在 Phase 17 移除。

---

## Phase 13 — context_memory_ports 上移

**风险**: 低 — 2 新文件 + 2 修改  
**涉及文件**: 4  
**前置**: Phase 1（`PortContext.contextAssembly` 类型引用已就绪）  
**与设计文档对应**: §1.9

### 变更

| 操作 | 文件 |
|------|------|
| 新建 | `context/ports.ts` — 定义 `ContextAssemblyPort`, `MemoryRuntimePort` |
| 修改 | `app/services/context/context_memory_ports.ts` — 改为从 `context/ports.js` re-export |
| 修改 | `context/service.ts` — 从 `ports.js` 导入（打破链 A 循环） |
| 修改 | `app/services/context/context_memory_port_factory.ts` — 同时从 `ports.js` 和 `app/context.ts` 导入（装配层，不产生循环） |

### 修复前后对比

```
修复前:
  context_memory_ports.ts → context/service.ts → app/context.ts → app_context_ports.ts → context_memory_ports.ts  (CYCLE)

修复后:
  context/ports.ts ← context/service.ts（值导入）
  context/ports.ts → re-export → context_memory_ports.ts（过渡期）
  context_memory_port_factory.ts → ports.ts + app/context.ts（装配层合法）
```

---

## Phase 14 — inference/behavior_tree 内部循环修复

**风险**: 低 — `inference/` 内部治理  
**涉及文件**: ~3  
**前置**: 无（可独立执行）  
**与设计文档对应**: §1.10, 决策 5.8

### 当前循环

```
evaluator.ts → composites.ts → evaluator.ts
evaluator.ts → decorators.ts → evaluator.ts
```

### 修复方向

- 将 `composites.ts` 和 `decorators.ts` 中对 `evaluator.ts` 的依赖提取为接口或注册机制
- 不新增 ESLint boundaries 元素类型（由 `inference/` 内部治理）

---

## Phase 15 — ESLint 新规则上线

**风险**: 高 — 可能暴露大量隐藏违规  
**涉及文件**: 1（`eslint.config.mjs`）  
**前置**: Phase 1–14 全部完成  
**与设计文档对应**: §2.3, §2.4

### 变更

在 `apps/server/eslint.config.mjs` 中：

1. 替换 `settings['boundaries/elements']` — 从 14 个旧类型变为 25 个新元素类型（含 9 个新增叶子类型）
2. 替换 `rules['boundaries/dependencies']` — `default: 'allow'` → `default: 'disallow'`，`severity: 'warn'` → `severity: 'error'`
3. 添加 20 条按类型的 `allow` 规则（对应 §2.4 配置片段）
4. `app-wiring` 反向禁止：`default: 'disallow'` 自然实现，无需额外规则

### 新增叶子元素类型（从原 `infra` 桶拆分）

| 新增元素 | 目录 | 原归属 |
|----------|------|--------|
| `infra-persist` | `src/db/**` | `infra` |
| `infra-config` | `src/config/**` | `infra` |
| `infra-op` | `src/operator/**` | `infra` |
| `infra-id` | `src/identity/**` | `infra` |
| `infra-memory` | `src/memory/**` | `infra` |
| `infra-context` | `src/context/**` | `infra` |
| `infra-plugins` | `src/plugins/**` | `infra` |
| `infra-clock` | `src/clock/**` | `infra` |
| `infra-conversation` | `src/conversation/**` | 未覆盖 |
| `infra-template` | `src/template_engine/**` | 未覆盖 |
| `infra-det` | `src/determinism/**` | 未覆盖 |
| `infra-obs` | `src/observability/**` | 未覆盖 |
| `infra-dynamics` | `src/dynamics/**` | `infra` |
| `infra-access` | `src/access_policy/**` | `infra` |
| `infra-permission` | `src/permission/**` | `infra` |
| `infra-world` | `src/world/**` | `infra` |
| `infra-kernel` | `src/kernel/**` | 未覆盖 |
| `infra-perception` | `src/perception/**` | 未覆盖 |
| `app-services` | `src/app/services/**` | `app` |
| `app-runtime` | `src/app/runtime/**` | `app` |
| `transport` | `src/app/routes/**`, `src/app/middleware/**`, `src/app/http/**` | `transport` |
| `app-wiring` | `src/app/context/**`, `src/app/composition/**`, `src/bootstrap/**`, `src/index.ts` | 部分 `app` |

### 验证

- `pnpm lint` 运行，记录所有违规
- 违规数为 0 或处于可控范围（≤ 10 个已知可修复违规）

---

## Phase 16 — 修复 ESLint 违规

**风险**: 高 — 文件数多，可能涉及重构  
**涉及文件**: ~20-50  
**前置**: Phase 15

### 策略

1. 按元素类型分组修复（infra-* 叶子层优先，然后是 domain/inference/ai，最后是 app-services/app-runtime）
2. 每次修复一批后运行 `pnpm typecheck && pnpm lint` 验证
3. 常见违规类型：
   - 跨层值导入（应改为类型导入或通过 DI）
   - 叶子层导入非 utils 模块
   - transport 层导入 core/domain 值

---

## Phase 17 — Repositories 组合接口移除

**风险**: 中 — ~30 文件需更新导入  
**涉及文件**: ~30  
**前置**: Phase 12, 16

### 变更

| 操作 |
|------|
| 删除 `types.ts` 中 `Repositories extends EntityRepositories, WorkflowRepositories, PluginRepositories {}` |
| 所有仍使用 `Repositories` 的消费者改为子接口或组合类型 `EntityRepositories & WorkflowRepositories & PluginRepositories` |
| `DataContext.repos` 类型从 `Repositories` 收窄为按需子接口 |

---

## Phase 18 — depcruise 升级为 error

**风险**: 低 — 仅当 cycle count = 0  
**涉及文件**: 1  
**前置**: Phase 1–17 全部完成

### 变更

`.dependency-cruiser.js` 中 `no-circular` 规则 `severity: 'warn'` → `severity: 'error'`

---

## Phase 19 — 非 services AppContext/AppInfrastructure 消费者迁移

**风险**: 中 — 涉及 plugins、domain、kernel、packs 跨模块消费者  
**涉及文件**: 12  
**前置**: Phase 10 (services 迁移完成，角色接口可用)  
**后置**: Phase 11 (旧 barrel 移除)

### 待迁移文件

| # | 文件 | 当前导入 | 实际使用的属性 | 目标角色接口 |
|---|------|---------|---------------|-------------|
| 1 | `packs/runtime/projections/pack_projection_scope_adapter.ts` | `AppContext` | 仅传递给 `createPackProjectionMetadataResolver(context)` | `PortContext & RuntimeContext` |
| 2 | `packs/runtime/projections/narrative_projection_service.ts` | `AppContext` | 传递给 scope adapter + `createPackNarrativeProjectionService(context)` | `DataContext & PortContext & RuntimeContext` |
| 3 | `packs/runtime/projections/entity_overview_service.ts` | `AppContext` | 传递给 scope adapter + `createPackEntityOverviewProjectionService(context)` | `DataContext & PortContext & RuntimeContext` |
| 4 | `domain/invocation/invocation_dispatcher.ts` | `AppInfrastructure` | `context.pack_runtime`, 传递给多个 callee | `DataContext & RuntimeContext & PortContext` |
| 5 | `domain/invocation/intent_grounder.ts` | `AppInfrastructure` | `context.pack_runtime["invocation_rules"]` | `DataContext & RuntimeContext` |
| 6 | `kernel/projections/operator_overview_service.ts` | `AppContext` | 仅传递给 callee (operator actions, overview routes) | `DataContext & PortContext` |
| 7 | `kernel/projections/projection_extractor.ts` | `AppContext` | `context.runtimeClockProjection` (Port) | `PortContext` |
| 8 | `plugins/worker/PluginWorkerClient.ts` | `AppContext` | 存储为字段，传递给 Manager | `DataContext & RuntimeContext & PortContext` |
| 9 | `plugins/worker/PluginWorkerManager.ts` | `AppContext` | `context.repos.plugin` (Data) | `DataContext` |
| 10 | `plugins/worker/host_call_handler.ts` | `AppContext` | `context.appContext.requestPluginInference`, `getPackHostApi(context.appContext)` | `PortContext` |
| 11 | `plugins/runtime.ts` | `AppContext` | `context.repos.plugin` (Data) | `DataContext` |
| 12 | `plugins/context.ts` | `AppContext`, `NotificationStore` | `context.notifications`, `context.isRuntimeReady()`, `context.assertRuntimeReady()` | `RuntimeContext` |

### 迁移策略

1. **纯传递型**（#1, #2, #3, #6）: 文件自身不访问 context 属性，仅传递给 callee。改为 callee 所需的角色接口交集。如果 callee 也需迁移，同步处理。

2. **DataContext 使用者**（#9, #11）: 仅访问 `context.repos.plugin`。直接改为 `DataContext`。

3. **RuntimeContext 使用者**（#5, #12）: 访问 `context.pack_runtime` / `context.notifications` / `context.isRuntimeReady()` 等。改为 `RuntimeContext`（#12）或 `DataContext & RuntimeContext`（#5）。

4. **PortContext 使用者**（#7, #10）: 访问 `context.runtimeClockProjection` / `context.requestPluginInference`。改为 `PortContext`。

5. **混合使用者**（#4, #8）: 多角色访问或跨模块传递。使用 `DataContext & RuntimeContext & PortContext` 交集。

### 特殊注意事项

- `plugins/runtime.ts` (`syncPackPluginRuntime`): Phase 10 中有 2 处通过 `as unknown as AppContext` 桥接调用。迁移后移除 cast。
- `plugins/context.ts`: 同时从旧 barrel 导入 `NotificationStore`。迁移后改为从 `runtime_context.ts` 独立导入。
- `domain/invocation/` 两个文件使用 `AppInfrastructure`（deprecated 过渡类型）。迁移后彻底消除 `AppInfrastructure` 引用。
- `host_call_handler.ts`: 使用 `context.appContext` 嵌套模式，需要审查 `PluginCallContext` 类型定义。

### 验证门

- `pnpm typecheck` 通过
- `pnpm lint` 无新增错误
- 所有 `as unknown as AppContext` / `as unknown as AppInfrastructure` bridge cast 移除
- `AppInfrastructure` 在代码库中的引用归零

---

## 执行顺序与依赖关系

```
Phase 0 (评审确认)
  └─ Phase 1 (角色接口创建)
       ├─ Phase 2 (memory)
       ├─ Phase 3 (domain)
       ├─ Phase 4 (inference) ──── 依赖 Phase 2
       ├─ Phase 5 (ai)
       ├─ Phase 6 (packs)
       ├─ Phase 7 (plugins + registry 移动) ─── 依赖 Phase 1
       ├─ Phase 8 (operator)
       ├─ Phase 9 (social lazy import) ─── 可独立执行
       ├─ Phase 10 (app/services) ──── 依赖 Phase 7
       ├─ Phase 19 (非 services 消费者) ─── 依赖 Phase 10
       └─ Phase 11 (旧 barrel 移除) ── 依赖 Phase 2-10, 19

Phase 12 (Repositories 子接口) ─── 依赖 Phase 1
Phase 13 (context_memory_ports 上移) ─── 依赖 Phase 1
Phase 14 (behavior_tree 循环) ─── 可独立执行 ✓ 已完成

Phase 15 (ESLint 新规则) ─── 依赖 Phase 1-14 ✓ 已完成
  └─ Phase 16 (修复违规) ─── 依赖 Phase 15 ✓ 已完成
       └─ Phase 17 (Repositories 组合接口移除) ─── 依赖 Phase 12, 16 ✓ 已完成
            └─ Phase 18 (depcruise error) ─── 依赖 Phase 1-17, 19
```

### 可并行执行

- Phase 2–9 之间大部分独立（除依赖 Phase 1 外）
- Phase 9（social lazy import）可随时执行
- Phase 12（Repositories 子接口）可与 Phase 2-11 并行
- Phase 14（behavior_tree 循环）可随时执行

### 关键路径（最长串行链）

```
Phase 0 → Phase 1 → Phase 4 → Phase 10 → Phase 19 → Phase 11 → Phase 18
```

估计总工作量：**~45-65 小时**（19 个 Phase，~90-200 文件涉及）

### 当前进度（截至 2026-05-31）

| Phase | 状态 |
|-------|------|
| 0-19 | ✅ 全部完成 |
| 18 | ✅ 完成 (0 runtime cycles, severity: error) |

---

## 回滚策略

每个 Phase 通过 git commit 隔离。如果 Phase N+1 出现问题：

1. `git revert <phase-N+1-commit>` 回滚该 Phase
2. Phase N 及之前的状态不受影响（每个 Phase 独立提交）

### 关键回滚点

| Phase | 回滚影响 |
|-------|----------|
| Phase 1 | 回滚时需恢复旧 `app/context.ts`，Phase 2-10 的迁移也必须回滚 |
| Phase 7 | registry 物理移动涉及 13+ 文件，回滚需恢复 `plugins/runtime.ts` 和所有消费者导入 |
| Phase 15 | ESLint 规则上线后回滚只需恢复 `eslint.config.mjs`，违规修复（Phase 16）不受影响 |

---

## 风险矩阵

| Phase | 风险 | 最大风险点 | 缓解措施 |
|-------|------|-----------|---------|
| 1 | 低 | 类型重导出不完整 | `pnpm typecheck` pre-commit |
| 4 | 中 | `pipeline.ts` 跨 3 个角色接口 | 交叉类型 `DataContext & RuntimeContext & PortContext` |
| 7 | 中 | registry 移动破坏插件加载 | 过渡期 re-export + 全量测试 |
| 10 | 中 | 服务层文件多，遗漏消费者 | grep 扫描确认 |
| 12 | 中 | Repositories barrel 消费者未迁移 | Phase 17 前不删除组合接口 |
| 15 | 高 | ESLint 新规则暴露大量违规 | 先在 warn 模式试运行，再切换 error |
| 16 | 高 | 违规修复引发重构 | 按元素类型分组修复，逐组验证 |
| 17 | 中 | ~30 文件导入更新 | 自动化脚本辅助批量替换 |
