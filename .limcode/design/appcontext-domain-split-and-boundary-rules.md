# AppContext 领域拆分 + ESLint 边界规则重写

## 动机

`apps/server/src/app/context.ts` 被 **52 个文件**导入，暴露接口 `AppInfrastructure`（12 个成员）+ `AppContextPorts`（8 个成员）+ 自身定义（11 个成员），合计 30+ 属性/方法揉在一个接口里。这导致：

- 使用者无法判断自己依赖了哪些子系统
- eslint-plugin-boundaries 当前 `default: 'allow'`，只有 3 条限制规则；depcruise 报告 **35 条唯一循环依赖**
- 新增模块没有明确的"我应该导入什么"指南

本文档定义拆分方案和新的边界规则。拆分后每个文件只需导入它实际使用的最小角色接口。

---

## 1. AppContext 领域拆分

### 1.1 目标

`AppContext` 拆为 4 个角色接口，放入 `apps/server/src/app/context/` 目录：

```
apps/server/src/app/context/
  data_context.ts       — 数据访问
  runtime_context.ts    — 模拟运行时
  port_context.ts       — 外部端口/扩展
  index.ts              — 组合接口 AppContext + re-export
```

### 1.2 当前 AppContext 完整结构

当前 `AppContext extends AppInfrastructure, AppContextPorts`，实际成员分布如下：

**`AppInfrastructure`（`app/context.ts:54-72`）**：

| 成员 | 类型 | 建议归属 |
|------|------|---------|
| `repos` | `Repositories` | DataContext |
| `prisma` | `PrismaClient` | DataContext |
| `conversationStore` | `ConversationStore` | **PortContext** |
| `packStorageAdapter` | `PackStorageAdapter` | DataContext |
| `schedulerStorage?` | `SchedulerStorageAdapter` | DataContext |
| `notifications` | `NotificationStore` | RuntimeContext |
| `startupHealth` | `StartupHealth` | RuntimeContext |
| `assertRuntimeReady` | `(feature: string) => void` | RuntimeContext |
| `isRuntimeReady` | `() => boolean` | RuntimeContext |
| `setRuntimeReady` | `(ready: boolean) => void` | RuntimeContext |
| `isPaused` | `() => boolean` | RuntimeContext |
| `setPaused` | `(paused: boolean) => void` | RuntimeContext |
| `requestPluginInference?` | `(input) => Promise<result>` | PortContext |
| `pluginRuntime?` | `{ getContextSourceAdapters; getPerceptionResolvers }` | PortContext |

**`AppContextPorts`（`app/services/app_context_ports.ts:35-44`）**：

| 成员 | 类型 | 建议归属 |
|------|------|---------|
| `runtimeBootstrap?` | `RuntimeDatabaseBootstrap` | PortContext |
| `packRuntimeObservation?` | `PackRuntimeObservation` | PortContext |
| `packRuntimeControl?` | `PackRuntimeControl` | PortContext |
| `packRuntimeLookup?` | `PackRuntimeLookupPort` | PortContext |
| `worldEngine?` | `WorldEnginePort` | PortContext |
| `packHostApi?` | `PackHostApi` | PortContext |
| `runtimeClockProjection?` | `RuntimeClockProjectionService` | PortContext |
| `contextAssembly?` | `ContextAssemblyPort` | PortContext |

**`AppContext` 自身（`app/context.ts:74-95`）**：

| 成员 | 类型 | 建议归属 |
|------|------|---------|
| `packScope` | `PackScopeResolver` | RuntimeContext |
| `packCatalog` | `PackCatalogService` | RuntimeContext |
| `getPackRuntimeHandle` | `(packId: string) => PackRuntimeHandle \| null` | RuntimeContext |
| `listLoadedPackRuntimeIds` | `() => string[]` | RuntimeContext |
| `getPackRuntimeHost` | `(packId: string) => PackRuntimeHost \| null` | PortContext |
| `getSpatialRuntime?` | `() => SpatialRuntime \| null` | RuntimeContext |
| `getRuntimeLoopDiagnostics` | `() => RuntimeLoopDiagnostics` | RuntimeContext |
| `setRuntimeLoopDiagnostics` | `(next: RuntimeLoopDiagnostics) => void` | RuntimeContext |
| `getDatabaseHealth` | `() => DatabaseHealthSnapshot \| null` | DataContext |
| `getPluginEnableWarningConfig` | `() => { enabled; require_acknowledgement }` | PortContext |
| `worldEngineStepCoordinator` | `WorldEngineStepCoordinator` | PortContext |
| `runtimeClockProjection` | `RuntimeClockProjectionService` | PortContext |
| `pluginRuntimeControl?` | `{ reload(packId) => Promise<...> }` | PortContext |

> **注意**：原始草案的 PortContext 遗漏了 `AppContextPorts` 的 4 个成员（`runtimeBootstrap`、`packRuntimeObservation`、`packRuntimeControl`、`packRuntimeLookup`）和 `AppContext` 自身的 `getPluginEnableWarningConfig`（共 5 个）。上表已补全。

### 1.3 DataContext — 数据访问

**消费者查证（使用 `repos`、`prisma`、`packStorageAdapter`、`schedulerStorage`、`getDatabaseHealth` 之一或全部）**：

| 文件 | 实际使用的 context 属性 |
|------|------------------------|
| `memory/blocks/evaluation_context.ts` | `repos` |
| `memory/recording/compaction_service.ts` | `repos` |
| `memory/short_term_adapter.ts` | `repos` |
| `memory/service.ts` | （类型声明用 AppInfrastructure） |
| `domain/authority/resolver.ts` | `packStorageAdapter` |
| `domain/perception/resolver.ts` | `packStorageAdapter` |
| `domain/rule/enforcement_engine.ts` | `repos`, `prisma`, `packStorageAdapter`, `worldEngine`, `getSpatialRuntime` |
| `domain/invocation/intent_grounder.ts` | `pack_runtime`（非 DataContext 成员） |
| `inference/context/pipeline.ts` | `repos`, `prisma`, `packStorageAdapter`, `startupHealth`, `assertRuntimeReady`, `contextAssembly`, `getPackRuntimeHost` |
| `inference/context/state_snapshot_builder.ts` | `prisma` |
| `inference/service.ts` | `conversationStore` |
| `ai/observability.ts` | `repos` |
| `operator/audit/logger.ts` | `repos` |
| `operator/auth/token.ts` | `repos` |
| `operator/guard/pack_access.ts` | `repos` |
| `operator/guard/subject_resolver.ts` | `repos` |
| `access_policy/service.ts` | `repos` |
| `context/overlay/store.ts` | `prisma` |
| `context/service.ts` | `prisma` |
| `packs/runtime/projections/pack_entity_overview_projection_service.ts` | `packStorageAdapter` |
| `packs/runtime/projections/pack_narrative_projection_service.ts` | `packStorageAdapter`, `repos` |
| `packs/snapshots/auto_snapshot_service.ts` | `packStorageAdapter`, `prisma`, `getPackRuntimeHandle` |

跨角色消费者比例高：`enforcement_engine.ts` 需要 DataContext + RuntimeContext（`getSpatialRuntime` 已从 PortContext 降级到 RuntimeContext）+ PortContext（`worldEngine`）；`pipeline.ts` 需要 DataContext + PortContext + RuntimeContext。

```typescript
// apps/server/src/app/context/data_context.ts
import type { PrismaClient } from '@prisma/client';
import type { PackStorageAdapter } from '../../packs/storage/PackStorageAdapter.js';
import type { SchedulerStorageAdapter } from '../../packs/storage/SchedulerStorageAdapter.js';
import type { Repositories } from '../services/repositories/types.js';
import type { DatabaseHealthSnapshot } from '../../db/sqlite_runtime.js';

export interface DataContext {
  readonly repos: Repositories;
  readonly prisma: PrismaClient;
  readonly packStorageAdapter: PackStorageAdapter;
  readonly schedulerStorage?: SchedulerStorageAdapter;
  getDatabaseHealth(): DatabaseHealthSnapshot | null;
}
```

### 1.4 RuntimeContext — 模拟运行时

