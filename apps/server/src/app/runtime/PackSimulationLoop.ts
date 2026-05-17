import { WORLD_ENGINE_PROTOCOL_VERSION } from '@yidhras/contracts';

import type { ChronosEngine } from '../../clock/engine.js';
import type { InferenceService } from '../../inference/service.js';
import { recordTickCompleted } from '../../observability/metrics.js';
import { dataCleanerRegistry } from '../../plugins/extensions/data_cleaner_registry.js';
import type { AppContext } from '../context.js';
import { getErrorMessage } from '../http/errors.js';
import type { PackRuntimePort } from '../services/pack_runtime_ports.js';
import { runActionDispatcher } from './action_dispatcher_runner.js';
import { runAgentScheduler } from './agent_scheduler.js';
import { runDecisionJobRunner } from './job_runner.js';
import { runPerceptionPipeline } from './perception_pipeline.js';
import { resolveOwnedSchedulerPartitionIds } from './scheduler_partitioning.js';
import type { WorldEngineSidecarClient } from './sidecar/world_engine_sidecar_client.js';
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
  last_step_errors: Array<{ step: string; error: string }>;
}

export interface HookContext {
  packId: string;
  tick: string;
  diagnostics: PackLoopDiagnostics;
}

export interface PackLoopHooks {
  beforeStep1?: Array<(ctx: HookContext) => Promise<void>>;
  afterStep1?: Array<(ctx: HookContext) => Promise<void>>;
  beforeStep2?: Array<(ctx: HookContext) => Promise<void>>;
  afterStep2?: Array<(ctx: HookContext) => Promise<void>>;
  beforeStep3?: Array<(ctx: HookContext) => Promise<void>>;
  afterStep3?: Array<(ctx: HookContext) => Promise<void>>;
  beforeStep4?: Array<(ctx: HookContext) => Promise<void>>;
  afterStep4?: Array<(ctx: HookContext) => Promise<void>>;
  beforeStep5?: Array<(ctx: HookContext) => Promise<void>>;
  afterStep5?: Array<(ctx: HookContext) => Promise<void>>;
  beforeStep6?: Array<(ctx: HookContext) => Promise<void>>;
  afterStep6?: Array<(ctx: HookContext) => Promise<void>>;
  onLoopStateChange?: Array<(from: string, to: string) => void>;
}

export interface PackSimulationLoopOptions {
  packId: string;
  clock: ChronosEngine;
  context: AppContext;
  inferenceService: InferenceService;
  decisionWorkerId: string;
  actionDispatcherWorkerId: string;
  worldEngine: WorldEngineSidecarClient;
  packRuntime: PackRuntimePort;
  schedulerWorkerId?: string;
  intervalMs?: number;
  crashThreshold?: number;
  hooks?: PackLoopHooks;
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
  last_error_message: null,
  last_step_errors: []
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
  private readonly worldEngine: WorldEngineSidecarClient;
  private readonly packRuntime: PackRuntimePort;
  private readonly schedulerWorkerId: string;
  private readonly schedulerPartitionIds: string[];
  private readonly intervalMs: number;
  private readonly crashThreshold: number;
  private readonly hooks?: PackLoopHooks;
  private readonly onDegraded?: (packId: string, reason: string) => void;
  private readonly onStepError?: (err: unknown) => void;

  constructor(options: PackSimulationLoopOptions) {
    this.packId = options.packId;
    this.clock = options.clock;
    this.context = options.context;
    this.inferenceService = options.inferenceService;
    this.decisionWorkerId = options.decisionWorkerId;
    this.actionDispatcherWorkerId = options.actionDispatcherWorkerId;
    this.worldEngine = options.worldEngine;
    this.packRuntime = options.packRuntime;
    this.schedulerWorkerId = options.schedulerWorkerId ?? `scheduler:${options.packId}:${process.pid}`;
    this.schedulerPartitionIds = resolveOwnedSchedulerPartitionIds({ workerId: this.schedulerWorkerId });
    this.intervalMs = options.intervalMs ?? 1000;
    this.crashThreshold = options.crashThreshold ?? SCHEDULER_CRASH_THRESHOLD;
    this.hooks = options.hooks;
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
      last_error_message: null,
      last_step_errors: []
    };

    const hookCtx: HookContext = {
      packId: this.packId,
      tick: this.packRuntime.getCurrentTick().toString(),
      diagnostics: this.diagnostics
    };

