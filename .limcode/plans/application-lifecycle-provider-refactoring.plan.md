## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] Phase 1: 定义 `ServiceProvider` 接口与 `ServiceContainer` — 拓扑排序依赖解析 `#AL-1`
- [ ] Phase 2: 实现 `Application` 类 — boot / start / shutdown 显式生命周期 `#AL-2`
- [ ] Phase 3: 将 `index.ts` 的所有关注点拆分为独立 Provider 模块 + wiring `#AL-3`
- [ ] Phase 4: 重构 `AppContext` — 消除所有 `?` 可选字段 `#AL-4`
- [ ] Phase 5: 重写 `index.ts` 为 ~80 行 Application 组装入口 `#AL-5`
- [ ] Phase 6: 适配所有 `AppContext` 消费者的类型错误 `#AL-6`
- [ ] Phase 7: typecheck + unit + integration + e2e 全量验证 `#AL-7`
<!-- LIMCODE_TODO_LIST_END -->

# Application 生命周期：从巨型 index.ts 到 Provider 组装

## 背景

`apps/server/src/index.ts` 545 行，混合了七个不同关注点：

| 行范围 | 关注点 | 行数 |
|--------|--------|------|
| 1-89 | imports | 89 |
| 93-108 | CLI 参数解析 | 16 |
| 110-148 | 基础设施构建（prisma、repos、adapters、config） | 39 |
| 155-235 | AppContext 组装 + 多次"事后补属性" | 81 |
| 237-285 | 服务装配（inference、plugin AI、loop host、sidecar） | 49 |
| 287-320 | 路由注册 | 34 |
| 329-543 | 启动序列（DB preflight、pack 加载、loop 启动、信号处理） | 215 |

**根本问题不是行数，而是 `AppContext` 的分阶段初始化模式。** `context.ts:65-89` 中大量属性标记为可选（`?`），因为它们在对象创建时不存在，需要后续赋值（`index.ts:194-235`）补上。这造成：

- TypeScript 无法验证某个服务在运行时是否真正可用
- 消费者代码需要防御性地检查 `context.worldEngine?.doSomething()`
- 新增服务需要触摸三个地方：构造逻辑、AppContext 类型定义、对象属性赋值

**目标**：用显式生命周期 + 依赖声明替代先创建空壳再填充的模式。

---

## 本次范围

### 纳入

1. `ServiceProvider` / `ServiceContainer` — 声明式依赖解析
2. `Application` 类 — boot / start / shutdown 生命周期
3. 将所有基础设施、服务、路由拆分为独立 Provider 文件
4. `AppContext` 瘦身 — 消除所有非真正可选的可选字段
5. `index.ts` 重写为 Application 组装入口

### 不纳入

1. 更换 Express 为其他框架
2. 引入第三方 DI 容器（tsyringe、inversify 等）
3. 改变业务逻辑或 API 行为
4. 路由注册方式重构（由 route-registration plan 独立覆盖）
5. 将纯配置函数（`getAppPort`、`getWorldPacksDir` 等）包装为 Provider — 它们无依赖、无副作用，保持直接 import

---

## Phase 1: `ServiceProvider` 接口与 `ServiceContainer`

**新建文件**: `apps/server/src/bootstrap/provider.ts`

```typescript
export type ServiceToken = string;

export interface ServiceProvider<T = unknown> {
  /** 此 Provider 提供的服务标识 */
  provide: ServiceToken;
  /** 依赖的其他服务标识（可选） */
  deps?: ServiceToken[];
  /** 工厂函数：接收已解析的依赖，返回服务实例 */
  useFactory: (deps: Record<string, unknown>) => T | Promise<T>;
  /** 生命周期：singleton（默认，只构造一次）| transient（每次解析都重新构造） */
  lifecycle?: 'singleton' | 'transient';
}

export class ServiceContainer {
  private providers = new Map<ServiceToken, ServiceProvider>();
  private instances = new Map<ServiceToken, unknown>();
  private resolving = new Set<ServiceToken>();

  register<T>(provider: ServiceProvider<T>): this {
    if (this.providers.has(provider.provide)) {
      throw new Error(`Duplicate provider: ${provider.provide}`);
    }
    this.providers.set(provider.provide, provider);
    return this;
  }

  async resolve<T>(token: ServiceToken): Promise<T> {
    const cached = this.instances.get(token);
    if (cached !== undefined) return cached as T;

    const provider = this.providers.get(token);
    if (!provider) throw new Error(`Unknown service: ${token}`);

    // 循环依赖检测
    if (this.resolving.has(token)) {
      throw new Error(`Circular dependency: ${[...this.resolving, token].join(' → ')}`);
    }
    this.resolving.add(token);

    const deps: Record<string, unknown> = {};
    for (const dep of provider.deps ?? []) {
      deps[dep] = await this.resolve(dep);
    }

    const instance = await provider.useFactory(deps);

    if (provider.lifecycle !== 'transient') {
      this.instances.set(token, instance);
    }

    this.resolving.delete(token);
    return instance as T;
  }

  listTokens(): ServiceToken[] {
    return [...this.providers.keys()];
  }
}
```

**设计决策：**

- `ServiceToken = string` 而非 `Symbol` — 字符串在错误消息中可读，且足够唯一（通过 `TOKENS` 常量对象引用）
- 工厂函数接收 `Record<string, unknown>` 而非强类型 `deps` — Provider 注册时已知依赖关系，但编译期完美类型推导需要复杂的泛型级联，超出本次范围。验收标准是运行时解析结果正确
- 拓扑排序隐式实现 — `resolve` 的递归 + 缓存天然做拓扑排序；循环依赖通过 `resolving` Set 检测
- **不引入 `boot` / `start` 阶段区分到 Container 层** — Container 只负责对象构造和依赖解析。"何时做什么事"由 Application 层管理

