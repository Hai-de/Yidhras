import { WORLD_ENGINE_PROTOCOL_VERSION } from '@yidhras/contracts';

import type { InferenceService } from '../../inference/service.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext, RuntimeLoopDiagnostics } from '../context.js';
import { getErrorMessage } from '../http/errors.js';
import { runActionDispatcher } from './action_dispatcher_runner.js';
import { runAgentScheduler } from './agent_scheduler.js';
import { runDecisionJobRunner } from './job_runner.js';
import {
  createDefaultWorldEnginePersistencePort,
  executeWorldEnginePreparedStep
} from './world_engine_persistence.js';

const getActiveRuntimeFacade = (context: AppContext) => {
  if (context.activePackRuntime) {
    return context.activePackRuntime;
  }

  throw new ApiError(503, 'ACTIVE_PACK_RUNTIME_NOT_READY', 'activePackRuntime is required for simulation loop execution', {
    feature: 'simulation_loop',
    fallback_blocked: true
  });
};

const getActivePackId = (context: AppContext): string => {
  const packId = getActiveRuntimeFacade(context).getActivePack()?.metadata.id?.trim();
  if (!packId) {
    throw new ApiError(503, 'WORLD_PACK_NOT_READY', 'World pack not ready for runtime loop world-engine step');
  }

  return packId;
};

const getWorldEngine = (context: AppContext) => {
  if (!context.worldEngine) {
    throw new ApiError(503, 'WORLD_ENGINE_NOT_READY', 'World engine is not available for simulation loop step');
  }

  return context.worldEngine;
};

const getActiveCurrentTick = async (context: AppContext): Promise<bigint> => {
  const activePackId = getActivePackId(context);
  const packHostApi = context.packHostApi;
  const tick = packHostApi
    ? await packHostApi.getCurrentTick({ pack_id: activePackId })
    : getActiveRuntimeFacade(context).getCurrentTick().toString();

  if (!tick) {
    throw new ApiError(503, 'WORLD_PACK_NOT_READY', 'Active pack tick is not available for runtime loop housekeeping', {
      pack_id: activePackId
    });
  }

  return BigInt(tick);
};

const stepWorldEngine = async (context: AppContext): Promise<void> => {
  const activeRuntime = getActiveRuntimeFacade(context);
  const packId = getActivePackId(context);
  await executeWorldEnginePreparedStep({
    context,
    worldEngine: getWorldEngine(context),
    persistence: createDefaultWorldEnginePersistencePort(),
    prepareInput: {
      protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
      pack_id: packId,
      step_ticks: activeRuntime.getStepTicks().toString(),
      reason: 'runtime_loop'
    }
  });
};

export const expireIdentityBindings = async (context: AppContext): Promise<void> => {
  const now = await getActiveCurrentTick(context);
  await context.repos.identityOperator.getPrisma().identityNodeBinding.updateMany({
    where: {
      AND: [
        { expires_at: { not: null } },
        { expires_at: { lte: now } },
        { status: { not: 'expired' } }
      ]
    },
    data: {
      status: 'expired',
      updated_at: now
    }
  });
};

export interface StartSimulationLoopOptions {
  context: AppContext;
  inferenceService: InferenceService;
  decisionWorkerId: string;
  actionDispatcherWorkerId: string;
  schedulerWorkerId?: string;
  intervalMs?: number;
  onStepError(err: unknown): void;
}

export interface SimulationLoopHandle {
  stop(): void;
  isRunning(): boolean;
}

const buildLoopDiagnostics = (
  previous: RuntimeLoopDiagnostics,
  patch: Partial<RuntimeLoopDiagnostics>
): RuntimeLoopDiagnostics => ({
  ...previous,
  ...patch
});

const getLoopDiagnostics = (context: AppContext): RuntimeLoopDiagnostics => {
  return context.getRuntimeLoopDiagnostics?.() ?? {
    status: 'idle',
    in_flight: false,
    overlap_skipped_count: 0,
    iteration_count: 0,
    last_started_at: null,
    last_finished_at: null,
    last_duration_ms: null,
    last_error_message: null
  };
};

