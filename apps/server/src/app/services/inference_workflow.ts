import { Prisma } from '@prisma/client';

import type {
  InferenceActionIntentSnapshot,
  InferenceJobReplayInput,
  InferenceJobReplaySubmitResult,
  InferenceJobRetryResult,
  InferenceJobsListSnapshot,
  InferenceJobSubmitResult,
  InferenceJobListItem,
  InferenceRequestInput,
  InferenceRunResult,
  ListInferenceJobsInput,
  WorkflowSnapshot
} from '../../inference/types.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';
import { toJsonSafe } from '../http/json.js';
import {
  parseInferenceJobsFilters,
  ensureNonEmptyId,
  normalizeReplayInput,
  normalizeStoredRequestInput
} from './inference_workflow/parsers.js';
import {
  buildInferenceJobReplayResult,
  buildInferenceJobReplaySubmitResult,
  buildInferenceJobRetryResult,
  buildInferenceJobSubmitResult,
  getDecisionResultFromWorkflowSnapshot
} from './inference_workflow/results.js';
import {
  buildInferenceRunResultFromTrace,
  buildWorkflowSnapshot,
  toInferenceActionIntentSnapshot,
  toInferenceJobSnapshot
} from './inference_workflow/snapshots.js';
import type {
  ActionIntentRecord,
  DecisionJobRecord,
  InferenceTraceRecord,
  ParsedInferenceJobsFilters
} from './inference_workflow/types.js';
import {
  DEFAULT_DECISION_JOB_LOCK_TICKS,
  RUNNABLE_JOB_STATUSES,
  isRecord,
  normalizeJobStatus,
  toTickString
} from './inference_workflow/types.js';

export interface ListInferenceJobsInput {
  status?: string[];
  agent_id?: string;
  identity_id?: string;
  strategy?: string;
  job_type?: string;
  from_tick?: string | number;
  to_tick?: string | number;
  from_created_at?: string | number;
  to_created_at?: string | number;
  cursor?: string;
  limit?: number;
  has_error?: boolean;
  action_intent_id?: string;
}

export interface InferenceJobListItem {
  id: string;
  source_inference_id: string | null;
  action_intent_id: string | null;
  job_type: string;
  status: ReturnType<typeof normalizeJobStatus>;
  attempt_count: number;
  max_attempts: number;
  idempotency_key: string | null;
  last_error: string | null;
  last_error_code: string | null;
  last_error_stage: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  started_at: string | null;
  next_retry_at: string | null;
  strategy: string | null;
  actor_ref: Record<string, unknown> | null;
  target_ref: Record<string, unknown> | null;
  request_input: InferenceRequestInput | null;
  workflow: {
    intent_type: string | null;
    intent_status: InferenceActionIntentSnapshot['status'] | null;
    decision_stage: WorkflowSnapshot['derived']['decision_stage'];
    dispatch_stage: WorkflowSnapshot['derived']['dispatch_stage'];
    workflow_state: WorkflowSnapshot['derived']['workflow_state'];
    failure_stage: WorkflowSnapshot['derived']['failure_stage'];
    failure_code: WorkflowSnapshot['derived']['failure_code'];
    failure_reason: WorkflowSnapshot['derived']['failure_reason'];
    outcome_summary: WorkflowSnapshot['derived']['outcome_summary'];
  };
}

export interface InferenceJobsListSnapshot {
  items: InferenceJobListItem[];
  page_info: {
    has_next_page: boolean;
    next_cursor: string | null;
  };
  summary: {
    returned: number;
    limit: number;
    counts_by_status: Record<'pending' | 'running' | 'completed' | 'failed', number>;
    filters: {
      status: ReturnType<typeof normalizeJobStatus>[] | null;
      agent_id: string | null;
      identity_id: string | null;
      strategy: string | null;
      job_type: string | null;
      from_created_at: string | null;
      to_created_at: string | null;
      from_tick: string | null;
      to_tick: string | null;
      has_error: boolean | null;
      action_intent_id: string | null;
      cursor: string | null;
    };
  };
}

const encodeInferenceJobsCursor = (item: Pick<InferenceJobListItem, 'created_at' | 'id'>): string => {
  return Buffer.from(
    JSON.stringify({
      created_at: item.created_at,
      id: item.id
    }),
    'utf8'
  ).toString('base64url');
};

