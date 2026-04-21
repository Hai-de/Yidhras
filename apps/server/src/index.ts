import type { AppContext, RouteRegistrar, RuntimeLoopDiagnostics } from './app/context.js';
import { createApp } from './app/create_app.js';
import { asyncHandler } from './app/http/async_handler.js';
import { getErrorMessage } from './app/http/errors.js';
import { toJsonSafe } from './app/http/json.js';
import { parseOptionalTick, parsePositiveStepTicks } from './app/http/runtime.js';
import { createGlobalErrorMiddleware } from './app/middleware/error_handler.js';
import { registerAccessPolicyRoutes } from './app/routes/access_policy.js';
import { registerAgentRoutes } from './app/routes/agent.js';
import { registerAuditRoutes } from './app/routes/audit.js';
import { registerClockRoutes } from './app/routes/clock.js';
import { registerExperimentalPackProjectionRoutes } from './app/routes/experimental_pack_projection.js';
import { registerExperimentalRuntimeRoutes } from './app/routes/experimental_runtime.js';
import { registerGraphRoutes } from './app/routes/graph.js';
import { registerIdentityRoutes } from './app/routes/identity.js';
import { registerInferenceRoutes } from './app/routes/inference.js';
import { registerNarrativeRoutes } from './app/routes/narrative.js';
import { registerOverviewRoutes } from './app/routes/overview.js';
import { registerPluginRuntimeWebRoutes } from './app/routes/plugin_runtime_web.js';
import { registerPluginRoutes } from './app/routes/plugins.js';
import { registerRelationalRoutes } from './app/routes/relational.js';
import { registerSchedulerRoutes } from './app/routes/scheduler.js';
import { registerSocialRoutes } from './app/routes/social.js';
import { registerSystemRoutes } from './app/routes/system.js';
import { createRuntimeKernelService } from './app/runtime/runtime_kernel_service.js';
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
import {
  createContextAssemblyPort,
  createMemoryRuntimePort
} from './app/services/context_memory_ports.js';
import { ensureSchedulerBootstrapOwnership, resetDevelopmentRuntimeState } from './app/services/system.js';
import {
  getAppPort,
  getPreferredWorldPack,
  getRuntimeConfig,
  getSimulationLoopIntervalMs,
  getStartupPolicy,
  getWorldEngineConfig,
  getWorldPacksDir,
  logRuntimeConfigSnapshot
} from './config/runtime_config.js';
import { sim } from './core/simulation.js';
import { createInferenceService } from './inference/service.js';
import { createPrismaInferenceTraceSink } from './inference/sinks/prisma.js';
import { syncActivePackPluginRuntime } from './plugins/runtime.js';
import { ApiError } from './utils/api_error.js';
import { notifications } from './utils/notifications.js';

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

let runtimeReady = false;
let timer: SimulationLoopHandle | null = null;
let isPaused = false;
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

const appContext: AppContext = {
  prisma: sim.prisma,
  sim,
  runtimeBootstrap: sim,
  activePackRuntime: sim,
  packCatalog: sim,
  notifications,
  startupHealth,
  getRuntimeReady: () => runtimeReady,
  setRuntimeReady: (ready: boolean) => {
    runtimeReady = ready;
  },
  getPaused: () => isPaused,
  setPaused: (paused: boolean) => {
    isPaused = paused;
  },
  getRuntimeLoopDiagnostics: () => runtimeLoopDiagnostics,
  setRuntimeLoopDiagnostics: next => {
    runtimeLoopDiagnostics = next;
  },
  getSqliteRuntimePragmas: () => getRuntimeBootstrap({ runtimeBootstrap: appContext.runtimeBootstrap, sim }).getSqliteRuntimePragmaSnapshot(),
  getPluginEnableWarningConfig: () => ({
    enabled: getRuntimeConfig().plugins.enable_warning.enabled,
    require_acknowledgement: getRuntimeConfig().plugins.enable_warning.require_acknowledgement
  }),
  getHttpApp: () => httpApp,
  setHttpApp: app => {
    httpApp = app;
  },
  worldEngineStepCoordinator: createWorldEngineStepCoordinator(),
  assertRuntimeReady
};

appContext.runtimeKernel = createRuntimeKernelService(appContext);
appContext.contextAssembly = createContextAssemblyPort(appContext);
appContext.memoryRuntime = createMemoryRuntimePort(appContext);
const worldEngineConfig = getWorldEngineConfig();
appContext.worldEngine = createWorldEngineSidecarClient({
  binaryPath: worldEngineConfig.binary_path,
  timeoutMs: worldEngineConfig.timeout_ms,
  autoRestart: worldEngineConfig.auto_restart
});
appContext.packHostApi = createPackHostApi(appContext);

const inferenceService = createInferenceService({
  context: appContext,
  traceSink: createPrismaInferenceTraceSink(appContext)
});

