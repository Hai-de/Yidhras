import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';
import type {
  AgentSchedulerCandidateDecisionSnapshot,
  AgentSchedulerRunResult,
  SchedulerKind,
  SchedulerReason,
  SchedulerSkipReason
} from '../runtime/agent_scheduler.js';

export interface SchedulerRunSnapshotRecord {
  id: string;
  worker_id: string;
  tick: bigint;
  summary: unknown;
  started_at: bigint;
  finished_at: bigint;
  created_at: bigint;
}

export interface SchedulerCandidateDecisionRecord {
  id: string;
  scheduler_run_id: string;
  actor_id: string;
  kind: string;
  candidate_reasons: unknown;
  chosen_reason: string;
  scheduled_for_tick: bigint;
  priority_score: number;
  skipped_reason: string | null;
  created_job_id: string | null;
  created_at: bigint;
}

export interface SchedulerRunReadModel {
  run: {
    id: string;
    worker_id: string;
    tick: string;
    summary: AgentSchedulerRunResult;
    started_at: string;
    finished_at: string;
    created_at: string;
  };
  candidates: SchedulerCandidateDecisionReadModel[];
}

export interface SchedulerCandidateDecisionReadModel {
  id: string;
  actor_id: string;
  kind: string;
  candidate_reasons: string[];
  chosen_reason: string;
  scheduled_for_tick: string;
  priority_score: number;
  skipped_reason: SchedulerSkipReason | null;
  created_job_id: string | null;
  created_at: string;
}

interface SchedulerListCursor {
  created_at: string;
  id: string;
}

export interface ListSchedulerRunsInput {
  limit?: string | number;
  cursor?: string;
  from_tick?: string | number;
  to_tick?: string | number;
  worker_id?: string;
}

export interface ListSchedulerDecisionsInput {
  limit?: string | number;
  cursor?: string;
  actor_id?: string;
  kind?: string;
  reason?: string;
  skipped_reason?: string;
  from_tick?: string | number;
  to_tick?: string | number;
}

interface SchedulerRunFilters {
  limit: number;
  cursor: SchedulerListCursor | null;
  from_tick: bigint | null;
  to_tick: bigint | null;
  worker_id: string | null;
}

interface SchedulerDecisionFilters {
  limit: number;
  cursor: SchedulerListCursor | null;
  actor_id: string | null;
  kind: SchedulerKind | null;
  reason: SchedulerReason | null;
  skipped_reason: SchedulerSkipReason | null;
  from_tick: bigint | null;
  to_tick: bigint | null;
}

export interface ListSchedulerRunsResult {
  items: SchedulerRunReadModel['run'][];
  page_info: {
    has_next_page: boolean;
    next_cursor: string | null;
  };
  summary: {
    returned: number;
    limit: number;
    filters: {
      cursor: string | null;
      from_tick: string | null;
      to_tick: string | null;
      worker_id: string | null;
    };
  };
}

export interface ListSchedulerDecisionsResult {
  items: SchedulerCandidateDecisionReadModel[];
  page_info: {
    has_next_page: boolean;
    next_cursor: string | null;
  };
  summary: {
    returned: number;
    limit: number;
    filters: {
      cursor: string | null;
      actor_id: string | null;
      kind: SchedulerKind | null;
      reason: SchedulerReason | null;
      skipped_reason: SchedulerSkipReason | null;
      from_tick: string | null;
      to_tick: string | null;
    };
  };
}

export interface SchedulerSummarySnapshot {
  latest_run: SchedulerRunReadModel['run'] | null;
  run_totals: {
    sampled_runs: number;
    created_total: number;
    created_periodic_total: number;
    created_event_driven_total: number;
    skipped_pending_total: number;
    skipped_cooldown_total: number;
    signals_detected_total: number;
  };
  top_reasons: Array<{
    reason: SchedulerReason;
    count: number;
  }>;
  top_skipped_reasons: Array<{
    skipped_reason: SchedulerSkipReason;
    count: number;
  }>;
  top_actors: Array<{
    actor_id: string;
    count: number;
  }>;
  intent_class_breakdown: Array<{
    intent_class: string;
    count: number;
  }>;
}

