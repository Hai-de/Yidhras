/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- deps cast from ServiceContainer Record<string, unknown> */
import type { PrismaClient } from '@prisma/client';

import { buildPromptBundleFromAiMessages } from '../../ai/prompt_bundle_from_messages.js';
import type { AiTaskService } from '../../ai/task_service.js';
import { createAiTaskService } from '../../ai/task_service.js';
import type { AppContext, NotificationStore, RuntimeLoopDiagnostics, StartupHealth } from '../../app/context.js';
import type { PackScopeResolver } from '../../app/runtime/PackScopeResolver.js';
import type { RuntimeClockProjectionService } from '../../app/runtime/runtime_clock_projection.js';
import type { WorldEngineStepCoordinator } from '../../app/runtime/world_engine_persistence.js';
import type { WorldEnginePort } from '../../app/runtime/world_engine_ports.js';
import { createPackHostApi } from '../../app/runtime/world_engine_ports.js';
import { createContextAssemblyPort } from '../../app/services/context/context_memory_ports.js';
import type { Repositories } from '../../app/services/repositories/index.js';
import { getRuntimeConfig } from '../../config/runtime_config.js';
import type { ConversationStore } from '../../conversation/store.js';
import type { PackRuntimeControl, PackRuntimeLookupPort, PackRuntimeObservation } from '../../core/pack_runtime_ports.js';
import type { SimulationManager } from '../../core/simulation.js';
import type { PackStorageAdapter } from '../../packs/storage/PackStorageAdapter.js';
import type { SchedulerStorageAdapter } from '../../packs/storage/SchedulerStorageAdapter.js';
import { pluginRuntimeRegistry, syncPackPluginRuntime } from '../../plugins/runtime.js';
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

interface ContextProviderDeps {
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
  runtimeState: RuntimeStateDeps;
  cliConfig: Record<string, unknown>;
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
    TOKENS.cliConfig
  ],
  useFactory: (deps) => {
    const d = deps as unknown as ContextProviderDeps;

    // Step 1: 构造不含循环依赖字段的 AppContext 壳
    // packHostApi, contextAssembly, pluginRuntimeControl, requestPluginInference, pluginAiTaskService
    // 与 AppContext 存在循环依赖（它们的工厂函数接收完整 AppContext，
    // 但 AppContext 本身包含它们），在 Step 2 中创建并回填。
    const ctx = {
      repos: d.repos,
      prisma: d.prisma,
      conversationStore: d.conversationStore,
      packStorageAdapter: d.packStorageAdapter,
      schedulerStorage: d.schedulerStorage,
      notifications: d.notifications,

      runtimeBootstrap: d.sim,
      packScope: d.packScope,
      packCatalog: {
        listAvailablePacks: () => d.sim.listAvailablePacks(),
        getPacksDir: () => d.sim.getPacksDir(),
        resolveByInstanceId: (instanceId: string) => d.sim.resolveByInstanceId(instanceId),
        getLoader: () => d.sim.getLoader()
      },

      getPackRuntimeHandle: (packId: string) => d.sim.getPackRuntimeHandle(packId),
      listLoadedPackRuntimeIds: () => d.sim.listLoadedPackRuntimeIds(),
      getPackRuntimeHost: (packId: string) => d.sim.getPackRuntimeRegistry().getHost(packId),

      packRuntimeLookup: d.packRuntimeLookup,
      packRuntimeObservation: d.packRuntimeObservation,
      packRuntimeControl: d.packRuntimeControl,

      worldEngine: d.worldEngine,
      runtimeClockProjection: d.runtimeClockProjection,
      worldEngineStepCoordinator: d.worldEngineStepCoordinator,

      startupHealth: d.runtimeState.startupHealth,
      assertRuntimeReady: d.runtimeState.assertRuntimeReady,
      isRuntimeReady: d.runtimeState.isRuntimeReady,
      setRuntimeReady: d.runtimeState.setRuntimeReady,
      isPaused: d.runtimeState.isPaused,
      setPaused: d.runtimeState.setPaused,
      getRuntimeLoopDiagnostics: d.runtimeState.getRuntimeLoopDiagnostics,
      setRuntimeLoopDiagnostics: d.runtimeState.setRuntimeLoopDiagnostics,
      getDatabaseHealth: () => d.sim.getDatabaseHealth(),
      getPluginEnableWarningConfig: () => ({
        enabled: getRuntimeConfig().plugins.enable_warning.enabled,
        require_acknowledgement: getRuntimeConfig().plugins.enable_warning.require_acknowledgement
      })
    } as unknown as AppContext;

    // Step 2: 创建依赖 AppContext 的对象并回填
    (ctx as unknown as Record<string, unknown>).packHostApi = createPackHostApi(ctx);
    (ctx as unknown as Record<string, unknown>).contextAssembly = createContextAssemblyPort(ctx);

    // pluginRuntimeControl — reload 需要完整 AppContext
    (ctx as unknown as Record<string, unknown>).pluginRuntimeControl = {
      reload: async (packId: string) => {
        await syncPackPluginRuntime(ctx, packId);
        const runtimeCount = pluginRuntimeRegistry.listRuntimes(packId).length;
        return { pack_id: packId, runtime_count: runtimeCount };
      }
    };

    // pluginAiTaskService — 独立的 circuit breaker，需要完整 AppContext
    const pluginAiTaskService: AiTaskService = createAiTaskService({ context: ctx });

    // requestPluginInference — 为插件推理提供独立入口
    (ctx as unknown as Record<string, unknown>).requestPluginInference = async (input: Record<string, unknown>) => {
      const messages = [
        { role: 'system' as const, parts: [{ type: 'text' as const, text: input.systemPrompt as string }] },
        { role: 'user' as const, parts: [{ type: 'text' as const, text: input.userPrompt as string }] }
      ];
      const taskId = `plugin:${String(input.purpose)}`;
      const result = await pluginAiTaskService.runTask({
        task_id: taskId,
        task_type: 'agent_decision',
        input: {},
        prompt_context: {
          prompt_bundle_v2: buildPromptBundleFromAiMessages({ taskId, taskType: 'agent_decision', messages })
        },
        output_contract: { mode: 'free_text' },
        route_hints: input.maxTokens
          ? { determinism_tier: 'balanced' }
          : undefined
      });
      return {
        content: result.invocation.output.text ?? '',
        usage: {
          inputTokens: result.invocation.usage?.input_tokens ?? 0,
          outputTokens: result.invocation.usage?.output_tokens ?? 0
        }
      };
    };

    return ctx;
  }
};
