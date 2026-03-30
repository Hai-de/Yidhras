import { Prisma } from '@prisma/client';

import type {
  InferenceActionIntentSnapshot,
  InferenceActionIntentStatus,
  InferenceJobReplayInput,
  InferenceJobReplaySubmitResult,
  InferenceJobResultSource,
  InferenceJobRetryResult,
  InferenceJobSnapshot,
  InferenceJobStatus,
  InferenceJobSubmitResult,
  InferenceRequestInput,
  InferenceRunResult,
  InferenceTraceRecordSnapshot,
  WorkflowDecisionJobSnapshot,
  WorkflowDispatchStage,
  WorkflowFailureStage,
  WorkflowOutcomeSummary,
  WorkflowSnapshot,
  WorkflowState
} from '../../inference/types.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';
import { toJsonSafe } from '../http/json.js';

export interface DecisionJobRecord {
  id: string;
  locked_by: string | null;
  locked_at: bigint | null;
  lock_expires_at: bigint | null;
  replay_of_job_id: string | null;
  replay_source_trace_id: string | null;
  replay_reason: string | null;
  replay_override_snapshot: unknown;
  source_inference_id: string | null;
  action_intent_id: string | null;
  job_type: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  request_input: unknown;
  last_error: string | null;
  last_error_code: string | null;
  last_error_stage: string | null;
  idempotency_key: string | null;
  started_at: bigint | null;
  next_retry_at: bigint | null;
  created_at: bigint;
  updated_at: bigint;
  completed_at: bigint | null;
}

interface InferenceTraceRecord {
  id: string;
  kind: string;
  strategy: string;
  provider: string;
  actor_ref: unknown;
  input: unknown;
  context_snapshot: unknown;
  prompt_bundle: unknown;
  trace_metadata: unknown;
  decision: unknown;
  created_at: bigint;
  updated_at: bigint;
}

interface ActionIntentRecord {
  id: string;
  source_inference_id: string;
  intent_type: string;
  actor_ref: unknown;
  target_ref: unknown;
  payload: unknown;
  scheduled_after_ticks: bigint | null;
  scheduled_for_tick: bigint | null;
  status: string;
  dispatch_started_at: bigint | null;
  dispatched_at: bigint | null;
  transmission_delay_ticks: bigint | null;
  transmission_policy: string;
  transmission_drop_chance: number;
  drop_reason: string | null;
  dispatch_error_code: string | null;
  dispatch_error_message: string | null;
  created_at: bigint;
  updated_at: bigint;
}

const RUNNABLE_JOB_STATUSES = ['pending', 'running'] as const;
const INFERENCE_JOB_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;
const ACTION_INTENT_STATUSES = ['pending', 'dispatching', 'completed', 'failed', 'dropped'] as const;
export const DEFAULT_DECISION_JOB_LOCK_TICKS = 5n;


const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const toRecord = (value: unknown): Record<string, unknown> => {
  return isRecord(value) ? value : {};
};

const normalizeJobStatus = (status: string): InferenceJobStatus => {
  return (INFERENCE_JOB_STATUSES as readonly string[]).includes(status) ? (status as InferenceJobStatus) : 'failed';
};

const normalizeIntentStatus = (status: string): InferenceActionIntentStatus => {
  return (ACTION_INTENT_STATUSES as readonly string[]).includes(status)
    ? (status as InferenceActionIntentStatus)
    : 'failed';
};

const ensureNonEmptyId = (value: string | undefined, fieldName: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(400, 'INFERENCE_INPUT_INVALID', `${fieldName} is required`);
  }

  return value.trim();
};

const toTickString = (value: bigint | null): string | null => {
  return value === null ? null : value.toString();
};

const toReplayLineageParentSnapshot = (job: DecisionJobRecord | null) => {
  if (!job) {
    return null;
  }

  return {
    id: job.id,
    status: normalizeJobStatus(job.status),
    created_at: job.created_at.toString(),
    completed_at: toTickString(job.completed_at)
  };
};

const toReplayLineageChildSnapshots = (jobs: DecisionJobRecord[]) => {
  return jobs.map(job => ({
    id: job.id,
    status: normalizeJobStatus(job.status),
    created_at: job.created_at.toString(),
    replay_reason: job.replay_reason
  }));
};