export interface SchedulerTrendPoint {
  tick: string;
  run_id: string;
  created_count: number;
  created_periodic_count: number;
  created_event_driven_count: number;
  signals_detected_count: number;
}

export interface SchedulerTrendsSnapshot {
  points: SchedulerTrendPoint[];
}

const SCHEDULER_QUERY_INVALID = 'SCHEDULER_QUERY_INVALID';
const DEFAULT_QUERY_LIMIT = 20;
const MAX_QUERY_LIMIT = 100;
const SCHEDULER_KINDS: SchedulerKind[] = ['periodic', 'event_driven'];
const SCHEDULER_REASONS: SchedulerReason[] = [
  'periodic_tick',
  'bootstrap_seed',
  'event_followup',
  'relationship_change_followup',
  'snr_change_followup'
];
const SCHEDULER_SKIP_REASONS: SchedulerSkipReason[] = [
  'pending_workflow',
  'periodic_cooldown',
  'event_coalesced',
  'replay_window_periodic_suppressed',
  'replay_window_event_suppressed',
  'retry_window_periodic_suppressed',
  'retry_window_event_suppressed',
  'existing_same_idempotency',
  'limit_reached'
];

const toJsonValue = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
};

const encodeSchedulerCursor = (value: SchedulerListCursor): string => {
  return Buffer.from(
    JSON.stringify({
      created_at: value.created_at,
      id: value.id
    }),
    'utf8'
  ).toString('base64url');
};

const parseSchedulerCursor = (value: string | undefined): SchedulerListCursor | null => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'cursor is invalid');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof (parsed as Record<string, unknown>).created_at !== 'string' ||
    typeof (parsed as Record<string, unknown>).id !== 'string'
  ) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'cursor payload is invalid');
  }

  const createdAt = (parsed as Record<string, unknown>).created_at as string;
  const id = (parsed as Record<string, unknown>).id as string;
  if (!/^\d+$/.test(createdAt) || id.trim().length === 0) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'cursor payload is invalid');
  }

  return {
    created_at: createdAt,
    id
  };
};

const parseOptionalTickFilter = (value: string | number | undefined, fieldName: 'from_tick' | 'to_tick'): bigint | null => {
  if (value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ApiError(400, SCHEDULER_QUERY_INVALID, `${fieldName} must be a non-negative safe integer number or integer string`);
    }
    return BigInt(value);
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, `${fieldName} must be a non-negative integer string`, {
      field: fieldName,
      value
    });
  }

  return BigInt(trimmed);
};

const parseLimit = (value: string | number | undefined): number => {
  if (value === undefined) {
    return DEFAULT_QUERY_LIMIT;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'limit must be a positive safe integer');
    }
    return Math.min(value, MAX_QUERY_LIMIT);
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'limit must be a positive integer string');
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'limit must be a positive safe integer');
  }

  return Math.min(parsed, MAX_QUERY_LIMIT);
};

const parseOptionalIdFilter = (value: string | undefined, fieldName: string): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, `${fieldName} must not be empty`);
  }

  return trimmed;
};

const parseOptionalKind = (value: string | undefined): SchedulerKind | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim() as SchedulerKind;
  if (!SCHEDULER_KINDS.includes(normalized)) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'kind is unsupported', { kind: value });
  }

  return normalized;
};

const parseOptionalReason = (value: string | undefined): SchedulerReason | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim() as SchedulerReason;
  if (!SCHEDULER_REASONS.includes(normalized)) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'reason is unsupported', { reason: value });
  }

  return normalized;
};