const registerRoutes: RouteRegistrar = (application, context) => {
  registerInferenceRoutes(application, context, inferenceService, {
    asyncHandler
  });
  registerSystemRoutes(application, context);
  registerOverviewRoutes(application, context, {
    asyncHandler
  });
  registerGraphRoutes(application, context, {
    asyncHandler
  });
  registerClockRoutes(application, context, {
    parsePositiveStepTicks,
    toJsonSafe,
    getErrorMessage
  });
  registerExperimentalRuntimeRoutes(application, context, {
    asyncHandler
  });
  registerExperimentalPackProjectionRoutes(application, context, {
    asyncHandler
  });
  registerSocialRoutes(application, context, {
    asyncHandler
  });
  registerRelationalRoutes(application, context, {
    asyncHandler
  });
  registerNarrativeRoutes(application, context, {
    asyncHandler
  });
  registerAgentRoutes(application, context, {
    asyncHandler
  });
  registerAuditRoutes(application, context, {
    asyncHandler
  });
  registerIdentityRoutes(application, context, {
    asyncHandler,
    parseOptionalTick
  });
  registerAccessPolicyRoutes(application, context, {
    asyncHandler
  });
  registerPluginRoutes(application, context, {
    asyncHandler
  });
  registerPluginRuntimeWebRoutes(application, context, {
    asyncHandler
  });
  registerSchedulerRoutes(application, context, {
    asyncHandler
  });
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
  const sqlitePragmas = appContext.getSqliteRuntimePragmas?.() ?? null;
  const details = {
    runtime_loop_status: runtimeLoop.status,
    runtime_loop_in_flight: runtimeLoop.in_flight,
    runtime_loop_iteration_count: runtimeLoop.iteration_count,
    runtime_loop_overlap_skipped_count: runtimeLoop.overlap_skipped_count,
    runtime_loop_last_duration_ms: runtimeLoop.last_duration_ms,
    sqlite_journal_mode: sqlitePragmas?.journal_mode ?? null,
    sqlite_busy_timeout: sqlitePragmas?.busy_timeout ?? null,
    sqlite_synchronous: sqlitePragmas?.synchronous ?? null
  };

  notifications.push(
    'error',
    isDatabaseTimeoutError(message)
      ? `模拟步进失败（数据库锁竞争或查询超时）: ${message}`
      : `模拟步进失败: ${message}`,
    'SIM_STEP_ERR',
    details
  );
  appContext.setPaused(true);
  const latestDiagnostics = appContext.getRuntimeLoopDiagnostics?.() ?? DEFAULT_RUNTIME_LOOP_DIAGNOSTICS;
  appContext.setRuntimeLoopDiagnostics?.({
    ...latestDiagnostics,
    status: 'paused',
    in_flight: false,
    last_error_message: message
  });
};

const startSimulation = (): void => {
  if (!appContext.getRuntimeReady()) {
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
  logRuntimeConfigSnapshot();

  await getRuntimeBootstrap({ runtimeBootstrap: appContext.runtimeBootstrap, sim }).prepareDatabase();

  await runStartupPreflight({
    startupHealth,
    startupPolicy,
    worldPacksDir,
    queryDatabaseHealth: () => sim.prisma.$queryRawUnsafe('SELECT 1'),
    getErrorMessage
  });

  try {
    const resetSummary = await resetDevelopmentRuntimeState(appContext);
    if (resetSummary) {
      notifications.push('info', '开发环境 runtime 观测数据已清理', 'DEV_RUNTIME_RESET', toJsonSafe(resetSummary) as Record<string, unknown>);
    }

    await ensureSchedulerBootstrapOwnership(appContext, {
      schedulerWorkerId,
      schedulerPartitionIds
    });

    if (startupHealth.level === 'fail') {
      appContext.setRuntimeReady(false);
      notifications.push('error', `系统启动健康检查失败: ${startupHealth.errors.join('; ')}`, 'SYS_PRECHECK_FAIL');
    } else if (!startupHealth.checks.world_pack_available) {
      appContext.setRuntimeReady(false);
      notifications.push('warning', '世界包为空，系统以降级模式启动。请先导入 world pack。', 'WORLD_PACK_EMPTY');
    } else {
      const selectedPack = selectStartupWorldPack(startupHealth.available_world_packs, preferredWorldPack);
      if (!selectedPack) {
        throw new ApiError(503, 'WORLD_PACK_NOT_READY', 'World pack not ready for startup');
      }

      await sim.init(selectedPack);
      if (appContext.worldEngine instanceof WorldEngineSidecarClient) {
        const activePackId = sim.getActivePack()?.metadata.id ?? selectedPack;
        await appContext.worldEngine.loadPack({
          pack_id: activePackId,
          pack_ref: selectedPack,
          mode: 'active',
          hydrate: await buildWorldPackHydrateRequest(appContext, activePackId)
        });
      }
      await syncActivePackPluginRuntime(appContext);
      appContext.setRuntimeReady(true);
      notifications.push('info', `Yidhras 系统初始化成功 (pack=${selectedPack}, schedulerPartitions=${schedulerPartitionIds.join(',') || 'none'}, loopIntervalMs=${String(simulationLoopIntervalMs)})`, 'SYS_INIT_OK');
      startSimulation();
    }
  } catch (err: unknown) {
    appContext.setRuntimeReady(false);
    startupHealth.level = 'degraded';
    startupHealth.errors.push(`simulation init failed: ${getErrorMessage(err)}`);
    console.error('[Yidhras Server] Init Error:', err);
    notifications.push('error', `系统初始化失败，已降级运行: ${getErrorMessage(err)}`, 'SYS_INIT_FAIL');
  }

  app.listen(port, () => {
    console.log(`[Yidhras Server] API full implementation running at http://localhost:${port}`);
    console.log(`[Yidhras Server] Inference module ready (phase=${inferenceService.phase}, ready=${String(inferenceService.ready)})`);
    console.log(`[Yidhras Server] Scheduler worker=${schedulerWorkerId} partitions=${schedulerPartitionIds.join(',') || 'none'} loopIntervalMs=${String(simulationLoopIntervalMs)}`);
  });
};

void start();