```typescript
// apps/server/src/app/context/runtime_context.ts
import type { PackRuntimeHandle } from '../../core/pack_runtime_handle.js';
import type { NotificationLevel, SystemMessage } from '../../utils/notifications.js';
import type { PackScopeResolver } from '../runtime/PackScopeResolver.js';
import type { PackCatalogService } from '../services/app_context_ports.js';
import type { HealthLevel } from '../../core/pack_runtime_health.js';

export interface StartupHealth {
  level: HealthLevel;
  checks: { db: boolean; world_pack_dir: boolean; world_pack_available: boolean };
  available_world_packs: string[];
  errors: string[];
}

export interface NotificationStore {
  push(level: NotificationLevel, content: string, code?: string, details?: Record<string, unknown>): SystemMessage;
  getMessages(): SystemMessage[];
  clear(): void;
}

export interface RuntimeLoopDiagnostics {
  status: 'idle' | 'scheduled' | 'running' | 'paused' | 'stopped';
  in_flight: boolean;
  overlap_skipped_count: number;
  iteration_count: number;
  last_started_at: number | null;
  last_finished_at: number | null;
  last_duration_ms: number | null;
  last_error_message: string | null;
}

export interface RuntimeContext {
  readonly notifications: NotificationStore;
  readonly startupHealth: StartupHealth;
  assertRuntimeReady(feature: string): void;
  isRuntimeReady(): boolean;
  setRuntimeReady(ready: boolean): void;
  isPaused(): boolean;
  setPaused(paused: boolean): void;
  getRuntimeLoopDiagnostics(): RuntimeLoopDiagnostics;
  setRuntimeLoopDiagnostics(next: RuntimeLoopDiagnostics): void;
  readonly packScope: PackScopeResolver;
  readonly packCatalog: PackCatalogService;
  getPackRuntimeHandle(packId: string): PackRuntimeHandle | null;
  listLoadedPackRuntimeIds(): string[];
  getSpatialRuntime?(): import('../../packs/runtime/spatial_runtime.js').SpatialRuntime | null;
}
```

### 1.5 PortContext — 外部端口与扩展

```typescript
// apps/server/src/app/context/port_context.ts
import type { ConversationStore } from '../../conversation/store.js';
import type { PackRuntimeHost } from '../../core/pack_runtime_host.js';
import type { WorldEngineStepCoordinator } from '../runtime/world_engine_coordinator.js';
import type { RuntimeClockProjectionService } from '../runtime/runtime_clock_projection.js';
import type { WorldEnginePort, PackHostApi } from '../runtime/world_engine_ports.js';
import type { ContextAssemblyPort } from '../services/context/context_memory_ports.js';
import type { RuntimeDatabaseBootstrap } from '../runtime/runtime_bootstrap.js';
import type { PackRuntimeObservation, PackRuntimeControl, PackRuntimeLookupPort } from '../../core/pack_runtime_ports.js';

export interface PortContext {
  // 对话存储（ConversationStore 接口定义在 conversation/，实现也在 conversation/）
  readonly conversationStore: ConversationStore;

  // 运行时端口（来自 AppContextPorts）
  readonly worldEngine?: WorldEnginePort;
  readonly packHostApi?: PackHostApi;
  readonly worldEngineStepCoordinator?: WorldEngineStepCoordinator;
  readonly runtimeClockProjection?: RuntimeClockProjectionService;
  readonly contextAssembly?: ContextAssemblyPort;
  readonly runtimeBootstrap?: RuntimeDatabaseBootstrap;
  readonly packRuntimeObservation?: PackRuntimeObservation;
  readonly packRuntimeControl?: PackRuntimeControl;
  readonly packRuntimeLookup?: PackRuntimeLookupPort;

  // 运行时方法
  getPackRuntimeHost(packId: string): PackRuntimeHost | null;

  // 插件扩展
  readonly pluginRuntime?: {
    getContextSourceAdapters(packId: string): unknown[];
    getPerceptionResolvers(packId: string): unknown[];
  };
  readonly pluginRuntimeControl?: {
    reload(packId: string): Promise<{ pack_id: string; runtime_count: number }>;
  };
  requestPluginInference?(input: import('../../plugins/types.js').PluginInferenceRequest): Promise<import('../../plugins/types.js').PluginInferenceResult>;
  getPluginEnableWarningConfig(): { enabled: boolean; require_acknowledgement: boolean };
}
```

> **`getPackRuntimeHandle` vs `getPackRuntimeHost`**：维持拆分。`PackRuntimeHandle` 是轻量只读快照（归 `RuntimeContext`），`PackRuntimeHost` 提供完整操作能力（归 `PortContext`）。消费者若同时需要两者则导入两个角色接口，语义边界清晰。
>
> **`getSpatialRuntime`**：从 `PortContext` 降级到 `RuntimeContext`。`getSpatialRuntime` 本质是查询运行时空间能力（只读），与 `getPackRuntimeHandle` 性质一致，归入 `RuntimeContext` 更合理。这减少了 `domain/rule/enforcement_engine.ts` 的跨角色依赖——它从需要 DataContext + PortContext + RuntimeContext 三个接口降为 DataContext + RuntimeContext。
>
> **`pluginRuntimeRegistry` 迁移**：采用方案 C，将 `pluginRuntimeRegistry` 从 `plugins/runtime.ts` 移入 `app/runtime/`。`plugins/` 内部通过依赖注入获得 registry 引用。这消除了方向 2（app/ → plugins/runtime）的跨层值导入，彻底切断循环。见 §1.8.3。

### 1.6 DataContext 内部分解：Repositories 拆分

#### 1.6.1 当前结构

```
Repositories (10 成员)
├── agent
├── inference
├── identityOperator
├── plugin
├── relationship
├── memory
├── workflowSteps
├── workflowRuns
├── social
└── narrative
```

循环 `types.ts → workflow_step_repository.ts → workflow_types.ts → app/context.ts → types.ts` 是 depcruise 报告的循环之一。

#### 1.6.2 拆分方案

```typescript
// apps/server/src/app/services/repositories/entity_repos.ts
import type { AgentRepository } from './AgentRepository.js';
import type { IdentityOperatorRepository } from './IdentityOperatorRepository.js';
import type { RelationshipGraphRepository } from './RelationshipGraphRepository.js';
import type { MemoryRepository } from './MemoryRepository.js';
import type { NarrativeEventRepository } from './NarrativeEventRepository.js';
import type { SocialRepository } from './SocialRepository.js';

export interface EntityRepositories {
  readonly agent: AgentRepository;
  readonly identityOperator: IdentityOperatorRepository;
  readonly relationship: RelationshipGraphRepository;
  readonly memory: MemoryRepository;
  readonly narrative: NarrativeEventRepository;
  readonly social: SocialRepository;
}
```

```typescript
// apps/server/src/app/services/repositories/workflow_repos.ts
import type { InferenceWorkflowRepository } from './InferenceWorkflowRepository.js';
import type { WorkflowRunRepository } from '../workflow/workflow_run_repository.js';
import type { WorkflowStepRunRepository } from '../workflow/workflow_step_repository.js';

export interface WorkflowRepositories {
  readonly inference: InferenceWorkflowRepository;
  readonly workflowRuns: WorkflowRunRepository;
  readonly workflowSteps: WorkflowStepRunRepository;
}
```

```typescript
// apps/server/src/app/services/repositories/plugin_repos.ts
import type { PluginRepository } from './PluginRepository.js';

export interface PluginRepositories {
  readonly plugin: PluginRepository;
}
```

```typescript
// apps/server/src/app/services/repositories/types.ts — 组合接口（过渡期，@deprecated）
import type { EntityRepositories } from './entity_repos.js';
import type { WorkflowRepositories } from './workflow_repos.js';
import type { PluginRepositories } from './plugin_repos.js';

/**
 * @deprecated 使用具体的子接口（EntityRepositories、WorkflowRepositories、
 * PluginRepositories）代替。此组合接口将在 Phase 16 移除。
 */
export type { EntityRepositories } from './entity_repos.js';
export type { WorkflowRepositories } from './workflow_repos.js';
export type { PluginRepositories } from './plugin_repos.js';

/** @deprecated 使用具体子接口代替。Phase 16 移除。 */
export interface Repositories extends EntityRepositories, WorkflowRepositories, PluginRepositories {}
```