---

## Phase 2: `Application` 类

**新建文件**: `apps/server/src/bootstrap/application.ts`

```typescript
import { ServiceContainer } from './provider.js';
import { createLogger } from '../utils/logger.js';

export type LifecyclePhase =
  | 'constructed'
  | 'booting'
  | 'booted'
  | 'starting'
  | 'running'
  | 'shutting_down'
  | 'stopped';

export class Application {
  readonly services = new ServiceContainer();
  private phase: LifecyclePhase = 'constructed';
  private shutdownHandlers: Array<() => Promise<void>> = [];
  private logger = createLogger('application');

  register<T>(provider: Parameters<ServiceContainer['register']>[0]): this {
    this.services.register(provider);
    return this;
  }

  /**
   * boot 阶段：解析所有 singleton 服务，完成对象构造和依赖注入。
   * 此时所有服务对象已存在、已互联，但无副作用操作（无 DB preflight、无 pack 加载、无 HTTP 监听）。
   *
   * 注意：某些 Provider 的工厂函数内部可能有副作用（如启动 sidecar 子进程）。
   * worldEngine sidecar client 的构造即为副作用 —— 在 boot 阶段启动子进程，
   * 但 loadPack() 调用推迟到 start 阶段。这是可接受的。
   */
  async boot(): Promise<void> {
    if (this.phase !== 'constructed') {
      throw new Error(`Cannot boot: already ${this.phase}`);
    }
    this.phase = 'booting';

    const tokens = this.services.listTokens();
    for (const token of tokens) {
      await this.services.resolve(token);
    }

    this.phase = 'booted';
    this.logger.info(`booted: ${String(tokens.length)} services resolved`);
  }

  /**
   * start 阶段：执行启动序列（DB preflight、pack 加载、loop 启动、HTTP 监听）。
   * onStart 回调承载所有需要"在一切就绪后"才执行的操作。
   */
  async start(onStart: (app: Application) => Promise<void>): Promise<void> {
    if (this.phase !== 'booted') {
      throw new Error(`Cannot start: currently ${this.phase}, expected booted`);
    }
    this.phase = 'starting';
    await onStart(this);
    this.phase = 'running';
  }

  /** 优雅关闭 */
  async shutdown(signal: string): Promise<void> {
    if (this.phase === 'stopped' || this.phase === 'shutting_down') return;
    this.phase = 'shutting_down';
    this.logger.info(`shutting down (signal=${signal})`);

    const forceExit = setTimeout(() => {
      this.logger.error('shutdown timeout (10s), force exit');
      process.exit(1);
    }, 10_000);

    try {
      // 逆序执行：后注册的先关闭
      for (const handler of this.shutdownHandlers.reverse()) {
        await handler();
      }
      clearTimeout(forceExit);
      this.phase = 'stopped';
      this.logger.info('shutdown complete');
    } catch (err) {
      this.logger.error('shutdown error', { error: String(err) });
      clearTimeout(forceExit);
      process.exit(1);
    }
  }

  onShutdown(handler: () => Promise<void>): this {
    this.shutdownHandlers.push(handler);
    return this;
  }
}
```

**关键设计决策：boot 与 start 的边界**

| 阶段 | 做什么 | 不做什么 |
|------|--------|---------|
| `boot()` | 构造所有服务对象、依赖注入、wiring（setWorldEngine / setMultiPackLoopHost） | DB preflight、pack 加载、HTTP 监听 |
| `start(onStart)` | DB preflight、pack 加载、loop 启动、HTTP 监听、信号处理注册 | 对象构造 |

**shutdown 处理器注册**：各 Provider 不直接注册 shutdown handler。`index.ts` 的 `start()` 回调中注册所有 shutdown 逻辑（关闭 HTTP server、停止 worldEngine sidecar、断开 prisma、关闭 watchers），与当前 `gracefulShutdown` 函数对应。

---

## Phase 3: 拆分 Provider 模块

**目录结构**: `apps/server/src/bootstrap/`

```
bootstrap/
  provider.ts            — ServiceProvider, ServiceContainer
  application.ts         — Application 类
  tokens.ts              — 所有 ServiceToken 常量
  providers/
    database.ts          — prisma, repos, conversationStore
    storage.ts           — packStorageAdapter, schedulerStorage
    notifications.ts     — notificationStore
    simulation.ts        — sim (SimulationManager)
    runtime_ports.ts     — packRuntimeObservation, packRuntimeControl, packRuntimeLookup
    pack_scope.ts        — packScopeResolver
    world_engine.ts      — worldEngine (sidecar client)
    pack_host_api.ts     — packHostApi (注意：此 Provider 不独立，见下文)
    clock.ts             — runtimeClockProjection, worldEngineStepCoordinator
    config_context.ts    — startupHealth, runtimeReady 状态闭包、CLI 参数解析
    inference.ts         — inferenceService, inferenceProviders, inferenceTraceSink
    plugin.ts            — pluginRuntimeControl, pluginAiTaskService, requestPluginInference, behaviorStateStore, systemPackPlugins 初始化
    context.ts           — AppContext 组装（聚合所有依赖，处理 packHostApi/contextAssembly 的循环依赖）
    routes.ts            — Express app 创建、registerRoutes 函数、中间件注册
```

### 3.1 各 Provider 职责与依赖明细

#### `providers/database.ts`

