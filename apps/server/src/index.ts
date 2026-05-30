import type { Express } from 'express';
import path from 'path';

import { listDynamicSlots, registerDynamicSlot, unregisterDynamicSlot } from './ai/registry.js';
import { startAiRegistryWatcher } from './ai/registry_watcher.js';
import type { AppContext } from './app/context.js';
import { getErrorMessage } from './app/http/errors.js';
import { toJsonSafe } from './app/http/json.js';
import {
  runStartupPreflight,
  selectStartupWorldPack
} from './app/runtime/startup.js';
import { buildWorldPackHydrateRequest } from './app/runtime/world_engine_snapshot.js';
import { getRuntimeBootstrap } from './app/services/app_context_ports.js';
import { ensureSchedulerBootstrapOwnership, resetDevelopmentRuntimeState } from './app/services/system/system.js';
import { Application } from './bootstrap/application.js';
import {
  runtimeClockProjectionProvider,
  worldEngineStepCoordinatorProvider
} from './bootstrap/providers/clock.js';
import { type CliConfig,cliConfigProvider, runtimeStateProvider } from './bootstrap/providers/config_context.js';
// Providers — 聚合与路由
import { appContextProvider } from './bootstrap/providers/context.js';
// Providers — 基础设施
import {
  conversationStoreProvider,
  prismaProvider,
  repositoriesProvider
} from './bootstrap/providers/database.js';
// Providers — AI / Inference
import {
  inferenceProvidersProvider,
  inferenceServiceProvider,
  inferenceTraceSinkProvider
} from './bootstrap/providers/inference.js';
import { metricsInitProvider } from './bootstrap/providers/metrics.js';
import { notificationsProvider } from './bootstrap/providers/notifications.js';
import { packScopeResolverProvider } from './bootstrap/providers/pack_scope.js';
// Providers — 插件
import { behaviorStateStoreInitProvider } from './bootstrap/providers/plugin.js';
import {
  expressAppProvider,
  queryHandlerRegistryProvider,
  registerRoutesProvider
} from './bootstrap/providers/routes.js';
import {
  packRuntimeControlProvider,
  packRuntimeLookupProvider,
  packRuntimeObservationProvider
} from './bootstrap/providers/runtime_ports.js';
// Providers — 核心服务
import { simulationManagerProvider } from './bootstrap/providers/simulation.js';
import {
  packStorageAdapterProvider,
  schedulerStorageProvider
} from './bootstrap/providers/storage.js';
import { wiringProvider } from './bootstrap/providers/wiring.js';
import { worldEngineProvider } from './bootstrap/providers/world_engine.js';
import { TOKENS } from './bootstrap/tokens.js';
import {
  getAiModelsConfigPath,
  getRuntimeConfig,
  getRuntimeMultiPackConfig,
  isAiGatewayEnabled,
  logRuntimeConfigSnapshot,
  resolveWorkspacePath,
  validateProductionSecrets
} from './config/runtime_config.js';
import { startConfigWatcher } from './config/watcher.js';
import { initMetrics } from './observability/metrics.js';
import { DefaultPackRuntimePort } from './packs/orchestration/default_pack_runtime_port.js';
import { syncPackPluginRuntime } from './plugins/runtime.js';
import { initSystemPackPlugins } from './plugins/system_pack_init.js';
import { ApiError } from './utils/api_error.js';
import { createLogger, setLoggerRuntimeConfig } from './utils/logger.js';
import { safeFs } from './utils/safe_fs.js';

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
// pluginRuntimeControl / pluginAiTaskService / requestPluginInference 内联在 context.ts（循环依赖）

// 聚合
app.register(appContextProvider);
app.register(queryHandlerRegistryProvider);
app.register(registerRoutesProvider);
app.register(expressAppProvider);

// Wiring
app.register(wiringProvider);
app.register(metricsInitProvider);

