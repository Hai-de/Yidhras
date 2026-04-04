import { Prisma, PrismaClient } from '@prisma/client';

import type { AppContext, StartupHealth } from '../app/context.js';
import {
  buildInferenceJobReplaySubmitResult,
  buildInferenceJobRetryResult,
  buildInferenceJobSubmitResult,
  createPendingDecisionJob,
  getDecisionJobById,
  getWorkflowSnapshotByJobId,
  listInferenceJobs
} from '../app/services/inference_workflow.js';
import { ensureNonEmptyId, normalizeReplayInput, normalizeStoredRequestInput, parseInferenceJobsCursor } from '../app/services/inference_workflow/parsers.js';
import {
  buildInferenceJobReplayResult,
  getDecisionResultFromWorkflowSnapshot,
  resolveInferenceIdForSubmitResult,
  resolveResultSource
} from '../app/services/inference_workflow/results.js';
import { buildWorkflowSnapshot } from '../app/services/inference_workflow/snapshots.js';
import { ChronosEngine } from '../clock/engine.js';
import type { SimulationManager } from '../core/simulation.js';
import { notifications } from '../utils/notifications.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertThrows(fn: () => unknown, message: string): void {
  try {
    fn();
  } catch {
    return;
  }

  throw new Error(message);
}

const buildTestContext = (prisma: PrismaClient): AppContext => {
  let paused = false;
  let runtimeReady = true;

  const sim = {
    prisma,
    clock: new ChronosEngine([], 1000n),
    getStepTicks: () => 1n,
    step: async () => {},
    getActivePack: () => null,
    getRuntimeSpeedSnapshot: () => ({
      mode: 'fixed' as const,
      source: 'default' as const,
      configured_step_ticks: null,
      override_step_ticks: null,
      override_since: null,
      effective_step_ticks: '1'
    }),
    setRuntimeSpeedOverride: () => {},
    clearRuntimeSpeedOverride: () => {}
  } as unknown as SimulationManager;

  const startupHealth: StartupHealth = {
    level: 'ok',
    checks: {
      db: true,
      world_pack_dir: true,
      world_pack_available: true
    },
    available_world_packs: ['cyber_noir'],
    errors: []
  };

  return {
    prisma,
    sim,
    notifications,
    startupHealth,
    getRuntimeReady: () => runtimeReady,
    setRuntimeReady: ready => {
      runtimeReady = ready;
    },
    getPaused: () => paused,
    setPaused: next => {
      paused = next;
    },
    assertRuntimeReady: () => {}
  };
};

