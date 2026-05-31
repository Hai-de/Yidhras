import { buildPromptBundleFromAiMessages } from '../../ai/prompt_bundle_from_messages.js';
import type { AiTaskService } from '../../ai/task_service.js';
import { createAiTaskService } from '../../ai/task_service.js';
import type { AppContext } from '../../app/context.js';
import { createPackHostApi } from '../../app/runtime/world_engine_ports.js';
import { createContextAssemblyPort } from '../../app/services/context/context_memory_port_factory.js';
import { getRuntimeConfig } from '../../config/runtime_config.js';
import { pluginRuntimeRegistry, syncPackPluginRuntime } from '../../plugins/runtime.js';
import { TOKENS } from '../tokens.js';

export const appContextProvider = {
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
  ] as const,
  useFactory: (deps) => {
    // Step 1: 构造不含循环依赖字段的 AppContext 壳
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- AppContext construction shell: missing circular deps are backfilled in Step 2
    const ctx = {
      repos: deps.repos,
      prisma: deps.prisma,
      conversationStore: deps.conversationStore,
      packStorageAdapter: deps.packStorageAdapter,
      schedulerStorage: deps.schedulerStorage,
      notifications: deps.notifications,

      runtimeBootstrap: deps.sim,
      packScope: deps.packScope,
      packCatalog: {
        listAvailablePacks: () => deps.sim.listAvailablePacks(),
        getPacksDir: () => deps.sim.getPacksDir(),
        resolveByInstanceId: (instanceId: string) => deps.sim.resolveByInstanceId(instanceId),
        getLoader: () => deps.sim.getLoader()
      },

      getPackRuntimeHandle: (packId: string) => deps.sim.getPackRuntimeHandle(packId),
      listLoadedPackRuntimeIds: () => deps.sim.listLoadedPackRuntimeIds(),
      getPackRuntimeHost: (packId: string) => deps.sim.getPackRuntimeRegistry().getHost(packId),

      packRuntimeLookup: deps.packRuntimeLookup,
      packRuntimeObservation: deps.packRuntimeObservation,
      packRuntimeControl: deps.packRuntimeControl,

      worldEngine: deps.worldEngine,
      runtimeClockProjection: deps.runtimeClockProjection,
      worldEngineStepCoordinator: deps.worldEngineStepCoordinator,

      startupHealth: deps.runtimeState.startupHealth,
      assertRuntimeReady: deps.runtimeState.assertRuntimeReady,
      isRuntimeReady: deps.runtimeState.isRuntimeReady,
      setRuntimeReady: deps.runtimeState.setRuntimeReady,
      isPaused: deps.runtimeState.isPaused,
      setPaused: deps.runtimeState.setPaused,
      getRuntimeLoopDiagnostics: deps.runtimeState.getRuntimeLoopDiagnostics,
      setRuntimeLoopDiagnostics: deps.runtimeState.setRuntimeLoopDiagnostics,
      getDatabaseHealth: () => deps.sim.getDatabaseHealth(),
      getPluginEnableWarningConfig: () => ({
        enabled: getRuntimeConfig().plugins.enable_warning.enabled,
        require_acknowledgement: getRuntimeConfig().plugins.enable_warning.require_acknowledgement
      })
    } as unknown as AppContext;

    // Step 2: 创建依赖 AppContext 的对象并回填
    // AppContext 中的 packHostApi / contextAssembly / pluginRuntimeControl / requestPluginInference
    // 与 AppContext 本身存在循环依赖（工厂接收 AppContext，产物又被 AppContext 持有）。
    // 使用 Record<string, unknown> 中转回填是解决此循环的标准模式。
    /* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- circular dependency backfill */
    (ctx as unknown as Record<string, unknown>)['packHostApi'] = createPackHostApi(ctx);
    (ctx as unknown as Record<string, unknown>)['contextAssembly'] = createContextAssemblyPort(ctx);
    (ctx as unknown as Record<string, unknown>)['pluginRuntime'] = pluginRuntimeRegistry;

    // pluginRuntimeControl — reload 需要完整 AppContext
    (ctx as unknown as Record<string, unknown>)['pluginRuntimeControl'] = {
      reload: async (packId: string) => {
        await syncPackPluginRuntime(ctx, packId);
        const runtimeCount = pluginRuntimeRegistry.listRuntimes(packId).length;
        return { pack_id: packId, runtime_count: runtimeCount };
      }
    };

    // pluginAiTaskService — 独立的 circuit breaker，需要完整 AppContext
    const pluginAiTaskService: AiTaskService = createAiTaskService({ context: ctx });

    // requestPluginInference — 为插件推理提供独立入口
     
    (ctx as unknown as Record<string, unknown>)['requestPluginInference'] = async (input: Record<string, unknown>) => {
      const messages = [
        { role: 'system' as const, parts: [{ type: 'text' as const, text: input['systemPrompt'] as string }] },
        { role: 'user' as const, parts: [{ type: 'text' as const, text: input['userPrompt'] as string }] }
      ];
      const taskId = `plugin:${String(input['purpose'])}`;
      const result = await pluginAiTaskService.runTask({
        task_id: taskId,
        task_type: 'agent_decision',
        input: {},
        prompt_context: {
          prompt_bundle_v2: buildPromptBundleFromAiMessages({ taskId, taskType: 'agent_decision', messages })
        },
        output_contract: { mode: 'free_text' },
        route_hints: input['maxTokens']
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
    /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */

    return ctx;
  }
} as const satisfies import('../provider.js').ServiceProvider;