const normalizeStoredRequestInput = (value: unknown): InferenceRequestInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(500, 'INFERENCE_INPUT_INVALID', 'Persisted job request_input must be an object');
  }

  const record = value as Record<string, unknown>;
  return {
    agent_id: typeof record.agent_id === 'string' ? record.agent_id : undefined,
    identity_id: typeof record.identity_id === 'string' ? record.identity_id : undefined,
    strategy: typeof record.strategy === 'string' ? record.strategy : undefined,
    attributes:
      record.attributes && typeof record.attributes === 'object' && !Array.isArray(record.attributes)
        ? (record.attributes as Record<string, unknown>)
        : undefined,
    idempotency_key: typeof record.idempotency_key === 'string' ? record.idempotency_key : undefined
  };
};

export const toInferenceJobSnapshot = (job: DecisionJobRecord): InferenceJobSnapshot => {
  return {
    id: job.id,
    source_inference_id: job.source_inference_id ?? '',
    action_intent_id: job.action_intent_id,
    job_type: job.job_type,
    status: normalizeJobStatus(job.status),
    attempt_count: job.attempt_count,
    max_attempts: job.max_attempts,
    last_error: job.last_error,
    idempotency_key: job.idempotency_key,
    created_at: job.created_at.toString(),
    updated_at: job.updated_at.toString(),
    completed_at: toTickString(job.completed_at)
  };
};

export const toWorkflowDecisionJobSnapshot = (job: DecisionJobRecord): WorkflowDecisionJobSnapshot => {
  return {
    ...toInferenceJobSnapshot(job),
    last_error: job.last_error,
    idempotency_key: job.idempotency_key,
    request_input: isRecord(job.request_input) ? toRecord(toJsonSafe(job.request_input)) : null,
    started_at: toTickString(job.started_at),
    next_retry_at: toTickString(job.next_retry_at),
    replay_of_job_id: job.replay_of_job_id,
    replay_source_trace_id: job.replay_source_trace_id,
    replay_reason: job.replay_reason,
    replay_override_snapshot: isRecord(job.replay_override_snapshot) ? toRecord(toJsonSafe(job.replay_override_snapshot)) : null,
    last_error_code: (job.last_error_code as WorkflowDecisionJobSnapshot['last_error_code']) ?? null,
    locked_by: job.locked_by,
    locked_at: toTickString(job.locked_at),
    lock_expires_at: toTickString(job.lock_expires_at),
    last_error_stage: (job.last_error_stage as WorkflowDecisionJobSnapshot['last_error_stage']) ?? null
  };
};

export const toInferenceTraceRecordSnapshot = (
  trace: InferenceTraceRecord | null
): InferenceTraceRecordSnapshot | null => {
  if (!trace) {
    return null;
  }

  return {
    id: trace.id,
    kind: trace.kind,
    strategy: trace.strategy,
    provider: trace.provider,
    actor_ref: toRecord(toJsonSafe(trace.actor_ref)),
    input: toRecord(toJsonSafe(trace.input)),
    context_snapshot: toRecord(toJsonSafe(trace.context_snapshot)),
    prompt_bundle: toRecord(toJsonSafe(trace.prompt_bundle)),
    trace_metadata: toRecord(toJsonSafe(trace.trace_metadata)),
    decision: trace.decision ? toRecord(toJsonSafe(trace.decision)) : null,
    created_at: trace.created_at.toString(),
    updated_at: trace.updated_at.toString()
  };
};

