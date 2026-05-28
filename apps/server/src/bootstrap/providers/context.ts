/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- deps cast from ServiceContainer Record<string, unknown> */
import type { PrismaClient } from '@prisma/client';

import type { AppContext,NotificationStore, RuntimeLoopDiagnostics,StartupHealth  } from '../../app/context.js';
import type { PackScopeResolver } from '../../app/runtime/PackScopeResolver.js';
import type { RuntimeClockProjectionService } from '../../app/runtime/runtime_clock_projection.js';
import type { WorldEngineStepCoordinator } from '../../app/runtime/world_engine_persistence.js';
import type { WorldEnginePort } from '../../app/runtime/world_engine_ports.js';
import { createPackHostApi } from '../../app/runtime/world_engine_ports.js';
import { createContextAssemblyPort } from '../../app/services/context/context_memory_ports.js';
import type { Repositories } from '../../app/services/repositories/index.js';
import { getRuntimeConfig } from '../../config/runtime_config.js';
import type { ConversationStore } from '../../conversation/store.js';
import type { PackRuntimeControl,PackRuntimeLookupPort, PackRuntimeObservation } from '../../core/pack_runtime_ports.js';
import type { SimulationManager } from '../../core/simulation.js';
import type { PackStorageAdapter } from '../../packs/storage/PackStorageAdapter.js';
import type { SchedulerStorageAdapter } from '../../packs/storage/SchedulerStorageAdapter.js';
import type { ServiceProvider } from '../provider.js';
import { TOKENS } from '../tokens.js';

interface RuntimeStateDeps {
  startupHealth: StartupHealth;
  assertRuntimeReady: (feature: string) => void;
  isRuntimeReady: () => boolean;
  setRuntimeReady: (ready: boolean) => void;
  isPaused: () => boolean;
  setPaused: (paused: boolean) => void;
  getRuntimeLoopDiagnostics: () => RuntimeLoopDiagnostics;
  setRuntimeLoopDiagnostics: (next: RuntimeLoopDiagnostics) => void;
}

interface ContextProviderDeps extends RuntimeStateDeps {
  repos: Repositories;
  prisma: PrismaClient;
  conversationStore: ConversationStore;
  packStorageAdapter: PackStorageAdapter;
  schedulerStorage: SchedulerStorageAdapter;
  notifications: NotificationStore;
  sim: SimulationManager;
  packScope: PackScopeResolver;
  packRuntimeLookup: PackRuntimeLookupPort;
  packRuntimeObservation: PackRuntimeObservation;
  packRuntimeControl: PackRuntimeControl;
  worldEngine: WorldEnginePort;
  runtimeClockProjection: RuntimeClockProjectionService;
  worldEngineStepCoordinator: WorldEngineStepCoordinator;
  pluginRuntimeControl: Record<string, unknown> | undefined;
  requestPluginInference: ((input: Record<string, unknown>) => Promise<Record<string, unknown>>) | undefined;
}

export const appContextProvider: ServiceProvider = {
  provide: TOKENS.appContext,
  deps: [
    TOKENS.prisma,
    TOKENS.repos,
    TOKENS.conversationStore,
    TOKENS.packStorageAdapter,
    TOKENS.schedulerStorage,
    TOKENS.notifications,
    TOKENS.sim,
    TOKENS.packScope,
    TOKENS.packRuntimeLookup,
    TOKENS.packRuntimeObservation,
    TOKENS.packRuntimeControl,
    TOKENS.worldEngine,
    TOKENS.runtimeClockProjection,
    TOKENS.worldEngineStepCoordinator,
    TOKENS.runtimeState,
    TOKENS.cliConfig,
    TOKENS.pluginRuntimeControl,
    TOKENS.requestPluginInference
  ],
  useFactory: (deps) => {
    const d = deps as unknown as ContextProviderDeps;

    // Step 1: 构造不含 packHostApi / contextAssembly 的 AppContext 壳
    const ctx = {
      repos: d.repos,
      prisma: d.prisma,
      conversationStore: d.conversationStore,
      packStorageAdapter: d.packStorageAdapter,
      schedulerStorage: d.schedulerStorage,
      notifications: d.notifications,

      runtimeBootstrap: d.sim,
      packScope: d.packScope,

      getPackRuntimeHandle: (packId: string) => d.sim.getPackRuntimeHandle(packId),
      listLoadedPackRuntimeIds: () => d.sim.listLoadedPackRuntimeIds(),
      getPackRuntimeHost: (packId: string) => d.sim.getPackRuntimeRegistry().getHost(packId),

      packRuntimeLookup: d.packRuntimeLookup,
      packRuntimeObservation: d.packRuntimeObservation,
      packRuntimeControl: d.packRuntimeControl,

      worldEngine: d.worldEngine,
      runtimeClockProjection: d.runtimeClockProjection,
      worldEngineStepCoordinator: d.worldEngineStepCoordinator,

      // 运行时可变状态（展开 runtimeState）
      startupHealth: d.startupHealth,
      assertRuntimeReady: d.assertRuntimeReady,
      isRuntimeReady: d.isRuntimeReady,
      setRuntimeReady: d.setRuntimeReady,
      isPaused: d.isPaused,
      setPaused: d.setPaused,
      getRuntimeLoopDiagnostics: d.getRuntimeLoopDiagnostics,
      setRuntimeLoopDiagnostics: d.setRuntimeLoopDiagnostics,
      getDatabaseHealth: () => d.sim.getDatabaseHealth(),
      getPluginEnableWarningConfig: () => ({
        enabled: getRuntimeConfig().plugins.enable_warning.enabled,
        require_acknowledgement: getRuntimeConfig().plugins.enable_warning.require_acknowledgement
      }),

      // 可选扩展
      pluginRuntimeControl: d.pluginRuntimeControl,
      requestPluginInference: d.requestPluginInference
    } as unknown as AppContext;

    // Step 2: 创建依赖 AppContext 的对象并回填（需要完整的 AppContext 引用）
     
    (ctx as unknown as Record<string, unknown>).packHostApi = createPackHostApi(ctx);
     
    (ctx as unknown as Record<string, unknown>).contextAssembly = createContextAssemblyPort(ctx);

    return ctx;
  }
};
