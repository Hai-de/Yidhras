import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import type { PackRuntimePort } from '../../src/app/services/pack/pack_runtime_ports.js';
import { createPrismaRepositories } from '../../src/app/services/repositories/index.js';
import { createWorkflowEngine } from '../../src/app/services/workflow/workflow_engine.js';
import type { InferenceService } from '../../src/inference/service.js';
import type { InferenceRunResult } from '../../src/inference/types.js';
import type { IsolatedRuntimeEnvironment } from '../helpers/runtime.js';
import {
  createIsolatedRuntimeEnvironment,
  createPrismaClientForEnvironment,
  migrateIsolatedDatabase
} from '../helpers/runtime.js';

const createPackRuntime = (): PackRuntimePort => ({
  getPackId: () => 'pack-workflow-engine',
  getCurrentTick: () => 100n,
  getCurrentRevision: () => 100n,
  getPack: () => ({
    schema_version: 1,
    metadata: {
      id: 'pack-workflow-engine',
      name: 'Workflow Engine Pack',
      version: '0.0.0'
    },
    workflows: {
      serial_review: {
        trigger: { type: 'manual' },
        max_ticks: 20,
        steps: [
          {
            id: 'draft',
            agent: 'agent-draft',
            inference: { provider: 'behavior_tree', behavior_tree: 'draft_tree' }
          },
          {
            id: 'review',
            agent: 'agent-review',
            depends_on: ['draft'],
            input_from: ['draft'],
            inference: { provider: 'behavior_tree', behavior_tree: 'review_tree' }
          }
        ]
      }
    }
  }) as ReturnType<PackRuntimePort['getPack']>,
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

const createInferenceService = (): InferenceService => ({
  phase: 'workflow_baseline',
  ready: true,
  previewInference: async () => { throw new Error('not used'); },
  runInference: async () => { throw new Error('not used'); },
  submitInferenceJob: async input => ({
    replayed: false,
    inference_id: `inf-${String(input.attributes?.workflow_step_id ?? 'unknown')}`,
    job: {
      id: `job-${String(input.attributes?.workflow_step_id ?? 'unknown')}`,
      source_inference_id: `inf-${String(input.attributes?.workflow_step_id ?? 'unknown')}`,
      action_intent_id: null,
      job_type: 'inference_run',
      status: 'completed',
      attempt_count: 1,
      max_attempts: 3,
      last_error: null,
      idempotency_key: input.idempotency_key ?? null,
      created_at: '100',
      intent_class: 'direct_inference',
      updated_at: '100',
      completed_at: '100'
    },
    result: {
      inference_id: `inf-${String(input.attributes?.workflow_step_id ?? 'unknown')}`,
      actor_ref: {
        identity_id: `identity-${input.agent_id ?? 'unknown'}`,
        identity_type: 'agent',
        role: 'active',
        agent_id: input.agent_id ?? null,
        atmosphere_node_id: null
      },
      strategy: 'behavior_tree',
      provider: 'mock-workflow-provider',
      tick: '100',
      decision: {
        action_type: `action_${String(input.attributes?.workflow_step_id ?? 'unknown')}`,
        target_ref: null,
        payload: { semantic_intent_kind: String(input.attributes?.workflow_step_id ?? 'unknown') },
        reasoning: `reasoning-${String(input.attributes?.workflow_step_id ?? 'unknown')}`
      },
      trace_metadata: {
        inference_id: `inf-${String(input.attributes?.workflow_step_id ?? 'unknown')}`,
        world_pack_id: input.pack_id ?? 'pack-workflow-engine',
        binding_ref: null,
        prompt_version: 'test',
        tick: '100',
        strategy: 'behavior_tree',
        provider: 'mock-workflow-provider'
      }
    } satisfies InferenceRunResult,
    result_source: 'fresh_run',
    workflow_snapshot: {
      records: { trace: null, job: null, intent: null },
      lineage: {
        replay_of_job_id: null,
        replay_source_trace_id: null,
        replay_reason: null,
        override_applied: false,
        override_snapshot: null,
        parent_job: null,
        child_jobs: []
      },
      derived: {
        decision_stage: 'completed',
        dispatch_stage: 'not_requested',
        workflow_state: 'workflow_completed',
        failure_stage: 'none',
        failure_code: null,
        failure_reason: null,
        outcome_summary: { kind: 'completed', message: 'completed' }
      }
    }
  }),
  replayInferenceJob: async () => { throw new Error('not used'); },
  retryInferenceJob: async () => { throw new Error('not used'); },
  executeDecisionJob: async () => null,
  buildActionIntentDraft: () => { throw new Error('not used'); }
});

describe('WorkflowEngine integration', () => {
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

  it('triggers and advances a serial workflow in one tick while recording step results', async () => {
    const context = {
      repos: createPrismaRepositories(prisma),
      prisma
    } as AppContext;
    const packRuntime = createPackRuntime();
    const engine = createWorkflowEngine();

    const run = await engine.triggerWorkflow({
      context,
      packRuntime,
      workflow_name: 'serial_review',
      trigger_type: 'manual',
      trigger_ref: null,
      trigger_tick: 100n
    });

    const advanceResult = await engine.advance({
      context,
      inferenceService: createInferenceService(),
      packRuntime,
      workerId: 'workflow-worker-1',
      tick: 100n,
      budget: {
        max_rounds_per_tick: 5,
        max_steps_per_tick: 5,
        max_wall_time_ms_per_tick: 10_000
      }
    });

    expect(advanceResult).toMatchObject({
      advanced_run_count: 1,
      executed_step_count: 2,
      completed_run_count: 1,
      budget_exhausted: false
    });

    const completedRun = await context.repos.workflowRuns.getRunById(run.id);
    expect(completedRun?.status).toBe('completed');

    const steps = await context.repos.workflowSteps.listStepRuns(run.id);
    expect(steps.map(step => [step.step_id, step.status])).toEqual([
      ['draft', 'completed'],
      ['review', 'completed']
    ]);
    expect(steps.find(step => step.step_id === 'review')?.result_json?.reasoning).toBe('reasoning-review');
  });
});