**关于向后兼容性和循环消除的矛盾**：保留 `types.ts` 作为组合 barrel 意味着 `Repositories` 仍然传递性地依赖所有三个子接口的全部导入。消费者如果只通过 `types.ts` 导入 `Repositories`，循环不会被消除——depcruise 仍然追踪到 `types.ts → workflow_step_repository.ts → … → app/context.ts`。

循环消除的前提是：**消费者迁移到直接从子接口文件导入**，而非通过 `types.ts` barrel。`types.ts` 的组合接口标记为 `@deprecated`，在 Phase 15 完成所有消费者迁移后，Phase 16 单独移除组合接口和 `types.ts` barrel。

工厂代码只返回扁平对象，不提供嵌套访问路径：

```typescript
// factory.ts — 保持现有扁平结构
export function createPrismaRepositories(prisma: PrismaClient): Repositories {
  return {
    agent: new PrismaAgentRepository(prisma),
    identityOperator: new PrismaIdentityOperatorRepository(prisma),
    relationship: new PrismaRelationshipGraphRepository(prisma),
    memory: new PrismaMemoryRepository(prisma),
    narrative: new PrismaNarrativeEventRepository(prisma),
    social: new PrismaSocialRepository(prisma),
    inference: new PrismaInferenceWorkflowRepository(prisma),
    workflowRuns: new PrismaWorkflowRunRepository(prisma),
    workflowSteps: new PrismaWorkflowStepRunRepository(prisma),
    plugin: new PrismaPluginRepository(prisma),
  };
}
```

消费者访问路径不变：`context.repos.agent`，而非 `context.repos.entities.agent`。子接口只用于类型声明（`function foo(repos: EntityRepositories)`），不用于运行时嵌套访问。

#### 1.6.3 收益

1. **循环隔离**：消费者从 `entity_repos.ts` 直接导入 `EntityRepositories` 时，依赖图不经过 `workflow_step_repository.ts`。仅当消费者通过 `types.ts` 的 `Repositories` 导入时仍保留循环传递。
2. **消费者自文档化**：`import type { EntityRepositories } from ...` 一眼可知该模块只访问实体数据。
3. **类型隔离**：TypeScript 重算隔离——插件消费者不会因为 `workflow_step_repository.ts` 的类型变更而触发重编译。
4. **为 AppContext 拆分铺路**：`DataContext` 可以将 `repos` 的类型从 `Repositories` 收窄为 `EntityRepositories`。

#### 1.6.4 代价

1. **`agent.ts` 和 `memory` 层跨两个子集**。`agent.ts` 使用 `EntityRepositories` 成员 + `WorkflowRepositories.inference`。这是协调层的合理职责。
2. **接口数量从 1 → 4**。理解成本略增，但每个接口更小、边界更清晰。
3. **组合 barrel 标记为 `@deprecated`**——Phase 15 之前保留，Phase 16 单独移除。消费者需逐步迁移到子接口直接导入。

#### 1.6.5 不单独实施

Repositories 拆分独立做收益有限（循环消除需要消费者迁移），必须配合 AppContext 角色接口拆分。在实施序列中作为 Phase 1.5 执行。

---

### 1.7 AppContext — 组合

仅 `bootstrap/providers/context.ts`、`index.ts`、路由注册函数使用完整 `AppContext`。

```typescript
// apps/server/src/app/context/app_context.ts
import type { DataContext } from './data_context.js';
import type { RuntimeContext } from './runtime_context.js';
import type { PortContext } from './port_context.js';

export interface AppContext extends DataContext, RuntimeContext, PortContext {}

export type RouteRegistrar = (app: import('express').Express, context: AppContext) => void;
```

```typescript
// apps/server/src/app/context/index.ts
export type { DataContext } from './data_context.js';
export type { RuntimeContext, NotificationStore, StartupHealth, RuntimeLoopDiagnostics } from './runtime_context.js';
export type { PortContext } from './port_context.js';
export type { AppContext } from './app_context.js';
export type { RouteRegistrar } from './app_context.js';
```

### 1.8 子系统分析：plugins

#### 1.8.1 内部结构

`plugins/` 共 22 文件，内部依赖图完全无环。depcruise 在 `plugins/` 内部零报告。

```
                    ┌──────────────┐
                    │  runtime.ts  │ ← 中心枢纽，导出 pluginRuntimeRegistry 单例
                    └──────┬───────┘
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────────┐
    │ dependency  │ │  worker/*   │ │ extensions/*    │
    │ _resolver    │ │  (8 文件)   │ │ (3 注册表)      │
    └─────────────┘ └──────┬──────┘ └─────────────────┘
                           │
                    ┌──────▼──────┐
                    │ capability  │
                    │  _keys.ts   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ context.ts  │
                    │ types.ts    │
                    │ service.ts  │ ← 叶子节点
                    │ store.ts    │
                    │ discovery.ts│
                    │ contracts.ts│
                    └─────────────┘
```

#### 1.8.2 问题：与 app/ 的双向导入

**方向 1 — `plugins/` → `app/`（类型导入）**：

| 文件 | 导入 |
|------|------|
| `plugins/context.ts` | `AppContext` 完整类型 |
| `plugins/runtime.ts` | `AppContext` |
| `plugins/worker/PluginWorkerManager.ts` | `AppContext` |
| `plugins/worker/PluginWorkerClient.ts` | `AppContext` |
| `plugins/worker/host_call_handler.ts` | `AppContext` |

**方向 2 — app/ 和其他层 → `plugins/runtime`（值导入 `pluginRuntimeRegistry`）**：

实际 **13 处值导入**（超出原始草案列出范围）：

| 文件 | 使用的方法 |
|------|-----------|
| `app/runtime/MultiPackLoopHost.ts` | `getLoopHooks` |
| `app/runtime/plugin_contributor_adapter.ts` | `getRuleContributors`, `getQueryContributors` |
| `app/runtime/world_engine_persistence.ts` | `getStepContributors` |
| `app/runtime/perception_pipeline.ts` | `getPerceptionResolvers` |
| `app/routes/plugin_runtime_server.ts` | `getRuntime` |
| `app/routes/pack_actions.ts` | `listRuntimes` |
| `app/composition/inference.ts` | `listRuntimes` |
| `app/services/pack/pack_scoped_plugin_runtime_service.ts` | `syncPackPluginRuntime` |
| `app/services/runtime/experimental_multi_pack_runtime.ts` | `syncPackPluginRuntime` |
| `packs/orchestration/pack_runtime_registry_service.ts` | `clearRuntimes` |
| `context/workflow/orchestrator.ts` | `getPromptWorkflowStepExecutors` |
| `bootstrap/providers/context.ts` | 注入到 context |
| `index.ts` | 启动时加载 |

`pluginRuntimeRegistry` 的 11 个公共方法：

| 方法 | 外部消费者数 |
|------|-------------|
| `listRuntimes` | 4 |
| `getPerceptionResolvers` | 2 |
| `getStepContributors` | 1 |
| `getRuleContributors` | 1 |
| `getQueryContributors` | 1 |
| `getPromptWorkflowStepExecutors` | 1 |
| `getLoopHooks` | 1 |
| `getRuntime` | 1 |
| `replaceRuntimes` | 1 |
| `clearRuntimes` | 1 |
| `getContextSourceAdapters` | 0（仅内部使用） |

草案中 `PortContext.pluginRuntime` 代理仅覆盖 2 个方法。完整代理需要覆盖 10 个方法（排除 `getContextSourceAdapters`），几乎等于暴露整个 registry 的只读子集。

#### 1.8.3 修复策略：将 `pluginRuntimeRegistry` 移入 `app/runtime/`（已决策）

**决策**：采用方案 C——将 `pluginRuntimeRegistry` 单例从 `plugins/runtime.ts` 移入 `app/runtime/`。

实施步骤：