export const toInferenceActionIntentSnapshot = (
  intent: ActionIntentRecord | null
): InferenceActionIntentSnapshot | null => {
  if (!intent) {
    return null;
  }

  const transmissionPolicy =
    intent.transmission_policy === 'best_effort' ||
    intent.transmission_policy === 'fragile' ||
    intent.transmission_policy === 'blocked'
      ? intent.transmission_policy
      : 'reliable';

  return {
    id: intent.id,
    source_inference_id: intent.source_inference_id,
    intent_type: intent.intent_type,
    actor_ref: toRecord(toJsonSafe(intent.actor_ref)),
    target_ref: isRecord(toJsonSafe(intent.target_ref)) ? toRecord(toJsonSafe(intent.target_ref)) : null,
    payload: toRecord(toJsonSafe(intent.payload)),
    scheduled_after_ticks: toTickString(intent.scheduled_after_ticks),
    scheduled_for_tick: toTickString(intent.scheduled_for_tick),
    status: normalizeIntentStatus(intent.status),
    dispatch_started_at: toTickString(intent.dispatch_started_at),
    dispatched_at: toTickString(intent.dispatched_at),
    transmission_delay_ticks: toTickString(intent.transmission_delay_ticks),
    transmission_policy: transmissionPolicy,
    transmission_drop_chance: intent.transmission_drop_chance,
    drop_reason: intent.status === 'failed' ? intent.dispatch_error_message : intent.drop_reason,
    dispatch_error_code: (intent.dispatch_error_code as InferenceActionIntentSnapshot['dispatch_error_code']) ?? null,
    dispatch_error_message: intent.dispatch_error_message,
    created_at: intent.created_at.toString(),
    updated_at: intent.updated_at.toString()
  };
};

const deriveWorkflowFailureStage = (
  job: WorkflowDecisionJobSnapshot | null,
  intent: InferenceActionIntentSnapshot | null
): { stage: WorkflowFailureStage; code: string | null; reason: string | null } => {
  if (job?.status === 'failed') {
    return {
      stage: job.last_error_stage === 'provider' || job.last_error_stage === 'normalization' || job.last_error_stage === 'persistence'
        ? job.last_error_stage
        : 'unknown',
      code: job.last_error_code ?? 'UNKNOWN_WORKFLOW_FAILURE',
      reason: job.last_error
    };
  }

  if (intent?.status === 'failed') {
    return {
      stage: 'dispatch',
      code: intent.dispatch_error_code ?? 'ACTION_DISPATCH_FAIL',
      reason: intent.dispatch_error_message ?? null
    };
  }

  return { stage: 'none', code: null, reason: intent?.status === 'dropped' ? intent.drop_reason : null };
};

const deriveWorkflowDispatchStage = (intent: InferenceActionIntentSnapshot | null): WorkflowDispatchStage => {
  if (!intent) {
    return 'not_requested';
  }

  switch (intent.status) {
    case 'pending':
      return 'pending';
    case 'dispatching':
      return 'dispatching';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'dropped':
      return 'dropped';
    default:
      return 'failed';
  }
};

const deriveWorkflowOutcomeSummary = (workflowState: WorkflowState): WorkflowOutcomeSummary => {
  switch (workflowState) {
    case 'preview_only':
      return { kind: 'preview_only', message: 'Preview trace exists without a persisted execution workflow' };
    case 'decision_pending':
      return { kind: 'decision_pending', message: 'Decision job is queued and has not completed yet' };
    case 'decision_running':
      return { kind: 'decision_running', message: 'Decision job is currently running' };
    case 'decision_failed':
      return { kind: 'decision_failed', message: 'Decision generation failed before dispatch could complete' };
    case 'dispatch_pending':
      return { kind: 'dispatch_pending', message: 'Decision completed and dispatch is pending' };
    case 'dispatching':
      return { kind: 'dispatching', message: 'World-side dispatch is in progress' };
    case 'workflow_completed':
      return { kind: 'completed', message: 'Workflow completed and world-side action was materialized' };
    case 'workflow_dropped':
      return { kind: 'dropped', message: 'Workflow ended in an intentional drop before world-side materialization' };
    case 'workflow_failed':
      return { kind: 'failed', message: 'Workflow failed during world-side dispatch' };
  }
};

