import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import {
  buildInferenceJobReplaySubmitResult,
  buildInferenceJobRetryResult,
  buildInferenceJobSubmitResult,
  createPendingDecisionJob,
  getDecisionJobById,
  getWorkflowSnapshotByJobId,
  listInferenceJobs
} from '../../src/app/services/inference_workflow.js';
import {
  ensureNonEmptyId,
  normalizeReplayInput,
  normalizeStoredRequestInput,
  parseInferenceJobsCursor
} from '../../src/app/services/inference_workflow/parsers.js';
import {
  buildInferenceJobReplayResult,
  getDecisionResultFromWorkflowSnapshot,
  resolveInferenceIdForSubmitResult,
  resolveResultSource
} from '../../src/app/services/inference_workflow/results.js';
import { buildWorkflowSnapshot } from '../../src/app/services/inference_workflow/snapshots.js';
import type {
  ActionIntentRecord,
  DecisionJobRecord,
  InferenceTraceRecord
} from '../../src/app/services/inference_workflow/types.js';
import { DEFAULT_E2E_WORLD_PACK } from '../support/config.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

describe('inference workflow core integration', () => {
  let cleanup: (() => Promise<void>) | null = null;
  let context: AppContext;

  beforeAll(async () => {
    const fixture = await createIsolatedAppContextFixture();
    cleanup = fixture.cleanup;
    context = fixture.context;
  });

  afterAll(async () => {
    await cleanup?.();
  });

  const createWorkflowJob = async (input: {
    suffix: string;
    agentId: string;
    strategy: 'mock' | 'rule_based';
    scheduledForTick?: bigint | null;
  }) => {
    const idempotencyKey = `workflow-core-${input.suffix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    return createPendingDecisionJob(context, {
      idempotency_key: idempotencyKey,
      request_input: {
        agent_id: input.agentId,
        identity_id: input.agentId,
        strategy: input.strategy,
        idempotency_key: idempotencyKey
      },
      scheduled_for_tick: input.scheduledForTick ?? null
    });
  };

  const createMockJob = (overrides: Partial<DecisionJobRecord> = {}): DecisionJobRecord => ({
    id: 'job-default',
    locked_by: null,
    locked_at: null,
    lock_expires_at: null,
    replay_of_job_id: null,
    replay_source_trace_id: null,
    replay_reason: null,
    replay_override_snapshot: null,
    source_inference_id: null,
    pending_source_key: 'pending-key',
    action_intent_id: null,
    job_type: 'inference_run',
    status: 'pending',
    attempt_count: 0,
    max_attempts: 3,
    request_input: { agent_id: 'agent-001' },
    last_error: null,
    last_error_code: null,
    last_error_stage: null,
    idempotency_key: 'job-default-key',
    started_at: null,
    next_retry_at: null,
    intent_class: 'direct_inference',
    scheduled_for_tick: null,
    created_at: 1000n,
    updated_at: 1000n,
    completed_at: null,
    ...overrides
  });

  const createMockTrace = (overrides: Partial<InferenceTraceRecord> = {}): InferenceTraceRecord => ({
    id: 'trace-default',
    kind: 'run',
    strategy: 'mock',
    provider: 'mock',
    actor_ref: { agent_id: 'agent-001' },
    input: {},
    context_snapshot: {},
    prompt_bundle: {},
    trace_metadata: { tick: '1000' },
    decision: null,
    created_at: 1000n,
    updated_at: 1000n,
    ...overrides
  });

  const createMockIntent = (overrides: Partial<ActionIntentRecord> = {}): ActionIntentRecord => ({
    id: 'intent-default',
    source_inference_id: 'trace-default',
    intent_type: 'post_message',
    actor_ref: { agent_id: 'agent-001' },
    target_ref: null,
    payload: {},
    scheduled_after_ticks: null,
    scheduled_for_tick: null,
    status: 'pending',
    dispatch_started_at: null,
    dispatched_at: null,
    transmission_delay_ticks: null,
    transmission_policy: 'reliable',
    transmission_drop_chance: 0,
    drop_reason: null,
    dispatch_error_code: null,
    dispatch_error_message: null,
    created_at: 1000n,
    updated_at: 1000n,
    ...overrides
  });

  it('normalizes stored request input, replay input and cursor parsing', () => {
    const normalizedRequest = normalizeStoredRequestInput({
      agent_id: 'agent-001',
      strategy: 'mock',
      attributes: { source: 'test' },
      idempotency_key: 'job-1'
    });
    expect(normalizedRequest.agent_id).toBe('agent-001');
    expect(normalizedRequest.strategy).toBe('mock');

    expect(() => normalizeStoredRequestInput('invalid-request-input')).toThrow();

    const replayInput = normalizeReplayInput({
      reason: ' replay me ',
      idempotency_key: ' replay-key ',
      overrides: {
        strategy: 'rule_based',
        attributes: { mode: 'test' },
        agent_id: 'agent-001'
      }
    });
    expect(replayInput.reason).toBe('replay me');
    expect(replayInput.idempotency_key).toBe('replay-key');
    expect(replayInput.overrides?.strategy).toBe('rule_based');

    expect(() => normalizeReplayInput({ overrides: { strategy: 'unsupported' as 'mock' } })).toThrow();

    const encodedCursor = Buffer.from(
      JSON.stringify({ created_at: '100', id: 'job-1' }),
      'utf8'
    ).toString('base64url');
    const parsedCursor = parseInferenceJobsCursor(encodedCursor);
    expect(parsedCursor?.created_at).toBe('100');
    expect(parsedCursor?.id).toBe('job-1');

    expect(() =>
      parseInferenceJobsCursor(
        Buffer.from(JSON.stringify({ created_at: 'invalid', id: '' }), 'utf8').toString('base64url')
      )
    ).toThrow();

    expect(ensureNonEmptyId('  abc  ', 'job_id')).toBe('abc');
    expect(() => ensureNonEmptyId('   ', 'job_id')).toThrow();
  });

  it('derives workflow snapshot states across preview, decision, dispatch and failure stages', () => {
    const previewOnly = buildWorkflowSnapshot({
      trace: createMockTrace({ id: 'trace-preview', kind: 'preview' }),
      job: null,
      intent: null
    });
    expect(previewOnly.derived.workflow_state).toBe('preview_only');

    const decisionPending = buildWorkflowSnapshot({
      trace: null,
      job: createMockJob({ id: 'job-pending', status: 'pending' }),
      intent: null
    });
    expect(decisionPending.derived.workflow_state).toBe('decision_pending');
    expect(decisionPending.derived.decision_stage).toBe('queued');

    const decisionRunning = buildWorkflowSnapshot({
      trace: null,
      job: createMockJob({
        id: 'job-running',
        status: 'running',
        locked_by: 'worker-a',
        locked_at: 1000n,
        lock_expires_at: 1005n,
        started_at: 1000n,
        attempt_count: 1,
        source_inference_id: 'trace-running',
        pending_source_key: null
      }),
      intent: null
    });
    expect(decisionRunning.derived.workflow_state).toBe('decision_running');

    const decisionFailed = buildWorkflowSnapshot({
      trace: null,
      job: createMockJob({
        id: 'job-failed',
        status: 'failed',
        attempt_count: 1,
        source_inference_id: 'trace-failed',
        pending_source_key: null,
        last_error: 'provider failed',
        last_error_code: 'INFERENCE_PROVIDER_FAIL',
        last_error_stage: 'provider'
      }),
      intent: null
    });
    expect(decisionFailed.derived.workflow_state).toBe('decision_failed');
    expect(decisionFailed.derived.failure_stage).toBe('provider');

    const dispatchPending = buildWorkflowSnapshot({
      trace: createMockTrace({
        id: 'trace-dispatch-pending',
        decision: { action_type: 'post_message', payload: { content: 'hello' } }
      }),
      job: createMockJob({
        id: 'job-dispatch-pending',
        status: 'completed',
        attempt_count: 1,
        source_inference_id: 'trace-dispatch-pending',
        pending_source_key: null,
        completed_at: 1002n
      }),
      intent: null
    });
    expect(dispatchPending.derived.workflow_state).toBe('dispatch_pending');

    const dispatching = buildWorkflowSnapshot({
      trace: null,
      job: createMockJob({
        id: 'job-dispatching',
        status: 'completed',
        attempt_count: 1,
        source_inference_id: 'trace-dispatching',
        pending_source_key: null,
        action_intent_id: 'intent-dispatching',
        completed_at: 1002n
      }),
      intent: createMockIntent({
        id: 'intent-dispatching',
        source_inference_id: 'trace-dispatching',
        status: 'dispatching',
        dispatch_started_at: 1002n
      })
    });
    expect(dispatching.derived.workflow_state).toBe('dispatching');

    const workflowCompleted = buildWorkflowSnapshot({
      trace: null,
      job: createMockJob({
        id: 'job-complete',
        status: 'completed',
        attempt_count: 1,
        source_inference_id: 'trace-complete',
        pending_source_key: null,
        action_intent_id: 'intent-complete',
        completed_at: 1002n
      }),
      intent: createMockIntent({
        id: 'intent-complete',
        source_inference_id: 'trace-complete',
        status: 'completed',
        dispatch_started_at: 1001n,
        dispatched_at: 1002n
      })
    });
    expect(workflowCompleted.derived.workflow_state).toBe('workflow_completed');

    const workflowDropped = buildWorkflowSnapshot({
      trace: null,
      job: createMockJob({
        id: 'job-dropped',
        status: 'completed',
        attempt_count: 1,
        source_inference_id: 'trace-dropped',
        pending_source_key: null,
        action_intent_id: 'intent-dropped',
        completed_at: 1002n
      }),
      intent: createMockIntent({
        id: 'intent-dropped',
        source_inference_id: 'trace-dropped',
        status: 'dropped',
        transmission_policy: 'fragile',
        transmission_drop_chance: 0.5,
        drop_reason: 'probabilistic_drop'
      })
    });
    expect(workflowDropped.derived.workflow_state).toBe('workflow_dropped');

    const workflowFailed = buildWorkflowSnapshot({
      trace: null,
      job: createMockJob({
        id: 'job-workflow-failed',
        status: 'completed',
        attempt_count: 1,
        source_inference_id: 'trace-workflow-failed',
        pending_source_key: null,
        action_intent_id: 'intent-workflow-failed',
        completed_at: 1002n
      }),
      intent: createMockIntent({
        id: 'intent-workflow-failed',
        source_inference_id: 'trace-workflow-failed',
        status: 'failed',
        dispatch_started_at: 1001n,
        transmission_policy: 'fragile',
        transmission_drop_chance: 0.2,
        dispatch_error_code: 'ACTION_DISPATCH_FAIL',
        dispatch_error_message: 'dispatch exploded'
      })
    });
    expect(workflowFailed.derived.workflow_state).toBe('workflow_failed');
    expect(workflowFailed.derived.failure_stage).toBe('dispatch');
  });

  it('builds submit, replay, retry and replay-submit results from persisted workflow data', async () => {
    const agentId = `agent-result-${Date.now()}`;
    const job = await createWorkflowJob({
      suffix: 'results-base',
      agentId,
      strategy: 'mock'
    });

    const noResultWorkflow = buildWorkflowSnapshot({
      trace: null,
      job,
      intent: null
    });

    expect(resolveResultSource(false, null)).toBe('not_available');
    expect(
      resolveResultSource(true, {
        inference_id: 'trace-x',
        actor_ref: {
          identity_id: agentId,
          identity_type: 'agent',
          role: 'active',
          agent_id: agentId,
          atmosphere_node_id: null
        },
        strategy: 'mock',
        provider: 'mock',
        tick: '1000',
        decision: { action_type: 'noop', target_ref: null, payload: {} },
        trace_metadata: {
          inference_id: 'trace-x',
          world_pack_id: 'world',
          binding_ref: null,
          prompt_version: null,
          tick: '1000',
          strategy: 'mock',
          provider: 'mock'
        }
      })
    ).toBe('stored_trace');
    expect(resolveInferenceIdForSubmitResult(noResultWorkflow, job)).toBe(job.pending_source_key);
    expect(getDecisionResultFromWorkflowSnapshot(noResultWorkflow)).toBeNull();

    const submitResult = buildInferenceJobSubmitResult(job, null, noResultWorkflow, false);
    expect(submitResult.result_source).toBe('not_available');
    expect(submitResult.result).toBeNull();

    const traceId = `trace-result-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const tick = 3000n;
    await context.prisma.inferenceTrace.create({
      data: {
        id: traceId,
        kind: 'run',
        strategy: 'mock',
        provider: 'mock',
        actor_ref: { agent_id: agentId, identity_id: agentId } as Prisma.InputJsonValue,
        input: { agent_id: agentId } as Prisma.InputJsonValue,
        context_snapshot: {} as Prisma.InputJsonValue,
        prompt_bundle: {} as Prisma.InputJsonValue,
        trace_metadata: {
          inference_id: traceId,
          tick: tick.toString(),
          strategy: 'mock',
          provider: 'mock',
          world_pack_id: DEFAULT_E2E_WORLD_PACK,
          binding_ref: null,
          prompt_version: null
        } as Prisma.InputJsonValue,
        decision: {
          action_type: 'post_message',
          target_ref: null,
          payload: { content: 'result path' }
        } as Prisma.InputJsonValue,
        created_at: tick,
        updated_at: tick
      }
    });

    const intentId = `intent-result-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    await context.prisma.actionIntent.create({
      data: {
        id: intentId,
        source_inference_id: traceId,
        intent_type: 'post_message',
        actor_ref: { agent_id: agentId, identity_id: agentId } as Prisma.InputJsonValue,
        target_ref: Prisma.JsonNull,
        payload: { content: 'result path' } as Prisma.InputJsonValue,
        scheduled_after_ticks: null,
        scheduled_for_tick: null,
        status: 'completed',
        dispatch_started_at: tick,
        dispatched_at: tick + 1n,
        transmission_delay_ticks: null,
        transmission_policy: 'reliable',
        transmission_drop_chance: 0,
        drop_reason: null,
        dispatch_error_code: null,
        dispatch_error_message: null,
        locked_by: null,
        locked_at: null,
        lock_expires_at: null,
        created_at: tick,
        updated_at: tick + 1n
      }
    });

    await context.prisma.decisionJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        source_inference_id: traceId,
        action_intent_id: intentId,
        pending_source_key: null,
        updated_at: tick + 1n,
        completed_at: tick + 1n
      }
    });

    const completedJob = await getDecisionJobById(context, job.id);
    const completedWorkflow = await getWorkflowSnapshotByJobId(context, completedJob.id);
    const decisionResult = getDecisionResultFromWorkflowSnapshot(completedWorkflow);
    expect(decisionResult?.inference_id).toBe(traceId);

    const replayResult = await buildInferenceJobReplayResult(completedJob, completedWorkflow);
    expect(replayResult.result_source).toBe('stored_trace');
    expect(replayResult.result?.inference_id).toBe(traceId);

    const retryResult = buildInferenceJobRetryResult(completedJob, decisionResult!, completedWorkflow);
    expect(retryResult.result_source).toBe('fresh_run');
    expect(retryResult.result?.inference_id).toBe(traceId);

    const replayChild = await createPendingDecisionJob(context, {
      idempotency_key: `workflow-core-results-replay-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      request_input: {
        agent_id: agentId,
        strategy: 'mock'
      },
      intent_class: 'replay_recovery'
    });

    await context.prisma.decisionJob.update({
      where: { id: replayChild.id },
      data: {
        replay_of_job_id: completedJob.id,
        replay_source_trace_id: traceId,
        replay_reason: 'result-builder-replay',
        replay_override_snapshot: { strategy: 'mock' } as Prisma.InputJsonValue,
        pending_source_key: replayChild.idempotency_key,
        updated_at: tick + 2n
      }
    });

    const refreshedReplayChild = await getDecisionJobById(context, replayChild.id);
    const replayChildWorkflow = await getWorkflowSnapshotByJobId(context, replayChild.id);
    const replaySubmitResult = buildInferenceJobReplaySubmitResult(refreshedReplayChild, replayChildWorkflow);
    expect(replaySubmitResult.result_source).toBe('not_available');
    expect(replaySubmitResult.replay.source_job_id).toBe(completedJob.id);
    expect(replaySubmitResult.replay.override_applied).toBe(true);
  });

  it('lists inference jobs with workflow summaries, replay lineage and cursor pagination', async () => {
    const agentOneId = `agent-list-a-${Date.now()}`;
    const agentTwoId = `agent-list-b-${Date.now()}`;

    const agentOneJob = await createWorkflowJob({
      suffix: 'agent-one',
      agentId: agentOneId,
      strategy: 'mock'
    });
    const agentTwoJob = await createWorkflowJob({
      suffix: 'agent-two',
      agentId: agentTwoId,
      strategy: 'rule_based'
    });

    const traceId = `trace-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const traceTick = 2000n;
    await context.prisma.inferenceTrace.create({
      data: {
        id: traceId,
        kind: 'run',
        strategy: 'mock',
        provider: 'mock',
        actor_ref: { agent_id: agentOneId, identity_id: agentOneId } as Prisma.InputJsonValue,
        input: { agent_id: agentOneId } as Prisma.InputJsonValue,
        context_snapshot: {} as Prisma.InputJsonValue,
        prompt_bundle: {} as Prisma.InputJsonValue,
        trace_metadata: {
          tick: traceTick.toString(),
          strategy: 'mock',
          provider: 'mock'
        } as Prisma.InputJsonValue,
        decision: {
          action_type: 'post_message',
          payload: { content: 'hello' }
        } as Prisma.InputJsonValue,
        created_at: traceTick,
        updated_at: traceTick
      }
    });

    const intentId = `intent-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    await context.prisma.actionIntent.create({
      data: {
        id: intentId,
        source_inference_id: traceId,
        intent_type: 'post_message',
        actor_ref: { agent_id: agentOneId, identity_id: agentOneId } as Prisma.InputJsonValue,
        target_ref: Prisma.JsonNull,
        payload: { content: 'hello' } as Prisma.InputJsonValue,
        scheduled_after_ticks: null,
        scheduled_for_tick: null,
        status: 'completed',
        dispatch_started_at: traceTick,
        dispatched_at: traceTick + 1n,
        transmission_delay_ticks: null,
        transmission_policy: 'reliable',
        transmission_drop_chance: 0,
        drop_reason: null,
        dispatch_error_code: null,
        dispatch_error_message: null,
        locked_by: null,
        locked_at: null,
        lock_expires_at: null,
        created_at: traceTick,
        updated_at: traceTick + 1n
      }
    });

    await context.prisma.decisionJob.update({
      where: { id: agentOneJob.id },
      data: {
        status: 'completed',
        source_inference_id: traceId,
        pending_source_key: null,
        action_intent_id: intentId,
        updated_at: traceTick + 1n,
        completed_at: traceTick + 1n
      }
    });

    await context.prisma.decisionJob.update({
      where: { id: agentTwoJob.id },
      data: {
        status: 'failed',
        last_error: 'simulated failure',
        updated_at: traceTick + 2n
      }
    });

    const replayJob = await createWorkflowJob({
      suffix: 'replay-child',
      agentId: agentOneId,
      strategy: 'mock'
    });

    await context.prisma.decisionJob.update({
      where: { id: replayJob.id },
      data: {
        replay_of_job_id: agentOneJob.id,
        replay_reason: 'test replay lineage',
        pending_source_key: replayJob.idempotency_key
      }
    });

    const listByAgent = await listInferenceJobs(context, {
      agent_id: agentOneId,
      limit: 10
    });
    expect(listByAgent.items.length).toBeGreaterThanOrEqual(2);
    expect(listByAgent.items.every(item => item.actor_ref?.agent_id === agentOneId)).toBe(true);

    const listByIdentity = await listInferenceJobs(context, {
      identity_id: agentOneId,
      limit: 10
    });
    expect(listByIdentity.items.length).toBeGreaterThanOrEqual(1);
    expect(listByIdentity.items.every(item => item.actor_ref?.identity_id === agentOneId)).toBe(true);

    const listByStrategy = await listInferenceJobs(context, {
      strategy: 'rule_based',
      agent_id: agentTwoId,
      limit: 10
    });
    expect(listByStrategy.items.some(item => item.id === agentTwoJob.id)).toBe(true);
    expect(listByStrategy.items.every(item => item.strategy === 'rule_based')).toBe(true);
    expect(listByStrategy.items.every(item => typeof item.intent_class === 'string')).toBe(true);
    expect(listByStrategy.items.some(item => item.intent_class === 'direct_inference')).toBe(true);

    const listByStatus = await listInferenceJobs(context, {
      status: ['failed'],
      agent_id: agentTwoId,
      limit: 10
    });
    expect(listByStatus.items.some(item => item.id === agentTwoJob.id)).toBe(true);
    expect(listByStatus.items.every(item => item.status === 'failed')).toBe(true);

    const listFailed = await listInferenceJobs(context, {
      has_error: true,
      agent_id: agentTwoId,
      limit: 10
    });
    expect(listFailed.items.some(item => item.id === agentTwoJob.id)).toBe(true);
    expect(listFailed.items.every(item => item.last_error !== null)).toBe(true);

    const listByIntent = await listInferenceJobs(context, {
      action_intent_id: intentId,
      limit: 10
    });
    expect(listByIntent.items).toHaveLength(1);
    expect(listByIntent.items[0]?.id).toBe(agentOneJob.id);
    expect(listByIntent.items[0]?.workflow.workflow_state).toBe('workflow_completed');

    const workflowSnapshot = await getWorkflowSnapshotByJobId(context, replayJob.id);
    expect(workflowSnapshot.lineage.replay_of_job_id).toBe(agentOneJob.id);

    const refreshedReplayJob = await getDecisionJobById(context, replayJob.id);
    const replayRequestInput = normalizeStoredRequestInput(refreshedReplayJob.request_input);
    expect(replayRequestInput.agent_id).toBe(agentOneId);

    const replayList = await listInferenceJobs(context, {
      agent_id: agentOneId,
      limit: 10
    });
    expect(replayList.items.every(item => item.actor_ref?.agent_id === agentOneId)).toBe(true);

    const paged = await listInferenceJobs(context, {
      agent_id: agentOneId,
      limit: 1
    });
    expect(paged.items).toHaveLength(1);
    if (paged.page_info.has_next_page) {
      expect(typeof paged.page_info.next_cursor).toBe('string');
      expect((paged.page_info.next_cursor ?? '').length).toBeGreaterThan(0);
    }
  });
});
