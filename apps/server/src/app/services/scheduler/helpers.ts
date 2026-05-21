import { getSchedulerObservabilityConfig } from '../../../config/runtime_config.js';
import { ApiError } from '../../../utils/api_error.js';
import type { AppContext } from '../../context.js';
import type {
  AgentSchedulerRunResult,
  SchedulerKind,
  SchedulerReason,
  SchedulerSkipReason
} from '../../runtime/agent_scheduler.js';
import type { SchedulerRebalanceRecommendationRecord } from '../../runtime/scheduler_rebalance.js';
import type {
  ListSchedulerDecisionsInput,
  ListSchedulerOwnershipAssignmentsInput,
  ListSchedulerOwnershipMigrationsInput,
  ListSchedulerRebalanceRecommendationsInput,
  ListSchedulerRunsInput,
  ListSchedulerWorkersInput,
  RawSchedulerCandidateDecisionRow,
  RawSchedulerRunRow,
  SchedulerCandidateDecisionReadModel,
  SchedulerDecisionFilters,
  SchedulerDecisionWorkflowLink,
  SchedulerListCursor,
  SchedulerOwnershipAssignmentFilters,
  SchedulerOwnershipMigrationFilters,
  SchedulerOwnershipMigrationReadModel,
  SchedulerOwnershipSummary,
  SchedulerPartitionOwnershipReadModel,
  SchedulerRebalanceRecommendationFilters,
  SchedulerRebalanceRecommendationReadModel,
  SchedulerRunCrossLinkSummary,
  SchedulerRunFilters,
  SchedulerRunReadModel,
  SchedulerWorkerFilters,
  SchedulerWorkerRuntimeReadModel} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SCHEDULER_QUERY_INVALID = 'SCHEDULER_QUERY_INVALID';
export const SCHEDULER_KINDS: SchedulerKind[] = ['periodic', 'event_driven'];
export const SCHEDULER_REASONS: SchedulerReason[] = [
  'periodic_tick',
  'bootstrap_seed',
  'event_followup',
  'relationship_change_followup',
  'snr_change_followup',
  'overlay_change_followup',
  'memory_change_followup'
];
export const SCHEDULER_SKIP_REASONS: SchedulerSkipReason[] = [
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

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

export const encodeSchedulerCursor = (value: SchedulerListCursor): string => {
  return Buffer.from(
    JSON.stringify({
      created_at: value.created_at,
      id: value.id
    }),
    'utf8'
  ).toString('base64url');
};

export const parseSchedulerCursor = (value: string | undefined): SchedulerListCursor | null => {
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

// ---------------------------------------------------------------------------
// Filter parsers
// ---------------------------------------------------------------------------

export const parseOptionalTickFilter = (value: string | number | undefined, fieldName: 'from_tick' | 'to_tick'): bigint | null => {
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

export const parseLimit = (value: string | number | undefined): number => {
  const config = getSchedulerObservabilityConfig();
  if (value === undefined) {
    return config.default_query_limit;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'limit must be a positive safe integer');
    }
    return Math.min(value, config.max_query_limit);
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'limit must be a positive integer string');
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'limit must be a positive safe integer');
  }

  return Math.min(parsed, config.max_query_limit);
};

export const parseOptionalIdFilter = (value: string | undefined, fieldName: string): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, `${fieldName} must not be empty`);
  }

  return trimmed;
};

export const parseOptionalKind = (value: string | undefined): SchedulerKind | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim() as SchedulerKind;
  if (!SCHEDULER_KINDS.includes(normalized)) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'kind is unsupported', { kind: value });
  }

  return normalized;
};

export const parseOptionalReason = (value: string | undefined): SchedulerReason | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim() as SchedulerReason;
  if (!SCHEDULER_REASONS.includes(normalized)) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'reason is unsupported', { reason: value });
  }

  return normalized;
};

export const parseOptionalSkipReason = (value: string | undefined): SchedulerSkipReason | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim() as SchedulerSkipReason;
  if (!SCHEDULER_SKIP_REASONS.includes(normalized)) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'skipped_reason is unsupported', { skipped_reason: value });
  }

  return normalized;
};

export const parseOptionalPartitionId = (value: string | undefined): string | null => {
  return parseOptionalIdFilter(value, 'partition_id');
};

export const parseOwnershipAssignmentFilters = (
  input: ListSchedulerOwnershipAssignmentsInput
): SchedulerOwnershipAssignmentFilters => ({
  worker_id: parseOptionalIdFilter(input.worker_id, 'worker_id'),
  partition_id: parseOptionalPartitionId(input.partition_id),
  status: parseOptionalIdFilter(input.status, 'status'),
  pack_id: parseOptionalIdFilter(input.pack_id, 'pack_id')
});