export const buildWorkflowSnapshot = (input: {
  trace: InferenceTraceRecord | null;
  job: DecisionJobRecord | null;
  intent: ActionIntentRecord | null;
  replayParentJob?: DecisionJobRecord | null;
  replayChildJobs?: DecisionJobRecord[];
}): WorkflowSnapshot => {
  const trace = toInferenceTraceRecordSnapshot(input.trace);
  const job = input.job ? toWorkflowDecisionJobSnapshot(input.job) : null;
  const intent = toInferenceActionIntentSnapshot(input.intent);

  const decisionStage = !job
    ? trace?.kind === 'preview'
      ? 'preview_only'
      : 'queued'
    : job.status === 'pending'
      ? 'queued'
      : job.status === 'running'
        ? 'running'
        : job.status === 'failed'
          ? 'failed'
          : 'completed';

  const dispatchStage = deriveWorkflowDispatchStage(intent);
  const failure = deriveWorkflowFailureStage(job, intent);

  let workflowState: WorkflowState;
  if (decisionStage === 'preview_only') {
    workflowState = 'preview_only';
  } else if (decisionStage === 'queued') {
    workflowState = 'decision_pending';
  } else if (decisionStage === 'running') {
    workflowState = 'decision_running';
  } else if (decisionStage === 'failed') {
    workflowState = 'decision_failed';
  } else if (dispatchStage === 'not_requested' || dispatchStage === 'pending') {
    workflowState = 'dispatch_pending';
  } else if (dispatchStage === 'dispatching') {
    workflowState = 'dispatching';
  } else if (dispatchStage === 'completed') {
    workflowState = 'workflow_completed';
  } else if (dispatchStage === 'dropped') {
    workflowState = 'workflow_dropped';
  } else {
    workflowState = 'workflow_failed';
  }

  return {
    records: {
      trace,
      job,
      intent
    },
    lineage: {
      replay_of_job_id: input.job?.replay_of_job_id ?? null,
      replay_source_trace_id: input.job?.replay_source_trace_id ?? null,
      replay_reason: input.job?.replay_reason ?? null,
      override_applied: isRecord(input.job?.replay_override_snapshot),
      override_snapshot: isRecord(input.job?.replay_override_snapshot)
        ? toRecord(toJsonSafe(input.job?.replay_override_snapshot))
        : null,
      parent_job: toReplayLineageParentSnapshot(input.replayParentJob ?? null),
      child_jobs: toReplayLineageChildSnapshots(input.replayChildJobs ?? [])
    },
    derived: {
      decision_stage: decisionStage,
      dispatch_stage: dispatchStage,
      workflow_state: workflowState,
      failure_stage: failure.stage,
      failure_code: failure.code as WorkflowSnapshot['derived']['failure_code'],
      failure_reason: failure.reason,
      outcome_summary: deriveWorkflowOutcomeSummary(workflowState)
    }
  };
};

const resolveInferenceIdForSubmitResult = (
  workflowSnapshot: WorkflowSnapshot,
  job: DecisionJobRecord
): string => {
  return (
    workflowSnapshot.records.trace?.id ??
    workflowSnapshot.records.job?.source_inference_id ??
    job.source_inference_id ??
    (job.idempotency_key ? `pending_${job.idempotency_key}` : job.id)
  );
};

const resolveResultSource = (
  replayed: boolean,
  result: InferenceRunResult | null
): InferenceJobResultSource => {
  if (!result) {
    return 'not_available';
  }

  return replayed ? 'stored_trace' : 'fresh_run';
};

const getDecisionResultFromWorkflowSnapshot = (workflowSnapshot: WorkflowSnapshot): InferenceRunResult | null => {
  const trace = workflowSnapshot.records.trace;
  if (!trace?.decision || !trace.trace_metadata) {
    return null;
  }

  return buildInferenceRunResultFromTrace({
    id: trace.id,
    strategy: trace.strategy,
    provider: trace.provider,
    actor_ref: trace.actor_ref,
    trace_metadata: trace.trace_metadata,
    decision: trace.decision
  });
};

const buildInferenceRunResultFromTrace = (trace: {
  id: string;
  strategy: string;
  provider: string;
  actor_ref: unknown;
  trace_metadata: unknown;
  decision: unknown;
} | null): InferenceRunResult | null => {
  if (!trace?.decision || !trace.trace_metadata) {
    return null;
  }

  const traceMetadata = toJsonSafe(trace.trace_metadata) as InferenceRunResult['trace_metadata'];

  return {
    inference_id: trace.id,
    actor_ref: toJsonSafe(trace.actor_ref) as InferenceRunResult['actor_ref'],
    strategy: trace.strategy as InferenceRunResult['strategy'],
    provider: trace.provider,
    tick: typeof traceMetadata.tick === 'string' ? traceMetadata.tick : '',
    decision: toJsonSafe(trace.decision) as InferenceRunResult['decision'],
    trace_metadata: traceMetadata
  };
};