    const steps: Array<{ name: string; fn: () => Promise<unknown> }> = [
      { name: 'step1_expireBindings', fn: () => expirePackIdentityBindings(this.packRuntime, this.context) },
      { name: 'step2_worldEngine', fn: () => stepPackWorldEngine(this.context, this.packId, this.worldEngine, this.packRuntime) },
      { name: 'step3_agentScheduler', fn: () => runAgentScheduler({
        context: this.context,
        workerId: this.schedulerWorkerId,
        partitionIds: this.schedulerPartitionIds,
        packId: this.packId,
        packRuntime: this.packRuntime
      }) },
      { name: 'step4_decisionJobs', fn: () => runDecisionJobRunner({
        context: this.context,
        inferenceService: this.inferenceService,
        workerId: this.decisionWorkerId,
        packRuntime: this.packRuntime
      }) },
      { name: 'step5_actionDispatch', fn: () => runActionDispatcher({
        context: this.context,
        workerId: this.actionDispatcherWorkerId,
        packRuntime: this.packRuntime
      }) },
      { name: 'step6_perception', fn: () => runPerceptionPipeline(this.context, this.packRuntime) }
    ];

    let anyStepFailed = false;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepNum = i + 1;
      const stepStartedAt = Date.now();

      try {
        await this.runHooks(`beforeStep${stepNum}`, hookCtx);
        await step.fn();
        await this.runHooks(`afterStep${stepNum}`, hookCtx);
        recordTickCompleted(this.packId, step.name, Date.now() - stepStartedAt, 'success');
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        this.diagnostics.last_step_errors.push({ step: step.name, error: message });
        anyStepFailed = true;
        recordTickCompleted(this.packId, step.name, Date.now() - stepStartedAt, 'failed');

        if (this.onStepError) {
          this.onStepError(err);
        }
      }
    }

    const finishedAt = Date.now();

    if (anyStepFailed) {
      this.consecutiveFailures += 1;

      this.diagnostics = {
        ...this.diagnostics,
        status: 'idle',
        in_flight: false,
        consecutive_failures: this.consecutiveFailures,
        last_finished_at: finishedAt,
        last_duration_ms: finishedAt - startedAt,
        last_error_message: this.diagnostics.last_step_errors[0]?.error ?? null
      };

      if (this.consecutiveFailures >= this.crashThreshold) {
        this.paused = true;
        if (this.onDegraded) {
          this.onDegraded(this.packId, this.diagnostics.last_error_message ?? 'unknown error');
        }
      }
    } else {
      this.consecutiveFailures = 0;

      this.diagnostics = {
        ...this.diagnostics,
        status: 'idle',
        in_flight: false,
        consecutive_failures: 0,
        last_finished_at: finishedAt,
        last_duration_ms: finishedAt - startedAt,
        last_error_message: null
      };
    }

    // Run registered data cleaners
    const cleaners = dataCleanerRegistry.list();
    if (cleaners.length > 0) {
      const packTick = this.packRuntime.getCurrentTick().toString();
      for (const cleaner of cleaners) {
        try {
          await dataCleanerRegistry.clean(cleaner.key, {
            text: `[pack=${this.packId}, tick=${packTick}]`,
            options: { pack_id: this.packId, tick: packTick }
          });
        } catch {
          // Single cleaner failure does not block the loop
        }
      }
    }

    this.scheduleNext();
  }

  private async runHooks(hookName: string, ctx: HookContext): Promise<void> {
    // Only step hooks use HookContext; onLoopStateChange has a different signature
    // and is handled separately via its own call site.
    if (hookName.startsWith('on')) {
      return;
    }

    const hooks = this.hooks?.[hookName as Exclude<keyof PackLoopHooks, 'onLoopStateChange'>];
    if (!hooks || hooks.length === 0) {
      return;
    }

    for (const hook of hooks) {
      try {
        await (hook)(ctx);
      } catch {
        // Single hook failure does not block other hooks or the step
      }
    }
  }
}

const expirePackIdentityBindings = async (
  packRuntime: PackRuntimePort,
  context: AppContext
): Promise<void> => {
  const now = packRuntime.getCurrentTick();
  await context.repos.identityOperator.expireBindings(now);
};

const stepPackWorldEngine = async (
  context: AppContext,
  packId: string,
  worldEngine: WorldEngineSidecarClient,
  packRuntime: PackRuntimePort
): Promise<void> => {
  const stepTicks = '1';

  await executeWorldEnginePreparedStep({
    context,
    worldEngine,
    persistence: createDefaultWorldEnginePersistencePort(),
    prepareInput: {
      protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
      pack_id: packId,
      step_ticks: stepTicks,
      reason: 'runtime_loop',
      base_revision: packRuntime.getCurrentRevision().toString()
    },
    packRuntime
  });
};