export const parseOwnershipMigrationFilters = (
  input: ListSchedulerOwnershipMigrationsInput
): SchedulerOwnershipMigrationFilters => ({
  limit: parseLimit(input.limit),
  partition_id: parseOptionalPartitionId(input.partition_id),
  worker_id: parseOptionalIdFilter(input.worker_id, 'worker_id'),
  status: parseOptionalIdFilter(input.status, 'status'),
  pack_id: parseOptionalIdFilter(input.pack_id, 'pack_id')
});

export const parseWorkerFilters = (input: ListSchedulerWorkersInput): SchedulerWorkerFilters => ({
  worker_id: parseOptionalIdFilter(input.worker_id, 'worker_id'),
  status: parseOptionalIdFilter(input.status, 'status'),
  pack_id: parseOptionalIdFilter(input.pack_id, 'pack_id')
});

export const parseRebalanceRecommendationFilters = (
  input: ListSchedulerRebalanceRecommendationsInput
): SchedulerRebalanceRecommendationFilters => ({
  limit: parseLimit(input.limit),
  partition_id: parseOptionalPartitionId(input.partition_id),
  worker_id: parseOptionalIdFilter(input.worker_id, 'worker_id'),
  status: parseOptionalIdFilter(input.status, 'status'),
  suppress_reason: parseOptionalIdFilter(input.suppress_reason, 'suppress_reason'),
  pack_id: parseOptionalIdFilter(input.pack_id, 'pack_id')
});

export const parseRunFilters = (input: ListSchedulerRunsInput): SchedulerRunFilters => {
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
    worker_id: parseOptionalIdFilter(input.worker_id, 'worker_id'),
    partition_id: parseOptionalPartitionId(input.partition_id),
    pack_id: parseOptionalIdFilter(input.pack_id, 'pack_id')
  };
};

export const parseDecisionFilters = (input: ListSchedulerDecisionsInput): SchedulerDecisionFilters => {
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
    to_tick: toTick,
    partition_id: parseOptionalPartitionId(input.partition_id),
    pack_id: parseOptionalIdFilter(input.pack_id, 'pack_id')
  };
};

// ---------------------------------------------------------------------------
// Raw row helpers
// ---------------------------------------------------------------------------

export const castRawRow = <T>(row: Record<string, unknown>): T => row as unknown as T;

export const parseSummaryJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

// ---------------------------------------------------------------------------
// Pack-id helpers
// ---------------------------------------------------------------------------

export const getAllPackIds = (context: AppContext): string[] => {
  return context.schedulerStorage?.listOpenPackIds() ?? [];
};

export const getFilteredPackIds = (context: AppContext, packId?: string): string[] => {
  const all = getAllPackIds(context);
  return packId ? all.filter(id => id === packId) : all;
};

// ---------------------------------------------------------------------------
// Cursor predicate builders
// ---------------------------------------------------------------------------

export const buildRunCursorWhere = (
  cursor: SchedulerListCursor | null
): ((run: RawSchedulerRunRow) => boolean) => {
  if (!cursor) {
    return () => true;
  }
  const cursorCreatedAt = Number(BigInt(cursor.created_at));
  return (run: RawSchedulerRunRow) =>
    run.created_at < cursorCreatedAt ||
    (run.created_at === cursorCreatedAt && run.id < cursor.id);
};

export const buildDecisionCursorWhere = (
  cursor: SchedulerListCursor | null
): ((decision: RawSchedulerCandidateDecisionRow) => boolean) => {
  if (!cursor) {
    return () => true;
  }
  const cursorCreatedAt = Number(BigInt(cursor.created_at));
  return (decision: RawSchedulerCandidateDecisionRow) =>
    decision.created_at < cursorCreatedAt ||
    (decision.created_at === cursorCreatedAt && decision.id < cursor.id);
};

// ---------------------------------------------------------------------------
// Read-model converters
// ---------------------------------------------------------------------------