export const getInferenceTraceById = async (context: AppContext, inferenceId?: string) => {
  const id = ensureNonEmptyId(inferenceId, 'inference_id');
  const trace = await context.prisma.inferenceTrace.findUnique({
    where: { id }
  });

  if (!trace) {
    throw new ApiError(404, 'INFERENCE_TRACE_NOT_FOUND', 'Inference trace not found', {
      inference_id: id
    });
  }

  return trace;
};

export const getActionIntentByInferenceId = async (context: AppContext, inferenceId?: string) => {
  const id = ensureNonEmptyId(inferenceId, 'inference_id');
  const actionIntent = await context.prisma.actionIntent.findUnique({
    where: {
      source_inference_id: id
    }
  });

  if (!actionIntent) {
    throw new ApiError(404, 'ACTION_INTENT_NOT_FOUND', 'Action intent not found', {
      inference_id: id
    });
  }

  return actionIntent;
};

export const getDecisionJobByInferenceId = async (context: AppContext, inferenceId?: string) => {
  const id = ensureNonEmptyId(inferenceId, 'inference_id');
  const decisionJob = await context.prisma.decisionJob.findUnique({
    where: {
      source_inference_id: id
    }
  });

  if (!decisionJob) {
    throw new ApiError(404, 'DECISION_JOB_NOT_FOUND', 'Decision job not found', {
      inference_id: id
    });
  }

  return decisionJob;
};

export const getDecisionJobById = async (context: AppContext, jobId?: string) => {
  const id = ensureNonEmptyId(jobId, 'job_id');
  const job = await context.prisma.decisionJob.findUnique({
    where: {
      id
    }
  });

  if (!job) {
    throw new ApiError(404, 'DECISION_JOB_NOT_FOUND', 'Decision job not found', {
      job_id: id
    });
  }

  return job;
};

export const getDecisionJobRequestInput = (job: DecisionJobRecord): InferenceRequestInput => {
  return normalizeStoredRequestInput(job.request_input);
};

export const listRunnableDecisionJobs = async (
  context: AppContext,
  limit = 10
): Promise<DecisionJobRecord[]> => {
  const now = context.sim.clock.getTicks();

  return context.prisma.decisionJob.findMany({
    where: {
      status: {
        in: [...RUNNABLE_JOB_STATUSES]
      },
      OR: [
        { next_retry_at: null },
        { next_retry_at: { lte: now } }
      ],
      AND: [
        {
          OR: [
            { locked_by: null },
            { lock_expires_at: null },
            { lock_expires_at: { lte: now } }
          ]
        }
      ]
    },
    orderBy: {
      updated_at: 'asc'
    },
    take: limit
  });
};

export const claimDecisionJob = async (
  context: AppContext,
  input: {
    job_id: string;
    worker_id: string;
    now?: bigint;
    lock_ticks?: bigint;
  }
): Promise<DecisionJobRecord | null> => {
  const existing = await getDecisionJobById(context, input.job_id);
  const now = input.now ?? context.sim.clock.getTicks();
  const lockTicks = input.lock_ticks ?? DEFAULT_DECISION_JOB_LOCK_TICKS;

  if (!RUNNABLE_JOB_STATUSES.includes(existing.status as (typeof RUNNABLE_JOB_STATUSES)[number])) {
    return null;
  }

  if (existing.next_retry_at !== null && existing.next_retry_at > now) {
    return null;
  }

  const claimable = existing.locked_by === null || existing.lock_expires_at === null || existing.lock_expires_at <= now;
  if (!claimable) {
    return null;
  }

  const shouldIncrementAttempt = existing.status === 'pending';
  const claimResult = await context.prisma.decisionJob.updateMany({
    where: {
      id: existing.id,
      status: {
        in: [...RUNNABLE_JOB_STATUSES]
      },
      OR: [
        { next_retry_at: null },
        { next_retry_at: { lte: now } }
      ],
      AND: [
        {
          OR: [
            { locked_by: null },
            { lock_expires_at: null },
            { lock_expires_at: { lte: now } }
          ]
        }
      ]
    },
    data: {
      status: 'running',
      locked_by: input.worker_id,
      locked_at: now,
      lock_expires_at: now + lockTicks,
      started_at: existing.started_at ?? now,
      updated_at: now,
      next_retry_at: null,
      attempt_count: shouldIncrementAttempt ? existing.attempt_count + 1 : existing.attempt_count
    }
  });

  if (claimResult.count === 0) {
    return null;
  }

  return getDecisionJobById(context, existing.id);
};

