import { describe, expect, it, vi } from 'vitest';

import { createWorkflowEngine } from '../../../src/app/services/workflow/workflow_engine.js';
import * as workflowSingleFlight from '../../../src/app/services/workflow/workflow_single_flight.js';
import { createMockAppContext } from '../../helpers/mock_context.js';

/** Assign a mock function to a property on an object, bypassing readonly/strict types. */
const setMock = (obj: unknown, key: string, value: unknown): ReturnType<typeof vi.fn> => {
  const fn = typeof value === 'function' ? value as ReturnType<typeof vi.fn> : vi.fn().mockResolvedValue(value);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
  (obj as Record<string, unknown>)[key] = fn;
  return fn;
};

const makePackRuntime = (workflows: Record<string, unknown> = {}, packId = 'test-pack') => ({
  getPack: () => ({
    metadata: { id: packId },
    workflows
  }),
  getPackId: () => packId,
  getCurrentTick: () => 100n,
  getCurrentRevision: () => 100n,
  getStepTicks: () => 1n,
  resolvePackVariables: (s: string) => s,
  getRuntimeSpeedSnapshot: () => ({
    mode: 'variable' as const,
    source: 'default' as const,
    strategy: { kind: 'variable' as const, range: { min: 1n, max: 1n }, loopIntervalMs: 1000 },
    effective_step_ticks: '1',
    override_since: null
  }),
  setRuntimeSpeedOverride: () => {},
  clearRuntimeSpeedOverride: () => {},
  getAllTimes: () => ({ current_tick: 100n }),
  step: async () => {},
  getPackSlotDeclarations: () => null,
  applyClockProjection: () => {}
});

const sampleWorkflow = {
  trigger: { type: 'manual' },
  max_ticks: 100,
  steps: [
    {
      id: 'step-a',
      agent: 'agent-1',
      inference: { provider: 'behavior_tree', behavior_tree: 'tree_a' }
    },
    {
      id: 'step-b',
      agent: 'agent-2',
      depends_on: ['step-a'],
      input_from: ['step-a'],
      inference: { provider: 'behavior_tree', behavior_tree: 'tree_b' }
    }
  ]
};

/* ──────────────────── createWorkflowEngine ──────────────────── */

describe('createWorkflowEngine', () => {
  it('creates engine with all public methods', () => {
    const engine = createWorkflowEngine();
    expect(engine).toBeDefined();
    expect(typeof engine.triggerWorkflow).toBe('function');
    expect(typeof engine.advance).toBe('function');
    expect(typeof engine.recoverExpiredRuns).toBe('function');
  });
});

/* ──────────────────── triggerWorkflow ──────────────────── */

describe('WorkflowEngine.triggerWorkflow', () => {
  it('throws WORKFLOW_NOT_FOUND for nonexistent workflow', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();
    const packRuntime = makePackRuntime({});

    await expect(
      engine.triggerWorkflow({
        context: ctx as never,
        packRuntime: packRuntime as never,
        workflow_name: 'nonexistent',
        trigger_type: 'manual',
        trigger_tick: 100n,
        trigger_ref: 'test'
      })
    ).rejects.toMatchObject({ code: 'WORKFLOW_NOT_FOUND' });
  });

  it('creates run with steps for valid workflow', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();
    const mockRun = { id: 'run-1', workflow_name: 'approval', status: 'pending' };
    const mockCreate = setMock(ctx.repos.workflowRuns, 'createRunWithStepsIdempotent', { run: mockRun });

    const packRuntime = makePackRuntime({ approval: sampleWorkflow });

    const result = await engine.triggerWorkflow({
      context: ctx as never,
      packRuntime: packRuntime as never,
      workflow_name: 'approval',
      trigger_type: 'manual',
      trigger_tick: 100n,
      trigger_ref: 'ref-1'
    });

    expect(result).toEqual(mockRun);
    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect((callArgs.run as Record<string, unknown>).workflow_name).toBe('approval');
    expect((callArgs.run as Record<string, unknown>).pack_id).toBe('test-pack');
    expect((callArgs.steps as unknown[])).toHaveLength(2);
    expect((callArgs.steps as Array<Record<string, unknown>>)[0].step_id).toBe('step-a');
    expect((callArgs.steps as Array<Record<string, unknown>>)[0].agent_id).toBe('agent-1');
    expect((callArgs.steps as Array<Record<string, unknown>>)[1].step_id).toBe('step-b');
    expect((callArgs.steps as Array<Record<string, unknown>>)[1].dependency_step_ids).toEqual(['step-a']);
    expect((callArgs.steps as Array<Record<string, unknown>>)[1].input_step_ids).toEqual(['step-a']);
  });

  it('uses trigger_ref in idempotency key', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();
    const mockCreate = setMock(ctx.repos.workflowRuns, 'createRunWithStepsIdempotent', { run: { id: 'r1' } });

    const packRuntime = makePackRuntime({ w: sampleWorkflow });

    await engine.triggerWorkflow({
      context: ctx as never,
      packRuntime: packRuntime as never,
      workflow_name: 'w',
      trigger_type: 'event',
      trigger_tick: 50n,
      trigger_ref: 'evt-1'
    });

    const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    const idemKey = (callArgs.run as Record<string, unknown>).idempotency_key as string;
    expect(idemKey).toContain('evt-1');
    expect(idemKey).toContain('event');
    expect(idemKey).toContain('50');
  });

  it('defaults trigger_ref to none when not provided', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();
    const mockCreate = setMock(ctx.repos.workflowRuns, 'createRunWithStepsIdempotent', { run: { id: 'r1' } });

    const packRuntime = makePackRuntime({ w: sampleWorkflow });

    await engine.triggerWorkflow({
      context: ctx as never,
      packRuntime: packRuntime as never,
      workflow_name: 'w',
      trigger_type: 'manual',
      trigger_tick: 100n,
      trigger_ref: null
    });

    const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect((callArgs.run as Record<string, unknown>).idempotency_key as string).toContain('none');
  });

  it('handles step without depends_on or input_from', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();
    const mockCreate = setMock(ctx.repos.workflowRuns, 'createRunWithStepsIdempotent', { run: { id: 'r1' } });

    const simpleWorkflow = {
      trigger: { type: 'manual' },
      max_ticks: 50,
      steps: [
        { id: 's1', agent: 'a1', inference: { provider: 'behavior_tree', behavior_tree: 'bt1' } }
      ]
    };
    const packRuntime = makePackRuntime({ w: simpleWorkflow });

    await engine.triggerWorkflow({
      context: ctx as never,
      packRuntime: packRuntime as never,
      workflow_name: 'w',
      trigger_type: 'manual',
      trigger_tick: 10n,
      trigger_ref: 'test'
    });

    const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    const steps = callArgs.steps as Array<Record<string, unknown>>;
    expect(steps[0].dependency_step_ids).toEqual([]);
    expect(steps[0].input_step_ids).toEqual([]);
  });
});

