import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import type { AppContext } from '../../src/app/context.js';
import { createPrismaRepositories } from '../../src/app/services/repositories/index.js';
import { createWorkflowEngine } from '../../src/app/services/workflow/workflow_engine.js';
import type { PackRuntimePort } from '../../src/app/services/pack/pack_runtime_ports.js';
import type { InferenceService } from '../../src/inference/service.js';
import type { InferenceJobSnapshot, InferenceRunResult, WorkflowSnapshot } from '../../src/inference/types.js';
import type { IsolatedRuntimeEnvironment } from '../helpers/runtime.js';
import {
  createIsolatedRuntimeEnvironment,
  createPrismaClientForEnvironment,
  migrateIsolatedDatabase
} from '../helpers/runtime.js';

const createPackRuntime = (): PackRuntimePort => ({
  getPackId: () => 'pack-workflow-cross-partition',
  getCurrentTick: () => 100n,
  getCurrentRevision: () => 100n,
  getPack: () => ({
    schema_version: 1,
    metadata: { id: 'pack-workflow-cross-partition', name: 'Workflow Cross Partition Pack', version: '0.0.0' },
    workflows: {
      gather_chain: {
        trigger: { type: 'manual' },
        max_ticks: 20,
        steps: [
          { id: 'source_a', agent: 'agent-a', inference: { provider: 'behavior_tree', behavior_tree: 'source_a_tree' } },
          { id: 'source_b', agent: 'agent-b', inference: { provider: 'behavior_tree', behavior_tree: 'source_b_tree' } },
          {
            id: 'gather',
            agent: 'agent-c',
            depends_on: ['source_a', 'source_b'],
            input_from: ['source_a', 'source_b'],
            inference: { provider: 'behavior_tree', behavior_tree: 'gather_tree' }
          }
        ]
      }
    }
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

const createInferenceJobSnapshot = (stepId: string, idempotencyKey: string | null): InferenceJobSnapshot => ({
  id: `job-${stepId}`,
  source_inference_id: `inf-${stepId}`,
  pending_source_key: null,
  action_intent_id: null,
  job_type: 'decision',
  status: 'completed',
  attempt_count: 1,
  max_attempts: 3,
  last_error: null,
  idempotency_key: idempotencyKey,
  created_at: '2024-01-01T00:00:00.000Z',
  intent_class: 'direct_inference',
  updated_at: '2024-01-01T00:00:00.000Z',
  completed_at: '2024-01-01T00:00:00.000Z'
});

const createWorkflowSnapshot = (stepId: string): WorkflowSnapshot => ({
  records: {
    trace: null,
    job: null,
    intent: null
  },
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
    outcome_summary: { kind: 'completed', message: `Mock workflow completed for ${stepId}` }
  }
});

const createInferenceService = (): InferenceService => ({
  phase: 'workflow_baseline',
  ready: true,
  previewInference: async () => { throw new Error('not used'); },
  runInference: async () => { throw new Error('not used'); },
  submitInferenceJob: async input => {
    const stepId = String(input.attributes?.workflow_step_id ?? 'unknown');
    return {
      replayed: false,
      inference_id: `inf-${stepId}`,
      job: createInferenceJobSnapshot(stepId, input.idempotency_key ?? null),
      result: {
        inference_id: `inf-${stepId}`,
        actor_ref: { identity_id: input.agent_id ?? stepId, identity_type: 'agent', role: 'active', agent_id: input.agent_id ?? null, atmosphere_node_id: null },
        strategy: 'behavior_tree',
        provider: 'mock-workflow-provider',
        tick: '100',
        decision: {
          action_type: `action_${stepId}`,
          target_ref: null,
          payload: { semantic_intent_kind: stepId },
          reasoning: input.previous_agent_output ? Object.keys(input.previous_agent_output).join('+') : stepId
        },
        trace_metadata: {
          inference_id: `inf-${stepId}`,
          world_pack_id: input.pack_id ?? 'pack-workflow-cross-partition',
          binding_ref: null,
          prompt_version: 'test',
          tick: '100',
          strategy: 'behavior_tree',
          provider: 'mock-workflow-provider'
        }
      } satisfies InferenceRunResult,
      result_source: 'fresh_run',
      workflow_snapshot: createWorkflowSnapshot(stepId)
    };
  },
  replayInferenceJob: async () => { throw new Error('not used'); },
  retryInferenceJob: async () => { throw new Error('not used'); },
  executeDecisionJob: async () => null,
  buildActionIntentDraft: () => { throw new Error('not used'); }
});

describe('WorkflowEngine cross-partition integration', () => {
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

  it('advances fan-out and gather steps across stored partition ids in one tick', async () => {
    const context = { repos: createPrismaRepositories(prisma), prisma } as AppContext;
    const packRuntime = createPackRuntime();
    const engine = createWorkflowEngine();
    const run = await engine.triggerWorkflow({
      context,
      packRuntime,
      workflow_name: 'gather_chain',
      trigger_type: 'manual',
      trigger_ref: null,
      trigger_tick: 100n
    });

    const createdSteps = await context.repos.workflowSteps.listStepRuns(run.id);
    expect(createdSteps.map(step => [step.step_id, step.partition_id])).toEqual([
      ['source_a', 0],
      ['source_b', 1],
      ['gather', 2]
    ]);

    const result = await engine.advance({
      context,
      inferenceService: createInferenceService(),
      packRuntime,
      workerId: 'cross-partition-worker',
      tick: 100n,
      budget: { max_rounds_per_tick: 5, max_steps_per_tick: 5, max_wall_time_ms_per_tick: 10_000 }
    });

    expect(result.executed_step_count).toBe(3);
    expect(result.completed_run_count).toBe(1);
    const steps = await context.repos.workflowSteps.listStepRuns(run.id);
    expect(steps.map(step => [step.step_id, step.status])).toEqual([
      ['source_a', 'completed'],
      ['source_b', 'completed'],
      ['gather', 'completed']
    ]);
    expect(steps.find(step => step.step_id === 'gather')?.result_json?.reasoning).toBe('source_a+source_b');
  });
});