```typescript
export const prismaProvider: ServiceProvider = {
  provide: TOKENS.prisma,
  useFactory: () => createPrismaClient()
};

export const repositoriesProvider: ServiceProvider = {
  provide: TOKENS.repos,
  deps: [TOKENS.prisma],
  useFactory: ({ prisma }) => createPrismaRepositories(prisma)
};

export const conversationStoreProvider: ServiceProvider = {
  provide: TOKENS.conversationStore,
  deps: [TOKENS.prisma],
  useFactory: ({ prisma }) => new PrismaConversationStore(prisma)
};
```

#### `providers/storage.ts`

```typescript
export const packStorageAdapterProvider: ServiceProvider = {
  provide: TOKENS.packStorageAdapter,
  deps: [TOKENS.prisma],
  useFactory: ({ prisma }) => {
    const dbProvider = process.env.PRISMA_DB_PROVIDER ?? 'sqlite';
    return dbProvider === 'postgresql'
      ? new PostgresPackStorageAdapter(prisma)
      : new SqlitePackStorageAdapter();
  }
};

export const schedulerStorageProvider: ServiceProvider = {
  provide: TOKENS.schedulerStorage,
  useFactory: () => new SqliteSchedulerStorageAdapter()
};
```

#### `providers/notifications.ts`

```typescript
export const notificationsProvider: ServiceProvider = {
  provide: TOKENS.notifications,
  useFactory: () => createNotificationManager()
};
```

#### `providers/simulation.ts`

```typescript
// SimulationManager 在此阶段只构造对象，不加载 pack。
// setWorldEngine / setMultiPackLoopHost 由 wiringProvider 负责。
export const simulationManagerProvider: ServiceProvider = {
  provide: TOKENS.sim,
  deps: [TOKENS.prisma, TOKENS.packStorageAdapter],
  useFactory: ({ prisma, packStorageAdapter }) =>
    new SimulationManager({ prisma, packStorageAdapter })
};
```

#### `providers/runtime_ports.ts`

对应当前 `index.ts:182-207` 内联创建的三个端口：

```typescript
export const packRuntimeLookupProvider: ServiceProvider = {
  provide: TOKENS.packRuntimeLookup,
  deps: [TOKENS.sim],
  useFactory: ({ sim }) => ({
    hasPackRuntime: (packId: string) => sim.getPackRuntimeHandle(packId) !== null,
    assertPackScope: (packId: string, _feature: string) => packId.trim(),
    getPackRuntimeSummary: (packId: string) => {
      const handle = sim.getPackRuntimeHandle(packId);
      if (!handle) return null;
      return {
        pack_id: handle.instance_id,
        pack_folder_name: handle.pack_folder_name,
        health_status: handle.getHealthSnapshot().status,
        current_tick: handle.getClockSnapshot().current_tick,
        runtime_ready: true
      };
    }
  })
};

export const packRuntimeObservationProvider: ServiceProvider = {
  provide: TOKENS.packRuntimeObservation,
  deps: [TOKENS.sim],
  useFactory: ({ sim }) => ({
    getStatus: (packId: string) => sim.getPackRuntimeStatusSnapshot(packId),
    listStatuses: () => sim.listRuntimeStatuses(),
    getClockSnapshot: (packId: string) =>
      sim.getPackRuntimeHandle(packId)?.getClockSnapshot() ?? null,
    getRuntimeSpeedSnapshot: (packId: string) =>
      sim.getPackRuntimeHandle(packId)?.getRuntimeSpeedSnapshot() ?? null
  })
};

export const packRuntimeControlProvider: ServiceProvider = {
  provide: TOKENS.packRuntimeControl,
  deps: [TOKENS.sim],
  useFactory: ({ sim }) => ({
    load: (packRef: string) => sim.loadExperimentalPackRuntime(packRef),
    unload: (packId: string) => sim.unloadExperimentalPackRuntime(packId)
  })
};
```

#### `providers/pack_scope.ts`

```typescript
export const packScopeResolverProvider: ServiceProvider = {
  provide: TOKENS.packScope,
  deps: [TOKENS.sim],
  useFactory: ({ sim }) => new PackScopeResolver(sim.getPackRuntimeRegistry())
};
```

#### `providers/world_engine.ts`

```typescript
export const worldEngineProvider: ServiceProvider = {
  provide: TOKENS.worldEngine,
  useFactory: () => {
    const config = getWorldEngineConfig();
    return createWorldEngineSidecarClient({
      binaryPath: config.binary_path,
      timeoutMs: config.timeout_ms,
      autoRestart: config.auto_restart
    });
  }
};
```

#### `providers/clock.ts`

```typescript
export const runtimeClockProjectionProvider: ServiceProvider = {
  provide: TOKENS.runtimeClockProjection,
  useFactory: () => createRuntimeClockProjectionService()
};

export const worldEngineStepCoordinatorProvider: ServiceProvider = {
  provide: TOKENS.worldEngineStepCoordinator,
  useFactory: () => createWorldEngineStepCoordinator()
};
```

#### `providers/config_context.ts`

CLI 参数解析 + 运行时可变状态闭包。这些不是"服务"而是有状态的上下文，但它们有明确的依赖关系（依赖纯配置函数），将其统一管理：