const createWorkflowJob = async (
  context: AppContext,
  input: {
    suffix: string;
    agentId: string;
    strategy: 'mock' | 'rule_based';
    scheduledForTick?: bigint | null;
  }
) => {
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

const testParsers = () => {
  const normalizedRequest = normalizeStoredRequestInput({
    agent_id: 'agent-001',
    strategy: 'mock',
    attributes: { source: 'test' },
    idempotency_key: 'job-1'
  });
  assert(normalizedRequest.agent_id === 'agent-001', 'normalizeStoredRequestInput should keep agent_id');
  assert(normalizedRequest.strategy === 'mock', 'normalizeStoredRequestInput should keep strategy');

  assertThrows(
    () => normalizeStoredRequestInput('invalid-request-input'),
    'normalizeStoredRequestInput should reject non-object payload'
  );

  const replayInput = normalizeReplayInput({
    reason: ' replay me ',
    idempotency_key: ' replay-key ',
    overrides: {
      strategy: 'rule_based',
      attributes: { mode: 'test' },
      agent_id: 'agent-001'
    }
  });
  assert(replayInput.reason === 'replay me', 'normalizeReplayInput should trim reason');
  assert(replayInput.idempotency_key === 'replay-key', 'normalizeReplayInput should trim idempotency_key');
  assert(replayInput.overrides?.strategy === 'rule_based', 'normalizeReplayInput should preserve strategy override');

  assertThrows(
    () => normalizeReplayInput({ overrides: { strategy: 'unsupported' as 'mock' } }),
    'normalizeReplayInput should reject unsupported strategy override'
  );

  const encodedCursor = Buffer.from(JSON.stringify({ created_at: '100', id: 'job-1' }), 'utf8').toString('base64url');
  const parsedCursor = parseInferenceJobsCursor(encodedCursor);
  assert(parsedCursor?.created_at === '100', 'parseInferenceJobsCursor should decode created_at');
  assert(parsedCursor?.id === 'job-1', 'parseInferenceJobsCursor should decode id');

  assertThrows(
    () => parseInferenceJobsCursor(Buffer.from(JSON.stringify({ created_at: 'invalid', id: '' }), 'utf8').toString('base64url')),
    'parseInferenceJobsCursor should reject invalid cursor payload'
  );

  assert(ensureNonEmptyId('  abc  ', 'job_id') === 'abc', 'ensureNonEmptyId should trim values');
  assertThrows(() => ensureNonEmptyId('   ', 'job_id'), 'ensureNonEmptyId should reject empty ids');
};

const testSnapshotDerivation = () => {
  const previewOnly = buildWorkflowSnapshot({
    trace: {
      id: 'trace-preview',
      kind: 'preview',
      strategy: 'mock',
      provider: 'mock',
      actor_ref: { agent_id: 'agent-001' },
      input: {},
      context_snapshot: {},
      prompt_bundle: {},
      trace_metadata: { tick: '1000' },
      decision: null,
      created_at: 1000n,
      updated_at: 1000n
    },
    job: null,
    intent: null
  });
  assert(previewOnly.derived.workflow_state === 'preview_only', 'preview trace without job should derive preview_only');

  const decisionPending = buildWorkflowSnapshot({
    trace: null,
    job: {
      id: 'job-pending',
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
      replay_of_job_id: null,
      replay_source_trace_id: null,
      replay_reason: null,
      replay_override_snapshot: null,
      pending_source_key: 'pending-key',
      source_inference_id: null,
      action_intent_id: null,
      job_type: 'inference_run',
      status: 'pending',
      attempt_count: 0,
      max_attempts: 3,
      request_input: { agent_id: 'agent-001' },
      last_error: null,
      last_error_code: null,
      last_error_stage: null,
      idempotency_key: 'job-pending-key',
      started_at: null,
      next_retry_at: null,
      intent_class: 'direct_inference',
      scheduled_for_tick: null,
      created_at: 1000n,
      updated_at: 1000n,
      completed_at: null
    },
    intent: null
  });
  assert(decisionPending.derived.workflow_state === 'decision_pending', 'pending job should derive decision_pending');
  assert(decisionPending.derived.decision_stage === 'queued', 'pending job should keep queued decision stage');

  const decisionRunning = buildWorkflowSnapshot({
    trace: null,
    job: {
      id: 'job-running',
      locked_by: 'worker-a',
      locked_at: 1000n,
      lock_expires_at: 1005n,
      replay_of_job_id: null,
      replay_source_trace_id: null,
      replay_reason: null,
      replay_override_snapshot: null,
      pending_source_key: null,
      source_inference_id: 'trace-running',
      action_intent_id: null,
      job_type: 'inference_run',
      status: 'running',
      attempt_count: 1,
      max_attempts: 3,
      request_input: { agent_id: 'agent-001' },
      last_error: null,
      last_error_code: null,
      last_error_stage: null,
      idempotency_key: 'job-running-key',
      started_at: 1000n,
      next_retry_at: null,
      intent_class: 'direct_inference',
      scheduled_for_tick: null,
      created_at: 1000n,
      updated_at: 1001n,
      completed_at: null
    },
    intent: null
  });
  assert(decisionRunning.derived.workflow_state === 'decision_running', 'running job should derive decision_running');

  const decisionFailed = buildWorkflowSnapshot({
    trace: null,
    job: {
      id: 'job-failed',
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
      replay_of_job_id: null,
      replay_source_trace_id: null,
      replay_reason: null,
      replay_override_snapshot: null,
      pending_source_key: null,
      source_inference_id: 'trace-1',
      action_intent_id: null,
      job_type: 'inference_run',
      status: 'failed',
      attempt_count: 1,
      max_attempts: 3,
      request_input: { agent_id: 'agent-001' },
      last_error: 'provider failed',
      last_error_code: 'INFERENCE_PROVIDER_FAIL',
      last_error_stage: 'provider',
      idempotency_key: 'job-failed-key',
      started_at: 1000n,
      next_retry_at: null,
      intent_class: 'direct_inference',
      scheduled_for_tick: null,
      created_at: 1000n,
      updated_at: 1001n,
      completed_at: null
    },
    intent: null
  });
  assert(decisionFailed.derived.workflow_state === 'decision_failed', 'failed job should derive decision_failed');
  assert(decisionFailed.derived.failure_stage === 'provider', 'failed job should expose provider failure stage');

  const dispatchPending = buildWorkflowSnapshot({
    trace: {
      id: 'trace-dispatch-pending',
      kind: 'run',
      strategy: 'mock',
      provider: 'mock',
      actor_ref: { agent_id: 'agent-001' },
      input: {},
      context_snapshot: {},
      prompt_bundle: {},
      trace_metadata: { tick: '1000' },
      decision: { action_type: 'post_message', payload: { content: 'hello' } },
      created_at: 1000n,
      updated_at: 1000n
    },
    job: {
      id: 'job-dispatch-pending',
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
      replay_of_job_id: null,
      replay_source_trace_id: null,
      replay_reason: null,
      replay_override_snapshot: null,
      pending_source_key: null,
      source_inference_id: 'trace-dispatch-pending',
      action_intent_id: null,
      job_type: 'inference_run',
      status: 'completed',
      attempt_count: 1,
      max_attempts: 3,
      request_input: { agent_id: 'agent-001' },
      last_error: null,
      last_error_code: null,
      last_error_stage: null,
      idempotency_key: 'job-dispatch-pending-key',
      started_at: 1000n,
      next_retry_at: null,
      intent_class: 'direct_inference',
      scheduled_for_tick: null,
      created_at: 1000n,
      updated_at: 1001n,
      completed_at: 1002n
    },
    intent: null
  });
  assert(dispatchPending.derived.workflow_state === 'dispatch_pending', 'completed decision without intent should derive dispatch_pending');

  const dispatching = buildWorkflowSnapshot({
    trace: null,
    job: {
      id: 'job-dispatching',
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
      replay_of_job_id: null,
      replay_source_trace_id: null,
      replay_reason: null,
      replay_override_snapshot: null,
      pending_source_key: null,
      source_inference_id: 'trace-dispatching',
      action_intent_id: 'intent-dispatching',
      job_type: 'inference_run',
      status: 'completed',
      attempt_count: 1,
      max_attempts: 3,
      request_input: { agent_id: 'agent-001' },
      last_error: null,
      last_error_code: null,
      last_error_stage: null,
      idempotency_key: 'job-dispatching-key',
      started_at: 1000n,
      next_retry_at: null,
      intent_class: 'direct_inference',
      scheduled_for_tick: null,
      created_at: 1000n,
      updated_at: 1001n,
      completed_at: 1002n
    },
    intent: {
      id: 'intent-dispatching',
      source_inference_id: 'trace-dispatching',
      intent_type: 'post_message',
      actor_ref: { agent_id: 'agent-001' },
      target_ref: null,
      payload: {},
      scheduled_after_ticks: null,
      scheduled_for_tick: null,
      status: 'dispatching',
      dispatch_started_at: 1002n,
      dispatched_at: null,
      transmission_delay_ticks: null,
      transmission_policy: 'reliable',
      transmission_drop_chance: 0,
      drop_reason: null,
      dispatch_error_code: null,
      dispatch_error_message: null,
      created_at: 1000n,
      updated_at: 1002n
    }
  });
  assert(dispatching.derived.workflow_state === 'dispatching', 'dispatching intent should derive dispatching state');

  const workflowCompleted = buildWorkflowSnapshot({
    trace: null,
    job: {
      id: 'job-complete',
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
      replay_of_job_id: null,
      replay_source_trace_id: null,
      replay_reason: null,
      replay_override_snapshot: null,
      pending_source_key: null,
      source_inference_id: 'trace-2',
      action_intent_id: 'intent-complete',
      job_type: 'inference_run',
      status: 'completed',
      attempt_count: 1,
      max_attempts: 3,
      request_input: { agent_id: 'agent-001' },
      last_error: null,
      last_error_code: null,
      last_error_stage: null,
      idempotency_key: 'job-complete-key',
      started_at: 1000n,
      next_retry_at: null,
      intent_class: 'direct_inference',
      scheduled_for_tick: null,
      created_at: 1000n,
      updated_at: 1001n,
      completed_at: 1002n
    },
    intent: {
      id: 'intent-complete',
      source_inference_id: 'trace-2',
      intent_type: 'post_message',
      actor_ref: { agent_id: 'agent-001' },
      target_ref: null,
      payload: {},
      scheduled_after_ticks: null,
      scheduled_for_tick: null,
      status: 'completed',
      dispatch_started_at: 1001n,
      dispatched_at: 1002n,
      transmission_delay_ticks: null,
      transmission_policy: 'reliable',
      transmission_drop_chance: 0,
      drop_reason: null,
      dispatch_error_code: null,
      dispatch_error_message: null,
      created_at: 1000n,
      updated_at: 1002n
    }
  });
  assert(workflowCompleted.derived.workflow_state === 'workflow_completed', 'completed intent should derive workflow_completed');

  const workflowDropped = buildWorkflowSnapshot({
    trace: null,
    job: {
      id: 'job-dropped',
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
      replay_of_job_id: null,
      replay_source_trace_id: null,
      replay_reason: null,
      replay_override_snapshot: null,
      pending_source_key: null,
      source_inference_id: 'trace-3',
      action_intent_id: 'intent-dropped',
      job_type: 'inference_run',
      status: 'completed',
      attempt_count: 1,
      max_attempts: 3,
      request_input: { agent_id: 'agent-001' },
      last_error: null,
      last_error_code: null,
      last_error_stage: null,
      idempotency_key: 'job-dropped-key',
      started_at: 1000n,
      next_retry_at: null,
      intent_class: 'direct_inference',
      scheduled_for_tick: null,
      created_at: 1000n,
      updated_at: 1001n,
      completed_at: 1002n
    },
    intent: {
      id: 'intent-dropped',
      source_inference_id: 'trace-3',
      intent_type: 'post_message',
      actor_ref: { agent_id: 'agent-001' },
      target_ref: null,
      payload: {},
      scheduled_after_ticks: null,
      scheduled_for_tick: null,
      status: 'dropped',
      dispatch_started_at: null,
      dispatched_at: null,
      transmission_delay_ticks: null,
      transmission_policy: 'fragile',
      transmission_drop_chance: 0.5,
      drop_reason: 'probabilistic_drop',
      dispatch_error_code: null,
      dispatch_error_message: null,
      created_at: 1000n,
      updated_at: 1002n
    }
  });
  assert(workflowDropped.derived.workflow_state === 'workflow_dropped', 'dropped intent should derive workflow_dropped');

  const workflowFailed = buildWorkflowSnapshot({
    trace: null,
    job: {
      id: 'job-workflow-failed',
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
      replay_of_job_id: null,
      replay_source_trace_id: null,
      replay_reason: null,
      replay_override_snapshot: null,
      pending_source_key: null,
      source_inference_id: 'trace-workflow-failed',
      action_intent_id: 'intent-workflow-failed',
      job_type: 'inference_run',
      status: 'completed',
      attempt_count: 1,
      max_attempts: 3,
      request_input: { agent_id: 'agent-001' },
      last_error: null,
      last_error_code: null,
      last_error_stage: null,
      idempotency_key: 'job-workflow-failed-key',
      started_at: 1000n,
      next_retry_at: null,
      intent_class: 'direct_inference',
      scheduled_for_tick: null,
      created_at: 1000n,
      updated_at: 1001n,
      completed_at: 1002n
    },
    intent: {
      id: 'intent-workflow-failed',
      source_inference_id: 'trace-workflow-failed',
      intent_type: 'post_message',
      actor_ref: { agent_id: 'agent-001' },
      target_ref: null,
      payload: {},
      scheduled_after_ticks: null,
      scheduled_for_tick: null,
      status: 'failed',
      dispatch_started_at: 1001n,
      dispatched_at: null,
      transmission_delay_ticks: null,
      transmission_policy: 'fragile',
      transmission_drop_chance: 0.2,
      drop_reason: null,
      dispatch_error_code: 'ACTION_DISPATCH_FAIL',
      dispatch_error_message: 'dispatch exploded',
      created_at: 1000n,
      updated_at: 1002n
    }
  });
  assert(workflowFailed.derived.workflow_state === 'workflow_failed', 'failed intent dispatch should derive workflow_failed');
  assert(workflowFailed.derived.failure_stage === 'dispatch', 'dispatch failure should expose dispatch failure stage');
};

const testResultBuilders = async (context: AppContext) => {
  const job = await createWorkflowJob(context, {
    suffix: 'results-base',
    agentId: 'agent-003',
    strategy: 'mock'
  });

  const noResultWorkflow = buildWorkflowSnapshot({
    trace: null,
    job,
    intent: null
  });

  assert(resolveResultSource(false, null) === 'not_available', 'missing fresh result should resolve to not_available');
  assert(resolveResultSource(true, { inference_id: 'trace-x', actor_ref: { identity_id: 'agent-003', identity_type: 'agent', role: 'active', agent_id: 'agent-003', atmosphere_node_id: null }, strategy: 'mock', provider: 'mock', tick: '1000', decision: { action_type: 'noop', target_ref: null, payload: {} }, trace_metadata: { inference_id: 'trace-x', world_pack_id: 'world', binding_ref: null, prompt_version: null, tick: '1000', strategy: 'mock', provider: 'mock' } }) === 'stored_trace', 'replayed result with trace should resolve to stored_trace');
  assert(resolveInferenceIdForSubmitResult(noResultWorkflow, job) === job.pending_source_key, 'submit result should fall back to pending source key when no trace exists');
  assert(getDecisionResultFromWorkflowSnapshot(noResultWorkflow) === null, 'workflow without trace decision should not expose decision result');

  const submitResult = buildInferenceJobSubmitResult(job, null, noResultWorkflow, false);
  assert(submitResult.result_source === 'not_available', 'fresh submit without result should stay not_available');
  assert(submitResult.result === null, 'fresh submit without result should keep null result');

  const traceId = `trace-result-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const tick = 3000n;
  await context.prisma.inferenceTrace.create({
    data: {
      id: traceId,
      kind: 'run',
      strategy: 'mock',
      provider: 'mock',
      actor_ref: { agent_id: 'agent-003', identity_id: 'agent-003' } as Prisma.InputJsonValue,
      input: { agent_id: 'agent-003' } as Prisma.InputJsonValue,
      context_snapshot: {} as Prisma.InputJsonValue,
      prompt_bundle: {} as Prisma.InputJsonValue,
      trace_metadata: {
        inference_id: traceId,
        tick: tick.toString(),
        strategy: 'mock',
        provider: 'mock',
        world_pack_id: 'cyber_noir',
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
      actor_ref: { agent_id: 'agent-003', identity_id: 'agent-003' } as Prisma.InputJsonValue,
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
  assert(decisionResult?.inference_id === traceId, 'workflow snapshot should rebuild inference run result from trace');

  const replayResult = await buildInferenceJobReplayResult(completedJob, completedWorkflow);
  assert(replayResult.result_source === 'stored_trace', 'replay result should mark stored_trace source when trace exists');
  assert(replayResult.result?.inference_id === traceId, 'replay result should expose stored trace payload');

  const retryResult = buildInferenceJobRetryResult(completedJob, decisionResult!, completedWorkflow);
  assert(retryResult.result_source === 'fresh_run', 'retry result should mark fresh_run source');
  assert(retryResult.result?.inference_id === traceId, 'retry result should expose fresh run payload');

  const replayChild = await createPendingDecisionJob(context, {
    idempotency_key: `workflow-core-results-replay-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    request_input: {
      agent_id: 'agent-003',
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

  const replayChildWorkflow = await getWorkflowSnapshotByJobId(context, replayChild.id);
  const replaySubmitResult = buildInferenceJobReplaySubmitResult(await getDecisionJobById(context, replayChild.id), replayChildWorkflow);
  assert(replaySubmitResult.result_source === 'not_available', 'replay submit without trace result should stay not_available');
  assert(replaySubmitResult.replay.source_job_id === completedJob.id, 'replay submit should expose parent job id');
  assert(replaySubmitResult.replay.override_applied === true, 'replay submit should expose override_applied');
};

const testListInferenceJobs = async (context: AppContext) => {
  const agentOneJob = await createWorkflowJob(context, {
    suffix: 'agent-one',
    agentId: 'agent-001',
    strategy: 'mock'
  });
  const agentTwoJob = await createWorkflowJob(context, {
    suffix: 'agent-two',
    agentId: 'agent-002',
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
      actor_ref: { agent_id: 'agent-001', identity_id: 'agent-001' } as Prisma.InputJsonValue,
      input: { agent_id: 'agent-001' } as Prisma.InputJsonValue,
      context_snapshot: {} as Prisma.InputJsonValue,
      prompt_bundle: {} as Prisma.InputJsonValue,
      trace_metadata: { tick: traceTick.toString(), strategy: 'mock', provider: 'mock' } as Prisma.InputJsonValue,
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
      actor_ref: { agent_id: 'agent-001', identity_id: 'agent-001' } as Prisma.InputJsonValue,
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

  const replayJob = await createWorkflowJob(context, {
    suffix: 'replay-child',
    agentId: 'agent-001',
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
    agent_id: 'agent-001',
    limit: 10
  });
  assert(listByAgent.items.length >= 2, 'listInferenceJobs should return agent-001 jobs with batch snapshot assembly');
  assert(listByAgent.items.every(item => item.actor_ref?.agent_id === 'agent-001'), 'agent filter should keep only matching actor_ref.agent_id');

  const listByIdentity = await listInferenceJobs(context, {
    identity_id: 'agent-001',
    limit: 10
  });
  assert(listByIdentity.items.length >= 1, 'identity_id filter should keep matching workflow items');
  assert(listByIdentity.items.every(item => item.actor_ref?.identity_id === 'agent-001'), 'identity_id filter should use actor_ref/request_input fallback');

  const listByStrategy = await listInferenceJobs(context, {
    strategy: 'rule_based',
    agent_id: 'agent-002',
    limit: 10
  });
  assert(listByStrategy.items.some(item => item.id === agentTwoJob.id), 'strategy filter should include the targeted rule_based failed job');
  assert(listByStrategy.items.every(item => item.strategy === 'rule_based'), 'strategy filter should only keep rule_based jobs');

  const listByStatus = await listInferenceJobs(context, {
    status: ['failed'],
    agent_id: 'agent-002',
    limit: 10
  });
  assert(listByStatus.items.some(item => item.id === agentTwoJob.id), 'status filter should include the targeted failed job');
  assert(listByStatus.items.every(item => item.status === 'failed'), 'status filter should only return failed jobs');

  const listFailed = await listInferenceJobs(context, {
    has_error: true,
    agent_id: 'agent-002',
    limit: 10
  });
  assert(listFailed.items.some(item => item.id === agentTwoJob.id), 'has_error filter should include failed job');
  assert(listFailed.items.every(item => item.last_error !== null), 'has_error filter should only return items with last_error');

  const listByIntent = await listInferenceJobs(context, {
    action_intent_id: intentId,
    limit: 10
  });
  assert(listByIntent.items.length === 1, 'action_intent_id filter should isolate the linked job');
  assert(listByIntent.items[0]?.id === agentOneJob.id, 'action_intent_id filter should return the expected job');
  assert(listByIntent.items[0]?.workflow.workflow_state === 'workflow_completed', 'completed intent should keep workflow state in list item');

  const workflowSnapshot = await getWorkflowSnapshotByJobId(context, replayJob.id);
  assert(workflowSnapshot.lineage.replay_of_job_id === agentOneJob.id, 'replay child workflow should expose replay_of_job_id');

  const refreshedReplayJob = await getDecisionJobById(context, replayJob.id);
  const replayRequestInput = normalizeStoredRequestInput(refreshedReplayJob.request_input);
  assert(replayRequestInput.agent_id === 'agent-001', 'replay child request_input should keep agent fallback source');

  const replayList = await listInferenceJobs(context, {
    agent_id: 'agent-001',
    limit: 10
  });
  assert(
    replayList.items.every(item => item.actor_ref?.agent_id === 'agent-001'),
    'batch list should preserve request_input/actor_ref fallback under bundle assembly'
  );

  const paged = await listInferenceJobs(context, {
    agent_id: 'agent-001',
    limit: 1
  });
  assert(paged.items.length === 1, 'limit should constrain page size');
  if (paged.page_info.has_next_page) {
    assert(typeof paged.page_info.next_cursor === 'string' && paged.page_info.next_cursor.length > 0, 'next_cursor should exist when has_next_page=true');
  }
};

const main = async () => {
  const prisma = new PrismaClient();
  const context = buildTestContext(prisma);

  try {
    testParsers();
    testSnapshotDerivation();
    await testResultBuilders(context);
    await testListInferenceJobs(context);

    console.log('[inference_workflow_core] PASS');
  } catch (error: unknown) {
    console.error('[inference_workflow_core] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

void main();
