import { buildPromptBundleFromAiMessages } from '../../ai/prompt_bundle_from_messages.js';
import type { AiTaskService } from '../../ai/task_service.js';
import { createAiTaskService } from '../../ai/task_service.js';
import type { AppContext } from '../../app/context.js';
import { pluginRuntimeRegistry } from '../../app/runtime/plugin_runtime_registry.js';
import type { PackHostApi } from '../../app/runtime/world_engine_ports.js';
import { createPackHostApi } from '../../app/runtime/world_engine_ports.js';
import { createContextAssemblyPort } from '../../app/services/context/context_memory_port_factory.js';
import { getRuntimeConfig } from '../../config/runtime_config.js';
import type { ContextAssemblyPort } from '../../context/ports.js';
import { syncPackPluginRuntime } from '../../plugins/runtime.js';
import type { PluginInferenceRequest, PluginInferenceResult } from '../../plugins/types.js';
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
    // Cache slots for lazy-initialized circular dependency fields.
    // Factories (createPackHostApi, createContextAssemblyPort, etc.) require a
    // fully-formed AppContext. Using getters with ??= caching so each factory
    // runs once on first access — eliminating the previous as unknown as Record
    // backfill pattern.
    let _packHostApi: PackHostApi | undefined;
    let _contextAssembly: ContextAssemblyPort | undefined;
    let _pluginRuntimeControl:
      | { reload(packId: string): Promise<{ pack_id: string; runtime_count: number }> }
      | undefined;
    let _pluginAiTaskService: AiTaskService | undefined;
    let _requestPluginInference: ((input: PluginInferenceRequest) => Promise<PluginInferenceResult>) | undefined;

    const ctx: AppContext = {
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
      }),

      // ── Circular dependency fields (lazy getters) ──────────────────
      // pluginRuntime is not circular — assign directly.
      pluginRuntime: pluginRuntimeRegistry,

      get packHostApi(): PackHostApi {
        return (_packHostApi ??= createPackHostApi(this));
      },

      get contextAssembly(): ContextAssemblyPort {
        return (_contextAssembly ??= createContextAssemblyPort(this));
      },

      get pluginRuntimeControl() {
        return (_pluginRuntimeControl ??= {
          reload: async (packId: string) => {
            await syncPackPluginRuntime(this, packId);
            const runtimeCount = pluginRuntimeRegistry.listRuntimes(packId).length;
            return { pack_id: packId, runtime_count: runtimeCount };
          }
        });
      },

      get requestPluginInference() {
        const svc = (_pluginAiTaskService ??= createAiTaskService({ context: this }));
        return (_requestPluginInference ??= async (input: PluginInferenceRequest) => {
          const messages = [
            { role: 'system' as const, parts: [{ type: 'text' as const, text: input.systemPrompt }] },
            { role: 'user' as const, parts: [{ type: 'text' as const, text: input.userPrompt }] }
          ];
          const taskId = `plugin:${input.purpose}`;
          const result = await svc.runTask({
            task_id: taskId,
            task_type: 'agent_decision',
            input: {},
            prompt_context: {
              prompt_bundle_v2: buildPromptBundleFromAiMessages({
                taskId,
                taskType: 'agent_decision',
                messages
              })
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
        });
      }
    };

    return ctx;
  }
} as const satisfies import('../provider.js').ServiceProvider;