export const toRunReadModel = (schedulerRun: {
  id: string;
  worker_id: string;
  partition_id: string;
  lease_holder: string | null;
  lease_expires_at_snapshot: bigint | null;
  tick: bigint;
  summary: unknown;
  started_at: bigint;
  finished_at: bigint;
  created_at: bigint;
  cross_link_summary?: SchedulerRunCrossLinkSummary | null;
}): SchedulerRunReadModel['run'] => ({
  id: schedulerRun.id,
  worker_id: schedulerRun.worker_id,
  partition_id: schedulerRun.partition_id,
  lease_holder: schedulerRun.lease_holder ?? null,
  lease_expires_at_snapshot: schedulerRun.lease_expires_at_snapshot?.toString() ?? null,
  tick: schedulerRun.tick.toString(),
  summary: schedulerRun.summary as AgentSchedulerRunResult,
  started_at: schedulerRun.started_at.toString(),
  finished_at: schedulerRun.finished_at.toString(),
  created_at: schedulerRun.created_at.toString(),
  cross_link_summary: schedulerRun.cross_link_summary ?? null
});

export const toCandidateDecisionReadModel = (candidate: {
  id: string;
  scheduler_run_id: string;
  partition_id: string;
  actor_id: string;
  kind: string;
  candidate_reasons: unknown;
  chosen_reason: string;
  scheduled_for_tick: bigint;
  priority_score: number;
  skipped_reason: string | null;
  created_job_id: string | null;
  workflow_link?: SchedulerDecisionWorkflowLink | null;
  created_at: bigint;
}): SchedulerCandidateDecisionReadModel => {
  const candidateReasons = Array.isArray(candidate.candidate_reasons) ? (candidate.candidate_reasons as string[]) : [];
  const coalescedSecondaryReasonCount = candidate.kind === 'event_driven' ? Math.max(candidateReasons.length - 1, 0) : 0;

  return {
    id: candidate.id,
    scheduler_run_id: candidate.scheduler_run_id,
    partition_id: candidate.partition_id,
    actor_id: candidate.actor_id,
    kind: candidate.kind,
    candidate_reasons: candidateReasons,
    chosen_reason: candidate.chosen_reason,
    scheduled_for_tick: candidate.scheduled_for_tick.toString(),
    priority_score: candidate.priority_score,
    skipped_reason: candidate.skipped_reason as SchedulerSkipReason | null,
    coalesced_secondary_reason_count: coalescedSecondaryReasonCount,
    has_coalesced_signals: coalescedSecondaryReasonCount > 0,
    created_job_id: candidate.created_job_id,
    created_at: candidate.created_at.toString(),
    workflow_link: candidate.workflow_link ?? null
  };
};

export const toOwnershipMigrationReadModel = (migration: {
  id: string;
  partition_id: string;
  from_worker_id: string | null;
  to_worker_id: string;
  status: string;
  reason: string | null;
  details: unknown;
  created_at: bigint;
  updated_at: bigint;
  completed_at: bigint | null;
}): SchedulerOwnershipMigrationReadModel => ({
  id: migration.id,
  partition_id: migration.partition_id,
  from_worker_id: migration.from_worker_id,
  to_worker_id: migration.to_worker_id,
  status: migration.status,
  reason: migration.reason,
  details: migration.details,
  created_at: migration.created_at.toString(),
  updated_at: migration.updated_at.toString(),
  completed_at: migration.completed_at?.toString() ?? null
});

export const toWorkerRuntimeReadModel = (worker: {
  worker_id: string;
  status: string;
  last_heartbeat_at: bigint;
  owned_partition_count: number;
  active_migration_count: number;
  capacity_hint: number | null;
  updated_at: bigint;
}): SchedulerWorkerRuntimeReadModel => ({
  worker_id: worker.worker_id,
  status: worker.status,
  last_heartbeat_at: worker.last_heartbeat_at.toString(),
  owned_partition_count: worker.owned_partition_count,
  active_migration_count: worker.active_migration_count,
  capacity_hint: worker.capacity_hint,
  updated_at: worker.updated_at.toString()
});

export const toRebalanceRecommendationReadModel = (
  recommendation: SchedulerRebalanceRecommendationRecord
): SchedulerRebalanceRecommendationReadModel => ({
  id: recommendation.id,
  partition_id: recommendation.partition_id,
  from_worker_id: recommendation.from_worker_id,
  to_worker_id: recommendation.to_worker_id,
  status: recommendation.status,
  reason: recommendation.reason,
  score: recommendation.score,
  suppress_reason: recommendation.suppress_reason,
  details: recommendation.details,
  created_at: recommendation.created_at.toString(),
  updated_at: recommendation.updated_at.toString(),
  applied_migration_id: recommendation.applied_migration_id
});

// ---------------------------------------------------------------------------
// Cross-link / summary builders
// ---------------------------------------------------------------------------

