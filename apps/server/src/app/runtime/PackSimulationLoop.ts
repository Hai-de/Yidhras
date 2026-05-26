import { WORLD_ENGINE_PROTOCOL_VERSION } from '@yidhras/contracts';

import type { ChronosEngine } from '../../clock/engine.js';
import { buildStepContext } from '../../core/step_strategy.js';
import type { DeterminismConfig } from '../../determinism/context.js';
import { createDeterminismContext, resolvePackDeterminismConfig } from '../../determinism/context.js';
import type { InferenceService } from '../../inference/service.js';
import { recordTickCompleted } from '../../observability/metrics.js';
import { maybeCaptureAutoSnapshot } from '../../packs/snapshots/auto_snapshot_service.js';
import { dataCleanerRegistry } from '../../plugins/extensions/data_cleaner_registry.js';
import { createLogger } from '../../utils/logger.js';
import type { AppContext } from '../context.js';
import { getErrorMessage } from '../http/errors.js';
import type { PackRuntimePort } from '../services/pack/pack_runtime_ports.js';
import { runActionDispatcher } from './action_dispatcher_runner.js';
import { runAgentScheduler } from './agent_scheduler.js';
import { runPerceptionPipeline } from './perception_pipeline.js';
import { runProjectionPipeline } from './projection_pipeline.js';
import { resolveOwnedSchedulerPartitionIds } from './scheduler_partitioning.js';
import type { WorldEngineSidecarClient } from './sidecar/world_engine_sidecar_client.js';
import { runWorkflowDecisionStep } from './workflow_decision_step.js';
import {
  createDefaultWorldEnginePersistencePort,
  executeWorldEnginePreparedStep
} from './world_engine_persistence.js';

export const SCHEDULER_CRASH_THRESHOLD = 3;

const logger = createLogger('PackSimulationLoop');

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
  last_extension_errors: Array<{ extension_type: 'hook' | 'data_cleaner'; key: string; error: string }>;
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
  beforeStep7?: Array<(ctx: HookContext) => Promise<void>>;
  afterStep7?: Array<(ctx: HookContext) => Promise<void>>;
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
  determinism?: DeterminismConfig;
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
  last_step_errors: [],
  last_extension_errors: []
});

