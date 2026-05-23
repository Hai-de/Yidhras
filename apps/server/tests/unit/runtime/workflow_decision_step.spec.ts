import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../../src/app/context.js';
import type { PackRuntimePort } from '../../../src/app/services/pack/pack_runtime_ports.js';
import type { WorkflowDecisionStepEngine } from '../../../src/app/runtime/workflow_decision_step.js';
import { runWorkflowDecisionStep } from '../../../src/app/runtime/workflow_decision_step.js';
import type { InferenceService } from '../../../src/inference/service.js';

const order = vi.hoisted((): string[] => []);
const runDecisionJobRunnerMock = vi.hoisted(() => vi.fn(async () => {
  order.push('decision_jobs');
  return 3;
}));

vi.mock('../../../src/app/runtime/job_runner.js', () => ({
  runDecisionJobRunner: runDecisionJobRunnerMock
}));

const createPackRuntime = (): PackRuntimePort => ({
  getPackId: () => 'pack-runtime-test',
  getCurrentTick: () => 42n,
  getCurrentRevision: () => 42n,
  getPack: () => ({ schema_version: 1, metadata: { id: 'pack-runtime-test', name: 'Pack Runtime Test', version: '0.0.0' } }) as ReturnType<PackRuntimePort['getPack']>,
  resolvePackVariables: template => template,
  getStepTicks: () => 1n,
  getStepStrategy: () => ({ kind: 'variable', range: { min: 1n, max: 1n }, loopIntervalMs: 1000 }),
  setStepStrategy: () => undefined,
  getEffectiveStepTicks: () => 1n,
  getLoopIntervalMs: () => 1000,
  getRuntimeSpeedSnapshot: () => ({
    mode: 'variable',
    source: 'default',
    strategy: { kind: 'variable', range: { min: 1n, max: 1n }, loopIntervalMs: 1000 },
    effective_step_ticks: '1',
    override_since: null
  }),
  clearRuntimeSpeedOverride: () => undefined,
  getAllTimes: () => [],
  step: () => undefined,
  getPackSlotDeclarations: () => null,
  applyClockProjection: () => undefined
});

const createEngine = (): WorkflowDecisionStepEngine => ({
  recoverExpiredRuns: async () => {
    order.push('recover');
    return {
      expired_run_count: 1,
      expired_step_count: 2,
      recovered_step_count: 2,
      failed_step_count: 0
    };
  },
  advance: async () => {
    order.push('advance');
    return {
      advanced_run_count: 1,
      executed_step_count: 2,
      completed_run_count: 1,
      failed_run_count: 0,
      narrativized_run_count: 0,
      budget_exhausted: false
    };
  }
});

describe('runWorkflowDecisionStep', () => {
  beforeEach(() => {
    order.length = 0;
    runDecisionJobRunnerMock.mockClear();
  });

  it('runs recovery, workflow advance, then ordinary decision jobs in order', async () => {
    const context = {} as AppContext;
    const inferenceService = {} as InferenceService;
    const packRuntime = createPackRuntime();

    const result = await runWorkflowDecisionStep({
      context,
      inferenceService,
      packRuntime,
      workerId: 'worker-1',
      workflowEngine: createEngine(),
      decisionJobLimit: 7,
      decisionJobConcurrency: 2,
      decisionJobLockTicks: 9n,
      workflowBudget: {
        max_rounds_per_tick: 4,
        max_steps_per_tick: 5,
        max_wall_time_ms_per_tick: 600
      }
    });

    expect(order).toEqual(['recover', 'advance', 'decision_jobs']);
    expect(result).toEqual({
      recovery: {
        expired_run_count: 1,
        expired_step_count: 2,
        recovered_step_count: 2,
        failed_step_count: 0
      },
      workflow_advance: {
        advanced_run_count: 1,
        executed_step_count: 2,
        completed_run_count: 1,
        failed_run_count: 0,
        narrativized_run_count: 0,
        budget_exhausted: false
      },
      executed_decision_job_count: 3
    });
    expect(runDecisionJobRunnerMock).toHaveBeenCalledWith({
      context,
      inferenceService,
      packRuntime,
      workerId: 'worker-1',
      limit: 7,
      concurrency: 2,
      lockTicks: 9n
    });
  });
});
