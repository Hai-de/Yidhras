import path from 'path';

import { buildPromptBundleFromAiMessages } from './ai/prompt_bundle_from_messages.js';
import { listDynamicSlots, registerDynamicSlot, unregisterDynamicSlot } from './ai/registry.js';
import { startAiRegistryWatcher } from './ai/registry_watcher.js';
import { createAiTaskService } from './ai/task_service.js';
import { createMemoryBehaviorStateStore, setBehaviorStateStore } from './app/behavior_state_store.js';
import { createInferenceProviders } from './app/composition/inference.js';
import type { AppContext, RouteRegistrar, RuntimeLoopDiagnostics } from './app/context.js';
import { createApp } from './app/create_app.js';
import { asyncHandler } from './app/http/async_handler.js';
import { getErrorMessage } from './app/http/errors.js';
import { toJsonSafe } from './app/http/json.js';
import { createPackScopeMiddleware } from './app/http/pack_scope_middleware.js';
import { parseOptionalTick } from './app/http/runtime.js';
import { createGlobalErrorMiddleware } from './app/middleware/error_handler.js';
import { registerConfigRoutes } from './app/routes/config.js';
import { registerConfigBackupRoutes } from './app/routes/config_backup.js';
import { registerAgentBindingRoutes } from './app/routes/operator_agent_bindings.js';
import { registerOperatorAuditRoutes } from './app/routes/operator_audit.js';
import { registerOperatorAuthRoutes } from './app/routes/operator_auth.js';
import { registerGrantRoutes } from './app/routes/operator_grants.js';
import { registerPackBindingRoutes } from './app/routes/operator_pack_bindings.js';
import { registerOperatorRoutes } from './app/routes/operators.js';
import { registerPackFrontendAssetRoutes } from './app/routes/pack_frontend_assets.js';
import { registerPackListRoutes } from './app/routes/packs.js';
import { registerPackRoutes } from './app/routes/packs/index.js';
import { registerPluginRuntimeServerRoutes } from './app/routes/plugin_runtime_server.js';
import { registerPluginRuntimeWebRoutes } from './app/routes/plugin_runtime_web.js';
import { registerPluginRoutes } from './app/routes/plugins.js';
import { registerSystemRoutes } from './app/routes/system.js';
import { MultiPackLoopHost } from './app/runtime/MultiPackLoopHost.js';
import { PackScopeResolver } from './app/runtime/PackScopeResolver.js';
import { createRuntimeClockProjectionService } from './app/runtime/runtime_clock_projection.js';
import { resolveOwnedSchedulerPartitionIds } from './app/runtime/scheduler_partitioning.js';
import {
  createWorldEngineSidecarClient,
  WorldEngineSidecarClient
} from './app/runtime/sidecar/world_engine_sidecar_client.js';
import {
  createRuntimeReadyGuard,
  createStartupHealth,
  runStartupPreflight,
  selectStartupWorldPack
} from './app/runtime/startup.js';
import { createWorldEngineStepCoordinator } from './app/runtime/world_engine_persistence.js';
import { createPackHostApi } from './app/runtime/world_engine_ports.js';
import { buildWorldPackHydrateRequest } from './app/runtime/world_engine_snapshot.js';
import { getRuntimeBootstrap } from './app/services/app_context_ports.js';
import { createContextAssemblyPort } from './app/services/context/context_memory_ports.js';
import { createPrismaRepositories } from './app/services/repositories/index.js';
import { ensureSchedulerBootstrapOwnership, resetDevelopmentRuntimeState } from './app/services/system/system.js';
import type { CalendarConfig } from './clock/types.js';
import {
  getAiModelsConfigPath,
  getAppPort,
  getPreferredWorldPack,
  getRuntimeConfig,
  getRuntimeMultiPackConfig,
  getSimulationLoopIntervalMs,
  getStartupPolicy,
  getWorldEngineConfig,
  getWorldPacksDir,
  isAiGatewayEnabled,
  logRuntimeConfigSnapshot,
  resolveWorkspacePath,
  validateProductionSecrets
} from './config/runtime_config.js';
import { startConfigWatcher } from './config/watcher.js';
import { PrismaConversationStore } from './conversation/store_prisma.js';
import { SimulationManager } from './core/simulation.js';
import { createPrismaClient } from './db/client.js';
import { createInferenceService } from './inference/service.js';
import { createPrismaInferenceTraceSink } from './inference/sinks/prisma.js';
import { initMetrics } from './observability/metrics.js';
import { DefaultPackRuntimePort } from './packs/orchestration/default_pack_runtime_port.js';
import { PostgresPackStorageAdapter } from './packs/storage/internal/PostgresPackStorageAdapter.js';
import { SqlitePackStorageAdapter } from './packs/storage/internal/SqlitePackStorageAdapter.js';
import { SqliteSchedulerStorageAdapter } from './packs/storage/internal/SqliteSchedulerStorageAdapter.js';
import { pluginRuntimeRegistry, syncPackPluginRuntime } from './plugins/runtime.js';
import { initSystemPackPlugins } from './plugins/system_pack_init.js';
import { ApiError } from './utils/api_error.js';
import { createLogger, setLoggerRuntimeConfig } from './utils/logger.js';
import { createNotificationManager } from './utils/notifications.js';
import { safeFs } from './utils/safe_fs.js';