export const buildRunCrossLinkSummary = (candidates: SchedulerCandidateDecisionReadModel[]): SchedulerRunCrossLinkSummary | null => {
  const linkedWorkflowCandidates = candidates.filter(candidate => candidate.workflow_link !== null);
  if (linkedWorkflowCandidates.length === 0) {
    return null;
  }

  const workflowStateCounts = new Map<string, number>();
  const intentTypeCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();

  for (const candidate of linkedWorkflowCandidates) {
    const workflowLink = candidate.workflow_link;
    if (!workflowLink) {
      continue;
    }
    if (workflowLink.workflow_state) {
      workflowStateCounts.set(workflowLink.workflow_state, (workflowStateCounts.get(workflowLink.workflow_state) ?? 0) + 1);
    }
    if (workflowLink.intent_type) {
      intentTypeCounts.set(workflowLink.intent_type, (intentTypeCounts.get(workflowLink.intent_type) ?? 0) + 1);
    }
    statusCounts.set(workflowLink.status, (statusCounts.get(workflowLink.status) ?? 0) + 1);
  }

  return {
    linked_workflow_count: linkedWorkflowCandidates.length,
    workflow_state_breakdown: Array.from(workflowStateCounts.entries()).map(([workflow_state, count]) => ({ workflow_state, count })),
    linked_intent_type_breakdown: Array.from(intentTypeCounts.entries()).map(([intent_type, count]) => ({ intent_type, count })),
    status_breakdown: Array.from(statusCounts.entries()).map(([status, count]) => ({ status, count })),
    recent_audit_summaries: linkedWorkflowCandidates.slice(0, 5).map(candidate => ({
      job_id: candidate.workflow_link?.job_id ?? '',
      summary: candidate.workflow_link?.audit_entry?.summary ?? null
    }))
  };
};

export const buildSchedulerDecisionWorkflowLinks = async (
  context: AppContext,
  decisions: Array<{
    id: string;
    created_job_id: string | null;
  }>
): Promise<Map<string, SchedulerDecisionWorkflowLink>> => {
  const createdJobIds = Array.from(
    new Set(decisions.map(item => item.created_job_id).filter((value): value is string => typeof value === 'string'))
  );
  if (createdJobIds.length === 0) {
    return new Map();
  }

  const jobs = await context.repos.inference.findDecisionJobs({
    where: {
      id: {
        in: createdJobIds
      }
    },
    select: {
      id: true,
      status: true,
      intent_class: true,
      action_intent_id: true,
      source_inference_id: true,
      pending_source_key: true,
      job_type: true,
      attempt_count: true,
      max_attempts: true
    }
  });

  const jobsById = new Map(jobs.map(job => [job.id, job]));

  return new Map(
    decisions.flatMap(decision => {
      if (!decision.created_job_id) {
        return [];
      }
      const job = jobsById.get(decision.created_job_id);
      if (!job) {
        return [];
      }
      return [[
        decision.id,
        {
          job_id: job.id,
          status: job.status,
          intent_class: job.intent_class ?? null,
          workflow_state: job.status,
          action_intent_id: job.action_intent_id ?? null,
          inference_id: job.source_inference_id ?? job.pending_source_key ?? null,
          intent_type: job.job_type ?? null,
          dispatch_stage: job.status === 'completed' ? 'completed' : job.status === 'failed' ? 'dispatch_failed' : 'dispatch_pending',
          failure_stage: job.status === 'failed' ? 'decision_failed' : null,
          failure_code: job.status === 'failed' ? 'WORKFLOW_JOB_FAILED' : null,
          outcome_summary_excerpt: { attempt_count: job.attempt_count, max_attempts: job.max_attempts },
          audit_entry: { kind: 'workflow', id: job.id, summary: `${job.job_type} -> ${job.status}` }
        } satisfies SchedulerDecisionWorkflowLink
      ]];
    })
  );
};

export const buildSchedulerOwnershipSummary = (items: SchedulerPartitionOwnershipReadModel[]): SchedulerOwnershipSummary => {
  const workerCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();

  for (const item of items) {
    if (item.worker_id) {
      workerCounts.set(item.worker_id, (workerCounts.get(item.worker_id) ?? 0) + 1);
    }
    sourceCounts.set(item.source, (sourceCounts.get(item.source) ?? 0) + 1);
  }

  return {
    returned: items.length,
    assigned_count: items.filter(item => item.status === 'assigned').length,
    migrating_count: items.filter(item => item.status === 'migrating').length,
    released_count: items.filter(item => item.status === 'released').length,
    active_partition_count: items.filter(item => item.worker_id !== null).length,
    top_workers: Array.from(workerCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([worker_id, partition_count]) => ({ worker_id, partition_count })),
    source_breakdown: Array.from(sourceCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([source, count]) => ({ source, count }))
  };
};