const compareInferenceJobsCursorPosition = (
  left: { created_at: string; id: string },
  right: { created_at: string; id: string }
): number => {
  const leftTick = BigInt(left.created_at);
  const rightTick = BigInt(right.created_at);

  if (leftTick === rightTick) {
    return right.id.localeCompare(left.id);
  }

  return leftTick > rightTick ? -1 : 1;
};

const buildInferenceJobsWhere = (filters: ParsedInferenceJobsFilters): Prisma.DecisionJobWhereInput => {
  return {
    ...(filters.status ? { status: { in: filters.status } } : {}),
    ...(filters.job_type ? { job_type: filters.job_type } : {}),
    ...(filters.action_intent_id ? { action_intent_id: filters.action_intent_id } : {}),
    ...(filters.has_error === null ? {} : filters.has_error ? { last_error: { not: null } } : { last_error: null }),
    ...(filters.from_created_at !== null || filters.to_created_at !== null
      ? {
          created_at: {
            ...(filters.from_created_at !== null ? { gte: filters.from_created_at } : {}),
            ...(filters.to_created_at !== null ? { lte: filters.to_created_at } : {})
          }
        }
      : {})
  };
};

const shouldFetchAllInferenceJobs = (filters: ParsedInferenceJobsFilters): boolean => {
  return filters.agent_id !== null || filters.identity_id !== null || filters.strategy !== null || filters.cursor !== null;
};

const getSafeRequestInput = (job: DecisionJobRecord): InferenceRequestInput | null => {
  if (job.request_input === null) {
    return null;
  }

  try {
    return normalizeStoredRequestInput(job.request_input);
  } catch {
    return null;
  }
};

const resolveInferenceJobActorRef = (
  workflowSnapshot: WorkflowSnapshot,
  requestInput: InferenceRequestInput | null
): Record<string, unknown> | null => {
  const actorRef = workflowSnapshot.records.intent?.actor_ref ?? workflowSnapshot.records.trace?.actor_ref ?? null;
  if (actorRef) {
    return actorRef;
  }

  const fallback: Record<string, unknown> = {};
  if (typeof requestInput?.agent_id === 'string') {
    fallback.agent_id = requestInput.agent_id;
  }
  if (typeof requestInput?.identity_id === 'string') {
    fallback.identity_id = requestInput.identity_id;
  }

  return Object.keys(fallback).length > 0 ? fallback : null;
};

const matchesInferenceJobFilters = (
  filters: ParsedInferenceJobsFilters,
  workflowSnapshot: WorkflowSnapshot,
  requestInput: InferenceRequestInput | null
): boolean => {
  const actorRef = resolveInferenceJobActorRef(workflowSnapshot, requestInput);
  const actorAgentId = actorRef && typeof actorRef.agent_id === 'string' ? actorRef.agent_id : requestInput?.agent_id ?? null;
  const actorIdentityId =
    actorRef && typeof actorRef.identity_id === 'string' ? actorRef.identity_id : requestInput?.identity_id ?? null;
  const strategy = workflowSnapshot.records.trace?.strategy ?? requestInput?.strategy ?? null;

  if (filters.agent_id !== null && actorAgentId !== filters.agent_id) {
    return false;
  }

  if (filters.identity_id !== null && actorIdentityId !== filters.identity_id) {
    return false;
  }

  if (filters.strategy !== null && strategy !== filters.strategy) {
    return false;
  }

  return true;
};

const buildInferenceJobListItem = (
  job: DecisionJobRecord,
  workflowSnapshot: WorkflowSnapshot,
  requestInput: InferenceRequestInput | null
): InferenceJobListItem => {
  return {
    id: job.id,
    source_inference_id: job.source_inference_id,
    action_intent_id: job.action_intent_id,
    job_type: job.job_type,
    status: normalizeJobStatus(job.status),
    attempt_count: job.attempt_count,
    max_attempts: job.max_attempts,
    idempotency_key: job.idempotency_key,
    last_error: job.last_error,
    last_error_code: job.last_error_code,
    last_error_stage: job.last_error_stage,
    created_at: job.created_at.toString(),
    updated_at: job.updated_at.toString(),
    completed_at: toTickString(job.completed_at),
    started_at: toTickString(job.started_at),
    next_retry_at: toTickString(job.next_retry_at),
    strategy: workflowSnapshot.records.trace?.strategy ?? requestInput?.strategy ?? null,
    actor_ref: resolveInferenceJobActorRef(workflowSnapshot, requestInput),
    target_ref: workflowSnapshot.records.intent?.target_ref ?? null,
    request_input: requestInput ? (toJsonSafe(requestInput) as InferenceRequestInput) : null,
    workflow: {
      intent_type: workflowSnapshot.records.intent?.intent_type ?? null,
      intent_status: workflowSnapshot.records.intent?.status ?? null,
      decision_stage: workflowSnapshot.derived.decision_stage,
      dispatch_stage: workflowSnapshot.derived.dispatch_stage,
      workflow_state: workflowSnapshot.derived.workflow_state,
      failure_stage: workflowSnapshot.derived.failure_stage,
      failure_code: workflowSnapshot.derived.failure_code,
      failure_reason: workflowSnapshot.derived.failure_reason,
      outcome_summary: workflowSnapshot.derived.outcome_summary
    }
  };
};