const parseOptionalSkipReason = (value: string | undefined): SchedulerSkipReason | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim() as SchedulerSkipReason;
  if (!SCHEDULER_SKIP_REASONS.includes(normalized)) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'skipped_reason is unsupported', { skipped_reason: value });
  }

  return normalized;
};

const buildRunCursorWhere = (cursor: SchedulerListCursor | null): Prisma.SchedulerRunWhereInput => {
  if (!cursor) {
    return {};
  }

  return {
    OR: [
      {
        created_at: {
          lt: BigInt(cursor.created_at)
        }
      },
      {
        AND: [
          {
            created_at: BigInt(cursor.created_at)
          },
          {
            id: {
              lt: cursor.id
            }
          }
        ]
      }
    ]
  };
};

const buildDecisionCursorWhere = (cursor: SchedulerListCursor | null): Prisma.SchedulerCandidateDecisionWhereInput => {
  if (!cursor) {
    return {};
  }

  return {
    OR: [
      {
        created_at: {
          lt: BigInt(cursor.created_at)
        }
      },
      {
        AND: [
          {
            created_at: BigInt(cursor.created_at)
          },
          {
            id: {
              lt: cursor.id
            }
          }
        ]
      }
    ]
  };
};

const toRunReadModel = (schedulerRun: {
  id: string;
  worker_id: string;
  tick: bigint;
  summary: unknown;
  started_at: bigint;
  finished_at: bigint;
  created_at: bigint;
}): SchedulerRunReadModel['run'] => {
  return {
    id: schedulerRun.id,
    worker_id: schedulerRun.worker_id,
    tick: schedulerRun.tick.toString(),
    summary: schedulerRun.summary as AgentSchedulerRunResult,
    started_at: schedulerRun.started_at.toString(),
    finished_at: schedulerRun.finished_at.toString(),
    created_at: schedulerRun.created_at.toString()
  };
};

const toCandidateDecisionReadModel = (candidate: {
  id: string;
  actor_id: string;
  kind: string;
  candidate_reasons: unknown;
  chosen_reason: string;
  scheduled_for_tick: bigint;
  priority_score: number;
  skipped_reason: string | null;
  created_job_id: string | null;
  created_at: bigint;
}): SchedulerCandidateDecisionReadModel => {
  return {
    id: candidate.id,
    actor_id: candidate.actor_id,
    kind: candidate.kind,
    candidate_reasons: Array.isArray(candidate.candidate_reasons) ? (candidate.candidate_reasons as string[]) : [],
    chosen_reason: candidate.chosen_reason,
    scheduled_for_tick: candidate.scheduled_for_tick.toString(),
    priority_score: candidate.priority_score,
    skipped_reason: candidate.skipped_reason as SchedulerSkipReason | null,
    created_job_id: candidate.created_job_id,
    created_at: candidate.created_at.toString()
  };
};

const parseRunFilters = (input: ListSchedulerRunsInput): SchedulerRunFilters => {
  const fromTick = parseOptionalTickFilter(input.from_tick, 'from_tick');
  const toTick = parseOptionalTickFilter(input.to_tick, 'to_tick');
  if (fromTick !== null && toTick !== null && fromTick > toTick) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'from_tick must be less than or equal to to_tick', {
      from_tick: fromTick.toString(),
      to_tick: toTick.toString()
    });
  }

  return {
    limit: parseLimit(input.limit),
    cursor: parseSchedulerCursor(input.cursor),
    from_tick: fromTick,
    to_tick: toTick,
    worker_id: parseOptionalIdFilter(input.worker_id, 'worker_id')
  };
};

