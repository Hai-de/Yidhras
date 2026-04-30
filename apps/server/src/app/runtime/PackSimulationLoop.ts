import { WORLD_ENGINE_PROTOCOL_VERSION } from '@yidhras/contracts';

import type { ChronosEngine } from '../../clock/engine.js';
import type { InferenceService } from '../../inference/service.js';
import type { AppContext } from '../context.js';
import { getErrorMessage } from '../http/errors.js';
import { runActionDispatcher } from './action_dispatcher_runner.js';
import { runAgentScheduler } from './agent_scheduler.js';
import { runDecisionJobRunner } from './job_runner.js';
import {
  createDefaultWorldEnginePersistencePort,
  executeWorldEnginePreparedStep
} from './world_engine_persistence.js';

export const SCHEDULER_CRASH_THRESHOLD = 3;

export interface PackLoopDiagnostics {
  status: 'idle' | 'scheduled' | 'running' | 'paused' | 'stopped';
  in_flight: boolean;
  overlap_skipped_count: number;
  iteration_count: number;
  consecutive_failures: number;
  last_started_at: number | null;
  last_finished_at: number | null;
  last_duration_ms: number | null;
  last_error_message: string | null;
}

export interface PackSimulationLoopOptions {
  packId: string;
  clock: ChronosEngine;
  context: AppContext;
  inferenceService: InferenceService;
  decisionWorkerId: string;
  actionDispatcherWorkerId: string;
  schedulerWorkerId?: string;
  intervalMs?: number;
  crashThreshold?: number;
  onDegraded?: (packId: string, reason: string) => void;
  onStepError?: (err: unknown) => void;
}

export interface PackLoopHandle {
  stop(): Promise<void>;
  isRunning(): boolean;
}

const createDefaultDiagnostics = (): PackLoopDiagnostics => ({
  status: 'idle',
  in_flight: false,
  overlap_skipped_count: 0,
  iteration_count: 0,
  consecutive_failures: 0,
  last_started_at: null,
  last_finished_at: null,
  last_duration_ms: null,
  last_error_message: null
});

export class PackSimulationLoop {
  private stopped = false;
  private paused = false;
  private timer: NodeJS.Timeout | null = null;
  private diagnostics: PackLoopDiagnostics = createDefaultDiagnostics();
  private consecutiveFailures = 0;

  private readonly packId: string;
  private readonly clock: ChronosEngine;
  private readonly context: AppContext;
  private readonly inferenceService: InferenceService;
  private readonly decisionWorkerId: string;
  private readonly actionDispatcherWorkerId: string;
  private readonly schedulerWorkerId: string;
  private readonly intervalMs: number;
  private readonly crashThreshold: number;
  private readonly onDegraded?: (packId: string, reason: string) => void;
  private readonly onStepError?: (err: unknown) => void;

  constructor(options: PackSimulationLoopOptions) {
    this.packId = options.packId;
    this.clock = options.clock;
    this.context = options.context;
    this.inferenceService = options.inferenceService;
    this.decisionWorkerId = options.decisionWorkerId;
    this.actionDispatcherWorkerId = options.actionDispatcherWorkerId;
    this.schedulerWorkerId = options.schedulerWorkerId ?? `scheduler:${options.packId}:${process.pid}`;
    this.intervalMs = options.intervalMs ?? 1000;
    this.crashThreshold = options.crashThreshold ?? SCHEDULER_CRASH_THRESHOLD;
    this.onDegraded = options.onDegraded;
    this.onStepError = options.onStepError;
  }

  public start(): void {
    this.stopped = false;
    this.paused = false;
    this.scheduleNext();
  }

  public stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.diagnostics = { ...this.diagnostics, status: 'stopped', in_flight: false };
  }

  public pause(): void {
    this.paused = true;
  }

  public resume(): void {
    this.paused = false;
    this.consecutiveFailures = 0;
  }

  public isRunning(): boolean {
    return !this.stopped;
  }

  public getDiagnostics(): PackLoopDiagnostics {
    return { ...this.diagnostics };
  }

  private scheduleNext(): void {
    if (this.stopped) {
      this.diagnostics = { ...this.diagnostics, status: 'stopped', in_flight: false };
      return;
    }

    this.diagnostics = {
      ...this.diagnostics,
      status: this.paused ? 'paused' : 'scheduled',
      in_flight: false
    };

    this.timer = setTimeout(() => {
      void this.runIteration();
    }, this.intervalMs);
  }

  private async runIteration(): Promise<void> {
    if (this.stopped) {
      return;
    }

    if (this.paused) {
      this.diagnostics = { ...this.diagnostics, status: 'paused', in_flight: false };
      this.scheduleNext();
      return;
    }

    if (this.diagnostics.in_flight) {
      this.diagnostics = {
        ...this.diagnostics,
        overlap_skipped_count: this.diagnostics.overlap_skipped_count + 1,
        status: 'running'
      };
      this.scheduleNext();
      return;
    }

    const startedAt = Date.now();
    this.diagnostics = {
      ...this.diagnostics,
      status: 'running',
      in_flight: true,
      iteration_count: this.diagnostics.iteration_count + 1,
      last_started_at: startedAt,
      last_error_message: null
    };

    try {
      // 1. Expire identity bindings
      await expirePackIdentityBindings(this.context);

      // 2. Step world engine
      await stepPackWorldEngine(this.context, this.packId);

      // 3. Run agent scheduler
      await runAgentScheduler({
        context: this.context,
        workerId: this.schedulerWorkerId,
        packId: this.packId
      });

      // 4. Run decision job runner
      await runDecisionJobRunner({
        context: this.context,
        inferenceService: this.inferenceService,
        workerId: this.decisionWorkerId
      });

      // 5. Run action dispatcher
      await runActionDispatcher({
        context: this.context,
        workerId: this.actionDispatcherWorkerId
      });

      // Kernel success — reset failure counter
      this.consecutiveFailures = 0;

      this.diagnostics = {
        ...this.diagnostics,
        status: 'idle',
        in_flight: false,
        consecutive_failures: 0,
        last_finished_at: Date.now(),
        last_duration_ms: Date.now() - startedAt,
        last_error_message: null
      };
    } catch (err: unknown) {
      this.consecutiveFailures += 1;

      this.diagnostics = {
        ...this.diagnostics,
        status: 'idle',
        in_flight: false,
        consecutive_failures: this.consecutiveFailures,
        last_finished_at: Date.now(),
        last_duration_ms: Date.now() - startedAt,
        last_error_message: getErrorMessage(err)
      };

      if (this.consecutiveFailures >= this.crashThreshold) {
        this.paused = true;
        const reason = getErrorMessage(err);
        if (this.onDegraded) {
          this.onDegraded(this.packId, reason);
        }
      }

      if (this.onStepError) {
        this.onStepError(err);
      }
    } finally {
      this.scheduleNext();
    }
  }
}

const expirePackIdentityBindings = async (context: AppContext): Promise<void> => {
  const now = context.clock.getCurrentTick();
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

const stepPackWorldEngine = async (context: AppContext, packId: string): Promise<void> => {
  if (!context.worldEngine) {
    throw new Error('[PackSimulationLoop] World engine is not available');
  }

  const stepTicks = '1';

  await executeWorldEnginePreparedStep({
    context,
    worldEngine: context.worldEngine,
    persistence: createDefaultWorldEnginePersistencePort(),
    prepareInput: {
      protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
      pack_id: packId,
      step_ticks: stepTicks,
      reason: 'runtime_loop'
    }
  });
};