1. 在 `app/runtime/` 新建 `plugin_runtime_registry.ts`，将 `PluginRuntimeRegistry` 类和 `pluginRuntimeRegistry` 导出移入
2. `plugins/runtime.ts` 改为从 `app/runtime/plugin_runtime_registry.js` re-export（过渡期），同时内部使用改为通过依赖注入获取
3. 当前直接值导入 `pluginRuntimeRegistry` 的 13 处消费者改为从 `app/runtime/plugin_runtime_registry.ts` 导入——全部在 `app/` 或 `packs/` 层，不跨层
4. `plugins/` 内部如果需要操作 registry（如 `syncPackPluginRuntime`），通过构造函数注入或 `PortContext.pluginRuntimeControl` 获取
5. 过渡期结束后，`plugins/runtime.ts` 的 re-export 移除

效果：方向 1（plugins/ → app/ 类型导入）通过角色接口修复；方向 2（app/ → plugins/runtime 值导入）通过物理移动修复。循环完全消除。

#### 1.8.4 结论

`plugins/` 内聚性好（22 文件、零内循环），不需要内部重构。通过将 `pluginRuntimeRegistry` 移入 `app/runtime/` + 角色接口拆分，即可完全消除 `plugins/` 的外部循环。

---

### 1.9 子系统分析：`infra-context` 与 `app-services/context` 的关系

#### 1.9.1 两个目录的角色

```
src/context/                      ← 31 文件，领域逻辑
  ├── service.ts                  → 上下文组装核心（buildContextRun）
  ├── source_registry.ts          → 上下文源注册与适配器
  ├── sources/*                   → 具体上下文源（memory_blocks, overlay, spatial 等）
  ├── overlay/store.ts            → 覆盖层持久化
  ├── policy_engine.ts            → 上下文策略评估
  ├── workflow/orchestrator.ts    → 提示工作流编排
  ├── workflow/executors/*        → 工作流步骤执行器（7 个）
  └── types.ts                    → ContextRun, ContextNode 等核心类型

src/app/services/context/         ← 3 文件，端口 + 装配
  ├── context_memory_ports.ts     → ContextAssemblyPort / MemoryRuntimePort 接口
  ├── context_memory_port_factory.ts → 工厂（DI 装配，接收 AppContext，产生端口实现）
  └── context_assembler.ts        → 扩展推理上下文组装
```

#### 1.9.2 问题：端口定义放在了错误的层级

两条 depcruise 报告的循环：

**链 A — 类型级**：
```
app/services/context/context_memory_ports.ts
  → (type) context/service.ts
    → (type) app/context.ts
      → app_context_ports.ts
        → context_memory_ports.ts       ← CYCLE
```

**链 B — 值级**：
```
app/services/context/context_memory_port_factory.ts
  → (value) context/service.ts
  → (value) memory/service.ts
    → (value) app/context.ts
      → app_context_ports.ts
        → context_memory_ports.ts       ← CYCLE
```

#### 1.9.3 修复：端口定义上移

将 `ContextAssemblyPort` 和 `MemoryRuntimePort` 从 `app/services/context/context_memory_ports.ts` 移动到 `src/context/ports.ts`。

修复后 `context/service.ts` 从 `ports.ts` 导入（打破链 A）。`context_memory_port_factory.ts` 继续在 `app/services/context/`，同时导入 `ports.ts` 和 `app/context.ts`（装配层，不产生循环）。

---

### 1.10 子系统分析：`inference/providers/behavior_tree/` 内部循环

depcruise 报告两条 `inference/` 内部循环：

```
evaluator.ts → composites.ts → evaluator.ts
evaluator.ts → decorators.ts → evaluator.ts
```

这是 `inference/` 子目录内部的自引用循环，与 AppContext 无关。ESLint boundaries 将 `inference/` 视为单一元素类型，不区分子目录，因此 boundaries 规则无法检测此循环。

**修复方向**：由 `inference/` 内部治理——将 `composites.ts` 和 `decorators.ts` 中对 `evaluator.ts` 的依赖提取为接口或注册机制。不新增 boundaries 元素类型。

---

### 1.11 子系统分析：`access_policy` 与 `social` 循环

depcruise 报告：

```
SocialRepository.ts → social/social.ts → access_policy/service.ts → app/context.ts → ... → SocialRepository.ts
```

`SocialRepository.ts` 通过 **lazy dynamic import**（`await import('../social/social.js')`）引用 `social.ts`，`social.ts` 又 lazy import `access_policy/service.ts`。depcruise 将 dynamic import 计入循环。

**修复决策**：重构为静态依赖。将 `SocialRepository` 中对 `social/social.ts` 和 `social.ts` 中对 `access_policy/service.ts` 的 lazy import 改为直接导入，再通过 AppContext 角色接口拆分截断循环链。lazy import 在此处不是必要的运行时优化（模块已在同一包内），消除后不增加加载成本。

---

## 2. ESLint 边界规则重写

### 2.1 当前问题

```javascript
// 当前配置 — 仅 3 条限制规则，default: 'allow'
'boundaries/dependencies': ['warn', {
  default: 'allow',
  rules: [
    { from: 'core',    disallow: [...] },
    { from: 'utils',   disallow: [...] },
    { from: 'transport', disallow: [...] },
  ]
}]
```

当前配置将 `dynamics/`、`world/`、`access_policy/`、`permission/`、`init/`、`narrative/`（空目录）全部归类为 `infra`，且无约束。其他目录完全不被覆盖。

### 2.2 新元素划分（25 种）

完整映射，覆盖全部 28 个 `src/` 顶级目录（`cli/` 和 `narrative/` 豁免）：

| 类型 | 模式 | 文件数 | 说明 |
|------|------|--------|------|
| `utils` | `src/utils/**` | 12 | 通用工具 |
| `core` | `src/core/**` | 17 | 仿真核心、时钟、步骤策略 |
| `domain` | `src/domain/**` | 11 | 权限解析、调用分发、规则执行 |
| `inference` | `src/inference/**` | 46 | 推理服务、上下文组装、tokenizer |
| `ai` | `src/ai/**` | 34 | AI Gateway、provider、路由、可观测 |
| `packs` | `src/packs/**` | 49 | World-pack 加载、投影、快照、存储 |
| `infra-persist` | `src/db/**` | 5 | 数据库连接、迁移、完整性 |
| `infra-config` | `src/config/**` | 22 | 运行时配置、模型注册 |
| `infra-op` | `src/operator/**` | 8 | 操作员身份、审计、授权 |
| `infra-id` | `src/identity/**` | 2 | 身份类型 |
| `infra-memory` | `src/memory/**` | 16 | 记忆块、录制、嵌入 |
| `infra-context` | `src/context/**` | 31 | 上下文源注册、覆盖层、工作流编排 |
| `infra-plugins` | `src/plugins/**` | 23 | 插件运行时、Worker |
| `infra-clock` | `src/clock/**` | 2 | 时钟引擎 |
| `infra-conversation` | `src/conversation/**` | 14 | 对话存储（含 Prisma 实现 + 接口） |
| `infra-template` | `src/template_engine/**` | 14 | 模板引擎 |
| `infra-det` | `src/determinism/**` | 6 | 确定性工具 |
| `infra-obs` | `src/observability/**` | 2 | 可观测性 |
| `infra-dynamics` | `src/dynamics/**` | 3 | 动力学算法 |
| `infra-access` | `src/access_policy/**` | 3 | 访问策略引擎 |
| `infra-permission` | `src/permission/**` | 1 | 权限类型定义 |
| `infra-world` | `src/world/**` | 1 | World bootstrap |
| `infra-kernel` | `src/kernel/**` | 3 | 安装和投影 |
| `infra-perception` | `src/perception/**` | 5 | 感知规则引擎 |
| `app-services` | `src/app/services/**` | 172 | 编排、查询组装、仓储 |
| `app-runtime` | `src/app/runtime/**` | 49 | 仿真循环、调度器、World Engine 协调 |
| `transport` | `src/app/routes/**`, `src/app/middleware/**`, `src/app/http/**` | — | HTTP 传输层 |
| `app-wiring` | `src/app/context/**`, `src/app/composition/**`, `src/bootstrap/**`, `src/index.ts` | — | 组合根 |