```typescript
export const cliConfigProvider: ServiceProvider = {
  provide: TOKENS.cliConfig,
  useFactory: () => {
    // CLI 参数解析（当前 index.ts:82-96）
    const parseCliInt = (key: string): string | undefined => { /* ... */ };
    const cliWorkerIndex = parseCliInt('worker-index');
    const cliWorkerTotal = parseCliInt('worker-total');
    if (cliWorkerIndex !== undefined) process.env.SCHEDULER_WORKER_INDEX = cliWorkerIndex;
    if (cliWorkerTotal !== undefined) process.env.SCHEDULER_WORKER_TOTAL = cliWorkerTotal;
    return {
      workerIndex: parseInt(process.env.SCHEDULER_WORKER_INDEX ?? '0', 10) || 0,
      port: getAppPort() + (parseInt(process.env.SCHEDULER_WORKER_INDEX ?? '0', 10) || 0),
      schedulerWorkerId: process.env.SCHEDULER_WORKER_ID ?? `scheduler:${process.pid}:${Date.now()}`,
      schedulerPartitionIds: resolveOwnedSchedulerPartitionIds({
        workerId: process.env.SCHEDULER_WORKER_ID ?? `scheduler:${process.pid}:${Date.now()}`
      }),
      simulationLoopIntervalMs: getSimulationLoopIntervalMs(),
      worldPacksDir: getWorldPacksDir(),
      preferredWorldPack: getPreferredWorldPack(),
      startupPolicy: getStartupPolicy(),
      decisionWorkerId: `decision:${process.pid}:${Date.now()}`,
      actionDispatcherWorkerId: `dispatcher:${process.pid}:${Date.now()}`
    };
  }
};

export const runtimeStateProvider: ServiceProvider = {
  provide: TOKENS.runtimeState,
  useFactory: () => {
    let runtimeReady = false;
    const startupHealth = createStartupHealth();
    let runtimeLoopDiagnostics: RuntimeLoopDiagnostics = { /* ... DEFAULT ... */ };

    return {
      get runtimeReady() { return runtimeReady; },
      set runtimeReady(v: boolean) { runtimeReady = v; },
      startupHealth,
      getRuntimeLoopDiagnostics: () => runtimeLoopDiagnostics,
      setRuntimeLoopDiagnostics: (next: RuntimeLoopDiagnostics) => { runtimeLoopDiagnostics = next; },
      assertRuntimeReady: createRuntimeReadyGuard({
        getRuntimeReady: () => runtimeReady,
        startupHealth
      })
    };
  }
};
```

#### `providers/inference.ts`

```typescript
export const inferenceProvidersProvider: ServiceProvider = {
  provide: TOKENS.inferenceProviders,
  deps: [TOKENS.appContext],
  useFactory: ({ appContext }) => createInferenceProviders({ context: appContext })
};

export const inferenceTraceSinkProvider: ServiceProvider = {
  provide: TOKENS.inferenceTraceSink,
  deps: [TOKENS.appContext],
  useFactory: ({ appContext }) => createPrismaInferenceTraceSink(appContext)
};

export const inferenceServiceProvider: ServiceProvider = {
  provide: TOKENS.inferenceService,
  deps: [TOKENS.appContext, TOKENS.inferenceProviders, TOKENS.inferenceTraceSink],
  useFactory: ({ appContext, inferenceProviders, inferenceTraceSink }) =>
    createInferenceService({
      context: appContext,
      providers: inferenceProviders,
      traceSink: inferenceTraceSink
    })
};
```

**注意**：`inferenceProviders` 和 `inferenceTraceSink` 依赖 `appContext`，而 `appContext` 自身聚合了大量依赖。这是合理的 — 它们需要完整的上下文来创建 provider 实例。这些 Provider 在拓扑排序中位于 appContext 之后。

#### `providers/plugin.ts`

```typescript
export const behaviorStateStoreInitProvider: ServiceProvider = {
  provide: TOKENS.behaviorStateStoreInit,
  useFactory: () => {
    setBehaviorStateStore(createMemoryBehaviorStateStore());
    return { initialized: true }; // 标记位，无实际返回值
  }
};

export const pluginRuntimeControlProvider: ServiceProvider = {
  provide: TOKENS.pluginRuntimeControl,
  deps: [TOKENS.appContext],
  useFactory: ({ appContext }) => ({
    reload: async (packId: string) => {
      await syncPackPluginRuntime(appContext, packId);
      const runtimeCount = pluginRuntimeRegistry.listRuntimes(packId).length;
      return { pack_id: packId, runtime_count: runtimeCount };
    }
  })
};

export const pluginAiTaskServiceProvider: ServiceProvider = {
  provide: TOKENS.pluginAiTaskService,
  deps: [TOKENS.appContext],
  useFactory: ({ appContext }) => createAiTaskService({ context: appContext })
};

export const requestPluginInferenceProvider: ServiceProvider = {
  provide: TOKENS.requestPluginInference,
  deps: [TOKENS.pluginAiTaskService],
  useFactory: ({ pluginAiTaskService }) => async (input: PluginInferenceRequest) => {
    const messages = [
      { role: 'system' as const, parts: [{ type: 'text' as const, text: input.systemPrompt }] },
      { role: 'user' as const, parts: [{ type: 'text' as const, text: input.userPrompt }] }
    ];
    const taskId = `plugin:${input.purpose}`;
    const result = await pluginAiTaskService.runTask({
      task_id: taskId,
      task_type: 'agent_decision',
      input: {},
      prompt_context: {
        prompt_bundle_v2: buildPromptBundleFromAiMessages({ taskId, taskType: 'agent_decision', messages })
      },
      output_contract: { mode: 'free_text' },
      route_hints: input.maxTokens ? { determinism_tier: 'balanced' } : undefined
    });
    return {
      content: result.invocation.output.text ?? '',
      usage: {
        inputTokens: result.invocation.usage?.input_tokens ?? 0,
        outputTokens: result.invocation.usage?.output_tokens ?? 0
      }
    };
  }
};
```

#### `providers/context.ts` — 聚合 + 循环依赖处理

`packHostApi` 和 `contextAssembly` 与 `AppContext` 存在循环依赖：
- `createPackHostApi(appContext)` 接收完整 AppContext
- `createContextAssemblyPort(appContext)` 接收完整 AppContext
- 它们又被赋值回 `appContext.packHostApi` / `appContext.contextAssembly`