/* ──────────────────── recoverExpiredRuns ──────────────────── */

describe('WorkflowEngine.recoverExpiredRuns', () => {
  it('returns zero counts when no active runs', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();
    setMock(ctx.repos.workflowRuns, 'listActiveRuns', []);

    const packRuntime = makePackRuntime();
    const result = await engine.recoverExpiredRuns({
      context: ctx as never,
      packRuntime: packRuntime as never,
      tick: 200n,
      workerId: 'w1'
    });

    expect(result.expired_run_count).toBe(0);
    expect(result.expired_step_count).toBe(0);
    expect(result.recovered_step_count).toBe(0);
  });

  it('releases expired run lock', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();

    const expiredRun = {
      id: 'run-1',
      lock_worker_id: 'worker-1',
      lock_expires_at: 150n
    };
    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [expiredRun]);
    const mockUpdate = setMock(ctx.repos.workflowRuns, 'updateRunStatus', {});
    setMock(ctx.repos.workflowSteps, 'listStepRuns', []);

    const packRuntime = makePackRuntime();
    const result = await engine.recoverExpiredRuns({
      context: ctx as never,
      packRuntime: packRuntime as never,
      tick: 200n,
      workerId: 'w1'
    });

    expect(result.expired_run_count).toBe(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ run_id: 'run-1', status: 'pending' })
    );
  });

  it('skips run when lock not expired', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();

    const activeRun = {
      id: 'run-1',
      lock_worker_id: 'worker-1',
      lock_expires_at: 300n
    };
    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [activeRun]);
    const mockUpdate = setMock(ctx.repos.workflowRuns, 'updateRunStatus', {});
    setMock(ctx.repos.workflowSteps, 'listStepRuns', []);

    const packRuntime = makePackRuntime();
    const result = await engine.recoverExpiredRuns({
      context: ctx as never,
      packRuntime: packRuntime as never,
      tick: 200n,
      workerId: 'w1'
    });

    expect(result.expired_run_count).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('skips run when no lock worker', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();

    const unlockedRun = {
      id: 'run-1',
      lock_worker_id: null,
      lock_expires_at: null
    };
    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [unlockedRun]);
    setMock(ctx.repos.workflowSteps, 'listStepRuns', []);

    const packRuntime = makePackRuntime();
    const result = await engine.recoverExpiredRuns({
      context: ctx as never,
      packRuntime: packRuntime as never,
      tick: 200n,
      workerId: 'w1'
    });

    expect(result.expired_run_count).toBe(0);
  });

  it('recovers expired step locks', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();

    const activeRun = {
      id: 'run-1',
      lock_worker_id: null,
      lock_expires_at: null
    };
    const expiredStep = {
      id: 'step-1',
      step_id: 's1',
      status: 'running',
      lock_expires_at: 150n
    };
    const activeStep = {
      id: 'step-2',
      step_id: 's2',
      status: 'running',
      lock_expires_at: 300n
    };
    const completedStep = {
      id: 'step-3',
      step_id: 's3',
      status: 'completed',
      lock_expires_at: null
    };

    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [activeRun]);
    setMock(ctx.repos.workflowSteps, 'listStepRuns', [expiredStep, activeStep, completedStep]);
    const mockRelease = setMock(ctx.repos.workflowSteps, 'releaseStepLock', {});

    const packRuntime = makePackRuntime();
    const result = await engine.recoverExpiredRuns({
      context: ctx as never,
      packRuntime: packRuntime as never,
      tick: 200n,
      workerId: 'w1'
    });

    expect(result.expired_step_count).toBe(1);
    expect(result.recovered_step_count).toBe(1);
    expect(mockRelease).toHaveBeenCalledWith(
      expect.objectContaining({ step_run_id: 'step-1', status: 'ready' })
    );
  });

  it('handles multiple runs', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();

    const expiredRun = { id: 'run-1', lock_worker_id: 'w1', lock_expires_at: 100n };
    const normalRun = { id: 'run-2', lock_worker_id: 'w2', lock_expires_at: 500n };

    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [expiredRun, normalRun]);
    setMock(ctx.repos.workflowRuns, 'updateRunStatus', {});
    setMock(ctx.repos.workflowSteps, 'listStepRuns', []);

    const packRuntime = makePackRuntime();
    const result = await engine.recoverExpiredRuns({
      context: ctx as never,
      packRuntime: packRuntime as never,
      tick: 200n,
      workerId: 'w1'
    });

    expect(result.expired_run_count).toBe(1);
  });
});