> **豁免**：`src/cli/`（CLI 入口）、`src/init/`（初始化脚本）— 这两者通过 `no-console: off` 和独立规则集管理，不在边界规则中约束。`src/narrative/` 为空目录，忽略。

**各新增元素类型的依赖方向**：

- `infra-conversation`：叶子模块，仅被 `PortContext.conversationStore` 类型引用和 `app-wiring` 注入。值导入方向：`infra-conversation` ← `app-wiring`。
- `infra-template`：被 `inference/`、`packs/`、`determinism/` 值导入。本身值导入 `utils`。
- `infra-det`：被 `app-runtime/`、`template_engine/` 值导入。值导入 `utils`。
- `infra-obs`：被 `ai/`、`plugins/`、`inference/`、`app/runtime/`、`app/routes/`、`index.ts` 值导入。值导入 `utils`。
- `infra-dynamics`：被 `app-runtime/` 值导入。值导入 `utils`、`core`（type）。
- `infra-access`：被 `app/services/social/` lazy import，被 `domain/` type import。值导入 `DataContext`。
- `infra-permission`：纯类型定义，值导入 `utils`。
- `infra-world`：被 `core/simulation.ts` 值导入。值导入 `utils`。
- `infra-kernel`：被 `app-services/` 值导入。值导入 `utils`、`dc`（type）。
- `infra-perception`：被 `context/`、`app/runtime/`、`plugins/` 值导入。值导入 `utils`。

### 2.3 规则矩阵

**原则**：`default: 'disallow'`（白名单模式），类型导入比值导入宽松一级。

```
from \ to           utils  core  domain  infer  ai    packs  persist  config  op    id    memory  context  plugins  clock  conv  template  det  obs  dynamics  access  permission  world  kernel  perception  services  runtime  transport  wiring
──────────────────  ────   ────  ──────  ────   ────  ────   ──────   ──────  ────  ────  ──────  ───────  ───────  ────   ────  ───────  ────  ──  ────  ──────  ──────  ────────  ─────  ─────  ─────────  ───────  ──────  ─────────  ─────
utils                -     ×v×t  ×v×t    ×v×t   ×v×t  ×v×t   ×v×t     ×v×t    ×v×t   ×v×t  ×v×t    ×v×t     ×v×t     ×v×t   ×v×t  ×v×t      ×v×t  ×v×t ×v×t  ×v×t     ×v×t     ×v×t       ×v×t   ×v×t    ×v×t        ×v×t      ×v×t     ×v×t       ×v×t
core                 ✔t    -     ×v×t    ×v×t   ×v×t  ✔t     ×v×t     ×v×t    ×v×t   ×v×t  ×v×t    ×v×t     ×v×t     ✔t      ×v×t   ×v×t      ×v×t  ×v×t ×v×t  ×v×t     ×v×t     ×v×t       ✔t     ×v×t    ×v×t        ×v×t      ×v×t     ×v×t       ×v×t
domain               ✔t    ✔t    -       ✔t    ✔t   ✔t     ✔t       ✔v      ✔t    ✔t    ✔t      ✔t       ✔t       ✔t      ✔t    ✔t        ✔t    ✔t  ✔t    ✔t        ✔t       ✔t         ✔t     ✔t     ✔t          ✔t        ✔t      ✔t         ×v×t
inference            ✔t    ✔t    ✔t      -      ✔t   ✔t     ✔v       ✔v      ✔t    ×v×t  ✔t      ✔t       ✔t       ✔t      ✔t    ✔t        ✔t    ✔t  ✔t    ✔t        ✔t       ✔t         ✔t     ✔t     ✔t          ✔t        ✔t      ✔t         ×v×t
ai                   ✔t    ✔t    ✔t      ✔t     -     ✔t     ✔v       ✔v      ✔t    ×v×t  ✔t      ✔t       ✔t       ✔t      ✔t    ✔t        ✔t    ✔t  ✔t    ✔t        ✔t       ✔t         ✔t     ✔t     ✔t          ✔t        ✔t      ✔t         ×v×t
packs                ✔t    ✔t    ✔t      ✔t     ✔t    -      ✔v       ✔v      ✔t    ×v×t  ✔t      ✔t       ✔t       ✔t      ✔t    ✔t        ✔t    ✔t  ✔t    ✔t        ✔t       ✔t         ✔t     ✔t     ✔t          ✔t        ✔t      ✔t         ×v×t
infra-persist        ✔t    ×v×t  ×v×t    ×v×t   ×v×t  ×v×t   -        ×v×t    ×v×t   ×v×t  ×v×t    ×v×t     ×v×t     ×v×t   ×v×t  ×v×t      ×v×t  ×v×t ×v×t  ×v×t     ×v×t     ×v×t       ×v×t   ×v×t    ×v×t        ×v×t      ×v×t     ×v×t       ×v×t
infra-config         ✔t    ×v×t  ×v×t    ×v×t   ×v×t  ×v×t   ×v×t     -       ×v×t   ×v×t  ×v×t    ×v×t     ×v×t     ×v×t   ×v×t  ×v×t      ×v×t  ×v×t ×v×t  ×v×t     ×v×t     ×v×t       ×v×t   ×v×t    ×v×t        ×v×t      ×v×t     ×v×t       ×v×t
infra-op             ✔t    ×v×t  ×v×t    ×v×t   ×v×t  ×v×t   ✔v       ×v×t    -      ✔t    ×v×t    ×v×t     ×v×t     ×v×t   ×v×t  ×v×t      ×v×t  ×v×t ×v×t  ×v×t     ×v×t     ×v×t       ×v×t   ×v×t    ×v×t        ×v×t      ×v×t     ×v×t       ×v×t
infra-id             ✔t    ×v×t  ×v×t    ×v×t   ×v×t  ×v×t   ×v×t     ×v×t    ×v×t   -     ×v×t    ×v×t     ×v×t     ×v×t   ×v×t  ×v×t      ×v×t  ×v×t ×v×t  ×v×t     ×v×t     ×v×t       ×v×t   ×v×t    ×v×t        ×v×t      ×v×t     ×v×t       ×v×t
infra-memory         ✔t    ✔t    ✔t      ✔t     ✔t   ✔t     ✔v       ✔v      ✔t    ✔t    -       ✔t       ✔t       ✔t      ✔t    ✔t        ✔t    ✔t  ✔t    ✔t        ✔t       ✔t         ✔t     ✔t     ✔t          ✔t        ✔t      ✔t         ×v×t
infra-context        ✔t    ✔t    ✔t      ✔t     ✔t   ✔t     ✔v       ✔v      ✔t    ✔t    ✔t      -        ✔t       ✔t      ✔t    ✔t        ✔t    ✔t  ✔t    ✔t        ✔t       ✔t         ✔t     ✔t     ✔t          ✔t        ✔t      ✔t         ×v×t
infra-plugins        ✔t    ✔t    ✔t      ✔t     ✔t   ✔t     ✔v       ✔v      ✔t    ✔t    ✔t      ✔t        -        ✔t      ✔t    ✔t        ✔t    ✔t  ✔t    ✔t        ✔t       ✔t         ✔t     ✔t     ✔t          ✔t        ✔t      ✔t         ×v×t
infra-clock          ✔t    ×v×t  ×v×t    ×v×t   ×v×t  ×v×t   ×v×t     ×v×t    ×v×t   ×v×t  ×v×t    ×v×t     ×v×t      -      ×v×t  ×v×t      ×v×t  ×v×t ×v×t  ×v×t     ×v×t     ×v×t       ×v×t   ×v×t    ×v×t        ×v×t      ×v×t     ×v×t       ×v×t
infra-conversation   ✔t    ×v×t  ×v×t    ×v×t   ×v×t  ×v×t   ✔v       ×v×t    ×v×t   ×v×t  ×v×t    ×v×t     ×v×t     ×v×t    -     ×v×t      ×v×t  ×v×t ×v×t  ×v×t     ×v×t     ×v×t       ×v×t   ×v×t    ×v×t        ×v×t      ×v×t     ×v×t       ×v×t
infra-template       ✔t    ×v×t  ×v×t    ×v×t   ×v×t  ×v×t   ×v×t     ×v×t    ×v×t   ×v×t  ×v×t    ×v×t     ×v×t     ×v×t   ×v×t    -        ×v×t  ×v×t ×v×t  ×v×t     ×v×t     ×v×t       ×v×t   ×v×t    ×v×t        ×v×t      ×v×t     ×v×t       ×v×t
infra-det            ✔t    ×v×t  ×v×t    ×v×t   ×v×t  ×v×t   ×v×t     ×v×t    ×v×t   ×v×t  ×v×t    ×v×t     ×v×t     ×v×t   ×v×t   ✔t         -    ×v×t ×v×t  ×v×t     ×v×t     ×v×t       ×v×t   ×v×t    ×v×t        ×v×t      ×v×t     ×v×t       ×v×t
infra-obs            ✔t    ×v×t  ×v×t    ×v×t   ×v×t  ×v×t   ×v×t     ×v×t    ×v×t   ×v×t  ×v×t    ×v×t     ×v×t     ×v×t   ×v×t   ×v×t      ×v×t    -   ×v×t  ×v×t     ×v×t     ×v×t       ×v×t   ×v×t    ×v×t        ×v×t      ×v×t     ×v×t       ×v×t
infra-dynamics       ✔t    ✔t    ×v×t    ×v×t   ×v×t  ×v×t   ×v×t     ×v×t    ×v×t   ×v×t  ×v×t    ×v×t     ×v×t     ×v×t   ×v×t   ×v×t      ×v×t  ×v×t  -     ×v×t     ×v×t     ×v×t       ×v×t   ×v×t    ×v×t        ×v×t      ×v×t     ×v×t       ×v×t
infra-access         ✔t    ×v×t  ✔t      ×v×t   ×v×t  ×v×t   ✔v       ×v×t    ×v×t   ×v×t  ×v×t    ×v×t     ×v×t     ×v×t   ×v×t   ×v×t      ×v×t  ×v×t ×v×t  -        ×v×t     ×v×t       ×v×t   ×v×t    ×v×t        ×v×t      ×v×t     ×v×t       ×v×t
infra-permission     ✔t    ×v×t  ×v×t    ×v×t   ×v×t  ×v×t   ×v×t     ×v×t    ×v×t   ×v×t  ×v×t    ×v×t     ×v×t     ×v×t   ×v×t   ×v×t      ×v×t  ×v×t ×v×t  ×v×t      -       ×v×t       ×v×t   ×v×t    ×v×t        ×v×t      ×v×t     ×v×t       ×v×t
infra-world          ✔t    ✔t    ×v×t    ×v×t   ×v×t  ×v×t   ×v×t     ×v×t    ×v×t   ×v×t  ×v×t    ×v×t     ×v×t     ×v×t   ×v×t   ×v×t      ×v×t  ×v×t ×v×t  ×v×t     ×v×t      -         ×v×t   ×v×t    ×v×t        ×v×t      ×v×t     ×v×t       ×v×t
infra-kernel         ✔t    ×v×t  ×v×t    ×v×t   ×v×t  ×v×t   ×v×t     ×v×t    ×v×t   ×v×t  ×v×t    ×v×t     ×v×t     ×v×t   ×v×t   ×v×t      ×v×t  ×v×t ×v×t  ×v×t     ×v×t     ×v×t        -     ×v×t    ×v×t        ×v×t      ×v×t     ×v×t       ×v×t
infra-perception     ✔t    ×v×t  ×v×t    ×v×t   ×v×t  ×v×t   ×v×t     ×v×t    ×v×t   ×v×t  ×v×t    ×v×t     ×v×t     ×v×t   ×v×t   ×v×t      ×v×t  ×v×t ×v×t  ×v×t     ×v×t     ×v×t       ×v×t    -      ×v×t        ×v×t      ×v×t     ×v×t       ×v×t
app-services         ✔t    ✔t    ✔t      ✔t     ✔t   ✔t     ✔v       ✔v      ✔t    ✔t    ✔t      ✔t       ✔t       ✔t      ✔t    ✔t        ✔t    ✔t  ✔t    ✔t        ✔t       ✔t         ✔t     ✔t     ✔t          ✔t        ✔t      ✔t         ×v×t
app-runtime          ✔t    ✔     ✔t      ✔t     ✔t   ✔      ✔v       ✔v      ✔t    ✔t    ✔       ✔t      ✔        ✔t      ✔t    ✔t        ✔t    ✔t  ✔t    ✔t        ✔t       ✔t         ✔t     ✔t     ✔t          ✔t        -        ✔t         ×v×t
transport            ✔t    ✔t    ×v×t    ×v×t   ×v×t  ✔t     ✔v       ✔v      ✔t    ✔t    ✔t      ✔t       ✔t       ✔t      ✔t    ✔t        ✔t    ✔t  ✔t    ✔t        ✔t       ✔t         ✔t     ✔t     ✔t          ✔         ✔t       -          ×v×t
app-wiring           ✔     ✔     ✔       ✔      ✔    ✔      ✔        ✔       ✔     ✔     ✔       ✔        ✔        ✔      ✔     ✔         ✔     ✔    ✔     ✔         ✔        ✔          ✔      ✔      ✔           ✔        ✔       ✔          -
```