处理方式：在 `appContextProvider` 的工厂内部先构造 AppContext 壳（不含这两个字段），再创建这两个对象并回填。这与当前 `index.ts` 的做法一致，但被隔离在单个 Provider 工厂内。

```typescript
export const appContextProvider: ServiceProvider = {
  provide: TOKENS.appContext,
  deps: [
    TOKENS.prisma, TOKENS.repos, TOKENS.conversationStore,
    TOKENS.packStorageAdapter, TOKENS.schedulerStorage, TOKENS.notifications,
    TOKENS.sim, TOKENS.packScope,
    TOKENS.packRuntimeLookup, TOKENS.packRuntimeObservation, TOKENS.packRuntimeControl,
    TOKENS.worldEngine, TOKENS.runtimeClockProjection, TOKENS.worldEngineStepCoordinator,
    TOKENS.runtimeState, TOKENS.cliConfig,
    TOKENS.pluginRuntimeControl, TOKENS.requestPluginInference
  ],
  useFactory: (deps) => {
    // Step 1: 构造不含 packHostApi / contextAssembly 的 AppContext 壳
    const ctx: AppContext = {
      repos: deps.repos,
      prisma: deps.prisma,
      conversationStore: deps.conversationStore,
      packStorageAdapter: deps.packStorageAdapter,
      schedulerStorage: deps.schedulerStorage,
      notifications: deps.notifications,
      runtimeBootstrap: deps.sim,
      packScope: deps.packScope,
      packRuntimeLookup: deps.packRuntimeLookup,
      packRuntimeObservation: deps.packRuntimeObservation,
      packRuntimeControl: deps.packRuntimeControl,
      worldEngine: deps.worldEngine,
      runtimeClockProjection: deps.runtimeClockProjection,
      worldEngineStepCoordinator: deps.worldEngineStepCoordinator,
      // 运行时可变状态
      ...deps.runtimeState,
      // CLI / 配置
      ...deps.cliConfig,
      // 可选扩展
      pluginRuntimeControl: deps.pluginRuntimeControl,
      requestPluginInference: deps.requestPluginInference,
      // packHostApi / contextAssembly 待回填（Step 2）
    } as AppContext;

    // Step 2: 创建依赖 AppContext 的对象并回填
    (ctx as Record<string, unknown>).packHostApi = createPackHostApi(ctx);
    (ctx as Record<string, unknown>).contextAssembly = createContextAssemblyPort(ctx);

    return ctx;
  }
};
```

#### `providers/routes.ts`

```typescript
export const queryHandlerRegistryProvider: ServiceProvider = {
  provide: TOKENS.queryHandlerRegistry,
  useFactory: () => new PackQueryHandlerRegistry()
};

export const registerRoutesProvider: ServiceProvider = {
  provide: TOKENS.registerRoutes,
  deps: [TOKENS.appContext, TOKENS.packScope, TOKENS.inferenceService, TOKENS.queryHandlerRegistry, TOKENS.cliConfig],
  useFactory: ({ appContext, packScope, inferenceService, queryHandlerRegistry, cliConfig }) => {
    const packScopeMiddleware = createPackScopeMiddleware(packScope);
    return (application: Express, context: AppContext) => {
      // Global routes
      for (const route of allGlobalRoutes) {
        route.register(application, context);
      }
      // Factory-based routes
      createPackListRoutes(cliConfig.worldPacksDir).register(application, context);
      createPackFrontendAssetRoutes(cliConfig.worldPacksDir).register(application, context);
      createPackActionsRoute(queryHandlerRegistry).register(application, context);
      // Pack-scoped routes
      const packRouter = registerPackRoutes({
        context,
        scopeResolver: packScope,
        inferenceService,
        parseOptionalTick,
        toJsonSafe,
        getErrorMessage
      });
      application.use('/:packId', packScopeMiddleware, packRouter);
    };
  }
};

export const expressAppProvider: ServiceProvider = {
  provide: TOKENS.httpApp,
  deps: [TOKENS.appContext, TOKENS.registerRoutes],
  useFactory: ({ appContext, registerRoutes }) => {
    const app = createApp({ context: appContext, registerRoutes });
    app.use(createGlobalErrorMiddleware(appContext));
    return app;
  }
};
```

#### `providers/wiring.ts` — 跨服务的后期绑定

`SimulationManager` 有两个 setter 方法（`setWorldEngine`、`setMultiPackLoopHost`）需要在各自依赖对象都构造完成后调用。wiring Provider 集中处理这些交叉绑定：

```typescript
export const wiringProvider: ServiceProvider = {
  provide: TOKENS.wiring,
  deps: [TOKENS.sim, TOKENS.worldEngine, TOKENS.inferenceService, TOKENS.appContext, TOKENS.cliConfig],
  useFactory: ({ sim, worldEngine, inferenceService, appContext, cliConfig }) => {
    // 1. sim.setWorldEngine
    sim.setWorldEngine(worldEngine);

    // 2. 构造 MultiPackLoopHost 并绑定到 sim
    const multiPackLoopHost = new MultiPackLoopHost({
      context: appContext,
      inferenceService,
      decisionWorkerId: cliConfig.decisionWorkerId,
      actionDispatcherWorkerId: cliConfig.actionDispatcherWorkerId,
      worldEngine: worldEngine as WorldEngineSidecarClient,
      intervalMs: cliConfig.simulationLoopIntervalMs
    });
    sim.setMultiPackLoopHost(multiPackLoopHost);

    // 返回 multiPackLoopHost 供启动逻辑使用（startLoop）
    return { multiPackLoopHost };
  }
};
```