/* ──────────────────── advance ──────────────────── */

describe('WorkflowEngine.advance', () => {
  it('returns empty result when no active runs', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();
    setMock(ctx.repos.workflowRuns, 'listActiveRuns', []);

    const result = await engine.advance({
      context: ctx as never,
      packRuntime: makePackRuntime() as never,
      tick: 100n,
      workerId: 'w1',
      budget: { max_rounds_per_tick: 10, max_steps_per_tick: 20, max_wall_time_ms_per_tick: 5000 },
      inferenceService: {} as never
    });

    expect(result.advanced_run_count).toBe(0);
    expect(result.executed_step_count).toBe(0);
    expect(result.completed_run_count).toBe(0);
    expect(result.failed_run_count).toBe(0);
    expect(result.budget_exhausted).toBe(false);
  });

  it('marks run as failed when workflow definition missing', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();

    const activeRun = {
      id: 'run-1',
      workflow_name: 'deleted_workflow',
      pack_id: 'test-pack',
      created_tick: 50n,
      max_ticks: 1000
    };
    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [activeRun]);
    setMock(ctx.repos.workflowRuns, 'claimRun', activeRun);
    const mockUpdate = setMock(ctx.repos.workflowRuns, 'updateRunStatus', {});

    const packRuntime = makePackRuntime({});

    const result = await engine.advance({
      context: ctx as never,
      packRuntime: packRuntime as never,
      tick: 100n,
      workerId: 'w1',
      budget: { max_rounds_per_tick: 10, max_steps_per_tick: 20, max_wall_time_ms_per_tick: 5000 },
      inferenceService: {} as never
    });

    expect(result.failed_run_count).toBe(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('skips run when claim fails', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();

    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [{ id: 'run-1', workflow_name: 'w' }]);
    setMock(ctx.repos.workflowRuns, 'claimRun', null);

    const result = await engine.advance({
      context: ctx as never,
      packRuntime: makePackRuntime({ w: sampleWorkflow }) as never,
      tick: 100n,
      workerId: 'w1',
      budget: { max_rounds_per_tick: 10, max_steps_per_tick: 20, max_wall_time_ms_per_tick: 5000 },
      inferenceService: {} as never
    });

    expect(result.advanced_run_count).toBe(0);
  });

  it('handles timed out run', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();

    const run = {
      id: 'run-1',
      workflow_name: 'w',
      pack_id: 'test-pack',
      created_tick: 10n,
      max_ticks: 50,
      status: 'running'
    };
    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [run]);
    setMock(ctx.repos.workflowRuns, 'claimRun', run);
    const mockUpdate = setMock(ctx.repos.workflowRuns, 'updateRunStatus', {});

    const result = await engine.advance({
      context: ctx as never,
      packRuntime: makePackRuntime({ w: sampleWorkflow }) as never,
      tick: 200n,
      workerId: 'w1',
      budget: { max_rounds_per_tick: 10, max_steps_per_tick: 20, max_wall_time_ms_per_tick: 5000 },
      inferenceService: {} as never
    });

    expect(result.failed_run_count).toBe(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'timed_out' })
    );
  });

  it('completes run when all steps are completed', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();

    const run = {
      id: 'run-1',
      workflow_name: 'w',
      pack_id: 'test-pack',
      created_tick: 90n,
      max_ticks: 100,
      status: 'running'
    };
    const completedSteps = [
      { step_id: 'step-a', status: 'completed', result_json: { reasoning: 'done' } },
      { step_id: 'step-b', status: 'completed', result_json: { reasoning: 'ok' } }
    ];

    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [run]);
    setMock(ctx.repos.workflowRuns, 'claimRun', run);
    setMock(ctx.repos.workflowRuns, 'updateRunStatus', {});
    setMock(ctx.repos.workflowSteps, 'listStepRuns', completedSteps);

    const result = await engine.advance({
      context: ctx as never,
      packRuntime: makePackRuntime({ w: sampleWorkflow }) as never,
      tick: 100n,
      workerId: 'w1',
      budget: { max_rounds_per_tick: 10, max_steps_per_tick: 20, max_wall_time_ms_per_tick: 5000 },
      inferenceService: {} as never
    });

    expect(result.completed_run_count).toBe(1);
    expect(result.failed_run_count).toBe(0);
  });

  it('narrativizes run when any step is narrativized', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();

    const run = {
      id: 'run-1',
      workflow_name: 'w',
      pack_id: 'test-pack',
      created_tick: 90n,
      max_ticks: 100,
      status: 'running'
    };
    const steps = [
      { step_id: 'step-a', status: 'narrativized', result_json: null },
      { step_id: 'step-b', status: 'completed', result_json: {} }
    ];

    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [run]);
    setMock(ctx.repos.workflowRuns, 'claimRun', run);
    const mockUpdate = setMock(ctx.repos.workflowRuns, 'updateRunStatus', {});
    setMock(ctx.repos.workflowSteps, 'listStepRuns', steps);

    const result = await engine.advance({
      context: ctx as never,
      packRuntime: makePackRuntime({ w: sampleWorkflow }) as never,
      tick: 100n,
      workerId: 'w1',
      budget: { max_rounds_per_tick: 10, max_steps_per_tick: 20, max_wall_time_ms_per_tick: 5000 },
      inferenceService: {} as never
    });

    expect(result.narrativized_run_count).toBe(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'narrativized' })
    );
  });

  it('marks run failed when any step failed', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();

    const run = {
      id: 'run-1',
      workflow_name: 'w',
      pack_id: 'test-pack',
      created_tick: 90n,
      max_ticks: 100,
      status: 'running'
    };
    const steps = [
      { step_id: 'step-a', status: 'completed', result_json: {} },
      { step_id: 'step-b', status: 'failed', result_json: { error: 'x' } }
    ];

    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [run]);
    setMock(ctx.repos.workflowRuns, 'claimRun', run);
    const mockUpdate = setMock(ctx.repos.workflowRuns, 'updateRunStatus', {});
    setMock(ctx.repos.workflowSteps, 'listStepRuns', steps);

    const result = await engine.advance({
      context: ctx as never,
      packRuntime: makePackRuntime({ w: sampleWorkflow }) as never,
      tick: 100n,
      workerId: 'w1',
      budget: { max_rounds_per_tick: 10, max_steps_per_tick: 20, max_wall_time_ms_per_tick: 5000 },
      inferenceService: {} as never
    });

    expect(result.failed_run_count).toBe(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('releases run when no ready steps', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();

    const run = {
      id: 'run-1',
      workflow_name: 'w',
      pack_id: 'test-pack',
      created_tick: 90n,
      max_ticks: 100,
      status: 'running'
    };
    const steps = [
      { step_id: 'step-a', status: 'running', lock_expires_at: 200n },
      { step_id: 'step-b', status: 'pending', lock_expires_at: null }
    ];

    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [run]);
    setMock(ctx.repos.workflowRuns, 'claimRun', run);
    setMock(ctx.repos.workflowRuns, 'updateRunStatus', {});
    setMock(ctx.repos.workflowSteps, 'listStepRuns', steps);

    const result = await engine.advance({
      context: ctx as never,
      packRuntime: makePackRuntime({ w: sampleWorkflow }) as never,
      tick: 100n,
      workerId: 'w1',
      budget: { max_rounds_per_tick: 10, max_steps_per_tick: 20, max_wall_time_ms_per_tick: 5000 },
      inferenceService: {} as never
    });

    expect(result.executed_step_count).toBe(0);
    expect(result.advanced_run_count).toBe(1);
  });

  it('marks run as failed when timed_out step present', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();

    const run = {
      id: 'run-1',
      workflow_name: 'w',
      pack_id: 'test-pack',
      created_tick: 90n,
      max_ticks: 100,
      status: 'running'
    };
    const steps = [
      { step_id: 'step-a', status: 'timed_out', result_json: null },
      { step_id: 'step-b', status: 'pending', result_json: null }
    ];

    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [run]);
    setMock(ctx.repos.workflowRuns, 'claimRun', run);
    const mockUpdate = setMock(ctx.repos.workflowRuns, 'updateRunStatus', {});
    setMock(ctx.repos.workflowSteps, 'listStepRuns', steps);

    const result = await engine.advance({
      context: ctx as never,
      packRuntime: makePackRuntime({ w: sampleWorkflow }) as never,
      tick: 100n,
      workerId: 'w1',
      budget: { max_rounds_per_tick: 10, max_steps_per_tick: 20, max_wall_time_ms_per_tick: 5000 },
      inferenceService: {} as never
    });

    expect(result.failed_run_count).toBe(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'timed_out' })
    );
  });

  it('handles multiple runs', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();

    const run1 = { id: 'run-1', workflow_name: 'w', pack_id: 'p', created_tick: 90n, max_ticks: 100, status: 'running' };
    const run2 = { id: 'run-2', workflow_name: 'w', pack_id: 'p', created_tick: 90n, max_ticks: 100, status: 'running' };

    let claimCount = 0;
    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [run1, run2]);
    setMock(ctx.repos.workflowRuns, 'claimRun', vi.fn().mockImplementation(async () => {
      claimCount++;
      return claimCount <= 2 ? (claimCount === 1 ? run1 : run2) : null;
    }));
    setMock(ctx.repos.workflowRuns, 'updateRunStatus', {});

    const completedSteps = [
      { step_id: 'step-a', status: 'completed', result_json: {} },
      { step_id: 'step-b', status: 'completed', result_json: {} }
    ];
    setMock(ctx.repos.workflowSteps, 'listStepRuns', completedSteps);

    const result = await engine.advance({
      context: ctx as never,
      packRuntime: makePackRuntime({ w: sampleWorkflow }) as never,
      tick: 100n,
      workerId: 'w1',
      budget: { max_rounds_per_tick: 10, max_steps_per_tick: 20, max_wall_time_ms_per_tick: 5000 },
      inferenceService: {} as never
    });

    expect(result.advanced_run_count).toBe(2);
    expect(result.completed_run_count).toBe(2);
  });