const matchesInferenceJobsCursor = (cursor: ParsedInferenceJobsFilters['cursor'], item: InferenceJobListItem): boolean => {
  if (!cursor) {
    return true;
  }

  return compareInferenceJobsCursorPosition({ created_at: item.created_at, id: item.id }, cursor) > 0;
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

export const listInferenceJobs = async (
  context: AppContext,
  input: ListInferenceJobsInput
): Promise<InferenceJobsListSnapshot> => {
  const filters = parseInferenceJobsFilters(input);
  const jobs = await context.prisma.decisionJob.findMany({
    ...(shouldFetchAllInferenceJobs(filters)
      ? {}
      : {
          take: filters.limit + 1
        }),
    where: buildInferenceJobsWhere(filters),
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }]
  });

  const filteredItems: InferenceJobListItem[] = [];
  for (const job of jobs) {
    const requestInput = getSafeRequestInput(job);
    const workflowSnapshot = await getWorkflowSnapshotByJobId(context, job.id);
    if (!matchesInferenceJobFilters(filters, workflowSnapshot, requestInput)) {
      continue;
    }

    filteredItems.push(buildInferenceJobListItem(job, workflowSnapshot, requestInput));
  }

  const cursorFilteredItems = filteredItems.filter(item => matchesInferenceJobsCursor(filters.cursor, item));
  const hasNextPage = cursorFilteredItems.length > filters.limit;
  const pageItems = hasNextPage ? cursorFilteredItems.slice(0, filters.limit) : cursorFilteredItems;
  const countsByStatus: Record<'pending' | 'running' | 'completed' | 'failed', number> = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0
  };

  for (const item of pageItems) {
    countsByStatus[item.status] += 1;
  }

  return {
    items: pageItems,
    page_info: {
      has_next_page: hasNextPage,
      next_cursor: hasNextPage ? encodeInferenceJobsCursor(pageItems[pageItems.length - 1]) : null
    },
    summary: {
      returned: pageItems.length,
      limit: filters.limit,
      counts_by_status: countsByStatus,
      filters: {
        status: filters.status,
        agent_id: filters.agent_id,
        identity_id: filters.identity_id,
        strategy: filters.strategy,
        job_type: filters.job_type,
        from_created_at: filters.from_created_at?.toString() ?? null,
        to_created_at: filters.to_created_at?.toString() ?? null,
        from_tick: filters.from_created_at?.toString() ?? null,
        to_tick: filters.to_created_at?.toString() ?? null,
        has_error: filters.has_error,
        action_intent_id: filters.action_intent_id,
        cursor: filters.cursor ? Buffer.from(JSON.stringify(filters.cursor), 'utf8').toString('base64url') : null
      }
    }
  };
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
        { OR: [{ scheduled_for_tick: null }, { scheduled_for_tick: { lte: now } }] },
        {
          OR: [
            { locked_by: null },
            { lock_expires_at: null },
            { lock_expires_at: { lte: now } }
          ]
        }
      ],
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

  if (existing.scheduled_for_tick !== null && existing.scheduled_for_tick > now) {
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
        { OR: [{ scheduled_for_tick: null }, { scheduled_for_tick: { lte: now } }] },
        {
          OR: [
            { locked_by: null },
            { lock_expires_at: null },
            { lock_expires_at: { lte: now } }
          ]
        }
      ],
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