#### `providers/metrics.ts`

```typescript
export const metricsInitProvider: ServiceProvider = {
  provide: TOKENS.metricsInit,
  useFactory: () => {
    // 仅在 boot 阶段初始化 metrics 库，不启动 server
    // metrics server 在 start 阶段按需启动（依赖 port 已知）
    return { initialized: true };
  }
};
```

### 3.2 完整 TOKENS 常量

```typescript
// bootstrap/tokens.ts
export const TOKENS = {
  // 基础设施
  prisma: 'prisma',
  repos: 'repos',
  conversationStore: 'conversationStore',
  packStorageAdapter: 'packStorageAdapter',
  schedulerStorage: 'schedulerStorage',
  notifications: 'notifications',

  // 核心服务
  sim: 'sim',
  packScope: 'packScope',
  packRuntimeLookup: 'packRuntimeLookup',
  packRuntimeObservation: 'packRuntimeObservation',
  packRuntimeControl: 'packRuntimeControl',
  worldEngine: 'worldEngine',
  runtimeClockProjection: 'runtimeClockProjection',
  worldEngineStepCoordinator: 'worldEngineStepCoordinator',

  // 运行时状态与配置
  runtimeState: 'runtimeState',
  cliConfig: 'cliConfig',

  // AI / Inference
  inferenceProviders: 'inferenceProviders',
  inferenceTraceSink: 'inferenceTraceSink',
  inferenceService: 'inferenceService',

  // 插件
  behaviorStateStoreInit: 'behaviorStateStoreInit',
  pluginRuntimeControl: 'pluginRuntimeControl',
  pluginAiTaskService: 'pluginAiTaskService',
  requestPluginInference: 'requestPluginInference',

  // 路由
  queryHandlerRegistry: 'queryHandlerRegistry',
  registerRoutes: 'registerRoutes',
  httpApp: 'httpApp',

  // 聚合
  appContext: 'appContext',

  // Wiring（内部使用）
  wiring: 'wiring',
  metricsInit: 'metricsInit'
} as const;
```

---

## Phase 4: AppContext 瘦身

**修改文件**: `apps/server/src/app/context.ts`

### 4.1 当前 AppContext 所有字段及归处

| 字段 | 当前类型标记 | 重构后 | 归处 |
|------|------------|--------|------|
| `repos` | required | required | 不变 |
| `prisma` | required | required | 不变 |
| `conversationStore` | required | required | 不变 |
| `packStorageAdapter` | required | required | 不变 |
| `schedulerStorage` | optional (`?`) | required | Provider 保证构造 |
| `notifications` | required | required | 不变 |
| `startupHealth` | required | required | 来自 `runtimeState` |
| `assertRuntimeReady` | required | required | 来自 `runtimeState` |
| `isRuntimeReady` | required | required | 来自 `runtimeState` |
| `setRuntimeReady` | required | required | 来自 `runtimeState` |
| `isPaused` | required | required | 来自 `runtimeState` |
| `setPaused` | required | required | 来自 `runtimeState` |
| `requestPluginInference` | optional (`?`) | optional (`?`) | 保留 — 无插件时不存在 |
| `runtimeBootstrap` | optional (`?`) | required | 即 `sim`，Provider 保证存在 |
| `packRuntimeObservation` | optional (`?`) | required | Provider 保证存在 |
| `packRuntimeControl` | optional (`?`) | required | Provider 保证存在 |
| `packRuntimeLookup` | optional (`?`) | required | Provider 保证存在 |
| `worldEngine` | optional (`?`) | required | Provider 保证存在 |
| `packHostApi` | optional (`?`) | required | context Provider 工厂内回填 |
| `runtimeClockProjection` | optional (`?`) | required | Provider 保证存在 |
| `contextAssembly` | optional (`?`) | required | context Provider 工厂内回填 |
| `packScope` | optional (`?`) | required | Provider 保证存在 |
| `packRuntime` | optional (`?`) | **删除** | 未被任何消费者使用 |
| `multiPackRuntime` | optional (`?`) | **删除** | 未被任何消费者使用 |
| `getSpatialRuntime` | optional (`?`) | **删除** | 仅在 `contextAssembly` 工厂内部使用，已内联 |
| `getPackRuntimeHost` | optional (`?`) | **删除** | 未被任何消费者使用 |
| `getPackRuntimeHandle` | optional (`?`) | required | 委托给 `packRuntimeLookup` 或直接通过 `runtimeBootstrap` |
| `listLoadedPackRuntimeIds` | optional (`?`) | required | 同上 |
| `getRuntimeLoopDiagnostics` | optional (`?`) | required | 来自 `runtimeState` |
| `setRuntimeLoopDiagnostics` | optional (`?`) | required | 来自 `runtimeState` |
| `getDatabaseHealth` | optional (`?`) | required | 委托给 `runtimeBootstrap.getDatabaseHealth()` |
| `getPluginEnableWarningConfig` | optional (`?`) | required | 始终有默认值 |
| `getHttpApp` | optional (`?`) | **删除** | 仅在 `createApp` 中调用 `setHttpApp`，改为在 `expressAppProvider` 内处理 |
| `setHttpApp` | optional (`?`) | **删除** | 同上 |
| `worldEngineStepCoordinator` | optional (`?`) | required | Provider 保证存在 |
| `pluginRuntimeControl` | optional (`?`) | optional (`?`) | 保留 — 无插件时不存在 |

### 4.2 瘦身后的 `AppContext`

