import { PrismaClient } from '@prisma/client';
import path from 'path';

import { startAiRegistryWatcher } from './ai/registry_watcher.js';
import { createInferenceProviders } from './app/composition/inference.js';
import type { AppContext, RouteRegistrar, RuntimeLoopDiagnostics } from './app/context.js';
import { createApp } from './app/create_app.js';
import { asyncHandler } from './app/http/async_handler.js';
import { getErrorMessage } from './app/http/errors.js';
import { toJsonSafe } from './app/http/json.js';
import { createPackScopeMiddleware } from './app/http/pack_scope_middleware.js';
import { parseOptionalTick, parsePositiveStepTicks } from './app/http/runtime.js';
import { createGlobalErrorMiddleware } from './app/middleware/error_handler.js';
import { registerConfigRoutes } from './app/routes/config.js';
import { registerConfigBackupRoutes } from './app/routes/config_backup.js';
import { registerAgentBindingRoutes } from './app/routes/operator_agent_bindings.js';
import { registerOperatorAuditRoutes } from './app/routes/operator_audit.js';
import { registerOperatorAuthRoutes } from './app/routes/operator_auth.js';
import { registerGrantRoutes } from './app/routes/operator_grants.js';
import { registerPackBindingRoutes } from './app/routes/operator_pack_bindings.js';
import { registerOperatorRoutes } from './app/routes/operators.js';
import { registerPackRoutes } from './app/routes/packs/index.js';
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
import { type SimulationLoopHandle, startSimulationLoop } from './app/runtime/simulation_loop.js';
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
import { createContextAssemblyPort } from './app/services/context_memory_ports.js';
import { createPrismaRepositories } from './app/services/repositories/index.js';
import { ensureSchedulerBootstrapOwnership, resetDevelopmentRuntimeState } from './app/services/system.js';
import type { CalendarConfig } from './clock/types.js';
import {
  getAiModelsConfigPath,
  getAppPort,
  getPreferredOpening,
  getPreferredWorldPack,
  getRuntimeConfig,
  getRuntimeMultiPackConfig,
  getSimulationLoopIntervalMs,
  getStartupPolicy,
  getWorldEngineConfig,
  getWorldPacksDir,
  isAiGatewayEnabled,
  isExperimentalMultiPackRuntimeEnabled,
  logRuntimeConfigSnapshot,
  resolveWorkspacePath,
  validateProductionSecrets
} from './config/runtime_config.js';
import { startConfigWatcher } from './config/watcher.js';
import { SimulationManager } from './core/simulation.js';
import { createInferenceService } from './inference/service.js';
import { createPrismaInferenceTraceSink } from './inference/sinks/prisma.js';
import { PostgresPackStorageAdapter } from './packs/storage/internal/PostgresPackStorageAdapter.js';
import { SqlitePackStorageAdapter } from './packs/storage/internal/SqlitePackStorageAdapter.js';
import { SqliteSchedulerStorageAdapter } from './packs/storage/internal/SqliteSchedulerStorageAdapter.js';
import { syncActivePackPluginRuntime } from './plugins/runtime.js';
import { ApiError } from './utils/api_error.js';
import { createLogger, setLoggerRuntimeConfig } from './utils/logger.js';
import { createNotificationManager } from './utils/notifications.js';
import { safeFs } from './utils/safe_fs.js';

const logger = createLogger('yidhras-server');

const prisma = new PrismaClient();
const repos = createPrismaRepositories(prisma);
const dbProvider = process.env.PRISMA_DB_PROVIDER ?? 'sqlite';
const packStorageAdapter = dbProvider === 'postgresql'
  ? new PostgresPackStorageAdapter(prisma)
  : new SqlitePackStorageAdapter();
const schedulerStorage = new SqliteSchedulerStorageAdapter();
const notifications = createNotificationManager();
const sim = new SimulationManager({ prisma, packStorageAdapter, notifications });