export const releaseDecisionJobLock = async (
  context: AppContext,
  input: {
    job_id: string;
    worker_id?: string;
  }
): Promise<DecisionJobRecord> => {
  const existing = await getDecisionJobById(context, input.job_id);
  if (input.worker_id && existing.locked_by !== input.worker_id) {
    return existing;
  }

  return context.prisma.decisionJob.update({
    where: {
      id: existing.id
    },
    data: {
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
      updated_at: context.sim.clock.getTicks()
    }
  });
};

export const assertDecisionJobLockOwnership = (
  job: DecisionJobRecord,
  workerId: string,
  now: bigint
): void => {
  if (job.status !== 'running' || job.locked_by !== workerId || job.lock_expires_at === null || job.lock_expires_at < now) {
    throw new ApiError(409, 'DECISION_JOB_NOT_FOUND', 'Decision job lock ownership is invalid', {
      job_id: job.id,
      worker_id: workerId
    });
  }
};

export const getDecisionJobByIdempotencyKey = async (
  context: AppContext,
  idempotencyKey: string
): Promise<DecisionJobRecord | null> => {
  return context.prisma.decisionJob.findUnique({
    where: {
      idempotency_key: idempotencyKey
    }
  });
};

export const createPendingDecisionJob = async (
  context: AppContext,
  input: {
    idempotency_key: string;
    request_input: InferenceRequestInput;
    max_attempts?: number;
  }
): Promise<DecisionJobRecord> => {
  const now = context.sim.clock.getTicks();

  return context.prisma.decisionJob.create({
    data: {
      source_inference_id: `pending_${input.idempotency_key}`,
      job_type: 'inference_run',
      status: 'pending',
      idempotency_key: input.idempotency_key,
      attempt_count: 0,
      max_attempts: input.max_attempts ?? 3,
      request_input: toJsonSafe(input.request_input) as Prisma.InputJsonValue,
      last_error: null,
      started_at: null,
      replay_of_job_id: null,
      replay_source_trace_id: null,
      replay_reason: null,
      replay_override_snapshot: Prisma.JsonNull,
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
      next_retry_at: null,
      created_at: now,
      updated_at: now,
      completed_at: null
    }
  });
};

