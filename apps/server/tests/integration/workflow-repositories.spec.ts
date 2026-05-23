import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import { createPrismaRepositories } from '../../src/app/services/repositories/index.js';
import type { IsolatedRuntimeEnvironment } from '../helpers/runtime.js';
import {
  createIsolatedRuntimeEnvironment,
  createPrismaClientForEnvironment,
  migrateIsolatedDatabase
} from '../helpers/runtime.js';

describe('workflow repositories integration', () => {
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

  it('creates, claims, completes workflow runs and step runs', async () => {
    const repos = createPrismaRepositories(prisma);
    const now = 100n;

    const run = await repos.workflowRuns.createRun({
      workflow_name: 'proposal_review',
      pack_id: 'pack-a',
      created_tick: now,
      max_ticks: 10,
      trigger_type: 'manual',
      trigger_ref: null,
      idempotency_key: 'wf:pack-a:proposal_review:manual:100:none',
      now
    });

    expect(run.status).toBe('pending');
    expect(await repos.workflowRuns.getRunByIdempotencyKey(run.idempotency_key)).toMatchObject({ id: run.id });

    const steps = await repos.workflowSteps.createStepRuns({
      steps: [
        {
          workflow_run_id: run.id,
          step_id: 'draft',
          agent_id: 'proposer',
          partition_id: 0,
          status: 'ready',
          dependency_step_ids: [],
          input_step_ids: [],
          idempotency_key: `${run.id}:draft:1`,
          now
        },
        {
          workflow_run_id: run.id,
          step_id: 'review',
          agent_id: 'reviewer',
          partition_id: 1,
          dependency_step_ids: ['draft'],
          input_step_ids: ['draft'],
          idempotency_key: `${run.id}:review:1`,
          now
        }
      ]
    });

    expect(steps).toHaveLength(2);
    expect(steps.find(step => step.step_id === 'review')?.dependency_step_ids).toEqual(['draft']);

    const runnableSteps = await repos.workflowSteps.listRunnableSteps({ workflow_run_id: run.id, now: now + 1n });
    expect(runnableSteps.map(step => step.step_id)).toEqual(['draft']);

    const claimedRun = await repos.workflowRuns.claimRun({
      run_id: run.id,
      worker_id: 'worker-1',
      now: now + 1n,
      lock_ticks: 5n
    });
    expect(claimedRun).toMatchObject({ status: 'running', lock_worker_id: 'worker-1' });

    const claimedStep = await repos.workflowSteps.claimStep({
      step_run_id: runnableSteps[0]!.id,
      worker_id: 'worker-1',
      now: now + 2n,
      lock_ticks: 5n
    });
    expect(claimedStep).toMatchObject({ status: 'running', lock_worker_id: 'worker-1' });

    await repos.workflowSteps.completeStep({
      step_run_id: claimedStep!.id,
      result_json: {
        reasoning: 'draft reasoning',
        decision_summary: 'drafted',
        grounding_result: { type: 'exact', semantic_intent: 'draft_proposal' },
        inference_id: 'inf-draft',
        action_intent_ids: ['intent-draft']
      },
      action_intent_ids: ['intent-draft'],
      completed_tick: now + 2n,
      now: now + 3n,
      worker_id: 'worker-1'
    });

    const completedStep = (await repos.workflowSteps.listStepRuns(run.id)).find(step => step.step_id === 'draft');
    expect(completedStep).toMatchObject({
      status: 'completed',
      action_intent_ids: ['intent-draft'],
      lock_worker_id: null
    });
    expect(completedStep?.result_json?.grounding_result.type).toBe('exact');

    await repos.workflowRuns.updateRunStatus({
      run_id: run.id,
      status: 'completed',
      last_advance_tick: now + 3n,
      lock_worker_id: null,
      lock_expires_at: null,
      now: now + 3n
    });

    expect(await repos.workflowRuns.listActiveRuns({ pack_id: 'pack-a' })).toEqual([]);
  });
});