const parseDecisionFilters = (input: ListSchedulerDecisionsInput): SchedulerDecisionFilters => {
  const fromTick = parseOptionalTickFilter(input.from_tick, 'from_tick');
  const toTick = parseOptionalTickFilter(input.to_tick, 'to_tick');
  if (fromTick !== null && toTick !== null && fromTick > toTick) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'from_tick must be less than or equal to to_tick', {
      from_tick: fromTick.toString(),
      to_tick: toTick.toString()
    });
  }

  return {
    limit: parseLimit(input.limit),
    cursor: parseSchedulerCursor(input.cursor),
    actor_id: parseOptionalIdFilter(input.actor_id, 'actor_id'),
    kind: parseOptionalKind(input.kind),
    reason: parseOptionalReason(input.reason),
    skipped_reason: parseOptionalSkipReason(input.skipped_reason),
    from_tick: fromTick,
    to_tick: toTick
  };
};

export const recordSchedulerRunSnapshot = async (
  context: AppContext,
  input: {
    workerId: string;
    tick: bigint;
    startedAt: bigint;
    finishedAt: bigint;
    summary: AgentSchedulerRunResult;
    candidateDecisions: AgentSchedulerCandidateDecisionSnapshot[];
  }
): Promise<string> => {
  const runId = randomUUID();

  await context.prisma.schedulerRun.create({
    data: {
      id: runId,
      worker_id: input.workerId,
      tick: input.tick,
      summary: toJsonValue(input.summary),
      started_at: input.startedAt,
      finished_at: input.finishedAt,
      created_at: input.finishedAt,
      candidate_decisions: {
        create: input.candidateDecisions.map(candidate => ({
          id: randomUUID(),
          actor_id: candidate.actor_id,
          kind: candidate.kind,
          candidate_reasons: toJsonValue(candidate.candidate_reasons),
          chosen_reason: candidate.chosen_reason,
          scheduled_for_tick: candidate.scheduled_for_tick,
          priority_score: candidate.priority_score,
          skipped_reason: candidate.skipped_reason,
          created_job_id: candidate.created_job_id,
          created_at: input.finishedAt
        }))
      }
    }
  });

  return runId;
};

export const getLatestSchedulerRunReadModel = async (context: AppContext): Promise<SchedulerRunReadModel | null> => {
  const schedulerRun = await context.prisma.schedulerRun.findFirst({
    include: {
      candidate_decisions: {
        orderBy: {
          created_at: 'asc'
        }
      }
    },
    orderBy: {
      created_at: 'desc'
    }
  });

  if (!schedulerRun) {
    return null;
  }

  return {
    run: toRunReadModel(schedulerRun),
    candidates: schedulerRun.candidate_decisions.map(toCandidateDecisionReadModel)
  };
};

export const getSchedulerRunReadModelById = async (
  context: AppContext,
  runId: string
): Promise<SchedulerRunReadModel | null> => {
  const schedulerRun = await context.prisma.schedulerRun.findUnique({
    where: {
      id: runId
    },
    include: {
      candidate_decisions: {
        orderBy: {
          created_at: 'asc'
        }
      }
    }
  });

  if (!schedulerRun) {
    return null;
  }

  return {
    run: toRunReadModel(schedulerRun),
    candidates: schedulerRun.candidate_decisions.map(toCandidateDecisionReadModel)
  };
};

export const listAgentSchedulerDecisions = async (
  context: AppContext,
  actorId: string,
  limit = 20
): Promise<SchedulerCandidateDecisionReadModel[]> => {
  const decisions = await context.prisma.schedulerCandidateDecision.findMany({
    where: {
      actor_id: actorId
    },
    orderBy: [
      {
        created_at: 'desc'
      },
      {
        id: 'desc'
      }
    ],
    take: limit
  });

  return decisions.map(toCandidateDecisionReadModel);
};