**图例**：`✔` = allow value + type，`✔t` = allow type only，`✔v` = allow value only，`×v×t` = disallow both，`-` = N/A

**与初始草案的关键差异**：

1. **transport 可以值导入 `infra-*` 叶子层和 `app-services`、`app-runtime`**。原始草案 §2.3 文字称 "transport 只能值导入 app-services、app-runtime" 但配置允许更多——这与实际代码中 transport 层大量使用 Prisma、operator 等一致。矩阵中 transport 的值导入权限反映了实际需要。

2. **9 个新增叶子类型**（`infra-conversation`、`infra-template`、`infra-det`、`infra-obs`、`infra-dynamics`、`infra-access`、`infra-permission`、`infra-world`、`infra-kernel`、`infra-perception`）默认只能值导入 `utils`，类型导入根据实际依赖微调。

3. **`infra-access`** 可以类型导入 `domain`，值导入 `infra-persist`（因为 `access_policy/service.ts` 导入 AppContext 的 `repos`）。

4. **`domain → infra-persist` 收紧为类型导入**（决策 5.7）。`domain/` 下的文件通过 `DataContext.prisma` 间接访问数据库，不直接 `import { PrismaClient }`。规则矩阵中 `domain → infra-persist` 允许 `✔t`（仅类型导入），不允许值导入。

5. **`app-wiring` 添加反向 Kind 限制**（决策 5.5）。虽然 `app-wiring` 可以导入任何模块，但任何业务层不得导入 `app-wiring`。这通过 `default: 'disallow'` 自然实现——没有元素类型的 `allow` 规则允许导入 `app-wiring`。

6. **`conversation/` 维持叶子层定位**（决策 5.6）。`infra-conversation` 只能值导入 `utils`，值导入 `infra-persist`（通过 Prisma 实现对话存储），类型导入无限制。实际代码中 `conversation/` 不值导入 `app/` 层，叶子层定位合理。

### 2.4 ESLint 配置片段