/* ──────────────────── advance: budget exhaustion ──────────────────── */

describe('WorkflowEngine.advance: budget', () => {
  const smallBudget = { max_rounds_per_tick: 0, max_steps_per_tick: 100, max_wall_time_ms_per_tick: 999999 };

  it('returns budget_exhausted when max_rounds is zero', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();
    const run = { id: 'run-1', workflow_name: 'w', pack_id: 'p', created_tick: 90n, max_ticks: 100, status: 'running' };
    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [run]);
    setMock(ctx.repos.workflowRuns, 'claimRun', run);

    const result = await engine.advance({
      context: ctx as never,
      packRuntime: makePackRuntime({ w: sampleWorkflow }) as never,
      tick: 100n,
      workerId: 'w1',
      budget: smallBudget,
      inferenceService: {} as never
    });

    expect(result.budget_exhausted).toBe(true);
    expect(result.advanced_run_count).toBe(0);
  });

  it('returns budget_exhausted when max_steps reached', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();
    const run = { id: 'run-1', workflow_name: 'w', pack_id: 'p', created_tick: 90n, max_ticks: 100, status: 'running' };
    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [run]);
    setMock(ctx.repos.workflowRuns, 'claimRun', run);
    setMock(ctx.repos.workflowRuns, 'updateRunStatus', {});
    // Two pending steps that are ready (no deps)
    const simpleWorkflow = {
      trigger: { type: 'manual' },
      max_ticks: 100,
      steps: [
        { id: 's1', agent: 'a1', inference: { provider: 'behavior_tree', behavior_tree: 'bt1' } },
        { id: 's2', agent: 'a2', inference: { provider: 'behavior_tree', behavior_tree: 'bt2' } }
      ]
    };
    const readySteps = [
      { step_id: 's1', status: 'pending', result_json: null, lock_expires_at: null },
      { step_id: 's2', status: 'pending', result_json: null, lock_expires_at: null }
    ];
    setMock(ctx.repos.workflowSteps, 'listStepRuns', readySteps);
    // First step claim succeeds
    let stepClaimCount = 0;
    setMock(ctx.repos.workflowSteps, 'claimStep', vi.fn().mockImplementation(async () => {
      stepClaimCount++;
      return stepClaimCount <= 1 ? { ...readySteps[stepClaimCount - 1], agent_id: 'a1', idempotency_key: 'idem-1' } : null;
    }));
    setMock(ctx.repos.workflowSteps, 'updateStepStatus', {});
    setMock(ctx.repos.workflowSteps, 'releaseStepLock', {});
    vi.spyOn(workflowSingleFlight, 'hasActiveWorkflowForActor').mockResolvedValue(false);

    const mockInferenceService = {
      submitInferenceJob: vi.fn().mockResolvedValue({ result: null }),
      executeDecisionJob: vi.fn()
    };
    // getByIdempotencyKey returns null → resolveSubmittedInferenceResult returns null → failStep
    setMock(ctx.repos.inference, 'getByIdempotencyKey', null);
    setMock(ctx.repos.workflowSteps, 'failStep', { updated: true });

    const budget = { max_rounds_per_tick: 10, max_steps_per_tick: 1, max_wall_time_ms_per_tick: 999999 };

    const result = await engine.advance({
      context: ctx as never,
      packRuntime: makePackRuntime({ w: simpleWorkflow }) as never,
      tick: 100n,
      workerId: 'w1',
      budget,
      inferenceService: mockInferenceService as never
    });

    // After executing 1 step, budget should be exhausted on the next step attempt
    expect(result.executed_step_count).toBe(1);
    expect(result.budget_exhausted).toBe(true);
  });
});

