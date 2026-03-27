import type { AppContext, RouteRegistrar } from './app/context.js';
import { createApp } from './app/create_app.js';
import { asyncHandler } from './app/http/async_handler.js';
import { getErrorMessage } from './app/http/errors.js';
import { toJsonSafe } from './app/http/json.js';
import { parseOptionalTick, parsePositiveStepTicks } from './app/http/runtime.js';
import { validatePolicyConditions } from './app/http/validators.js';
import { createGlobalErrorMiddleware } from './app/middleware/error_handler.js';
import { registerAgentRoutes } from './app/routes/agent.js';
import { registerClockRoutes } from './app/routes/clock.js';
import { registerIdentityRoutes } from './app/routes/identity.js';
import { registerInferenceRoutes } from './app/routes/inference.js';
import { registerNarrativeRoutes } from './app/routes/narrative.js';
import { registerPolicyRoutes } from './app/routes/policy.js';
import { registerRelationalRoutes } from './app/routes/relational.js';
import { registerSocialRoutes } from './app/routes/social.js';
import { registerSystemRoutes } from './app/routes/system.js';
import { startSimulationLoop } from './app/runtime/simulation_loop.js';
import {
  createRuntimeReadyGuard,
  createStartupHealth,
  resolveWorldPacksDir,
  runStartupPreflight,
  selectStartupWorldPack
} from './app/runtime/startup.js';
import { sim } from './core/simulation.js';
import { createInferenceService } from './inference/service.js';
import { createPrismaInferenceTraceSink } from './inference/sinks/prisma.js';
import { ApiError } from './utils/api_error.js';
import { notifications } from './utils/notifications.js';

const port = process.env.PORT || 3001;
const worldPacksDir = resolveWorldPacksDir();
const preferredWorldPack = 'cyber_noir';
const startupHealth = createStartupHealth();

let runtimeReady = false;
let timer: NodeJS.Timeout | null = null;
let isPaused = false;

const assertRuntimeReady = createRuntimeReadyGuard({
  getRuntimeReady: () => runtimeReady,
  startupHealth
});

const appContext: AppContext = {
  prisma: sim.prisma,
  sim,
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
  assertRuntimeReady
};

const inferenceService = createInferenceService({
  context: appContext,
  traceSink: createPrismaInferenceTraceSink(appContext)
});

const registerRoutes: RouteRegistrar = (application, context) => {
  registerInferenceRoutes(application, context, inferenceService, {
    asyncHandler
  });
  registerSystemRoutes(application, context);
  registerClockRoutes(application, context, {
    parsePositiveStepTicks,
    toJsonSafe,
    getErrorMessage
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
  registerIdentityRoutes(application, context, {
    asyncHandler,
    parseOptionalTick
  });
  registerPolicyRoutes(application, context, {
    asyncHandler,
    validatePolicyConditions
  });
};

const app = createApp({
  context: appContext,
  registerRoutes
});

app.use(createGlobalErrorMiddleware(appContext));

const handleSimulationStepError = (err: unknown): void => {
  notifications.push(
    'error',
    `模拟步进失败 (可能存在 BigInt 异常): ${getErrorMessage(err)}`,
    'SIM_STEP_ERR'
  );
  appContext.setPaused(true);
};

const startSimulation = (): void => {
  if (!appContext.getRuntimeReady()) {
    return;
  }

  if (timer) {
    clearInterval(timer);
  }

  timer = startSimulationLoop({
    context: appContext,
    inferenceService,
    onStepError: handleSimulationStepError
  });
};

const start = async (): Promise<void> => {
  await runStartupPreflight({
    startupHealth,
    worldPacksDir,
    queryDatabaseHealth: () => sim.prisma.$queryRawUnsafe('SELECT 1'),
    getErrorMessage
  });

  try {
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
      appContext.setRuntimeReady(true);
      notifications.push('info', `Yidhras 系统初始化成功 (pack=${selectedPack})`, 'SYS_INIT_OK');
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
  });
};

void start();