const logger = createLogger('yidhras-server');

// -- CLI 参数解析：--worker-index=<n> --worker-total=<n> 覆盖环境变量 --
const parseCliInt = (key: string): string | undefined => {
  const arg = process.argv.find(a => a.startsWith(`--${key}=`));
  if (!arg) return undefined;
  const value = arg.slice(key.length + 3);
  if (!/^\d+$/.test(value)) {
    logger.warn(`Invalid --${key} value: "${value}", expected non-negative integer. Ignoring.`);
    return undefined;
  }
  return value;
};
const cliWorkerIndex = parseCliInt('worker-index');
const cliWorkerTotal = parseCliInt('worker-total');
if (cliWorkerIndex !== undefined) process.env.SCHEDULER_WORKER_INDEX = cliWorkerIndex;
if (cliWorkerTotal !== undefined) process.env.SCHEDULER_WORKER_TOTAL = cliWorkerTotal;
// -- end CLI --

const prisma = createPrismaClient();
const repos = createPrismaRepositories(prisma);
const conversationStore = new PrismaConversationStore(prisma);
const dbProvider = process.env.PRISMA_DB_PROVIDER ?? 'sqlite';
const packStorageAdapter = dbProvider === 'postgresql'
  ? new PostgresPackStorageAdapter(prisma)
  : new SqlitePackStorageAdapter();
const schedulerStorage = new SqliteSchedulerStorageAdapter();
const notifications = createNotificationManager();
const sim = new SimulationManager({ prisma, packStorageAdapter });

let runtimeReady = false;

const workerIndex = parseInt(process.env.SCHEDULER_WORKER_INDEX ?? '0', 10) || 0;
const port = getAppPort() + workerIndex;
const worldPacksDir = getWorldPacksDir();
const preferredWorldPack = getPreferredWorldPack();
const startupPolicy = getStartupPolicy();
const startupHealth = createStartupHealth();

const DEFAULT_RUNTIME_LOOP_DIAGNOSTICS: RuntimeLoopDiagnostics = {
  status: 'idle',
  in_flight: false,
  overlap_skipped_count: 0,
  iteration_count: 0,
  last_started_at: null,
  last_finished_at: null,
  last_duration_ms: null,
  last_error_message: null
};

let httpServer: ReturnType<typeof app.listen> | null = null;
let runtimeLoopDiagnostics: RuntimeLoopDiagnostics = { ...DEFAULT_RUNTIME_LOOP_DIAGNOSTICS };
let httpApp: import('express').Express | null = null;
const decisionWorkerId = `decision:${process.pid}:${Date.now()}`;
const actionDispatcherWorkerId = `dispatcher:${process.pid}:${Date.now()}`;
const schedulerWorkerId = process.env.SCHEDULER_WORKER_ID ?? `scheduler:${process.pid}:${Date.now()}`;
const schedulerPartitionIds = resolveOwnedSchedulerPartitionIds({ workerId: schedulerWorkerId });
const simulationLoopIntervalMs = getSimulationLoopIntervalMs();

const assertRuntimeReady = createRuntimeReadyGuard({
  getRuntimeReady: () => runtimeReady,
  startupHealth
});

const packScopeResolver = new PackScopeResolver(sim.getPackRuntimeRegistry());

// Initialize behavior state store (Phase 2: stateful slot trigger rules)
setBehaviorStateStore(createMemoryBehaviorStateStore());