// -- boot: 构造所有对象，完成依赖注入 --
// -- start: 启动序列 --
void (async () => {
  await app.boot();

  await app.start(async (application) => {
  const ctx = await application.services.resolve<AppContext>(TOKENS.appContext);
  const cliConfig = await application.services.resolve<CliConfig>(TOKENS.cliConfig);
  const wiring = await application.services.resolve<{ multiPackLoopHost: import('./app/runtime/MultiPackLoopHost.js').MultiPackLoopHost }>(TOKENS.wiring);

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
    queryDatabaseHealth: async () => {
      const dbProvider = process.env['PRISMA_DB_PROVIDER'] ?? 'sqlite';
      let count: unknown;
      if (dbProvider === 'postgresql' || dbProvider === 'pg') {
        const rows = await ctx.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT 1 FROM information_schema.tables WHERE table_name = '_prisma_migrations'`
        );
        count = rows.length;
      } else {
        const rows = await ctx.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
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
    const resetSummary = await resetDevelopmentRuntimeState(ctx);
    if (resetSummary) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: toJsonSafe return type
      ctx.notifications.push('info', '开发环境 runtime 观测数据已清理', 'DEV_RUNTIME_RESET', toJsonSafe(resetSummary) as Record<string, unknown>);
    }

    if (ctx.startupHealth.level === 'fail') {
      ctx.setRuntimeReady(false);
      ctx.notifications.push('error', `系统启动健康检查失败: ${ctx.startupHealth.errors.join('; ')}`, 'SYS_PRECHECK_FAIL');
    } else if (!ctx.startupHealth.checks.world_pack_available) {
      ctx.setRuntimeReady(false);
      ctx.notifications.push('warning', '世界包为空，系统以降级模式启动。请先导入 world pack。', 'WORLD_PACK_EMPTY');
    } else {
      const selectedPack = selectStartupWorldPack(ctx.startupHealth.available_world_packs, cliConfig.preferredWorldPack);
      if (!selectedPack) {
        throw new ApiError(503, 'WORLD_PACK_NOT_READY', 'World pack not ready for startup');
      }

      const runtimeDataDir = resolveWorkspacePath('data/runtime');
      const cliMarkerPath = path.join(runtimeDataDir, 'startup_opening.txt');
      if (safeFs.existsSync(runtimeDataDir, cliMarkerPath)) {
        safeFs.unlinkSync(runtimeDataDir, cliMarkerPath);
      }

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- packRuntimeControl is guaranteed by provider wiring
      const loadResult = await ctx.packRuntimeControl!.load(selectedPack);
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
      ctx.runtimeClockProjection.rebuildFromRuntimeSeed({
        pack_id: packId,
        current_tick: clockSnapshot.current_tick,
        current_revision: clockSnapshot.current_tick,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- boundary type assertion
        calendars: pack?.time_systems ?? []
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      const worldEngineClient = ctx.worldEngine as import('./app/runtime/sidecar/world_engine_sidecar_client.js').WorldEngineSidecarClient;
      if (worldEngineClient instanceof (await import('./app/runtime/sidecar/world_engine_sidecar_client.js')).WorldEngineSidecarClient) {
        await worldEngineClient.loadPack({
          pack_id: packId,
          pack_ref: selectedPack,
          mode: 'active',
          hydrate: await buildWorldPackHydrateRequest(ctx, packId)
        });
      }

      const systemPackResult = await initSystemPackPlugins(
        { prisma: ctx.prisma },
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

      await syncPackPluginRuntime(ctx, packId);
      await ensureSchedulerBootstrapOwnership(ctx, {
        packId,
        schedulerWorkerId: cliConfig.schedulerWorkerId,
        schedulerPartitionIds: cliConfig.schedulerPartitionIds
      });

      const multiPackConfig = getRuntimeMultiPackConfig();
      if (multiPackConfig.start_mode === 'bootstrap_list' && multiPackConfig.bootstrap_packs.length > 0) {
        logger.info(`bootstrap_list: loading ${String(multiPackConfig.bootstrap_packs.length)} pack(s): ${multiPackConfig.bootstrap_packs.join(', ')}`);
        for (const packRef of multiPackConfig.bootstrap_packs) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- packRuntimeControl is guaranteed by provider wiring
            const result = await ctx.packRuntimeControl!.load(packRef);
            if (result.loaded) {
              logger.info(`bootstrap_list: loaded pack ${packRef} (handle=${result.handle.instance_id})`);
            } else if (result.already_loaded) {
              logger.info(`bootstrap_list: pack ${packRef} already loaded, skipping`);
            }
          } catch (err) {
            logger.error(`bootstrap_list: failed to load ${packRef}: ${getErrorMessage(err)}`);
            ctx.startupHealth.errors.push(`bootstrap_list: failed to load ${packRef}: ${getErrorMessage(err)}`);
          }
        }
      }

      ctx.setRuntimeReady(true);
      ctx.notifications.push(
        'info',
        `Yidhras 系统初始化成功 (pack=${selectedPack}, schedulerPartitions=${cliConfig.schedulerPartitionIds.join(',') || 'none'}, loopIntervalMs=${String(cliConfig.simulationLoopIntervalMs)}, aiGatewayEnabled=${String(isAiGatewayEnabled())})`,
        'SYS_INIT_OK',
        { ai_gateway_enabled: isAiGatewayEnabled() }
      );

      const packHost = ctx.getPackRuntimeHost(packId);
      if (packHost) {
        const packRuntimePort = new DefaultPackRuntimePort(packHost);
        wiring.multiPackLoopHost.startLoop(packId, packHost.getClock(), packRuntimePort);
      }
    }
  } catch (err: unknown) {
    ctx.setRuntimeReady(false);
    ctx.startupHealth.level = 'degraded';
    ctx.startupHealth.errors.push(`simulation init failed: ${getErrorMessage(err)}`);
    logger.error('Init Error', { error: getErrorMessage(err) });
    ctx.notifications.push('error', `系统初始化失败，已降级运行: ${getErrorMessage(err)}`, 'SYS_INIT_FAIL');
  }

  // HTTP 监听
  const httpApp = await application.services.resolve<Express>(TOKENS.httpApp);
  const inferenceService = await application.services.resolve<import('./inference/service.js').InferenceService>(TOKENS.inferenceService);
  const httpServer = httpApp.listen(cliConfig.port, () => {
    logger.info(`API full implementation running at http://localhost:${cliConfig.port}`);
    logger.info(`Inference module ready (phase=${inferenceService.phase}, ready=${String(inferenceService.ready)})`);
    logger.info(`AI gateway enabled=${String(isAiGatewayEnabled())}`);
    logger.info(`Scheduler worker=${cliConfig.schedulerWorkerId} partitions=${cliConfig.schedulerPartitionIds.join(',') || 'none'} loopIntervalMs=${String(cliConfig.simulationLoopIntervalMs)}`);
  });

  // Metrics server
  const metricsPort = getRuntimeConfig().runtime.metrics_port;
  if (metricsPort > 0) {
    const { startMetricsServer } = await import('./observability/metrics_server.js');
    startMetricsServer(metricsPort);
  }

  // Watchers
  const registryWatcher = startAiRegistryWatcher({
    aiModelsConfigPath: getAiModelsConfigPath(),
    promptSlotsDefaultPath: resolveWorkspacePath(
      'apps/server/src/ai/schemas/prompt_slots.default.yaml'
    )
  });
  const configWatcher = startConfigWatcher();

  // Graceful shutdown
  application.onShutdown(async () => {
    wiring.multiPackLoopHost.shutdown();

    httpServer?.close();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: WorldEnginePort → WorldEngineSidecarClient
    const weClient = ctx.worldEngine as import('./app/runtime/sidecar/world_engine_sidecar_client.js').WorldEngineSidecarClient;
    if (weClient && typeof weClient.stop === 'function') {
      await weClient.stop();
    }

    await ctx.prisma.$disconnect();
    logger.info('Prisma 已断开连接');

    registryWatcher.close();
    logger.info('Registry watcher 已关闭');

    configWatcher?.close();

    logger.info('优雅关闭完成');
  });

  process.on('SIGINT', () => { void application.shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void application.shutdown('SIGTERM'); });
  });
})();