export const createReplayDecisionJob = async (
  context: AppContext,
  input: {
    source_job: DecisionJobRecord;
    source_trace_id: string | null;
    request_input: InferenceRequestInput;
    idempotency_key: string;
    reason?: string | null;
    max_attempts?: number;
    replay_override_snapshot?: Record<string, unknown> | null;
  }
): Promise<DecisionJobRecord> => {
  const now = context.sim.clock.getTicks();

  return context.prisma.decisionJob.create({
    data: {
      source_inference_id: `pending_${input.idempotency_key}`,
      replay_of_job_id: input.source_job.id,
      replay_source_trace_id: input.source_trace_id,
      replay_reason: input.reason ?? null,
      replay_override_snapshot: input.replay_override_snapshot
        ? (toJsonSafe(input.replay_override_snapshot) as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      job_type: 'inference_run',
      status: 'pending',
      idempotency_key: input.idempotency_key,
      attempt_count: 0,
      max_attempts: input.max_attempts ?? input.source_job.max_attempts,
      request_input: toJsonSafe(input.request_input) as Prisma.InputJsonValue,
      created_at: now,
      updated_at: now
    }
  });
};

export const buildReplayRequestInputFromJob = (job: DecisionJobRecord): InferenceRequestInput => {
  return getDecisionJobRequestInput(job);
};

export const updateDecisionJobState = async (
  context: AppContext,
  input: {
    job_id: string;
    status: DecisionJobRecord['status'];
    last_error?: string | null;
    last_error_code?: string | null;
    last_error_stage?: string | null;
    completed_at?: bigint | null;
    next_retry_at?: bigint | null;
    started_at?: bigint | null;
    locked_by?: string | null;
    locked_at?: bigint | null;
    lock_expires_at?: bigint | null;
    replay_of_job_id?: string | null;
    replay_source_trace_id?: string | null;
    replay_reason?: string | null;
    replay_override_snapshot?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    source_inference_id?: string;
    action_intent_id?: string | null;
    increment_attempt?: boolean;
  }
): Promise<DecisionJobRecord> => {
  const existing = await getDecisionJobById(context, input.job_id);
  const nextAttemptCount = input.increment_attempt ? existing.attempt_count + 1 : existing.attempt_count;

  return context.prisma.decisionJob.update({
    where: {
      id: existing.id
    },
    data: {
      status: input.status,
      last_error: input.last_error ?? null,
      last_error_code: input.last_error_code ?? null,
      last_error_stage: input.last_error_stage ?? null,
      attempt_count: nextAttemptCount,
      started_at: input.started_at === undefined ? existing.started_at : input.started_at,
      replay_of_job_id: input.replay_of_job_id === undefined ? existing.replay_of_job_id : input.replay_of_job_id,
      replay_source_trace_id: input.replay_source_trace_id === undefined ? existing.replay_source_trace_id : input.replay_source_trace_id,
      replay_reason: input.replay_reason === undefined ? existing.replay_reason : input.replay_reason,
      replay_override_snapshot:
        input.replay_override_snapshot === undefined ? existing.replay_override_snapshot ?? Prisma.JsonNull : input.replay_override_snapshot,
      locked_by: input.locked_by === undefined ? existing.locked_by : input.locked_by,
      locked_at: input.locked_at === undefined ? existing.locked_at : input.locked_at,
      lock_expires_at: input.lock_expires_at === undefined ? existing.lock_expires_at : input.lock_expires_at,
      next_retry_at: input.next_retry_at === undefined ? existing.next_retry_at : input.next_retry_at,
      source_inference_id: input.source_inference_id ?? existing.source_inference_id,
      action_intent_id: input.action_intent_id === undefined ? existing.action_intent_id : input.action_intent_id,
      updated_at: context.sim.clock.getTicks(),
      completed_at: input.completed_at === undefined ? existing.completed_at : input.completed_at
    }
  });
};

export const assertDecisionJobRetryable = (job: DecisionJobRecord): void => {
  if (job.status !== 'failed') {
    throw new ApiError(409, 'DECISION_JOB_RETRY_INVALID', 'Only failed jobs can be retried', {
      job_id: job.id,
      status: job.status
    });
  }

  if (job.attempt_count >= job.max_attempts) {
    throw new ApiError(409, 'DECISION_JOB_RETRY_EXHAUSTED', 'Decision job has exhausted max attempts', {
      job_id: job.id,
      attempt_count: job.attempt_count,
      max_attempts: job.max_attempts
    });
  }
};

export const buildInferenceJobReplayResult = async (
  context: AppContext,
  idempotencyKey: string
): Promise<InferenceJobSubmitResult> => {
  const job = await getDecisionJobByIdempotencyKey(context, idempotencyKey);
  if (!job) {
    throw new ApiError(404, 'DECISION_JOB_NOT_FOUND', 'Decision job not found for idempotency key', {
      idempotency_key: idempotencyKey
    });
  }

  const workflowSnapshot = await getWorkflowSnapshotByJobId(context, job.id);
  const result = getDecisionResultFromWorkflowSnapshot(workflowSnapshot);

  return {
    replayed: true,
    inference_id: resolveInferenceIdForSubmitResult(workflowSnapshot, job),
    job: toInferenceJobSnapshot(job),
    result,
    result_source: resolveResultSource(true, result),
    workflow_snapshot: workflowSnapshot
  };
};

export const buildInferenceJobSubmitResult = (
  job: DecisionJobRecord,
  result: InferenceRunResult | null,
  workflowSnapshot: WorkflowSnapshot,
  replayed: boolean
): InferenceJobSubmitResult => {
  return {
    replayed,
    inference_id: result?.inference_id ?? resolveInferenceIdForSubmitResult(workflowSnapshot, job),
    job: toInferenceJobSnapshot(job),
    result: replayed ? null : result,
    result_source: resolveResultSource(replayed, replayed ? null : result),
    workflow_snapshot: workflowSnapshot
  };
};

export const buildInferenceJobRetryResult = (
  job: DecisionJobRecord,
  result: InferenceRunResult,
  workflowSnapshot: WorkflowSnapshot
): InferenceJobRetryResult => {
  return {
    replayed: false,
    inference_id: result.inference_id,
    job: toInferenceJobSnapshot(job),
    result,
    result_source: resolveResultSource(false, result),
    workflow_snapshot: workflowSnapshot
  };
};

export const buildInferenceJobReplaySubmitResult = (
  job: DecisionJobRecord,
  workflowSnapshot: WorkflowSnapshot
): InferenceJobReplaySubmitResult => {
  return {
    replayed: false,
    inference_id: resolveInferenceIdForSubmitResult(workflowSnapshot, job),
    job: toInferenceJobSnapshot(job),
    result: null,
    result_source: 'not_available',
    workflow_snapshot: workflowSnapshot,
    replay: {
      source_job_id: job.replay_of_job_id ?? '',
      source_trace_id: job.replay_source_trace_id,
      reason: job.replay_reason,
      override_applied: isRecord(job.replay_override_snapshot),
      override_snapshot: isRecord(job.replay_override_snapshot) ? toRecord(toJsonSafe(job.replay_override_snapshot)) : null,
      parent_job: workflowSnapshot.lineage.parent_job,
      child_jobs: workflowSnapshot.lineage.child_jobs
    }
  };
};

export const normalizeReplayInput = (input: InferenceJobReplayInput | undefined): InferenceJobReplayInput => {
  return {
    reason: typeof input?.reason === 'string' && input.reason.trim().length > 0 ? input.reason.trim() : undefined,
    idempotency_key:
      typeof input?.idempotency_key === 'string' && input.idempotency_key.trim().length > 0 ? input.idempotency_key.trim() : undefined,
    overrides: isRecord(input?.overrides)
      ? {
          strategy:
            input?.overrides?.strategy === 'mock' || input?.overrides?.strategy === 'rule_based'
              ? input.overrides.strategy
              : undefined,
          attributes: isRecord(input?.overrides?.attributes) ? input.overrides.attributes : undefined,
          agent_id: typeof input?.overrides?.agent_id === 'string' ? input.overrides.agent_id : undefined,
          identity_id:
            typeof input?.overrides?.identity_id === 'string' ? input.overrides.identity_id : undefined
        }
      : undefined
  };
};

export const getWorkflowSnapshotByInferenceId = async (
  context: AppContext,
  inferenceId?: string
): Promise<WorkflowSnapshot> => {
  const id = ensureNonEmptyId(inferenceId, 'inference_id');
  const [trace, job, intent] = await Promise.all([
    context.prisma.inferenceTrace.findUnique({
      where: { id }
    }),
    context.prisma.decisionJob.findUnique({
      where: { source_inference_id: id }
    }),
    context.prisma.actionIntent.findUnique({
      where: { source_inference_id: id }
    })
  ]);

  if (!trace) {
    throw new ApiError(404, 'INFERENCE_TRACE_NOT_FOUND', 'Inference trace not found', {
      inference_id: id
    });
  }

  return buildWorkflowSnapshot({
    trace,
    job,
    intent
  });
};

export const getWorkflowSnapshotByJobId = async (
  context: AppContext,
  jobId?: string
): Promise<WorkflowSnapshot> => {
  const id = ensureNonEmptyId(jobId, 'job_id');
  const job = await getDecisionJobById(context, id);

  const [trace, intent, replayParentJob, replayChildJobs] = await Promise.all([
    job.source_inference_id && !job.source_inference_id.startsWith('pending_')
      ? context.prisma.inferenceTrace.findUnique({
          where: { id: job.source_inference_id }
        })
      : Promise.resolve(null),
    job.action_intent_id
      ? context.prisma.actionIntent.findUnique({
          where: { id: job.action_intent_id }
        })
      : Promise.resolve(null),
    job.replay_of_job_id
      ? context.prisma.decisionJob.findUnique({
          where: { id: job.replay_of_job_id }
        })
      : Promise.resolve(null),
    context.prisma.decisionJob.findMany({
      where: {
        replay_of_job_id: job.id
      },
      orderBy: {
        created_at: 'asc'
      }
    })
  ]);

  return buildWorkflowSnapshot({
    trace,
    job,
    intent,
    replayParentJob,
    replayChildJobs
  });
};