const appContext: AppContext = {
  repos,
  prisma,
  conversationStore,
  packStorageAdapter,
  schedulerStorage,
  runtimeBootstrap: sim,
  packScope: packScopeResolver,
  getPackRuntimeHandle: packId => sim.getPackRuntimeHandle(packId),
  listLoadedPackRuntimeIds: () => sim.listLoadedPackRuntimeIds(),
  isRuntimeReady: () => runtimeReady,
  setRuntimeReady: (ready: boolean) => { runtimeReady = ready; },
  isPaused: () => false,
  setPaused: () => {},
  notifications,
  startupHealth,
  getRuntimeLoopDiagnostics: () => runtimeLoopDiagnostics,
  setRuntimeLoopDiagnostics: next => {
    runtimeLoopDiagnostics = next;
  },
  getDatabaseHealth: () => getRuntimeBootstrap({ runtimeBootstrap: appContext.runtimeBootstrap }).getDatabaseHealth(),
  getPluginEnableWarningConfig: () => ({
    enabled: getRuntimeConfig().plugins.enable_warning.enabled,
    require_acknowledgement: getRuntimeConfig().plugins.enable_warning.require_acknowledgement
  }),
  getHttpApp: () => httpApp,
  setHttpApp: app => {
    httpApp = app;
  },
  worldEngineStepCoordinator: createWorldEngineStepCoordinator(),
  runtimeClockProjection: createRuntimeClockProjectionService(),
  assertRuntimeReady
};