export class PackSimulationLoop {
  private stopped = false;
  private paused = false;
  private timer: NodeJS.Timeout | null = null;
  private diagnostics: PackLoopDiagnostics = createDefaultDiagnostics();
  private consecutiveFailures = 0;
  private loopState: 'stopped' | 'scheduled' | 'running' | 'idle' | 'paused' = 'stopped';

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
  private readonly crashThreshold: number;
  private readonly determinismConfig: DeterminismConfig;
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
    this.crashThreshold = options.crashThreshold ?? SCHEDULER_CRASH_THRESHOLD;
    this.determinismConfig = options.determinism ?? resolvePackDeterminismConfig(options.packId);
    this.hooks = options.hooks;
    this.onDegraded = options.onDegraded;
    this.onStepError = options.onStepError;
  }

  private getIntervalMs(): number {
    return this.packRuntime.getLoopIntervalMs();
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
    this.diagnostics = { ...this.diagnostics, in_flight: false };
    this.transitionState('stopped');
  }

  public pause(): void {
    this.paused = true;
  }

  public resume(): void {
    this.paused = false;
    this.consecutiveFailures = 0;
    this.transitionState('scheduled');
  }

  public isRunning(): boolean {
    return !this.stopped;
  }

  public getDiagnostics(): PackLoopDiagnostics {
    return { ...this.diagnostics };
  }

  private transitionState(to: typeof this.loopState): void {
    const from = this.loopState;
    if (from === to) return;
    this.loopState = to;
    this.diagnostics = { ...this.diagnostics, status: to };
    if (this.hooks?.onLoopStateChange) {
      for (const fn of this.hooks.onLoopStateChange) {
        try {
          fn(from, to);
        } catch (err: unknown) {
          logger.warn('onLoopStateChange hook failed', {
            pack_id: this.packId,
            from,
            to,
            error: getErrorMessage(err)
          });
        }
      }
    }
  }

  private scheduleNext(): void {
    if (this.stopped) {
      this.diagnostics = { ...this.diagnostics, in_flight: false };
      this.transitionState('stopped');
      return;
    }

    this.diagnostics = {
      ...this.diagnostics,
      in_flight: false
    };
    this.transitionState(this.paused ? 'paused' : 'scheduled');

    this.timer = setTimeout(() => {
      void this.runIteration();
    }, this.getIntervalMs());
  }

  private async runIteration(): Promise<void> {
    if (this.stopped) {
      return;
    }

    if (this.paused) {
      this.diagnostics = { ...this.diagnostics, in_flight: false };
      this.transitionState('paused');
      this.scheduleNext();
      return;
    }

    if (this.diagnostics.in_flight) {
      this.diagnostics = {
        ...this.diagnostics,
        overlap_skipped_count: this.diagnostics.overlap_skipped_count + 1
      };
      this.scheduleNext();
      return;
    }

    const startedAt = Date.now();
    this.diagnostics = {
      ...this.diagnostics,
      in_flight: true,
      iteration_count: this.diagnostics.iteration_count + 1,
      last_started_at: startedAt,
      last_error_message: null,
      last_step_errors: [],
      last_extension_errors: []
    };
    this.transitionState('running');

    const result = await runPackSimulationIteration({
      packId: this.packId,
      context: this.context,
      packRuntime: this.packRuntime,
      inferenceService: this.inferenceService,
      decisionWorkerId: this.decisionWorkerId,
      actionDispatcherWorkerId: this.actionDispatcherWorkerId,
      worldEngine: this.worldEngine,
      schedulerWorkerId: this.schedulerWorkerId,
      schedulerPartitionIds: this.schedulerPartitionIds,
      determinism: this.determinismConfig,
      diagnostics: this.diagnostics,
      hooks: this.hooks,
      onStepError: this.onStepError
    });

    const finishedAt = Date.now();
    const anyStepFailed = result.stepErrors.length > 0;

    this.diagnostics.last_step_errors = result.stepErrors;
    this.diagnostics.last_extension_errors = result.extensionErrors;

    if (anyStepFailed) {
      this.consecutiveFailures += 1;

      this.diagnostics = {
        ...this.diagnostics,
        in_flight: false,
        consecutive_failures: this.consecutiveFailures,
        last_finished_at: finishedAt,
        last_duration_ms: finishedAt - startedAt,
        last_error_message: result.stepErrors[0]?.error ?? null
      };

      if (this.consecutiveFailures >= this.crashThreshold) {
        this.paused = true;
        this.transitionState('paused');
        if (this.onDegraded) {
          this.onDegraded(this.packId, this.diagnostics.last_error_message ?? 'unknown error');
        }
      } else {
        this.transitionState('idle');
      }
    } else {
      this.consecutiveFailures = 0;

      this.diagnostics = {
        ...this.diagnostics,
        in_flight: false,
        consecutive_failures: 0,
        last_finished_at: finishedAt,
        last_duration_ms: finishedAt - startedAt,
        last_error_message: null
      };
      this.transitionState('idle');
    }

    this.scheduleNext();
  }

}

export interface RunPackIterationInput {
  packId: string;
  context: AppContext;
  packRuntime: PackRuntimePort;
  inferenceService: InferenceService;
  decisionWorkerId: string;
  actionDispatcherWorkerId: string;
  worldEngine: WorldEngineSidecarClient;
  schedulerWorkerId: string;
  schedulerPartitionIds: string[];
  determinism?: DeterminismConfig;
  diagnostics: PackLoopDiagnostics;
  hooks?: PackLoopHooks;
  onStepError?: (err: unknown) => void;
}

export interface RunPackIterationResult {
  stepErrors: Array<{ step: string; error: string }>;
  extensionErrors: Array<{ extension_type: 'hook' | 'data_cleaner'; key: string; error: string }>;
}