```javascript
// apps/server/eslint.config.mjs — boundaries 部分
settings: {
  'boundaries/elements': [
    { type: 'utils',              pattern: 'src/utils/**', mode: 'full' },
    { type: 'core',               pattern: 'src/core/**', mode: 'full' },
    { type: 'domain',             pattern: 'src/domain/**', mode: 'full' },
    { type: 'inference',          pattern: 'src/inference/**', mode: 'full' },
    { type: 'ai',                 pattern: 'src/ai/**', mode: 'full' },
    { type: 'packs',              pattern: 'src/packs/**', mode: 'full' },
    { type: 'infra-persist',      pattern: 'src/db/**', mode: 'full' },
    { type: 'infra-config',       pattern: 'src/config/**', mode: 'full' },
    { type: 'infra-op',           pattern: 'src/operator/**', mode: 'full' },
    { type: 'infra-id',           pattern: 'src/identity/**', mode: 'full' },
    { type: 'infra-memory',       pattern: 'src/memory/**', mode: 'full' },
    { type: 'infra-context',      pattern: 'src/context/**', mode: 'full' },
    { type: 'infra-plugins',      pattern: 'src/plugins/**', mode: 'full' },
    { type: 'infra-clock',        pattern: 'src/clock/**', mode: 'full' },
    { type: 'infra-conversation', pattern: 'src/conversation/**', mode: 'full' },
    { type: 'infra-template',     pattern: 'src/template_engine/**', mode: 'full' },
    { type: 'infra-det',          pattern: 'src/determinism/**', mode: 'full' },
    { type: 'infra-obs',          pattern: 'src/observability/**', mode: 'full' },
    { type: 'infra-dynamics',     pattern: 'src/dynamics/**', mode: 'full' },
    { type: 'infra-access',       pattern: 'src/access_policy/**', mode: 'full' },
    { type: 'infra-permission',   pattern: 'src/permission/**', mode: 'full' },
    { type: 'infra-world',        pattern: 'src/world/**', mode: 'full' },
    { type: 'infra-kernel',       pattern: 'src/kernel/**', mode: 'full' },
    { type: 'infra-perception',   pattern: 'src/perception/**', mode: 'full' },
    { type: 'app-services',       pattern: 'src/app/services/**', mode: 'full' },
    { type: 'app-runtime',        pattern: 'src/app/runtime/**', mode: 'full' },
    { type: 'transport',          pattern: ['src/app/routes/**', 'src/app/middleware/**', 'src/app/http/**'], mode: 'full' },
    { type: 'app-wiring',         pattern: ['src/app/context/**', 'src/app/composition/**', 'src/bootstrap/**', 'src/index.ts'], mode: 'full' },
  ]
},
rules: {
  'boundaries/dependencies': ['error', {
    default: 'disallow',
    rules: [
      // ─── 叶子层 — 只能导入 utils（除 infra-conversation 允许值导入 infra-persist） ───
      { from: ['infra-persist', 'infra-config', 'infra-id', 'infra-clock',
               'infra-template', 'infra-det', 'infra-obs',
               'infra-permission', 'infra-kernel'],
        allow: ['utils'] },

      // ─── infra-conversation — Prisma 实现需要 infra-persist ───
      { from: 'infra-conversation',
        allow: ['utils', 'infra-persist'] },

      // ─── infra-op — 审计需要持久化 + 身份 ───
      { from: 'infra-op',
        allow: ['utils', 'infra-persist', 'infra-id'] },

      // ─── infra-access — 访问策略引擎 ───
      { from: 'infra-access',
        allow: ['utils', 'infra-persist',
          { to: ['domain'], dependency: { kind: 'type' } }] },

      // ─── infra-memory — 记忆层 ───
      { from: 'infra-memory',
        allow: ['utils', 'infra-persist',
          { to: ['domain', 'inference', 'ai', 'packs', 'infra-context', 'infra-plugins',
                 'infra-op', 'infra-id', 'app-services', 'app-runtime', 'transport'], dependency: { kind: 'type' } }] },

      // ─── infra-context — 上下文源/覆盖层 ───
      { from: 'infra-context',
        allow: ['utils', 'infra-persist', 'infra-memory',
          { to: ['domain', 'inference', 'ai', 'packs', 'infra-plugins', 'infra-op', 'infra-id',
                 'app-services', 'app-runtime', 'transport'], dependency: { kind: 'type' } }] },

      // ─── infra-plugins — 插件运行时 ───
      { from: 'infra-plugins',
        allow: ['utils', 'infra-persist', 'infra-context', 'infra-memory',
          { to: ['domain', 'inference', 'ai', 'packs', 'infra-op', 'infra-id',
                 'app-services', 'app-runtime', 'transport'], dependency: { kind: 'type' } }] },

      // ─── infra-dynamics — 动力学 ───
      { from: 'infra-dynamics',
        allow: ['utils',
          { to: ['core', 'packs'], dependency: { kind: 'type' } }] },

      // ─── infra-world — World bootstrap ───
      { from: 'infra-world',
        allow: ['utils',
          { to: ['core'], dependency: { kind: 'type' } }] },

      // ─── infra-perception — 感知规则 ───
      { from: 'infra-perception',
        allow: ['utils',
          { to: ['domain'], dependency: { kind: 'type' } }] },

      // ─── Domain — 业务域 — infra-persist 仅类型导入（通过 DataContext 间接访问） ───
      { from: 'domain',
        allow: ['utils', 'infra-op', 'infra-id',
          { to: ['infra-persist', 'core', 'inference', 'ai', 'packs', 'infra-memory', 'infra-context', 'infra-plugins',
                 'app-services', 'app-runtime', 'transport',
                 'infra-access', 'infra-perception', 'infra-conversation'], dependency: { kind: 'type' } }] },

      // ─── Inference ───
      { from: 'inference',
        allow: ['utils', 'infra-persist', 'infra-memory', 'infra-context', 'ai',
          { to: ['domain', 'core', 'packs', 'infra-plugins', 'infra-op', 'infra-id',
                 'app-services', 'app-runtime', 'transport'], dependency: { kind: 'type' } }] },

      // ─── AI ───
      { from: 'ai',
        allow: ['utils', 'infra-persist', 'inference',
          { to: ['domain', 'core', 'packs', 'infra-memory', 'infra-context', 'infra-plugins',
                 'infra-op', 'infra-id', 'app-services', 'app-runtime', 'transport'], dependency: { kind: 'type' } }] },

      // ─── Packs ───
      { from: 'packs',
        allow: ['utils', 'infra-persist', 'core', 'domain',
          { to: ['inference', 'ai', 'infra-memory', 'infra-context', 'infra-plugins',
                 'infra-op', 'infra-id', 'app-services', 'app-runtime', 'transport'], dependency: { kind: 'type' } }] },

      // ─── Core ───
      { from: 'core',
        allow: ['utils', 'infra-clock', 'packs',
          { to: ['domain', 'inference', 'ai', 'infra-memory', 'infra-context', 'infra-plugins',
                 'infra-op', 'infra-id', 'app-services', 'app-runtime', 'transport'], dependency: { kind: 'type' } }] },

      // ─── App services ───
      { from: 'app-services',
        allow: ['utils', 'infra-persist', 'infra-memory', 'infra-context', 'infra-plugins',
                 'infra-op', 'infra-id',
          { to: ['domain', 'inference', 'ai', 'packs', 'core', 'app-runtime', 'transport',
                 'infra-conversation', 'infra-template', 'infra-det', 'infra-obs',
                 'infra-perception'], dependency: { kind: 'type' } }] },

      // ─── App runtime ───
      { from: 'app-runtime',
        allow: ['utils', 'core', 'packs', 'infra-memory', 'infra-plugins', 'infra-persist', 'infra-context',
          { to: ['domain', 'inference', 'ai', 'infra-op', 'infra-id', 'app-services', 'transport',
                 'infra-perception', 'infra-det', 'infra-obs', 'infra-conversation'], dependency: { kind: 'type' } }] },

      // ─── Transport ───
      { from: 'transport',
        allow: ['utils', 'app-services', 'app-runtime',
                 'infra-persist', 'infra-op', 'infra-id', 'infra-memory', 'infra-context', 'infra-plugins',
          { to: ['domain', 'inference', 'ai', 'core', 'packs'], dependency: { kind: 'type' } }] },

      // ─── App wiring — 组合根，可以导入任何模块；但反向禁止任何业务层导入 wiring ───
      { from: 'app-wiring', allow: [] },
    ]
  }]
}
```

### 2.5 从 warn 升级到 error 的策略

当前 depcruise 和 boundaries 都配置为 `warn`。新规则实施后：

1. **新规则直接设为 `error`** — 所有新代码必须遵守
2. **现有违规**：先通过重构逐一消除，直到 `pnpm lint` 零错误
3. **depcruise**：在 cycle count 归零后，从 `warn` 升级到 `error`

---

## 3. 实施顺序

