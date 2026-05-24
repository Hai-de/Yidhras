import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import type { PackRuntimePort } from '../../src/app/services/pack/pack_runtime_ports.js';
import { createPrismaRepositories } from '../../src/app/services/repositories/index.js';
import { createWorkflowEngine } from '../../src/app/services/workflow/workflow_engine.js';
import type { IsolatedRuntimeEnvironment } from '../helpers/runtime.js';
import {
  createIsolatedRuntimeEnvironment,
  createPrismaClientForEnvironment,
  migrateIsolatedDatabase
} from '../helpers/runtime.js';

const createPackRuntime = (): PackRuntimePort => ({
  getPackId: () => 'pack-workflow-recovery',
  getCurrentTick: () => 100n,
  getCurrentRevision: () => 100n,
  getPack: () => ({
    schema_version: 1,
    metadata: { id: 'pack-workflow-recovery', name: 'Workflow Recovery Pack', version: '0.0.0' },
    workflows: {}
  }) as unknown as ReturnType<PackRuntimePort['getPack']>,
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

describe('WorkflowEngine recovery integration', () => {
  let environment: IsolatedRuntimeEnvironment;
  let prisma: PrismaClient;

  beforeAll(async () => {
    environment = await createIsolatedRuntimeEnvironment({ seededPackRefs: [] });
    await migrateIsolatedDatabase(environment);
    prisma = createPrismaClientForEnvironment(environment);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await environment?.cleanup();
  });

  it('releases expired run locks and returns expired running steps to ready', async () => {
    const context = { repos: createPrismaRepositories(prisma), prisma } as AppContext;
    const run = await context.repos.workflowRuns.createRun({
      workflow_name: 'recoverable',
      pack_id: 'pack-workflow-recovery',
      created_tick: 90n,
      last_advance_tick: 95n,
      max_ticks: 100,
      trigger_type: 'manual',
      trigger_ref: null,
      idempotency_key: 'wf:pack-workflow-recovery:recoverable:manual:90:none',
      now: 90n
    });
    await context.repos.workflowRuns.updateRunStatus({
      run_id: run.id,
      status: 'running',
      lock_worker_id: 'dead-worker',
      lock_expires_at: 99n,
      now: 95n
    });
    const [step] = await context.repos.workflowSteps.createStepRuns({
      steps: [{
        workflow_run_id: run.id,
        step_id: 'expired-step',
        agent_id: 'agent-expired',
        partition_id: 1,
        status: 'ready',
        dependency_step_ids: [],
        input_step_ids: [],
        idempotency_key: `wfstep:${run.id}:expired-step:1`,
        now: 90n
      }]
    });
    await context.repos.workflowSteps.claimStep({
      step_run_id: step!.id,
      worker_id: 'dead-worker',
      now: 95n,
      lock_ticks: 4n
    });

    const result = await createWorkflowEngine().recoverExpiredRuns({
      context,
      packRuntime: createPackRuntime(),
      workerId: 'recovery-worker',
      tick: 100n
    });

    expect(result).toEqual({
      expired_run_count: 1,
      expired_step_count: 1,
      recovered_step_count: 1,
      failed_step_count: 0
    });
    expect(await context.repos.workflowRuns.getRunById(run.id)).toMatchObject({
      status: 'pending',
      lock_worker_id: null,
      lock_expires_at: null
    });
    expect((await context.repos.workflowSteps.listStepRuns(run.id))[0]).toMatchObject({
      status: 'ready',
      lock_worker_id: null,
      lock_expires_at: null
    });
  });
});