export const runPackSimulationIteration = async (input: RunPackIterationInput): Promise<RunPackIterationResult> => {
  const stepErrors: Array<{ step: string; error: string }> = [];
  const extensionErrors: Array<{ extension_type: 'hook' | 'data_cleaner'; key: string; error: string }> = [];

  const hookCtx: HookContext = {
    packId: input.packId,
    tick: input.packRuntime.getCurrentTick().toString(),
    diagnostics: input.diagnostics
  };

  const runHooks = async (hookName: string): Promise<void> => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    const hooks = input.hooks?.[hookName as Exclude<keyof PackLoopHooks, 'onLoopStateChange'>];
    if (!hooks || hooks.length === 0) {
      return;
    }

    for (const hook of hooks) {
      try {
        await hook(hookCtx);
      } catch (err: unknown) {
        const error = getErrorMessage(err);
        extensionErrors.push({ extension_type: 'hook', key: hookName, error });
        logger.warn('Pack loop hook failed', {
          pack_id: input.packId,
          tick: hookCtx.tick,
          hook: hookName,
          error
        });
      }
    }
  };

  const tickDeterminism = input.determinism?.enabled
    ? createDeterminismContext({
        packId: input.packId,
        baseSeed: input.determinism.seed,
        mode: input.determinism.strict ? 'strict' : 'off'
      }).forTick(input.packRuntime.getCurrentTick().toString())
    : undefined;

  const steps: Array<{ name: string; fn: () => Promise<unknown> }> = [
    { name: 'step1_expireBindings', fn: () => expirePackIdentityBindings(input.packRuntime, input.context) },
    { name: 'step2_worldEngine', fn: () => stepPackWorldEngine(input.context, input.packId, input.worldEngine, input.packRuntime, input.diagnostics) },
    { name: 'step3_agentScheduler', fn: () => runAgentScheduler({
      context: input.context,
      workerId: input.schedulerWorkerId,
      partitionIds: input.schedulerPartitionIds,
      packId: input.packId,
      packRuntime: input.packRuntime
    }) },
    { name: 'step4_workflowDecision', fn: () => runWorkflowDecisionStep({
      context: input.context,
      inferenceService: input.inferenceService,
      workerId: input.decisionWorkerId,
      packRuntime: input.packRuntime
    }) },
    { name: 'step5_actionDispatch', fn: () => runActionDispatcher({
      context: input.context,
      workerId: input.actionDispatcherWorkerId,
      packRuntime: input.packRuntime,
      determinism: tickDeterminism
    }) },
    { name: 'step6_perception', fn: () => runPerceptionPipeline(input.context, input.packRuntime) },
    { name: 'step7_projection', fn: () => runProjectionPipeline(input.context, input.packRuntime) }
  ];

  for (let i = 0; i < steps.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- steps is a static array, i is loop-local
    const step = steps[i];
    const stepNum = i + 1;
    const stepStartedAt = Date.now();

    try {
      await runHooks(`beforeStep${stepNum}`);
      await step.fn();
      await runHooks(`afterStep${stepNum}`);
      recordTickCompleted(input.packId, step.name, Date.now() - stepStartedAt, 'success');
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      stepErrors.push({ step: step.name, error: message });
      recordTickCompleted(input.packId, step.name, Date.now() - stepStartedAt, 'failed');

      if (input.onStepError) {
        input.onStepError(err);
      }
    }
  }

  // Run registered data cleaners scoped to this pack
  const cleaners = dataCleanerRegistry.listByPack(input.packId);
  if (cleaners.length > 0) {
    const packTick = input.packRuntime.getCurrentTick().toString();
    for (const cleaner of cleaners) {
      try {
        await dataCleanerRegistry.clean(cleaner.key, {
          text: `[pack=${input.packId}, tick=${packTick}]`,
          options: { pack_id: input.packId, tick: packTick }
        });
      } catch (err: unknown) {
        const error = getErrorMessage(err);
        extensionErrors.push({ extension_type: 'data_cleaner', key: cleaner.key, error });
        logger.warn('Data cleaner failed during pack loop cleanup', {
          pack_id: input.packId,
          tick: packTick,
          cleaner_key: cleaner.key,
          error
        });
      }
    }
  }

  await maybeCaptureAutoSnapshot({
    context: input.context,
    packId: input.packId,
    packRuntime: input.packRuntime
  });

  return { stepErrors, extensionErrors };
};

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
  packRuntime: PackRuntimePort,
  loopDiagnostics: PackLoopDiagnostics
): Promise<void> => {
  const ctx = buildStepContext({
    currentTick: packRuntime.getCurrentTick(),
    lastLoopDurationMs: loopDiagnostics.last_duration_ms ?? 0,
    overlapSkippedCount: loopDiagnostics.overlap_skipped_count,
    pendingEventCount: 0
  });
  const stepTicks = packRuntime.getEffectiveStepTicks(ctx).toString();

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
