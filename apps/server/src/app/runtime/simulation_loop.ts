import type { InferenceService } from '../../inference/service.js';
import type { AppContext, RuntimeLoopDiagnostics } from '../context.js';
import { getErrorMessage } from '../http/errors.js';
import { runActionDispatcher } from './action_dispatcher_runner.js';
import { runAgentScheduler } from './agent_scheduler.js';
import { runDecisionJobRunner } from './job_runner.js';

export const expireIdentityBindings = async (context: AppContext): Promise<void> => {
  const now = context.sim.getCurrentTick();
  await context.prisma.identityNodeBinding.updateMany({
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
      await context.sim.step(context.sim.getStepTicks());

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