appContext.contextAssembly = createContextAssemblyPort(appContext);
appContext.packRuntimeLookup = {
  hasPackRuntime: packId => sim.getPackRuntimeHandle(packId) !== null,
  assertPackScope: (packId, _feature) => packId.trim(),
  getPackRuntimeSummary: packId => {
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
};
appContext.packRuntimeObservation = {
  getStatus: packId => sim.getPackRuntimeStatusSnapshot(packId),
  listStatuses: () => sim.listRuntimeStatuses(),
  getClockSnapshot: packId => sim.getPackRuntimeHandle(packId)?.getClockSnapshot() ?? null,
  getRuntimeSpeedSnapshot: packId => sim.getPackRuntimeHandle(packId)?.getRuntimeSpeedSnapshot() ?? null
};
appContext.packRuntimeControl = {
  load: packRef => sim.loadExperimentalPackRuntime(packRef),
  unload: packId => sim.unloadExperimentalPackRuntime(packId)
};

const worldEngineConfig = getWorldEngineConfig();
appContext.worldEngine = createWorldEngineSidecarClient({
  binaryPath: worldEngineConfig.binary_path,
  timeoutMs: worldEngineConfig.timeout_ms,
  autoRestart: worldEngineConfig.auto_restart
});
sim.setWorldEngine(appContext.worldEngine);
appContext.packHostApi = createPackHostApi(appContext);
appContext.pluginRuntimeControl = {
  reload: async packId => {
    await syncPackPluginRuntime(appContext, packId);
    const runtimeCount = pluginRuntimeRegistry.listRuntimes(packId).length;
    return { pack_id: packId, runtime_count: runtimeCount };
  }
};

const inferenceService = createInferenceService({
  context: appContext,
  providers: createInferenceProviders({ context: appContext }),
  traceSink: createPrismaInferenceTraceSink(appContext)
});

// Plugin inference uses its own AiTaskService with independent circuit breakers
const pluginAiTaskService = createAiTaskService({ context: appContext });
appContext.requestPluginInference = async (input) => {
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

const multiPackLoopHost = new MultiPackLoopHost({
  context: appContext,
  inferenceService,
  decisionWorkerId,
  actionDispatcherWorkerId,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
  worldEngine: appContext.worldEngine as WorldEngineSidecarClient,
  intervalMs: simulationLoopIntervalMs
});
sim.setMultiPackLoopHost(multiPackLoopHost);

const packScopeMiddleware = createPackScopeMiddleware(packScopeResolver);

const registerRoutes: RouteRegistrar = (application, context) => {
  // -- Global routes (no pack prefix) -- must be registered before /:packId middleware
  // so that /api/* paths match exact routes rather than being caught by the
  // /:packId wildcard (which would resolve "api" as a pack id).
  registerPackListRoutes(application, context, worldPacksDir);
  registerPackFrontendAssetRoutes(application, context, worldPacksDir);
  registerSystemRoutes(application, context);
  registerConfigBackupRoutes(application, context, { asyncHandler });
  registerConfigRoutes(application, context, { asyncHandler });
  registerPluginRoutes(application, context, { asyncHandler });
  registerPluginRuntimeServerRoutes(application, context, { asyncHandler });
  registerPluginRuntimeWebRoutes(application, context, { asyncHandler });
  registerOperatorAuthRoutes(application, context, { asyncHandler });
  registerOperatorRoutes(application, context, { asyncHandler });
  registerPackBindingRoutes(application, context, { asyncHandler });
  registerAgentBindingRoutes(application, context, { asyncHandler });
  registerGrantRoutes(application, context, { asyncHandler });
  registerOperatorAuditRoutes(application, context, { asyncHandler });

  // -- Pack-scoped routes mounted at /:packId --
  const packRouter = registerPackRoutes({
    context,
    scopeResolver: packScopeResolver,
    asyncHandler,
    inferenceService,
    parseOptionalTick,
    toJsonSafe,
    getErrorMessage
  });
  application.use('/:packId', packScopeMiddleware, packRouter);
};

const app = createApp({
  context: appContext,
  registerRoutes
});

app.use(createGlobalErrorMiddleware(appContext));

const start = async (): Promise<void> => {
  validateProductionSecrets();
  setLoggerRuntimeConfig(getRuntimeConfig().logging);
  initMetrics();
  logRuntimeConfigSnapshot();

  await getRuntimeBootstrap({ runtimeBootstrap: appContext.runtimeBootstrap }).prepareDatabase();

  await runStartupPreflight({
    startupHealth,
    startupPolicy,
    worldPacksDir,
    queryDatabaseHealth: async () => {
      const dbProvider = process.env.PRISMA_DB_PROVIDER ?? 'sqlite';
      let count: unknown;
      if (dbProvider === 'postgresql' || dbProvider === 'pg') {
        const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT 1 FROM information_schema.tables WHERE table_name = '_prisma_migrations'`
        );
        count = rows.length;
      } else {
        const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_prisma_migrations'`
        );
        count = rows.length;
      }
      if (!count) {
        throw new Error('Prisma migrations table not found. Run prisma migrate deploy.');
      }
    },
    getErrorMessage
  });

  try {
    const resetSummary = await resetDevelopmentRuntimeState(appContext);
    if (resetSummary) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- toJsonSafe return type
      appContext.notifications.push('info', '开发环境 runtime 观测数据已清理', 'DEV_RUNTIME_RESET', toJsonSafe(resetSummary) as Record<string, unknown>);
    }

    if (startupHealth.level === 'fail') {
      runtimeReady = false;
      appContext.notifications.push('error', `系统启动健康检查失败: ${startupHealth.errors.join('; ')}`, 'SYS_PRECHECK_FAIL');
    } else if (!startupHealth.checks.world_pack_available) {
      runtimeReady = false;
      appContext.notifications.push('warning', '世界包为空，系统以降级模式启动。请先导入 world pack。', 'WORLD_PACK_EMPTY');
    } else {
      const selectedPack = selectStartupWorldPack(startupHealth.available_world_packs, preferredWorldPack);
      if (!selectedPack) {
        throw new ApiError(503, 'WORLD_PACK_NOT_READY', 'World pack not ready for startup');
      }

      const runtimeDataDir = resolveWorkspacePath('data/runtime');
      const cliMarkerPath = path.join(runtimeDataDir, 'startup_opening.txt');
      if (safeFs.existsSync(runtimeDataDir, cliMarkerPath)) {
        safeFs.unlinkSync(runtimeDataDir, cliMarkerPath);
      }

      // Load main pack through registry service (symmetric with experimental packs)
      const loadResult = await sim.loadExperimentalPackRuntime(selectedPack);
      const packId = loadResult.handle.instance_id;
      const pack = loadResult.handle.pack;

      // Register world pack dynamic slots
      const packSlots = pack.ai?.slots;
      if (packSlots) {
        for (const slotId of listDynamicSlots().map(s => s.id)) {
          unregisterDynamicSlot(slotId);
        }
        for (const [slotId, slotConfig] of Object.entries(packSlots)) {
          registerDynamicSlot({ id: slotId, ...slotConfig });
        }
      }

      const clockSnapshot = loadResult.handle.getClockSnapshot();
      appContext.runtimeClockProjection?.rebuildFromRuntimeSeed({
        pack_id: packId,
        current_tick: clockSnapshot.current_tick,
        current_revision: clockSnapshot.current_tick,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
        calendars: (pack?.time_systems ?? []) as unknown as CalendarConfig[]
      });

      if (appContext.worldEngine instanceof WorldEngineSidecarClient) {
        await appContext.worldEngine.loadPack({
          pack_id: packId,
          pack_ref: selectedPack,
          mode: 'active',
          hydrate: await buildWorldPackHydrateRequest(appContext, packId)
        });
      }
      const systemPackResult = await initSystemPackPlugins(
        { prisma },
        resolveWorkspacePath('apps/server/builtin/system_pack/plugins')
      );
      if (systemPackResult.errors.length > 0) {
        for (const err of systemPackResult.errors) {
          logger.warn(`system pack plugin: ${err}`);
        }
      }

      if (systemPackResult.enabled.length > 0) {
        logger.info(`system pack plugins enabled: ${systemPackResult.enabled.join(', ')}`);
      }

      await syncPackPluginRuntime(appContext, packId);
      await ensureSchedulerBootstrapOwnership(appContext, {
        packId: packId,
        schedulerWorkerId,
        schedulerPartitionIds
      });

      const multiPackConfig = getRuntimeMultiPackConfig();
      if (multiPackConfig.start_mode === 'bootstrap_list' && multiPackConfig.bootstrap_packs.length > 0) {
        logger.info(`bootstrap_list: loading ${String(multiPackConfig.bootstrap_packs.length)} pack(s): ${multiPackConfig.bootstrap_packs.join(', ')}`);
        for (const packRef of multiPackConfig.bootstrap_packs) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- bootstrap config guarantees packRuntimeControl
            const result = await appContext.packRuntimeControl!.load(packRef);
            if (result.loaded) {
              logger.info(`bootstrap_list: loaded pack ${packRef} (handle=${result.handle.instance_id})`);
            } else if (result.already_loaded) {
              logger.info(`bootstrap_list: pack ${packRef} already loaded, skipping`);
            }
          } catch (err) {
            logger.error(`bootstrap_list: failed to load ${packRef}: ${getErrorMessage(err)}`);
            startupHealth.errors.push(`bootstrap_list: failed to load ${packRef}: ${getErrorMessage(err)}`);
          }
        }
      }

      runtimeReady = true;
      appContext.notifications.push(
        'info',
        `Yidhras 系统初始化成功 (pack=${selectedPack}, schedulerPartitions=${schedulerPartitionIds.join(',') || 'none'}, loopIntervalMs=${String(simulationLoopIntervalMs)}, aiGatewayEnabled=${String(isAiGatewayEnabled())})`,
        'SYS_INIT_OK',
        { ai_gateway_enabled: isAiGatewayEnabled() }
      );
      const packHost = sim.getPackRuntimeRegistry().getHost(packId);
      if (packHost) {
        const packRuntimePort = new DefaultPackRuntimePort(packHost);
        multiPackLoopHost.startLoop(packId, packHost.getClock(), packRuntimePort);
      }
    }
  } catch (err: unknown) {
    runtimeReady = false;
    startupHealth.level = 'degraded';
    startupHealth.errors.push(`simulation init failed: ${getErrorMessage(err)}`);
    logger.error('Init Error', { error: getErrorMessage(err) });
    appContext.notifications.push('error', `系统初始化失败，已降级运行: ${getErrorMessage(err)}`, 'SYS_INIT_FAIL');
  }

  httpServer = app.listen(port, () => {
    logger.info(`API full implementation running at http://localhost:${port}`);
    logger.info(`Inference module ready (phase=${inferenceService.phase}, ready=${String(inferenceService.ready)})`);
    logger.info(`AI gateway enabled=${String(isAiGatewayEnabled())}`);
    logger.info(`Scheduler worker=${schedulerWorkerId} partitions=${schedulerPartitionIds.join(',') || 'none'} loopIntervalMs=${String(simulationLoopIntervalMs)}`);
  });

  const metricsPort = getRuntimeConfig().runtime.metrics_port;
  if (metricsPort > 0) {
    const { startMetricsServer } = await import('./observability/metrics_server.js');
    startMetricsServer(metricsPort);
  }

  const registryWatcher = startAiRegistryWatcher({
    aiModelsConfigPath: getAiModelsConfigPath(),
    promptSlotsDefaultPath: resolveWorkspacePath(
      'apps/server/src/ai/schemas/prompt_slots.default.yaml',
    ),
  });

  const configWatcher = startConfigWatcher();

  const gracefulShutdown = async (signal: string): Promise<void> => {
    logger.info(`收到 ${signal} 信号，开始优雅关闭...`);

    const forceExit = setTimeout(() => {
      logger.error('优雅关闭超时（10 秒），强制退出');
      process.exit(1);
    }, 10_000);

    try {
      multiPackLoopHost.shutdown();

      httpServer?.close();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      if (appContext.worldEngine && typeof (appContext.worldEngine as WorldEngineSidecarClient).stop === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
        await (appContext.worldEngine as WorldEngineSidecarClient).stop();
      }

      await prisma.$disconnect();
      logger.info('Prisma 已断开连接');

      registryWatcher.close();
      logger.info('Registry watcher 已关闭');

      configWatcher?.close();

      clearTimeout(forceExit);
      logger.info('优雅关闭完成');
      process.exit(0);
    } catch (err) {
      logger.error('关闭过程出错', { error: getErrorMessage(err) });
      clearTimeout(forceExit);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
  process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
};

void start();