export const listSchedulerRuns = async (
  context: AppContext,
  input: ListSchedulerRunsInput
): Promise<ListSchedulerRunsResult> => {
  const filters = parseRunFilters(input);
  const runs = await context.prisma.schedulerRun.findMany({
    where: {
      ...(filters.worker_id !== null ? { worker_id: filters.worker_id } : {}),
      ...(filters.from_tick !== null || filters.to_tick !== null
        ? {
            tick: {
              ...(filters.from_tick !== null ? { gte: filters.from_tick } : {}),
              ...(filters.to_tick !== null ? { lte: filters.to_tick } : {})
            }
          }
        : {}),
      ...buildRunCursorWhere(filters.cursor)
    },
    orderBy: [
      {
        created_at: 'desc'
      },
      {
        id: 'desc'
      }
    ],
    take: filters.limit + 1
  });

  const hasNextPage = runs.length > filters.limit;
  const pageItems = runs.slice(0, filters.limit).map(toRunReadModel);
  const nextCursor = hasNextPage
    ? encodeSchedulerCursor({
        created_at: pageItems[pageItems.length - 1].created_at,
        id: pageItems[pageItems.length - 1].id
      })
    : null;

  return {
    items: pageItems,
    page_info: {
      has_next_page: hasNextPage,
      next_cursor: nextCursor
    },
    summary: {
      returned: pageItems.length,
      limit: filters.limit,
      filters: {
        cursor: filters.cursor ? encodeSchedulerCursor(filters.cursor) : null,
        from_tick: filters.from_tick?.toString() ?? null,
        to_tick: filters.to_tick?.toString() ?? null,
        worker_id: filters.worker_id
      }
    }
  };
};

export const listSchedulerDecisions = async (
  context: AppContext,
  input: ListSchedulerDecisionsInput
): Promise<ListSchedulerDecisionsResult> => {
  const filters = parseDecisionFilters(input);
  const decisions = await context.prisma.schedulerCandidateDecision.findMany({
    where: {
      ...(filters.actor_id !== null ? { actor_id: filters.actor_id } : {}),
      ...(filters.kind !== null ? { kind: filters.kind } : {}),
      ...(filters.reason !== null ? { chosen_reason: filters.reason } : {}),
      ...(filters.skipped_reason !== null ? { skipped_reason: filters.skipped_reason } : {}),
      ...(filters.from_tick !== null || filters.to_tick !== null
        ? {
            scheduled_for_tick: {
              ...(filters.from_tick !== null ? { gte: filters.from_tick } : {}),
              ...(filters.to_tick !== null ? { lte: filters.to_tick } : {})
            }
          }
        : {}),
      ...buildDecisionCursorWhere(filters.cursor)
    },
    orderBy: [
      {
        created_at: 'desc'
      },
      {
        id: 'desc'
      }
    ],
    take: filters.limit + 1
  });

  const hasNextPage = decisions.length > filters.limit;
  const pageItems = decisions.slice(0, filters.limit).map(toCandidateDecisionReadModel);
  const nextCursor = hasNextPage
    ? encodeSchedulerCursor({
        created_at: pageItems[pageItems.length - 1].created_at,
        id: pageItems[pageItems.length - 1].id
      })
    : null;

  return {
    items: pageItems,
    page_info: {
      has_next_page: hasNextPage,
      next_cursor: nextCursor
    },
    summary: {
      returned: pageItems.length,
      limit: filters.limit,
      filters: {
        cursor: filters.cursor ? encodeSchedulerCursor(filters.cursor) : null,
        actor_id: filters.actor_id,
        kind: filters.kind,
        reason: filters.reason,
        skipped_reason: filters.skipped_reason,
        from_tick: filters.from_tick?.toString() ?? null,
        to_tick: filters.to_tick?.toString() ?? null
      }
    }
  };
};