export const listActiveSchedulerAgents = async (
  context: AppContext,
  limit = 10
): Promise<Array<{ id: string }>> => {
  return context.prisma.agent.findMany({
    where: {
      type: 'active'
    },
    select: {
      id: true
    },
    orderBy: {
      created_at: 'asc'
    },
    take: limit
  });
};

export const listPendingSchedulerDecisionJobs = async (
  context: AppContext,
  agentIds: string[]
): Promise<Set<string>> => {
  if (agentIds.length === 0) {
    return new Set();
  }

  const jobs = await context.prisma.decisionJob.findMany({
    where: {
      status: {
        in: ['pending', 'running']
      }
    },
    select: {
      request_input: true
    }
  });

  const agentIdSet = new Set(agentIds);
  return new Set(
    jobs.flatMap(job => {
      const requestInput = isRecord(job.request_input) ? job.request_input : null;
      const agentId = requestInput && typeof requestInput.agent_id === 'string' ? requestInput.agent_id : null;
      return agentId && agentIdSet.has(agentId) ? [agentId] : [];
    })
  );
};

export const listPendingSchedulerActionIntents = async (
  context: AppContext,
  agentIds: string[]
): Promise<Set<string>> => {
  if (agentIds.length === 0) {
    return new Set();
  }

  const intents = await context.prisma.actionIntent.findMany({
    where: {
      status: {
        in: ['pending', 'dispatching']
      }
    },
    select: {
      actor_ref: true
    }
  });

  const agentIdSet = new Set(agentIds);
  return new Set(
    intents.flatMap(intent => {
      const actorRef = isRecord(intent.actor_ref) ? intent.actor_ref : null;
      const agentId = actorRef && typeof actorRef.agent_id === 'string' ? actorRef.agent_id : null;
      return agentId && agentIdSet.has(agentId) ? [agentId] : [];
    })
  );
};

export const listRecentScheduledDecisionJobs = async (
  context: AppContext,
  agentIds: string[]
): Promise<Map<string, bigint>> => {
  if (agentIds.length === 0) {
    return new Map();
  }

  const jobs = await context.prisma.decisionJob.findMany({
    where: {
      idempotency_key: {
        startsWith: 'sch:'
      }
    },
    select: {
      request_input: true,
      created_at: true
    },
    orderBy: {
      created_at: 'desc'
    }
  });

  const recentTicks = new Map<string, bigint>();
  const agentIdSet = new Set(agentIds);
  for (const job of jobs) {
    const requestInput = isRecord(job.request_input) ? job.request_input : null;
    const agentId = requestInput && typeof requestInput.agent_id === 'string' ? requestInput.agent_id : null;
    if (agentId && agentIdSet.has(agentId) && !recentTicks.has(agentId)) {
      recentTicks.set(agentId, job.created_at);
    }
  }

  return recentTicks;
};

export const listRecentRecoveryWindowActors = async (
  context: AppContext,
  sinceTick: bigint,
  intentClasses: Array<'direct_inference' | 'scheduler_periodic' | 'scheduler_event_followup' | 'replay_recovery' | 'retry_recovery' | 'operator_forced'>
): Promise<Set<string>> => {
  if (intentClasses.length === 0) {
    return new Set();
  }

  const jobs = await context.prisma.decisionJob.findMany({
    where: {
      intent_class: {
        in: intentClasses
      },
      created_at: {
        gte: sinceTick
      }
    },
    select: {
      request_input: true
    }
  });

  return new Set(
    jobs.flatMap(job => {
      const requestInput = isRecord(job.request_input) ? job.request_input : null;
      const agentId = requestInput && typeof requestInput.agent_id === 'string' ? requestInput.agent_id : null;
      return agentId ? [agentId] : [];
    })
  );
};

export const listRecentEventFollowupSignals = async (
  context: AppContext,
  sinceTick: bigint
): Promise<Array<{ agent_id: string; reason: 'event_followup' }>> => {
  const events = await context.prisma.event.findMany({
    where: {
      created_at: {
        gte: sinceTick
      },
      source_action_intent_id: {
        not: null
      }
    },
    include: {
      source_action_intent: {
        select: {
          actor_ref: true
        }
      }
    },
    orderBy: {
      created_at: 'desc'
    }
  });

  return events.flatMap(event => {
    const actorRef = event.source_action_intent && isRecord(event.source_action_intent.actor_ref)
      ? event.source_action_intent.actor_ref
      : null;
    return actorRef && typeof actorRef.agent_id === 'string'
      ? [{ agent_id: actorRef.agent_id, reason: 'event_followup' as const }]
      : [];
  });
};