const port = getAppPort();
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

let timer: SimulationLoopHandle | null = null;
let httpServer: ReturnType<typeof app.listen> | null = null;
let runtimeLoopDiagnostics: RuntimeLoopDiagnostics = { ...DEFAULT_RUNTIME_LOOP_DIAGNOSTICS };
let httpApp: import('express').Express | null = null;
const decisionWorkerId = `decision:${process.pid}:${Date.now()}`;
const actionDispatcherWorkerId = `dispatcher:${process.pid}:${Date.now()}`;
const schedulerWorkerId = process.env.SCHEDULER_WORKER_ID ?? `scheduler:${process.pid}:${Date.now()}`;
const schedulerPartitionIds = resolveOwnedSchedulerPartitionIds({ workerId: schedulerWorkerId });
const simulationLoopIntervalMs = getSimulationLoopIntervalMs();

const assertRuntimeReady = createRuntimeReadyGuard({
  getRuntimeReady: () => sim.isRuntimeReady(),
  startupHealth
});

const packScopeResolver = new PackScopeResolver(sim.getPackRuntimeRegistry());

const appContext: AppContext = {
  repos,
  prisma,
  packStorageAdapter,
  schedulerStorage,
  sim,
  clock: sim,
  activePack: sim,
  runtimeBootstrap: sim,
  activePackRuntime: sim,
  packScope: packScopeResolver,
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
  getActivePackId: () => sim.getActivePack()?.metadata.id ?? null,
  hasPackRuntime: packId => sim.getPackRuntimeHandle(packId) !== null,
  assertPackScope: (packId, _mode, _feature) => packId.trim(),
  getPackRuntimeSummary: packId => {
    const handle = sim.getPackRuntimeHandle(packId);
    if (!handle) return null;
    return {
      pack_id: handle.pack_id,
      pack_folder_name: handle.pack_folder_name,
      health_status: handle.getHealthSnapshot().status,
      current_tick: handle.getClockSnapshot().current_tick,
      runtime_ready: sim.getActivePack()?.metadata.id === handle.pack_id
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
appContext.packHostApi = createPackHostApi(appContext);

const inferenceService = createInferenceService({
  context: appContext,
  providers: createInferenceProviders({ context: appContext }),
  traceSink: createPrismaInferenceTraceSink(appContext)
});

const multiPackLoopHost = new MultiPackLoopHost({
  context: appContext,
  inferenceService,
  decisionWorkerId,
  actionDispatcherWorkerId,
  intervalMs: simulationLoopIntervalMs
});
sim.setMultiPackLoopHost(multiPackLoopHost);

const packScopeMiddleware = createPackScopeMiddleware(packScopeResolver);

const registerRoutes: RouteRegistrar = (application, context) => {
  // -- Pack-scoped routes mounted at /:packId --
  const packRouter = registerPackRoutes({
    context,
    scopeResolver: packScopeResolver,
    asyncHandler,
    inferenceService,
    parseOptionalTick,
    parsePositiveStepTicks,
    toJsonSafe,
    getErrorMessage
  });
  application.use('/:packId', packScopeMiddleware, packRouter);

  // -- Global routes (no pack prefix) --
  registerSystemRoutes(application, context);
  registerConfigBackupRoutes(application, context, { asyncHandler });
  registerConfigRoutes(application, context, { asyncHandler });
  registerPluginRoutes(application, context, { asyncHandler });
  registerPluginRuntimeWebRoutes(application, context, { asyncHandler });
  registerOperatorAuthRoutes(application, context, { asyncHandler });
  registerOperatorRoutes(application, context, { asyncHandler });
  registerPackBindingRoutes(application, context, { asyncHandler });
  registerAgentBindingRoutes(application, context, { asyncHandler });
  registerGrantRoutes(application, context, { asyncHandler });
  registerOperatorAuditRoutes(application, context, { asyncHandler });
};

const app = createApp({
  context: appContext,
  registerRoutes
});

app.use(createGlobalErrorMiddleware(appContext));

const isDatabaseTimeoutError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return normalized.includes('socket timeout') || normalized.includes('database failed to respond') || normalized.includes('database is locked');
};

const handleSimulationStepError = (err: unknown): void => {
  const message = getErrorMessage(err);
  const runtimeLoop = appContext.getRuntimeLoopDiagnostics?.() ?? DEFAULT_RUNTIME_LOOP_DIAGNOSTICS;
  const dbHealth = appContext.getDatabaseHealth?.() ?? null;
  const details = {
    runtime_loop_status: runtimeLoop.status,
    runtime_loop_in_flight: runtimeLoop.in_flight,
    runtime_loop_iteration_count: runtimeLoop.iteration_count,
    runtime_loop_overlap_skipped_count: runtimeLoop.overlap_skipped_count,
    runtime_loop_last_duration_ms: runtimeLoop.last_duration_ms,
    db_provider: dbHealth?.provider ?? null,
    db_connected: dbHealth?.connected ?? null,
    ...(dbHealth?.sqlite ? {
      sqlite_journal_mode: dbHealth.sqlite.journal_mode,
      sqlite_busy_timeout: dbHealth.sqlite.busy_timeout,
      sqlite_synchronous: dbHealth.sqlite.synchronous
    } : {})
  };

  appContext.notifications.push(
    'error',
    isDatabaseTimeoutError(message)
      ? `模拟步进失败（数据库锁竞争或查询超时）: ${message}`
      : `模拟步进失败: ${message}`,
    'SIM_STEP_ERR',
    details
  );
  sim.setPaused(true);
  const latestDiagnostics = appContext.getRuntimeLoopDiagnostics?.() ?? DEFAULT_RUNTIME_LOOP_DIAGNOSTICS;
  appContext.setRuntimeLoopDiagnostics?.({
    ...latestDiagnostics,
    status: 'paused',
    in_flight: false,
    last_error_message: message
  });
};

const startSimulation = (): void => {
  if (!sim.isRuntimeReady()) {
    return;
  }

  if (timer) {
    timer.stop();
  }

  timer = startSimulationLoop({
    context: appContext,
    inferenceService,
    decisionWorkerId,
    actionDispatcherWorkerId,
    schedulerWorkerId,
    intervalMs: simulationLoopIntervalMs,
    onStepError: handleSimulationStepError
  });
};

const start = async (): Promise<void> => {
  validateProductionSecrets();
  setLoggerRuntimeConfig(getRuntimeConfig().logging);
  logRuntimeConfigSnapshot();

  await getRuntimeBootstrap({ runtimeBootstrap: appContext.runtimeBootstrap }).prepareDatabase();

  await runStartupPreflight({
    startupHealth,
    startupPolicy,
    worldPacksDir,
    queryDatabaseHealth: () => prisma.$queryRawUnsafe('SELECT 1'),
    getErrorMessage
  });

  try {
    const resetSummary = await resetDevelopmentRuntimeState(appContext);
    if (resetSummary) {
      appContext.notifications.push('info', '开发环境 runtime 观测数据已清理', 'DEV_RUNTIME_RESET', toJsonSafe(resetSummary) as Record<string, unknown>);
    }

    await ensureSchedulerBootstrapOwnership(appContext, {
      schedulerWorkerId,
      schedulerPartitionIds
    });

    if (startupHealth.level === 'fail') {
      sim.setRuntimeReady(false);
      appContext.notifications.push('error', `系统启动健康检查失败: ${startupHealth.errors.join('; ')}`, 'SYS_PRECHECK_FAIL');
    } else if (!startupHealth.checks.world_pack_available) {
      sim.setRuntimeReady(false);
      appContext.notifications.push('warning', '世界包为空，系统以降级模式启动。请先导入 world pack。', 'WORLD_PACK_EMPTY');
    } else {
      const selectedPack = selectStartupWorldPack(startupHealth.available_world_packs, preferredWorldPack);
      if (!selectedPack) {
        throw new ApiError(503, 'WORLD_PACK_NOT_READY', 'World pack not ready for startup');
      }

      const runtimeDataDir = resolveWorkspacePath('data/runtime');
      const cliMarkerPath = path.join(runtimeDataDir, 'startup_opening.txt');
      let openingId = getPreferredOpening();
      if (safeFs.existsSync(runtimeDataDir, cliMarkerPath)) {
        const cliOpening = safeFs.readFileSync(runtimeDataDir, cliMarkerPath, 'utf-8').trim();
        if (cliOpening) {
          openingId = cliOpening;
        }
        safeFs.unlinkSync(runtimeDataDir, cliMarkerPath);
      }

      await appContext.activePackRuntime!.init(selectedPack, openingId);
      const activePack = appContext.activePack.getActivePack();
      const activePackId = activePack?.metadata.id ?? selectedPack;
      appContext.runtimeClockProjection?.rebuildFromRuntimeSeed({
        pack_id: activePackId,
        current_tick: appContext.clock.getCurrentTick().toString(),
        current_revision: appContext.activePack.getCurrentRevision().toString(),
        calendars: (activePack?.time_systems ?? []) as unknown as CalendarConfig[]
      });

      if (appContext.worldEngine instanceof WorldEngineSidecarClient) {
        await appContext.worldEngine.loadPack({
          pack_id: activePackId,
          pack_ref: selectedPack,
          mode: 'active',
          hydrate: await buildWorldPackHydrateRequest(appContext, activePackId)
        });
      }
      await syncActivePackPluginRuntime(appContext);

      if (isExperimentalMultiPackRuntimeEnabled()) {
        const multiPackConfig = getRuntimeMultiPackConfig();
        if (multiPackConfig.start_mode === 'bootstrap_list' && multiPackConfig.bootstrap_packs.length > 0) {
          logger.info(`bootstrap_list: loading ${String(multiPackConfig.bootstrap_packs.length)} pack(s): ${multiPackConfig.bootstrap_packs.join(', ')}`);
          for (const packRef of multiPackConfig.bootstrap_packs) {
            try {
              const result = await sim.loadExperimentalPackRuntime(packRef);
              if (result.loaded) {
                logger.info(`bootstrap_list: loaded experimental pack ${packRef} (handle=${result.handle.pack_id})`);
              } else if (result.already_loaded) {
                logger.info(`bootstrap_list: pack ${packRef} already loaded, skipping`);
              }
            } catch (err) {
              logger.error(`bootstrap_list: failed to load ${packRef}: ${getErrorMessage(err)}`);
              startupHealth.errors.push(`bootstrap_list: failed to load ${packRef}: ${getErrorMessage(err)}`);
            }
          }
        }
      }

      sim.setRuntimeReady(true);
      appContext.notifications.push(
        'info',
        `Yidhras 系统初始化成功 (pack=${selectedPack}, schedulerPartitions=${schedulerPartitionIds.join(',') || 'none'}, loopIntervalMs=${String(simulationLoopIntervalMs)}, aiGatewayEnabled=${String(isAiGatewayEnabled())})`,
        'SYS_INIT_OK',
        { ai_gateway_enabled: isAiGatewayEnabled() }
      );
      startSimulation();
    }
  } catch (err: unknown) {
    sim.setRuntimeReady(false);
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
      timer?.stop();
      appContext.setRuntimeLoopDiagnostics?.({
        ...(appContext.getRuntimeLoopDiagnostics?.() ?? DEFAULT_RUNTIME_LOOP_DIAGNOSTICS),
        status: 'stopped'
      });

      httpServer?.close();

      if (appContext.worldEngine && typeof (appContext.worldEngine as WorldEngineSidecarClient).stop === 'function') {
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
