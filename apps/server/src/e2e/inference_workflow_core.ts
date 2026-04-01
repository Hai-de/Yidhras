import { Prisma, PrismaClient } from '@prisma/client';

import type { AppContext, StartupHealth } from '../app/context.js';
import {
  createPendingDecisionJob,
  getDecisionJobById,
  getWorkflowSnapshotByJobId,
  listInferenceJobs
} from '../app/services/inference_workflow.js';
import { ensureNonEmptyId, normalizeReplayInput, normalizeStoredRequestInput, parseInferenceJobsCursor } from '../app/services/inference_workflow/parsers.js';
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
      source_inference_id: `pending_${replayJob.idempotency_key}`
    }
  });

  const listByAgent = await listInferenceJobs(context, {
    agent_id: 'agent-001',
    limit: 10
  });
  assert(listByAgent.items.length >= 2, 'listInferenceJobs should return agent-001 jobs with batch snapshot assembly');
  assert(listByAgent.items.every(item => item.actor_ref?.agent_id === 'agent-001'), 'agent filter should keep only matching actor_ref.agent_id');

  const listFailed = await listInferenceJobs(context, {
    has_error: true,
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