export const listRecentRelationshipFollowupSignals = async (
  context: AppContext,
  sinceTick: bigint
): Promise<Array<{ agent_id: string; reason: 'relationship_change_followup' }>> => {
  const logs = await context.prisma.relationshipAdjustmentLog.findMany({
    where: {
      created_at: {
        gte: sinceTick
      }
    },
    orderBy: {
      created_at: 'desc'
    }
  });

  return logs.flatMap(log => [
    { agent_id: log.from_id, reason: 'relationship_change_followup' as const },
    { agent_id: log.to_id, reason: 'relationship_change_followup' as const }
  ]);
};

export const listRecentSnrFollowupSignals = async (
  context: AppContext,
  sinceTick: bigint
): Promise<Array<{ agent_id: string; reason: 'snr_change_followup' }>> => {
  const logs = await context.prisma.sNRAdjustmentLog.findMany({
    where: {
      created_at: {
        gte: sinceTick
      }
    },
    orderBy: {
      created_at: 'desc'
    }
  });

  return logs.map(log => ({
    agent_id: log.agent_id,
    reason: 'snr_change_followup' as const
  }));
};

export const createPendingDecisionJob = async (
  context: AppContext,
  input: {
    idempotency_key: string;
    request_input: InferenceRequestInput;
    max_attempts?: number;
    scheduled_for_tick?: bigint | null;
    intent_class?: 'direct_inference' | 'scheduler_periodic' | 'scheduler_event_followup' | 'replay_recovery' | 'retry_recovery' | 'operator_forced';
    job_source?: string;
  }
): Promise<DecisionJobRecord> => {
  const now = context.sim.clock.getTicks();

  return context.prisma.decisionJob.create({
    data: {
      source_inference_id: `pending_${input.idempotency_key}`,
      job_type: 'inference_run',
      status: 'pending',
      idempotency_key: input.idempotency_key,
      intent_class: input.intent_class ?? 'direct_inference',
      attempt_count: 0,
      max_attempts: input.max_attempts ?? 3,
      request_input: toJsonSafe({
        ...input.request_input,
        attributes: {
          ...(input.request_input.attributes ?? {}),
          job_intent_class: input.intent_class ?? 'direct_inference',
          job_source: input.job_source ?? 'api_submit'
        }
      }) as Prisma.InputJsonValue,
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
      scheduled_for_tick: input.scheduled_for_tick ?? null,
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
    intent_class?: 'direct_inference' | 'scheduler_periodic' | 'scheduler_event_followup' | 'replay_recovery' | 'retry_recovery' | 'operator_forced';
    job_source?: string;
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
      intent_class: input.intent_class ?? 'replay_recovery',
      status: 'pending',
      idempotency_key: input.idempotency_key,
      attempt_count: 0,
      max_attempts: input.max_attempts ?? input.source_job.max_attempts,
      scheduled_for_tick: null,
      request_input: toJsonSafe({
        ...input.request_input,
        attributes: {
          ...(input.request_input.attributes ?? {}),
          job_intent_class: input.intent_class ?? 'replay_recovery',
          job_source: input.job_source ?? 'replay'
        }
      }) as Prisma.InputJsonValue,
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
    scheduled_for_tick?: bigint | null;
    intent_class?: 'direct_inference' | 'scheduler_periodic' | 'scheduler_event_followup' | 'replay_recovery' | 'retry_recovery' | 'operator_forced';
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
      intent_class: input.intent_class ?? existing.intent_class,
      scheduled_for_tick: input.scheduled_for_tick === undefined ? existing.scheduled_for_tick : input.scheduled_for_tick,
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

export const buildInferenceJobReplayResultByIdempotencyKey = async (
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
  return buildInferenceJobReplayResult(job, workflowSnapshot);
};

export const normalizeReplayJobInput = normalizeReplayInput;

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

export {
  buildInferenceJobReplaySubmitResult,
  buildInferenceJobRetryResult,
  buildInferenceJobSubmitResult,
  buildInferenceRunResultFromTrace,
  getDecisionResultFromWorkflowSnapshot,
  toInferenceActionIntentSnapshot,
  toInferenceJobSnapshot
};