| 阶段 | 变更 | 涉及文件 | 风险 |
|------|------|----------|------|
| **0. 草案评审** | 本文档通过评审 | — | — |
| **1. 创建角色接口** | 新建 `data_context.ts`、`runtime_context.ts`、`port_context.ts`、`app_context.ts`、`index.ts`；旧 `app/context.ts` 改为 re-export。补全 §1.2 表中列出的所有 AppContext 成员 | 5 新建 + 1 修改 | 低 — 只是类型移动 |
| **2. memory → DataContext** | `memory/service.ts`、`memory/short_term_adapter.ts`、`memory/recording/*.ts`、`memory/blocks/evaluation_context.ts` → `DataContext` | ~6 | 低 |
| **3. domain → DataContext + RuntimeContext** | `domain/authority/resolver.ts`、`domain/invocation/*.ts`、`domain/rule/enforcement_engine.ts`（DataContext + RuntimeContext，`getSpatialRuntime` 已降级）、`domain/perception/resolver.ts` → 按需选择 | ~5 | 低 |
| **4. inference → DataContext + PortContext** | `inference/service.ts`、`inference/context/*.ts`（`builder.ts` 和 `pipeline.ts` 使用 `Pick<AppContextPorts, 'packRuntimeLookup' | 'contextAssembly'>`）、`inference/sinks/prisma.ts` → 按需选择 | ~6 | 中 — `builder.ts`/`pipeline.ts` 需同时导入 DataContext + PortContext |
| **5. ai → DataContext** | `ai/gateway.ts`、`ai/task_service.ts`、`ai/observability.ts`、`ai/tool_executor.ts` → `DataContext` | ~4 | 低 |
| **6. packs/projections → DataContext + RuntimeContext** | `packs/runtime/projections/*.ts`、`packs/snapshots/*.ts` → 按需选择 | ~6 | 中 |
| **7. plugins → DataContext + RuntimeContext + PortContext** | 同时将 `pluginRuntimeRegistry` 从 `plugins/runtime.ts` 移入 `app/runtime/plugin_runtime_registry.ts`；13 处消费者改为从新位置导入；`plugins/` 内部通过依赖注入获取 registry 引用 | ~6 + 新建 1 | 中 — 插件系统与 AppContext 耦合最深 |
| **8. operator → DataContext** | `operator/audit/logger.ts`、`operator/auth/token.ts`、`operator/guard/*.ts` → `DataContext` | ~4 | 低 |
| **9. social lazy import 重构** | 将 `SocialRepository.ts` 中的 lazy import 改为静态导入；将 `social/social.ts` 中对 `access_policy/service.ts` 的 lazy import 改为静态导入 | ~3 | 低 |
| **10. app/services → DataContext + RuntimeContext + PortContext** | `app/services/agent/*.ts`、`app/services/inference_workflow.ts`、`app/services/audit/*.ts` 等 → 按需选择 | ~8 | 中 |
| **11. 旧 barrel 移除** | 所有消费者迁移完毕后，删除旧 `app/context.ts` 的 re-export | 1 | 低 |
| **12. Repositories 子接口拆分** | 新建 `entity_repos.ts`、`workflow_repos.ts`、`plugin_repos.ts`；`types.ts` 组合接口标记 `@deprecated`；消费者逐步迁移到子接口 | 3 新建 + ~10 修改 | 中 |
| **13. context_memory_ports 上移** | `ContextAssemblyPort`、`MemoryRuntimePort` → `src/context/ports.ts` | 2 新建 + 2 修改 | 低 |
| **14. inference/behavior_tree 内部循环修复** | `evaluator.ts ↔ composites.ts`、`evaluator.ts ↔ decorators.ts` 提取接口或注册机制 | ~3 | 低 |
| **15. ESLint 新规则上线** | 替换 `eslint.config.mjs` 的 boundaries 配置，`default: 'disallow'`，`severity: 'error'`；app-wiring 反向禁止被导入 | 1 | 高 — 可能暴露隐藏违规 |
| **16. 修复 ESLint 违规** | 根据新规则报错逐文件修复 | ~20-50 | 高 |
| **17. Repositories 组合接口移除** | 删除 `types.ts` 中 `Repositories` 组合接口，所有消费者使用子接口 | ~30 修改 | 中 |
| **18. depcruise 升级为 error** | `.dependency-cruiser.js` 中 `no-circular` 从 `warn` 升级到 `error` | 1 | 低 — 仅当 cycle count = 0 时执行 |

---

## 4. 预期效果

| 指标 | 当前 | 目标 |
|------|------|------|
| depcruise 循环依赖 | 35 unique cycles | 0 errors |
| AppContext 消费者 | 52 文件导入完整 AppContext | ≤ 5 文件导入完整 AppContext |
| ESLint 边界规则覆盖 | 3 条限制（default: allow） | 25 种元素类型（default: disallow） |
| 模块间依赖方向 | 无约束 | 单向无环 |

---

## 5. 决策记录

以下决策已在评审中确认。

### 5.1 `pluginRuntimeRegistry` 代理策略 → 方案 C：移入 `app/runtime/`

将 `pluginRuntimeRegistry` 从 `plugins/runtime.ts` 移入 `app/runtime/plugin_runtime_registry.ts`。`plugins/` 内部通过依赖注入获得 registry 引用。消除了方向 2（app/ → plugins/runtime 值导入）的跨层值导入。见 §1.8.3 实施细节。

### 5.2 Repositories 组合接口 → 保留但标记 `@deprecated`，Phase 17 移除

保留 `types.ts` 的 `Repositories extends EntityRepositories, WorkflowRepositories, PluginRepositories {}` 作为过渡期向后兼容接口，但标记为 `@deprecated`。消费者逐步迁移到子接口。Phase 17 单独移除组合接口和 `types.ts` barrel，此时循环完全消除。

### 5.3 `getPackRuntimeHandle` vs `getPackRuntimeHost` → 维持拆分

`PackRuntimeHandle`（只读快照）归 `RuntimeContext`，`PackRuntimeHost`（操作能力）归 `PortContext`。消费者若同时需要两者则导入两个角色接口。语义边界清晰优先于导入便利。

### 5.4 `domain/enforcement_engine.ts` 跨角色接口 → `getSpatialRuntime` 降级到 RuntimeContext

`getSpatialRuntime` 从 `PortContext` 降级到 `RuntimeContext`。`enforcement_engine.ts` 只需 `DataContext` + `RuntimeContext`，不再需要 `PortContext`。

### 5.5 `app-wiring` 无限制 → 添加反向禁止

`app-wiring` 可以导入任何模块（`allow: []` 表示允许所有），但任何业务层不得导入 `app-wiring`。这通过 `default: 'disallow'` 自然实现——没有其他元素类型的 `allow` 规则包含 `app-wiring`。

### 5.6 `conversation/` 归类 → 维持叶子层

`infra-conversation` 定位为叶子模块：只能值导入 `utils` 和 `infra-persist`（Prisma 实现），类型导入不受限。实际代码中 `conversation/` 不值导入 `app/` 层，叶子层定位合理。

### 5.7 `domain → infra-persist` → 收紧为仅类型导入

`domain/` 下的文件通过 `DataContext.prisma` 间接访问 Prisma Client，不直接 `import { PrismaClient }`。规则矩阵中 `domain → infra-persist` 改为 `✔t`（仅允许类型导入），值导入被禁止。

### 5.8 `behavior_tree/` 内部循环 → 由 `inference/` 内部治理

`evaluator.ts ↔ composites.ts`、`evaluator.ts ↔ decorators.ts` 的自引用循环不由 boundaries 细分治理。由 `inference/` 模块内部提取接口或注册机制解决。见 §3 Phase 14。

### 5.9 `social.ts` lazy import 循环 → 重构为静态依赖

将 `SocialRepository.ts` 中对 `social/social.ts` 的 lazy import 和 `social.ts` 中对 `access_policy/service.ts` 的 lazy import 改为直接导入，再通过 AppContext 角色接口拆分截断循环链。这些模块在同一包内，lazy import 不是必要的运行时优化。见 §3 Phase 9。