import { Prisma } from '@prisma/client';

import type { InferenceJobIntentClass, InferenceRequestInput } from '../../../inference/types.js';
import { ApiError } from '../../../utils/api_error.js';
import type { AppContext } from '../../context.js';
import { toJsonSafe } from '../../http/json.js';
import { ensureNonEmptyId } from './parsers.js';
import type { DecisionJobRecord } from './types.js';
import { DEFAULT_DECISION_JOB_LOCK_TICKS, RUNNABLE_JOB_STATUSES, isRecord } from './types.js';

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
      OR: [{ next_retry_at: null }, { next_retry_at: { lte: now } }],
      AND: [
        { OR: [{ scheduled_for_tick: null }, { scheduled_for_tick: { lte: now } }] },
        {
          OR: [{ locked_by: null }, { lock_expires_at: null }, { lock_expires_at: { lte: now } }]
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
      OR: [{ next_retry_at: null }, { next_retry_at: { lte: now } }],
      AND: [
        { OR: [{ scheduled_for_tick: null }, { scheduled_for_tick: { lte: now } }] },
        {
          OR: [{ locked_by: null }, { lock_expires_at: null }, { lock_expires_at: { lte: now } }]
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

export { DEFAULT_DECISION_JOB_LOCK_TICKS };

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
    intent_class?: InferenceJobIntentClass;
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
  intentClasses: InferenceJobIntentClass[]
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
    intent_class?: InferenceJobIntentClass;
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
    intent_class?: InferenceJobIntentClass;
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