/* ──────────────────── advance: condition evaluation ──────────────────── */

describe('WorkflowEngine.advance: conditions', () => {
  const conditionalWorkflow = {
    trigger: { type: 'manual' },
    max_ticks: 100,
    steps: [
      {
        id: 'step-a',
        agent: 'agent-1',
        inference: { provider: 'behavior_tree', behavior_tree: 'tree_a' }
      },
      {
        id: 'step-b',
        agent: 'agent-2',
        depends_on: ['step-a'],
        condition: { field: 'step-a.decision_summary', op: 'eq', value: 'approve' },
        inference: { provider: 'behavior_tree', behavior_tree: 'tree_b' }
      }
    ]
  };

  it('skips step when condition evaluates to false', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();
    const run = { id: 'run-1', workflow_name: 'w', pack_id: 'p', created_tick: 90n, max_ticks: 100, status: 'running' };
    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [run]);
    setMock(ctx.repos.workflowRuns, 'claimRun', run);
    setMock(ctx.repos.workflowRuns, 'updateRunStatus', {});

    const steps = [
      { id: 'sr-a', step_id: 'step-a', status: 'completed', result_json: { decision_summary: 'reject', reasoning: 'no', grounding_result: { type: 'exact', semantic_intent: 'reject' }, inference_id: 'inf-1', action_intent_ids: [] } },
      { id: 'sr-b', step_id: 'step-b', status: 'pending', result_json: null, lock_expires_at: null }
    ];
    setMock(ctx.repos.workflowSteps, 'listStepRuns', steps);
    const mockUpdateStatus = setMock(ctx.repos.workflowSteps, 'updateStepStatus', {});

    const result = await engine.advance({
      context: ctx as never,
      packRuntime: makePackRuntime({ w: conditionalWorkflow }) as never,
      tick: 100n,
      workerId: 'w1',
      budget: { max_rounds_per_tick: 10, max_steps_per_tick: 20, max_wall_time_ms_per_tick: 5000 },
      inferenceService: {} as never
    });

    expect(mockUpdateStatus).toHaveBeenCalledWith(
      expect.objectContaining({ step_run_id: 'sr-b', status: 'skipped' })
    );
    expect(result.executed_step_count).toBe(0);
  });

  it('narrativizes step when condition evaluation errors', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();
    const run = { id: 'run-1', workflow_name: 'w', pack_id: 'p', created_tick: 90n, max_ticks: 100, status: 'running' };
    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [run]);
    setMock(ctx.repos.workflowRuns, 'claimRun', run);
    setMock(ctx.repos.workflowRuns, 'updateRunStatus', {});

    // step-a completed but step-b condition references a non-existent field path
    const steps = [
      { id: 'sr-a', step_id: 'step-a', status: 'completed', result_json: { decision_summary: 'approve', reasoning: 'ok', grounding_result: { type: 'exact', semantic_intent: 'approve' }, inference_id: 'inf-1', action_intent_ids: [] } },
      { id: 'sr-b', step_id: 'step-b', status: 'pending', result_json: null, lock_expires_at: null }
    ];
    setMock(ctx.repos.workflowSteps, 'listStepRuns', steps);
    const mockNarrativize = setMock(ctx.repos.workflowSteps, 'narrativizeStep', { updated: true });

    // Condition references a non-existent path → condition_error
    const errorConditionWorkflow = {
      ...conditionalWorkflow,
      steps: [
        conditionalWorkflow.steps[0],
        { ...conditionalWorkflow.steps[1], condition: { field: 'step-a.nonexistent.path', op: 'eq', value: 'x' } }
      ]
    };

    const result = await engine.advance({
      context: ctx as never,
      packRuntime: makePackRuntime({ w: errorConditionWorkflow }) as never,
      tick: 100n,
      workerId: 'w1',
      budget: { max_rounds_per_tick: 10, max_steps_per_tick: 20, max_wall_time_ms_per_tick: 5000 },
      inferenceService: {} as never
    });

    expect(mockNarrativize).toHaveBeenCalledWith(
      expect.objectContaining({ step_run_id: 'sr-b' })
    );
    expect(result.executed_step_count).toBe(0);
  });
});