const setLoopDiagnostics = (context: AppContext, next: RuntimeLoopDiagnostics): void => {
  context.setRuntimeLoopDiagnostics?.(next);
};

const getSimulationLoopTestDelayMs = (): number => {
  const raw = process.env.SIM_LOOP_TEST_DELAY_MS;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return 0;
  }

  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`SIM_LOOP_TEST_DELAY_MS is invalid: ${raw}`);
  }

  return parsed;
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export const startSimulationLoop = ({
  context,
  inferenceService,
  decisionWorkerId,
  actionDispatcherWorkerId,
  schedulerWorkerId = `scheduler:${process.pid}`,
  intervalMs = 1000,
  onStepError
}: StartSimulationLoopOptions): SimulationLoopHandle => {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const scheduleNext = (): void => {
    if (stopped) {
      const previous = getLoopDiagnostics(context);
      setLoopDiagnostics(context, buildLoopDiagnostics(previous, {
        status: 'stopped',
        in_flight: false
      }));
      return;
    }

    const previous = getLoopDiagnostics(context);
    setLoopDiagnostics(context, buildLoopDiagnostics(previous, {
      status: context.getPaused() ? 'paused' : 'scheduled',
      in_flight: false
    }));

    timer = setTimeout(() => {
      void runIteration();
    }, intervalMs);
  };

  const runIteration = async (): Promise<void> => {
    if (stopped) {
      return;
    }

    if (context.getPaused()) {
      const previous = getLoopDiagnostics(context);
      setLoopDiagnostics(context, buildLoopDiagnostics(previous, {
        status: 'paused',
        in_flight: false
      }));
      scheduleNext();
      return;
    }

    const previous = getLoopDiagnostics(context);
    if (previous.in_flight) {
      setLoopDiagnostics(context, buildLoopDiagnostics(previous, {
        overlap_skipped_count: previous.overlap_skipped_count + 1,
        status: 'running'
      }));
      scheduleNext();
      return;
    }

    const startedAt = Date.now();
    setLoopDiagnostics(context, buildLoopDiagnostics(previous, {
      status: 'running',
      in_flight: true,
      iteration_count: previous.iteration_count + 1,
      last_started_at: startedAt,
      last_error_message: null
    }));

    try {
      await expireIdentityBindings(context);
      await stepWorldEngine(context);

      const injectedDelayMs = getSimulationLoopTestDelayMs();
      if (injectedDelayMs > 0) {
        await sleep(injectedDelayMs);
      }

      await runAgentScheduler({
        context,
        workerId: schedulerWorkerId
      });
      await runDecisionJobRunner({
        context,
        inferenceService,
        workerId: decisionWorkerId
      });
      await runActionDispatcher({
        context,
        workerId: actionDispatcherWorkerId
      });

      const latest = getLoopDiagnostics(context);
      setLoopDiagnostics(context, buildLoopDiagnostics(latest, {
        status: 'idle',
        in_flight: false,
        last_finished_at: Date.now(),
        last_duration_ms: Date.now() - startedAt,
        last_error_message: null
      }));
    } catch (err: unknown) {
      const latest = getLoopDiagnostics(context);
      setLoopDiagnostics(context, buildLoopDiagnostics(latest, {
        status: 'idle',
        in_flight: false,
        last_finished_at: Date.now(),
        last_duration_ms: Date.now() - startedAt,
        last_error_message: getErrorMessage(err)
      }));
      onStepError(err);
    } finally {
      scheduleNext();
    }
  };

  scheduleNext();

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const previous = getLoopDiagnostics(context);
      setLoopDiagnostics(context, buildLoopDiagnostics(previous, {
        status: 'stopped',
        in_flight: false
      }));
    },
    isRunning() {
      return !stopped;
    }
  };
};