```typescript
export interface AppContext {
  // 基础设施（必然存在）
  readonly repos: Repositories;
  readonly prisma: PrismaClient;
  readonly conversationStore: ConversationStore;
  readonly packStorageAdapter: PackStorageAdapter;
  readonly schedulerStorage: SchedulerStorageAdapter;
  readonly notifications: NotificationStore;

  // 运行时引导（必然存在）
  readonly runtimeBootstrap: RuntimeDatabaseBootstrap;
  readonly packScope: PackScopeResolver;
  getPackRuntimeHandle(packId: string): PackRuntimeHandle | null;
  listLoadedPackRuntimeIds(): string[];

  // 运行时端口（必然存在）
  readonly packRuntimeObservation: PackRuntimeObservation;
  readonly packRuntimeControl: PackRuntimeControl;
  readonly packRuntimeLookup: PackRuntimeLookupPort;

  // World Engine（必然存在）
  readonly worldEngine: WorldEnginePort;
  readonly packHostApi: PackHostApi;
  readonly worldEngineStepCoordinator: WorldEngineStepCoordinator;

  // 时间与上下文（必然存在）
  readonly runtimeClockProjection: RuntimeClockProjectionService;
  readonly contextAssembly: ContextAssemblyPort;

  // 运行时可变状态（必然存在）
  readonly startupHealth: StartupHealth;
  isRuntimeReady(): boolean;
  setRuntimeReady(ready: boolean): void;
  isPaused(): boolean;
  setPaused(paused: boolean): void;
  assertRuntimeReady(feature: string): void;
  getRuntimeLoopDiagnostics(): RuntimeLoopDiagnostics;
  setRuntimeLoopDiagnostics(next: RuntimeLoopDiagnostics): void;
  getDatabaseHealth(): DatabaseHealthSnapshot | null;
  getPluginEnableWarningConfig(): { enabled: boolean; require_acknowledgement: boolean };

  // 可选扩展（真正可能不存在的）
  readonly pluginRuntimeControl?: PluginRuntimeControl;
  requestPluginInference?(input: PluginInferenceRequest): Promise<PluginInferenceResult>;
}
```

验证标准：可选字段从当前 ~15 个降至 **2 个**（`pluginRuntimeControl` 和 `requestPluginInference`）。

---

## Phase 5: 重写 `index.ts`

约 80 行。启动序列（DB preflight、pack 加载、loop 启动）保留在 `start()` 回调中，与当前 `index.ts:309-522` 逻辑等价但通过 `app.services.resolve()` 获取所需服务。