/* ──────────────────── advance: step execution ──────────────────── */


describe('WorkflowEngine.advance: step execution', () => {
  /** Helper: listStepRuns that returns pending first, then terminal on second call */
  const makeStepListMock = (pending: unknown, terminal: unknown) => {
    let call = 0;
    return vi.fn().mockImplementation(async () => {
      call++;
      return call <= 1 ? [pending] : [terminal];
    });
  };

  it('executes step via inferenceService and completes it', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();
    const run = { id: 'run-1', workflow_name: 'w', pack_id: 'p', created_tick: 90n, max_ticks: 100, status: 'running' };
    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [run]);
    setMock(ctx.repos.workflowRuns, 'claimRun', run);
    setMock(ctx.repos.workflowRuns, 'updateRunStatus', {});

    const singleStepWorkflow = {
      trigger: { type: 'manual' },
      max_ticks: 100,
      steps: [
        { id: 's1', agent: 'a1', inference: { provider: 'behavior_tree', behavior_tree: 'bt1' } }
      ]
    };

    const pendingStep = { step_id: 's1', status: 'pending', result_json: null, lock_expires_at: null, agent_id: 'a1', idempotency_key: 'idem-1' };
    const completedStep = { step_id: 's1', status: 'completed', result_json: { reasoning: 'done' }, lock_expires_at: null };
    setMock(ctx.repos.workflowSteps, 'listStepRuns', makeStepListMock(pendingStep, completedStep));
    setMock(ctx.repos.workflowSteps, 'updateStepStatus', {});
    setMock(ctx.repos.workflowSteps, 'claimStep', pendingStep);
    setMock(ctx.repos.workflowSteps, 'completeStep', { updated: true });
    setMock(ctx.repos.workflowSteps, 'releaseStepLock', {});
    vi.spyOn(workflowSingleFlight, 'hasActiveWorkflowForActor').mockResolvedValue(false);

    const inferenceResult = {
      inference_id: 'inf-1',
      decision: {
        action_type: 'approve',
        reasoning: 'looks good',
        payload: { semantic_intent_kind: 'approve' }
      }
    };
    const mockInferenceService = {
      submitInferenceJob: vi.fn().mockResolvedValue({ result: inferenceResult })
    };
    setMock(ctx.repos.inference, 'findActionIntentByInferenceId', { id: 'intent-1' });

    const result = await engine.advance({
      context: ctx as never,
      packRuntime: makePackRuntime({ w: singleStepWorkflow }) as never,
      tick: 100n,
      workerId: 'w1',
      budget: { max_rounds_per_tick: 2, max_steps_per_tick: 20, max_wall_time_ms_per_tick: 5000 },
      inferenceService: mockInferenceService as never
    });

    expect(result.executed_step_count).toBe(1);
    expect(result.completed_run_count).toBe(1);
    expect(mockInferenceService.submitInferenceJob).toHaveBeenCalledOnce();
  });

  it('fails step when inference result is null', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();
    const run = { id: 'run-1', workflow_name: 'w', pack_id: 'p', created_tick: 90n, max_ticks: 100, status: 'running' };
    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [run]);
    setMock(ctx.repos.workflowRuns, 'claimRun', run);
    setMock(ctx.repos.workflowRuns, 'updateRunStatus', {});

    const singleStepWorkflow = {
      trigger: { type: 'manual' },
      max_ticks: 100,
      steps: [
        { id: 's1', agent: 'a1', inference: { provider: 'behavior_tree', behavior_tree: 'bt1' } }
      ]
    };

    const pendingStep = { step_id: 's1', status: 'pending', result_json: null, lock_expires_at: null, agent_id: 'a1', idempotency_key: 'idem-1' };
    const failedStep = { step_id: 's1', status: 'failed', result_json: null, lock_expires_at: null };
    setMock(ctx.repos.workflowSteps, 'listStepRuns', makeStepListMock(pendingStep, failedStep));
    setMock(ctx.repos.workflowSteps, 'updateStepStatus', {});
    setMock(ctx.repos.workflowSteps, 'claimStep', pendingStep);
    setMock(ctx.repos.workflowSteps, 'failStep', { updated: true });
    setMock(ctx.repos.workflowSteps, 'releaseStepLock', {});
    vi.spyOn(workflowSingleFlight, 'hasActiveWorkflowForActor').mockResolvedValue(false);

    const mockInferenceService = {
      submitInferenceJob: vi.fn().mockResolvedValue({ result: null })
    };
    setMock(ctx.repos.inference, 'getByIdempotencyKey', null);

    const result = await engine.advance({
      context: ctx as never,
      packRuntime: makePackRuntime({ w: singleStepWorkflow }) as never,
      tick: 100n,
      workerId: 'w1',
      budget: { max_rounds_per_tick: 2, max_steps_per_tick: 20, max_wall_time_ms_per_tick: 5000 },
      inferenceService: mockInferenceService as never
    });

    expect(result.executed_step_count).toBe(1);
    expect(result.failed_run_count).toBe(1);
  });

  it('releases step lock when actor has other active workflow (single flight)', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();
    const run = { id: 'run-1', workflow_name: 'w', pack_id: 'p', created_tick: 90n, max_ticks: 100, status: 'running' };
    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [run]);
    setMock(ctx.repos.workflowRuns, 'claimRun', run);
    setMock(ctx.repos.workflowRuns, 'updateRunStatus', {});

    const singleStepWorkflow = {
      trigger: { type: 'manual' },
      max_ticks: 100,
      steps: [
        { id: 's1', agent: 'a1', inference: { provider: 'behavior_tree', behavior_tree: 'bt1' } }
      ]
    };

    const pendingStep = { step_id: 's1', status: 'pending', result_json: null, lock_expires_at: null, agent_id: 'a1', idempotency_key: 'idem-1' };
    setMock(ctx.repos.workflowSteps, 'listStepRuns', [pendingStep]);
    setMock(ctx.repos.workflowSteps, 'updateStepStatus', {});
    setMock(ctx.repos.workflowSteps, 'claimStep', pendingStep);
    setMock(ctx.repos.workflowSteps, 'releaseStepLock', {});
    vi.spyOn(workflowSingleFlight, 'hasActiveWorkflowForActor').mockResolvedValue(true);

    const result = await engine.advance({
      context: ctx as never,
      packRuntime: makePackRuntime({ w: singleStepWorkflow }) as never,
      tick: 100n,
      workerId: 'w1',
      budget: { max_rounds_per_tick: 1, max_steps_per_tick: 20, max_wall_time_ms_per_tick: 5000 },
      inferenceService: {} as never
    });

    expect(result.executed_step_count).toBe(0);
    expect(result.advanced_run_count).toBe(1);
  });

  it('skips step when claimStep returns null', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();
    const run = { id: 'run-1', workflow_name: 'w', pack_id: 'p', created_tick: 90n, max_ticks: 100, status: 'running' };
    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [run]);
    setMock(ctx.repos.workflowRuns, 'claimRun', run);
    setMock(ctx.repos.workflowRuns, 'updateRunStatus', {});

    const singleStepWorkflow = {
      trigger: { type: 'manual' },
      max_ticks: 100,
      steps: [
        { id: 's1', agent: 'a1', inference: { provider: 'behavior_tree', behavior_tree: 'bt1' } }
      ]
    };

    const pendingStep = { step_id: 's1', status: 'pending', result_json: null, lock_expires_at: null, agent_id: 'a1', idempotency_key: 'idem-1' };
    setMock(ctx.repos.workflowSteps, 'listStepRuns', [pendingStep]);
    setMock(ctx.repos.workflowSteps, 'updateStepStatus', {});
    setMock(ctx.repos.workflowSteps, 'claimStep', null);

    const result = await engine.advance({
      context: ctx as never,
      packRuntime: makePackRuntime({ w: singleStepWorkflow }) as never,
      tick: 100n,
      workerId: 'w1',
      budget: { max_rounds_per_tick: 1, max_steps_per_tick: 20, max_wall_time_ms_per_tick: 5000 },
      inferenceService: {} as never
    });

    expect(result.executed_step_count).toBe(0);
    expect(result.advanced_run_count).toBe(1);
  });

  it('handles step execution error gracefully', async () => {
    const engine = createWorkflowEngine();
    const ctx = createMockAppContext();
    const run = { id: 'run-1', workflow_name: 'w', pack_id: 'p', created_tick: 90n, max_ticks: 100, status: 'running' };
    setMock(ctx.repos.workflowRuns, 'listActiveRuns', [run]);
    setMock(ctx.repos.workflowRuns, 'claimRun', run);
    setMock(ctx.repos.workflowRuns, 'updateRunStatus', {});

    const singleStepWorkflow = {
      trigger: { type: 'manual' },
      max_ticks: 100,
      steps: [
        { id: 's1', agent: 'a1', inference: { provider: 'behavior_tree', behavior_tree: 'bt1' } }
      ]
    };

    const pendingStep = { step_id: 's1', status: 'pending', result_json: null, lock_expires_at: null, agent_id: 'a1', idempotency_key: 'idem-1' };
    const failedStep = { step_id: 's1', status: 'failed', result_json: null, lock_expires_at: null };
    setMock(ctx.repos.workflowSteps, 'listStepRuns', makeStepListMock(pendingStep, failedStep));
    setMock(ctx.repos.workflowSteps, 'updateStepStatus', {});
    setMock(ctx.repos.workflowSteps, 'claimStep', pendingStep);
    setMock(ctx.repos.workflowSteps, 'failStep', { updated: true });
    vi.spyOn(workflowSingleFlight, 'hasActiveWorkflowForActor').mockResolvedValue(false);

    const mockInferenceService = {
      submitInferenceJob: vi.fn().mockRejectedValue(new Error('inference failed'))
    };

    const result = await engine.advance({
      context: ctx as never,
      packRuntime: makePackRuntime({ w: singleStepWorkflow }) as never,
      tick: 100n,
      workerId: 'w1',
      budget: { max_rounds_per_tick: 2, max_steps_per_tick: 20, max_wall_time_ms_per_tick: 5000 },
      inferenceService: mockInferenceService as never
    });

    expect(result.executed_step_count).toBe(1);
    expect(result.failed_run_count).toBe(1);
  });
});

});