export const getSchedulerSummarySnapshot = async (
  context: AppContext,
  input?: { sampleRuns?: number }
): Promise<SchedulerSummarySnapshot> => {
  const sampleRuns = Math.min(Math.max(input?.sampleRuns ?? 20, 1), 100);
  const [latestRunReadModel, recentRuns, recentDecisions, recentJobs] = await Promise.all([
    getLatestSchedulerRunReadModel(context),
    context.prisma.schedulerRun.findMany({
      orderBy: [{ created_at: 'desc' }],
      take: sampleRuns
    }),
    context.prisma.schedulerCandidateDecision.findMany({
      orderBy: [{ created_at: 'desc' }],
      take: sampleRuns * 10
    }),
    context.prisma.decisionJob.findMany({
      where: {
        intent_class: {
          in: ['scheduler_periodic', 'scheduler_event_followup', 'replay_recovery', 'retry_recovery', 'direct_inference']
        }
      },
      select: {
        intent_class: true
      },
      orderBy: [{ created_at: 'desc' }],
      take: sampleRuns * 10
    })
  ]);

  const reasonCounts = new Map<SchedulerReason, number>();
  const skippedReasonCounts = new Map<SchedulerSkipReason, number>();
  const actorCounts = new Map<string, number>();
  const intentClassCounts = new Map<string, number>();

  for (const decision of recentDecisions) {
    const chosenReason = decision.chosen_reason as SchedulerReason;
    reasonCounts.set(chosenReason, (reasonCounts.get(chosenReason) ?? 0) + 1);
    actorCounts.set(decision.actor_id, (actorCounts.get(decision.actor_id) ?? 0) + 1);
    if (decision.skipped_reason) {
      const skippedReason = decision.skipped_reason as SchedulerSkipReason;
      skippedReasonCounts.set(skippedReason, (skippedReasonCounts.get(skippedReason) ?? 0) + 1);
    }
  }

  for (const job of recentJobs) {
    intentClassCounts.set(job.intent_class, (intentClassCounts.get(job.intent_class) ?? 0) + 1);
  }

  const runTotals = recentRuns.reduce(
    (accumulator, run) => {
      const summary = run.summary as unknown as AgentSchedulerRunResult;
      accumulator.sampled_runs += 1;
      accumulator.created_total += summary.created_count;
      accumulator.created_periodic_total += summary.created_periodic_count;
      accumulator.created_event_driven_total += summary.created_event_driven_count;
      accumulator.skipped_pending_total += summary.skipped_pending_count;
      accumulator.skipped_cooldown_total += summary.skipped_cooldown_count;
      accumulator.signals_detected_total += summary.signals_detected_count;
      return accumulator;
    },
    {
      sampled_runs: 0,
      created_total: 0,
      created_periodic_total: 0,
      created_event_driven_total: 0,
      skipped_pending_total: 0,
      skipped_cooldown_total: 0,
      signals_detected_total: 0
    }
  );

  return {
    latest_run: latestRunReadModel?.run ?? null,
    run_totals: runTotals,
    top_reasons: Array.from(reasonCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count })),
    top_skipped_reasons: Array.from(skippedReasonCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([skipped_reason, count]) => ({ skipped_reason, count })),
    top_actors: Array.from(actorCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([actor_id, count]) => ({ actor_id, count })),
    intent_class_breakdown: Array.from(intentClassCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([intent_class, count]) => ({ intent_class, count }))
  };
};

export const getSchedulerTrendsSnapshot = async (
  context: AppContext,
  input?: { sampleRuns?: number }
): Promise<SchedulerTrendsSnapshot> => {
  const sampleRuns = Math.min(Math.max(input?.sampleRuns ?? 20, 1), 100);
  const recentRuns = await context.prisma.schedulerRun.findMany({
    orderBy: [{ created_at: 'desc' }],
    take: sampleRuns
  });

  return {
    points: recentRuns
      .map(run => {
        const summary = run.summary as unknown as AgentSchedulerRunResult;
        return {
          tick: run.tick.toString(),
          run_id: run.id,
          created_count: summary.created_count,
          created_periodic_count: summary.created_periodic_count,
          created_event_driven_count: summary.created_event_driven_count,
          signals_detected_count: summary.signals_detected_count
        };
      })
      .reverse()
  };
};