```typescript
import { Application } from './bootstrap/application.js';
import { createLogger } from './utils/logger.js';
import { TOKENS } from './bootstrap/tokens.js';

// Providers — 基础设施
import { prismaProvider, repositoriesProvider, conversationStoreProvider } from './bootstrap/providers/database.js';
import { packStorageAdapterProvider, schedulerStorageProvider } from './bootstrap/providers/storage.js';
import { notificationsProvider } from './bootstrap/providers/notifications.js';

// Providers — 核心服务
import { simulationManagerProvider } from './bootstrap/providers/simulation.js';
import { packScopeResolverProvider } from './bootstrap/providers/pack_scope.js';
import { packRuntimeLookupProvider, packRuntimeObservationProvider, packRuntimeControlProvider } from './bootstrap/providers/runtime_ports.js';
import { worldEngineProvider } from './bootstrap/providers/world_engine.js';
import { runtimeClockProjectionProvider, worldEngineStepCoordinatorProvider } from './bootstrap/providers/clock.js';
import { cliConfigProvider, runtimeStateProvider } from './bootstrap/providers/config_context.js';

// Providers — AI / Inference
import { inferenceProvidersProvider, inferenceTraceSinkProvider, inferenceServiceProvider } from './bootstrap/providers/inference.js';

// Providers — 插件
import { behaviorStateStoreInitProvider, pluginRuntimeControlProvider, pluginAiTaskServiceProvider, requestPluginInferenceProvider } from './bootstrap/providers/plugin.js';

// Providers — 聚合与路由
import { appContextProvider } from './bootstrap/providers/context.js';
import { queryHandlerRegistryProvider, registerRoutesProvider, expressAppProvider } from './bootstrap/providers/routes.js';
import { wiringProvider } from './bootstrap/providers/wiring.js';
import { metricsInitProvider } from './bootstrap/providers/metrics.js';

const logger = createLogger('yidhras-server');

const app = new Application();

// 基础设施
app.register(prismaProvider);
app.register(repositoriesProvider);
app.register(conversationStoreProvider);
app.register(packStorageAdapterProvider);
app.register(schedulerStorageProvider);
app.register(notificationsProvider);

// 核心服务
app.register(simulationManagerProvider);
app.register(packScopeResolverProvider);
app.register(packRuntimeLookupProvider);
app.register(packRuntimeObservationProvider);
app.register(packRuntimeControlProvider);
app.register(worldEngineProvider);
app.register(runtimeClockProjectionProvider);
app.register(worldEngineStepCoordinatorProvider);
app.register(cliConfigProvider);
app.register(runtimeStateProvider);

// AI
app.register(inferenceProvidersProvider);
app.register(inferenceTraceSinkProvider);
app.register(inferenceServiceProvider);

// 插件
app.register(behaviorStateStoreInitProvider);
app.register(pluginRuntimeControlProvider);
app.register(pluginAiTaskServiceProvider);
app.register(requestPluginInferenceProvider);

// 聚合
app.register(appContextProvider);
app.register(queryHandlerRegistryProvider);
app.register(registerRoutesProvider);
app.register(expressAppProvider);

// Wiring（依赖 sim + worldEngine + inferenceService，必须位于它们之后）
app.register(wiringProvider);
app.register(metricsInitProvider);

// -- boot: 构造所有对象，完成依赖注入 --
await app.boot();

// -- start: 启动序列 --
await app.start(async (app) => {
  const ctx = await app.services.resolve<AppContext>(TOKENS.appContext);
  const cliConfig = await app.services.resolve(TOKENS.cliConfig);
  const wiring = await app.services.resolve<{ multiPackLoopHost: MultiPackLoopHost }>(TOKENS.wiring);
  const sim = await app.services.resolve<SimulationManager>(TOKENS.sim);

  validateProductionSecrets();
  setLoggerRuntimeConfig(getRuntimeConfig().logging);
  initMetrics();
  logRuntimeConfigSnapshot();

  // DB preflight
  await getRuntimeBootstrap({ runtimeBootstrap: ctx.runtimeBootstrap }).prepareDatabase();
  await runStartupPreflight({
    startupHealth: ctx.startupHealth,
    startupPolicy: cliConfig.startupPolicy,
    worldPacksDir: cliConfig.worldPacksDir,
    queryDatabaseHealth: async () => { /* ... 同当前代码 ... */ },
    getErrorMessage
  });

  // Pack 加载 + loop 启动（同当前 index.ts:342-451）
  try {
    // ... resetDevelopmentRuntimeState ...
    // ... selectStartupWorldPack ...
    // ... sim.loadExperimentalPackRuntime ...
    // ... dynamic slots registration ...
    // ... runtimeClockProjection.rebuildFromRuntimeSeed ...
    // ... worldEngine.loadPack ...
    // ... initSystemPackPlugins ...
    // ... syncPackPluginRuntime ...
    // ... ensureSchedulerBootstrapOwnership ...
    // ... bootstrap_list loading ...
    // ... multiPackLoopHost.startLoop ...
    runtimeReady = true; // 通过 ctx.setRuntimeReady(true)
  } catch (err: unknown) {
    ctx.setRuntimeReady(false);
    // ... error handling ...
  }

  // HTTP 监听
  const httpApp = await app.services.resolve<Express>(TOKENS.httpApp);
  const httpServer = httpApp.listen(cliConfig.port, () => {
    logger.info(`API running at http://localhost:${cliConfig.port}`);
  });

  // Metrics server（按需）
  const metricsPort = getRuntimeConfig().runtime.metrics_port;
  if (metricsPort > 0) {
    const { startMetricsServer } = await import('./observability/metrics_server.js');
    startMetricsServer(metricsPort);
  }

  // Config / registry watchers
  const registryWatcher = startAiRegistryWatcher({ /* ... */ });
  const configWatcher = startConfigWatcher();

  // Shutdown
  app.onShutdown(async () => {
    wiring.multiPackLoopHost.shutdown();
    httpServer?.close();
    if (ctx.worldEngine && typeof (ctx.worldEngine as WorldEngineSidecarClient).stop === 'function') {
      await (ctx.worldEngine as WorldEngineSidecarClient).stop();
    }
    await ctx.prisma.$disconnect();
    registryWatcher.close();
    configWatcher?.close();
  });

  process.on('SIGINT', () => { void app.shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void app.shutdown('SIGTERM'); });
});
```

---

## Phase 6: 适配消费者

所有消费 `AppContext` 的代码需要更新类型引用。主要影响范围：

- `routes/*.ts` — 32 个路由文件，`context.worldEngine?.` → `context.worldEngine.`
- `services/**/*.ts` — 业务服务层
- `middleware/**/*.ts` — 中间件
- `runtime/**/*.ts` — 运行时循环，`context.runtimeClockProjection?.` → `context.runtimeClockProjection.`

### 适配规则

| 模式 | 当前代码 | 重构后 |
|------|---------|--------|
| 可选链调用 | `context.worldEngine?.doSomething()` | `context.worldEngine.doSomething()` |
| 守卫检查 | `if (!context.worldEngine) { throw ... }` | **删除守卫** — worldEngine 始终存在 |
| 空值回退 | `context.getPackRuntimeHandle?.(id) ?? null` | `context.getPackRuntimeHandle(id) ?? null` |
| 条件存在 | `if (context.listLoadedPackRuntimeIds) { ... }` | **直接调用** — 始终存在 |

### 特殊适配

**`world_engine_ports.ts`** — `getProjectedCurrentTick` (line 84-91)：当前使用 `context.runtimeClockProjection?.getSnapshot(packId)`。重构后 `runtimeClockProjection` 非可选，但 `getSnapshot` 仍可能返回 `null`（无该 pack 的投影数据），所以改为 `context.runtimeClockProjection.getSnapshot(packId)` — 删除 `?.` 但保留 null 检查。

**`enforcement_engine.ts:381`** — `if (!context.worldEngine) { throw ... }` 守卫删除。worldEngine 由 Provider 保证存在。

**`create_app.ts:19-20`** — `setHttpApp` 调用移除。改为在 `expressAppProvider` 内直接持有引用。

**`pack_snapshots.ts:80,104,151,167`** — `context.setPaused(true/false)` 保留，`setPaused` 改为 required。

---

## Phase 7: 验证

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm --filter yidhras-server test:integration
pnpm --filter yidhras-server test:e2e
```

### 验证标准

- 所有现有测试通过
- `pnpm typecheck` 零错误
- `AppContext` 可选字段从 ~15 降至 2
- `index.ts` 从 545 行降至 ~120 行（imports + register 调用 ~55 行 + boot/start 回调 ~65 行）
- 每个 Provider 可独立实例化测试
- 循环依赖检测生效：刻意制造 A→B→A 循环依赖，`boot()` 抛出清晰错误消息
- `packHostApi` / `contextAssembly` 与 `AppContext` 的循环依赖通过 context Provider 内工厂两步构造解决，不触发循环检测
