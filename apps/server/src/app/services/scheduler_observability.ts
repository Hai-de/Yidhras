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
import { listSchedulerWorkerRuntimeStates } from '../runtime/scheduler_ownership.js';
import { DEFAULT_SCHEDULER_PARTITION_ID } from '../runtime/scheduler_partitioning.js';
import type { SchedulerRebalanceRecommendationRecord } from '../runtime/scheduler_rebalance.js';
import { listRecentSchedulerRebalanceRecommendations } from '../runtime/scheduler_rebalance.js';

export interface SchedulerRunSnapshotRecord {
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
}

export interface SchedulerCandidateDecisionRecord {
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
  created_at: bigint;
}

export interface SchedulerRunReadModel {
  run: {
    id: string;
    worker_id: string;
    partition_id: string;
    lease_holder: string | null;
    lease_expires_at_snapshot: string | null;
    tick: string;
    summary: AgentSchedulerRunResult;
    started_at: string;
    finished_at: string;
    created_at: string;
    cross_link_summary: SchedulerRunCrossLinkSummary | null;
  };
  candidates: SchedulerCandidateDecisionReadModel[];
}

export interface SchedulerRunCrossLinkSummary {
  linked_workflow_count: number;
  workflow_state_breakdown: Array<{
    workflow_state: string;
    count: number;
  }>;
  linked_intent_type_breakdown: Array<{
    intent_type: string;
    count: number;
  }>;
  status_breakdown: Array<{
    status: string;
    count: number;
  }>;
  recent_audit_summaries: Array<{
    job_id: string;
    summary: string | null;
  }>;
}

export interface SchedulerCandidateDecisionReadModel {
  id: string;
  scheduler_run_id: string;
  partition_id: string;
  actor_id: string;
  kind: string;
  candidate_reasons: string[];
  chosen_reason: string;
  scheduled_for_tick: string;
  priority_score: number;
  skipped_reason: SchedulerSkipReason | null;
  coalesced_secondary_reason_count: number;
  has_coalesced_signals: boolean;
  created_job_id: string | null;
  created_at: string;
  workflow_link: SchedulerDecisionWorkflowLink | null;
}

export interface SchedulerDecisionWorkflowLink {
  job_id: string;
  status: string;
  intent_class: string | null;
  workflow_state: string | null;
  action_intent_id: string | null;
  inference_id: string | null;
  intent_type: string | null;
  dispatch_stage: string | null;
  failure_stage: string | null;
  failure_code: string | null;
  outcome_summary_excerpt: Record<string, unknown> | null;
  audit_entry: {
    kind: 'workflow';
    id: string;
    summary: string | null;
  } | null;
}

export interface AgentSchedulerProjection {
  actor_id: string;
  summary: {
    total_decisions: number;
    created_count: number;
    skipped_count: number;
    periodic_count: number;
    event_driven_count: number;
    latest_scheduled_tick: string | null;
    latest_run_id: string | null;
    latest_partition_id: string | null;
    top_reason: {
      reason: SchedulerReason;
      count: number;
    } | null;
    top_skipped_reason: {
      skipped_reason: SchedulerSkipReason;
      count: number;
    } | null;
  };
  reason_breakdown: Array<{
    reason: SchedulerReason;
    count: number;
  }>;
  skipped_reason_breakdown: Array<{
    skipped_reason: SchedulerSkipReason;
    count: number;
  }>;
  timeline: SchedulerCandidateDecisionReadModel[];
  linkage: {
    recent_runs: Array<{
      run_id: string;
      tick: string;
      worker_id: string;
      partition_id: string;
      created_at: string;
    }>;
    recent_created_jobs: Array<{
      decision_id: string;
      job_id: string;
      scheduler_run_id: string;
      partition_id: string;
      scheduled_for_tick: string;
      created_at: string;
    }>;
  };
}

export interface SchedulerOwnershipMigrationReadModel {
  id: string;
  partition_id: string;
  from_worker_id: string | null;
  to_worker_id: string;
  status: string;
  reason: string | null;
  details: unknown;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface SchedulerPartitionOwnershipReadModel {
  partition_id: string;
  worker_id: string | null;
  status: string;
  version: number;
  source: string;
  updated_at: string;
  latest_migration: SchedulerOwnershipMigrationReadModel | null;
}

export interface SchedulerOwnershipSummary {
  returned: number;
  assigned_count: number;
  migrating_count: number;
  released_count: number;
  active_partition_count: number;
  top_workers: Array<{
    worker_id: string;
    partition_count: number;
  }>;
  source_breakdown: Array<{
    source: string;
    count: number;
  }>;
}

export interface SchedulerWorkerRuntimeReadModel {
  worker_id: string;
  status: string;
  last_heartbeat_at: string;
  owned_partition_count: number;
  active_migration_count: number;
  capacity_hint: number | null;
  updated_at: string;
}

export interface SchedulerRebalanceRecommendationReadModel {
  id: string;
  partition_id: string;
  from_worker_id: string | null;
  to_worker_id: string | null;
  status: string;
  reason: string;
  score: number | null;
  suppress_reason: string | null;
  details: unknown;
  created_at: string;
  updated_at: string;
  applied_migration_id: string | null;
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
  partition_id?: string;
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
  partition_id?: string;
}

export interface ListSchedulerOwnershipAssignmentsInput {
  worker_id?: string;
  partition_id?: string;
  status?: string;
}

export interface ListSchedulerOwnershipMigrationsInput {
  limit?: string | number;
  partition_id?: string;
  worker_id?: string;
  status?: string;
}

export interface ListSchedulerWorkersInput {
  worker_id?: string;
  status?: string;
}

export interface ListSchedulerRebalanceRecommendationsInput {
  limit?: string | number;
  partition_id?: string;
  worker_id?: string;
  status?: string;
  suppress_reason?: string;
}

interface SchedulerRunFilters {
  limit: number;
  cursor: SchedulerListCursor | null;
  from_tick: bigint | null;
  to_tick: bigint | null;
  worker_id: string | null;
  partition_id: string | null;
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
  partition_id: string | null;
}

interface SchedulerOwnershipAssignmentFilters {
  worker_id: string | null;
  partition_id: string | null;
  status: string | null;
}

interface SchedulerOwnershipMigrationFilters {
  limit: number;
  partition_id: string | null;
  worker_id: string | null;
  status: string | null;
}

interface SchedulerWorkerFilters {
  worker_id: string | null;
  status: string | null;
}

interface SchedulerRebalanceRecommendationFilters {
  limit: number;
  partition_id: string | null;
  worker_id: string | null;
  status: string | null;
  suppress_reason: string | null;
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
      partition_id: string | null;
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
      partition_id: string | null;
    };
  };
}

export interface SchedulerOwnershipAssignmentsResult {
  items: SchedulerPartitionOwnershipReadModel[];
  summary: SchedulerOwnershipSummary & {
    filters: {
      worker_id: string | null;
      partition_id: string | null;
      status: string | null;
    };
  };
}

export interface SchedulerOwnershipMigrationsResult {
  items: SchedulerOwnershipMigrationReadModel[];
  summary: {
    returned: number;
    limit: number;
    in_progress_count: number;
    filters: {
      partition_id: string | null;
      worker_id: string | null;
      status: string | null;
    };
  };
}

export interface SchedulerWorkersResult {
  items: SchedulerWorkerRuntimeReadModel[];
  summary: {
    returned: number;
    active_count: number;
    stale_count: number;
    suspected_dead_count: number;
    filters: {
      worker_id: string | null;
      status: string | null;
    };
  };
}

export interface SchedulerRebalanceRecommendationsResult {
  items: SchedulerRebalanceRecommendationReadModel[];
  summary: {
    returned: number;
    limit: number;
    status_breakdown: Array<{
      status: string;
      count: number;
    }>;
    suppress_reason_breakdown: Array<{
      suppress_reason: string;
      count: number;
    }>;
    filters: {
      partition_id: string | null;
      worker_id: string | null;
      status: string | null;
      suppress_reason: string | null;
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
  top_partitions: Array<{
    partition_id: string;
    count: number;
  }>;
  top_workers: Array<{
    worker_id: string;
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
  partition_id: string;
  worker_id: string;
  created_count: number;
  created_periodic_count: number;
  created_event_driven_count: number;
  signals_detected_count: number;
  skipped_by_reason: Partial<Record<SchedulerSkipReason, number>>;
}

export interface SchedulerTrendsSnapshot {
  points: SchedulerTrendPoint[];
}

export interface SchedulerOperatorProjection {
  latest_run: SchedulerRunReadModel | null;
  summary: SchedulerSummarySnapshot;
  trends: SchedulerTrendsSnapshot;
  recent_runs: SchedulerRunReadModel['run'][];
  recent_decisions: SchedulerCandidateDecisionReadModel[];
  ownership: {
    assignments: SchedulerPartitionOwnershipReadModel[];
    recent_migrations: SchedulerOwnershipMigrationReadModel[];
    summary: SchedulerOwnershipSummary;
  };
  workers: {
    items: SchedulerWorkerRuntimeReadModel[];
    summary: SchedulerWorkersResult['summary'];
  };
  rebalance: {
    recommendations: SchedulerRebalanceRecommendationReadModel[];
    summary: SchedulerRebalanceRecommendationsResult['summary'];
  };
  highlights: {
    latest_partition_id: string | null;
    latest_created_workflow_count: number;
    latest_skipped_count: number;
    latest_top_reason: string | null;
    latest_top_intent_type: string | null;
    latest_top_workflow_state: string | null;
    latest_top_skipped_reason: string | null;
    latest_top_failure_code: string | null;
    latest_failed_workflow_count: number;
    latest_pending_workflow_count: number;
    latest_completed_workflow_count: number;
    latest_top_actor: string | null;
    migration_in_progress_count: number;
    latest_migration_partition_id: string | null;
    latest_migration_to_worker_id: string | null;
    top_owner_worker_id: string | null;
    latest_rebalance_status: string | null;
    latest_rebalance_partition_id: string | null;
    latest_rebalance_suppress_reason: string | null;
    latest_stale_worker_id: string | null;
  };
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

const parseOptionalPartitionId = (value: string | undefined): string | null => {
  return parseOptionalIdFilter(value, 'partition_id');
};

const parseOwnershipAssignmentFilters = (
  input: ListSchedulerOwnershipAssignmentsInput
): SchedulerOwnershipAssignmentFilters => ({
  worker_id: parseOptionalIdFilter(input.worker_id, 'worker_id'),
  partition_id: parseOptionalPartitionId(input.partition_id),
  status: parseOptionalIdFilter(input.status, 'status')
});

const parseOwnershipMigrationFilters = (
  input: ListSchedulerOwnershipMigrationsInput
): SchedulerOwnershipMigrationFilters => ({
  limit: parseLimit(input.limit),
  partition_id: parseOptionalPartitionId(input.partition_id),
  worker_id: parseOptionalIdFilter(input.worker_id, 'worker_id'),
  status: parseOptionalIdFilter(input.status, 'status')
});

const parseWorkerFilters = (input: ListSchedulerWorkersInput): SchedulerWorkerFilters => ({
  worker_id: parseOptionalIdFilter(input.worker_id, 'worker_id'),
  status: parseOptionalIdFilter(input.status, 'status')
});

const parseRebalanceRecommendationFilters = (
  input: ListSchedulerRebalanceRecommendationsInput
): SchedulerRebalanceRecommendationFilters => ({
  limit: parseLimit(input.limit),
  partition_id: parseOptionalPartitionId(input.partition_id),
  worker_id: parseOptionalIdFilter(input.worker_id, 'worker_id'),
  status: parseOptionalIdFilter(input.status, 'status'),
  suppress_reason: parseOptionalIdFilter(input.suppress_reason, 'suppress_reason')
});

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

const toCandidateDecisionReadModel = (candidate: {
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

const toOwnershipMigrationReadModel = (migration: {
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

const toWorkerRuntimeReadModel = (worker: {
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

const toRebalanceRecommendationReadModel = (
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

const buildRunCrossLinkSummary = (candidates: SchedulerCandidateDecisionReadModel[]): SchedulerRunCrossLinkSummary | null => {
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

const buildSchedulerDecisionWorkflowLinks = async (
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

  const jobs = await context.prisma.decisionJob.findMany({
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

const buildSchedulerOwnershipSummary = (items: SchedulerPartitionOwnershipReadModel[]): SchedulerOwnershipSummary => {
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
    worker_id: parseOptionalIdFilter(input.worker_id, 'worker_id'),
    partition_id: parseOptionalPartitionId(input.partition_id)
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
    to_tick: toTick,
    partition_id: parseOptionalPartitionId(input.partition_id)
  };
};

export const recordSchedulerRunSnapshot = async (
  context: AppContext,
  input: {
    workerId: string;
    partitionId?: string;
    leaseHolder?: string | null;
    leaseExpiresAtSnapshot?: bigint | null;
    tick: bigint;
    startedAt: bigint;
    finishedAt: bigint;
    summary: AgentSchedulerRunResult;
    candidateDecisions: AgentSchedulerCandidateDecisionSnapshot[];
  }
): Promise<string> => {
  const runId = randomUUID();
  const partitionId = input.partitionId ?? DEFAULT_SCHEDULER_PARTITION_ID;

  await context.prisma.schedulerRun.create({
    data: {
      id: runId,
      worker_id: input.workerId,
      partition_id: partitionId,
      lease_holder: input.leaseHolder ?? input.workerId,
      lease_expires_at_snapshot: input.leaseExpiresAtSnapshot ?? null,
      tick: input.tick,
      summary: toJsonValue(input.summary),
      started_at: input.startedAt,
      finished_at: input.finishedAt,
      created_at: input.finishedAt,
      candidate_decisions: {
        create: input.candidateDecisions.map(candidate => ({
          id: randomUUID(),
          partition_id: candidate.partition_id ?? partitionId,
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

  const workflowLinks = await buildSchedulerDecisionWorkflowLinks(context, schedulerRun.candidate_decisions);
  const candidates = schedulerRun.candidate_decisions.map(candidate =>
    toCandidateDecisionReadModel({
      ...candidate,
      workflow_link: workflowLinks.get(candidate.id) ?? null
    })
  );

  return {
    run: toRunReadModel({
      ...schedulerRun,
      cross_link_summary: buildRunCrossLinkSummary(candidates)
    }),
    candidates
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

  const workflowLinks = await buildSchedulerDecisionWorkflowLinks(context, schedulerRun.candidate_decisions);
  const candidates = schedulerRun.candidate_decisions.map(candidate =>
    toCandidateDecisionReadModel({
      ...candidate,
      workflow_link: workflowLinks.get(candidate.id) ?? null
    })
  );

  return {
    run: toRunReadModel({
      ...schedulerRun,
      cross_link_summary: buildRunCrossLinkSummary(candidates)
    }),
    candidates
  };
};

export const getAgentSchedulerProjection = async (
  context: AppContext,
  actorId: string,
  options?: {
    limit?: number;
  }
): Promise<AgentSchedulerProjection> => {
  const resolvedActorId = parseOptionalIdFilter(actorId, 'actor_id');
  if (resolvedActorId === null) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'actor_id is required');
  }

  const limit = parseLimit(options?.limit);
  const decisions = await context.prisma.schedulerCandidateDecision.findMany({
    where: {
      actor_id: resolvedActorId
    },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: limit
  });

  const workflowLinks = await buildSchedulerDecisionWorkflowLinks(context, decisions);
  const timeline = decisions.map(decision =>
    toCandidateDecisionReadModel({
      ...decision,
      workflow_link: workflowLinks.get(decision.id) ?? null
    })
  );
  const runIds = Array.from(new Set(timeline.map(item => item.scheduler_run_id)));
  const runs = runIds.length
    ? await context.prisma.schedulerRun.findMany({
        where: {
          id: {
            in: runIds
          }
        },
        orderBy: [{ created_at: 'desc' }]
      })
    : [];

  const reasonCounts = new Map<SchedulerReason, number>();
  const skippedReasonCounts = new Map<SchedulerSkipReason, number>();
  let createdCount = 0;
  let skippedCount = 0;
  let periodicCount = 0;
  let eventDrivenCount = 0;

  for (const item of timeline) {
    const chosenReason = item.chosen_reason as SchedulerReason;
    reasonCounts.set(chosenReason, (reasonCounts.get(chosenReason) ?? 0) + 1);
    if (item.kind === 'periodic') {
      periodicCount += 1;
    }
    if (item.kind === 'event_driven') {
      eventDrivenCount += 1;
    }

    if (item.skipped_reason === null) {
      createdCount += 1;
    } else {
      skippedCount += 1;
      skippedReasonCounts.set(item.skipped_reason, (skippedReasonCounts.get(item.skipped_reason) ?? 0) + 1);
    }
  }

  const sortedReasons = Array.from(reasonCounts.entries()).sort((left, right) => right[1] - left[1]);
  const sortedSkippedReasons = Array.from(skippedReasonCounts.entries()).sort((left, right) => right[1] - left[1]);

  return {
    actor_id: resolvedActorId,
    summary: {
      total_decisions: timeline.length,
      created_count: createdCount,
      skipped_count: skippedCount,
      periodic_count: periodicCount,
      event_driven_count: eventDrivenCount,
      latest_scheduled_tick: timeline[0]?.scheduled_for_tick ?? null,
      latest_run_id: timeline[0]?.scheduler_run_id ?? null,
      latest_partition_id: timeline[0]?.partition_id ?? null,
      top_reason: sortedReasons[0] ? { reason: sortedReasons[0][0], count: sortedReasons[0][1] } : null,
      top_skipped_reason: sortedSkippedReasons[0]
        ? { skipped_reason: sortedSkippedReasons[0][0], count: sortedSkippedReasons[0][1] }
        : null
    },
    reason_breakdown: sortedReasons.map(([reason, count]) => ({ reason, count })),
    skipped_reason_breakdown: sortedSkippedReasons.map(([skipped_reason, count]) => ({ skipped_reason, count })),
    timeline,
    linkage: {
      recent_runs: runs.map(run => ({
        run_id: run.id,
        tick: run.tick.toString(),
        worker_id: run.worker_id,
        partition_id: run.partition_id,
        created_at: run.created_at.toString()
      })),
      recent_created_jobs: timeline
        .filter(item => item.created_job_id !== null)
        .map(item => ({
          decision_id: item.id,
          job_id: item.created_job_id as string,
          scheduler_run_id: item.scheduler_run_id,
          partition_id: item.partition_id,
          scheduled_for_tick: item.scheduled_for_tick,
          created_at: item.created_at
        }))
    }
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
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
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
      ...(filters.partition_id !== null ? { partition_id: filters.partition_id } : {}),
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
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: filters.limit + 1
  });

  const hasNextPage = runs.length > filters.limit;
  const pageItems = runs.slice(0, filters.limit).map(toRunReadModel);
  const nextCursor = hasNextPage && pageItems.length > 0
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
        worker_id: filters.worker_id,
        partition_id: filters.partition_id
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
      ...(filters.partition_id !== null ? { partition_id: filters.partition_id } : {}),
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
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: filters.limit + 1
  });

  const hasNextPage = decisions.length > filters.limit;
  const pageDecisions = decisions.slice(0, filters.limit);
  const workflowLinks = await buildSchedulerDecisionWorkflowLinks(context, pageDecisions);
  const pageItems = pageDecisions.map(decision =>
    toCandidateDecisionReadModel({
      ...decision,
      workflow_link: workflowLinks.get(decision.id) ?? null
    })
  );
  const nextCursor = hasNextPage && pageItems.length > 0
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
        to_tick: filters.to_tick?.toString() ?? null,
        partition_id: filters.partition_id
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
  const partitionCounts = new Map<string, number>();
  const workerCounts = new Map<string, number>();
  const intentClassCounts = new Map<string, number>();

  for (const decision of recentDecisions) {
    const chosenReason = decision.chosen_reason as SchedulerReason;
    reasonCounts.set(chosenReason, (reasonCounts.get(chosenReason) ?? 0) + 1);
    actorCounts.set(decision.actor_id, (actorCounts.get(decision.actor_id) ?? 0) + 1);
    partitionCounts.set(decision.partition_id, (partitionCounts.get(decision.partition_id) ?? 0) + 1);
    if (decision.skipped_reason) {
      const skippedReason = decision.skipped_reason as SchedulerSkipReason;
      skippedReasonCounts.set(skippedReason, (skippedReasonCounts.get(skippedReason) ?? 0) + 1);
    }
  }

  for (const run of recentRuns) {
    workerCounts.set(run.worker_id, (workerCounts.get(run.worker_id) ?? 0) + 1);
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
    top_partitions: Array.from(partitionCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([partition_id, count]) => ({ partition_id, count })),
    top_workers: Array.from(workerCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([worker_id, count]) => ({ worker_id, count })),
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
          partition_id: run.partition_id,
          worker_id: run.worker_id,
          created_count: summary.created_count,
          created_periodic_count: summary.created_periodic_count,
          created_event_driven_count: summary.created_event_driven_count,
          signals_detected_count: summary.signals_detected_count,
          skipped_by_reason: summary.skipped_by_reason ?? {}
        };
      })
      .reverse()
  };
};

export const listSchedulerOwnershipAssignments = async (
  context: AppContext,
  input: ListSchedulerOwnershipAssignmentsInput = {}
): Promise<SchedulerOwnershipAssignmentsResult> => {
  const filters = parseOwnershipAssignmentFilters(input);
  const assignments = await context.prisma.schedulerPartitionAssignment.findMany({
    where: {
      ...(filters.worker_id !== null ? { worker_id: filters.worker_id } : {}),
      ...(filters.partition_id !== null ? { partition_id: filters.partition_id } : {}),
      ...(filters.status !== null ? { status: filters.status } : {})
    },
    orderBy: [{ partition_id: 'asc' }]
  });

  const latestMigrations = await Promise.all(
    assignments.map(async assignment => {
      const migration = await context.prisma.schedulerOwnershipMigrationLog.findFirst({
        where: {
          partition_id: assignment.partition_id
        },
        orderBy: [{ created_at: 'desc' }]
      });
      return [assignment.partition_id, migration] as const;
    })
  );
  const latestMigrationByPartition = new Map(latestMigrations);

  const items = assignments.map(assignment => ({
    partition_id: assignment.partition_id,
    worker_id: assignment.worker_id,
    status: assignment.status,
    version: assignment.version,
    source: assignment.source,
    updated_at: assignment.updated_at.toString(),
    latest_migration: latestMigrationByPartition.get(assignment.partition_id)
      ? toOwnershipMigrationReadModel(latestMigrationByPartition.get(assignment.partition_id)!)
      : null
  }));
  const summary = buildSchedulerOwnershipSummary(items);

  return {
    items,
    summary: {
      ...summary,
      filters
    }
  };
};

export const listSchedulerOwnershipMigrations = async (
  context: AppContext,
  input: ListSchedulerOwnershipMigrationsInput = {}
): Promise<SchedulerOwnershipMigrationsResult> => {
  const filters = parseOwnershipMigrationFilters(input);
  const migrations = await context.prisma.schedulerOwnershipMigrationLog.findMany({
    where: {
      ...(filters.partition_id !== null ? { partition_id: filters.partition_id } : {}),
      ...(filters.status !== null ? { status: filters.status } : {}),
      ...(filters.worker_id !== null
        ? {
            OR: [{ from_worker_id: filters.worker_id }, { to_worker_id: filters.worker_id }]
          }
        : {})
    },
    orderBy: [{ created_at: 'desc' }],
    take: filters.limit
  });

  const items = migrations.map(toOwnershipMigrationReadModel);

  return {
    items,
    summary: {
      returned: items.length,
      limit: filters.limit,
      in_progress_count: migrations.filter(item => item.status === 'requested' || item.status === 'in_progress').length,
      filters
    }
  };
};

export const listSchedulerWorkers = async (
  context: AppContext,
  input: ListSchedulerWorkersInput = {}
): Promise<SchedulerWorkersResult> => {
  const filters = parseWorkerFilters(input);
  const workers = await listSchedulerWorkerRuntimeStates(context);
  const filteredWorkers = workers.filter(
    worker =>
      (filters.worker_id === null || worker.worker_id === filters.worker_id) &&
      (filters.status === null || worker.status === filters.status)
  );
  const items = filteredWorkers.map(toWorkerRuntimeReadModel);

  return {
    items,
    summary: {
      returned: items.length,
      active_count: items.filter(item => item.status === 'active').length,
      stale_count: items.filter(item => item.status === 'stale').length,
      suspected_dead_count: items.filter(item => item.status === 'suspected_dead').length,
      filters
    }
  };
};

export const listSchedulerRebalanceRecommendations = async (
  context: AppContext,
  input: ListSchedulerRebalanceRecommendationsInput = {}
): Promise<SchedulerRebalanceRecommendationsResult> => {
  const filters = parseRebalanceRecommendationFilters(input);
  const recommendations = await listRecentSchedulerRebalanceRecommendations(context, filters.limit);
  const filteredRecommendations = recommendations.filter(
    item =>
      (filters.partition_id === null || item.partition_id === filters.partition_id) &&
      (filters.status === null || item.status === filters.status) &&
      (filters.suppress_reason === null || item.suppress_reason === filters.suppress_reason) &&
      (filters.worker_id === null || item.from_worker_id === filters.worker_id || item.to_worker_id === filters.worker_id)
  );
  const items = filteredRecommendations.map(toRebalanceRecommendationReadModel);

  const statusCounts = new Map<string, number>();
  const suppressCounts = new Map<string, number>();
  for (const item of items) {
    statusCounts.set(item.status, (statusCounts.get(item.status) ?? 0) + 1);
    if (item.suppress_reason) {
      suppressCounts.set(item.suppress_reason, (suppressCounts.get(item.suppress_reason) ?? 0) + 1);
    }
  }

  return {
    items,
    summary: {
      returned: items.length,
      limit: filters.limit,
      status_breakdown: Array.from(statusCounts.entries()).map(([status, count]) => ({ status, count })),
      suppress_reason_breakdown: Array.from(suppressCounts.entries()).map(([suppress_reason, count]) => ({ suppress_reason, count })),
      filters
    }
  };
};

export const getSchedulerOperatorProjection = async (
  context: AppContext,
  input?: { sampleRuns?: number; recentLimit?: number }
): Promise<SchedulerOperatorProjection> => {
  const sampleRuns = Math.min(Math.max(input?.sampleRuns ?? 20, 1), 100);
  const recentLimit = Math.min(Math.max(input?.recentLimit ?? 5, 1), 20);

  const [latestRun, summary, trends, recentRunsResult, recentDecisionsResult, ownershipAssignments, ownershipMigrations, workers, rebalanceRecommendations] = await Promise.all([
    getLatestSchedulerRunReadModel(context),
    getSchedulerSummarySnapshot(context, { sampleRuns }),
    getSchedulerTrendsSnapshot(context, { sampleRuns }),
    listSchedulerRuns(context, { limit: recentLimit }),
    listSchedulerDecisions(context, { limit: recentLimit }),
    listSchedulerOwnershipAssignments(context),
    listSchedulerOwnershipMigrations(context, { limit: recentLimit }),
    listSchedulerWorkers(context),
    listSchedulerRebalanceRecommendations(context, { limit: recentLimit })
  ]);

  const latestCandidates = latestRun?.candidates ?? [];
  const latestMigration = ownershipMigrations.items[0] ?? null;
  const latestRebalance = rebalanceRecommendations.items[0] ?? null;
  const latestCreatedWorkflowCount = latestCandidates.filter(candidate => candidate.workflow_link !== null).length;
  const latestSkippedCount = latestCandidates.filter(candidate => candidate.skipped_reason !== null).length;
  const latestTopIntentType = latestRun?.run.cross_link_summary?.linked_intent_type_breakdown[0]?.intent_type ?? null;
  const latestTopWorkflowState = latestRun?.run.cross_link_summary?.workflow_state_breakdown[0]?.workflow_state ?? null;
  const latestTopSkippedReason = summary.top_skipped_reasons[0]?.skipped_reason ?? null;
  const latestTopFailureCode = latestCandidates.find(candidate => candidate.workflow_link?.failure_code)?.workflow_link?.failure_code ?? null;
  const latestFailedWorkflowCount = latestCandidates.filter(candidate => candidate.workflow_link?.workflow_state === 'failed').length;
  const latestPendingWorkflowCount = latestCandidates.filter(candidate => candidate.workflow_link?.workflow_state === 'pending').length;
  const latestCompletedWorkflowCount = latestCandidates.filter(candidate => candidate.workflow_link?.workflow_state === 'completed').length;
  const latestTopActor = summary.top_actors[0]?.actor_id ?? null;
  const topOwnerWorkerId = ownershipAssignments.summary.top_workers[0]?.worker_id ?? null;
  const latestStaleWorkerId = workers.items.find(item => item.status === 'stale' || item.status === 'suspected_dead')?.worker_id ?? null;

  return {
    latest_run: latestRun,
    summary,
    trends,
    recent_runs: recentRunsResult.items,
    recent_decisions: recentDecisionsResult.items,
    ownership: {
      assignments: ownershipAssignments.items,
      recent_migrations: ownershipMigrations.items,
      summary: buildSchedulerOwnershipSummary(ownershipAssignments.items)
    },
    workers: {
      items: workers.items,
      summary: workers.summary
    },
    rebalance: {
      recommendations: rebalanceRecommendations.items,
      summary: rebalanceRecommendations.summary
    },
    highlights: {
      latest_partition_id: latestRun?.run.partition_id ?? null,
      latest_created_workflow_count: latestCreatedWorkflowCount,
      latest_skipped_count: latestSkippedCount,
      latest_top_reason: summary.top_reasons[0]?.reason ?? null,
      latest_top_intent_type: latestTopIntentType,
      latest_top_workflow_state: latestTopWorkflowState,
      latest_top_skipped_reason: latestTopSkippedReason,
      latest_top_failure_code: latestTopFailureCode,
      latest_failed_workflow_count: latestFailedWorkflowCount,
      latest_pending_workflow_count: latestPendingWorkflowCount,
      latest_completed_workflow_count: latestCompletedWorkflowCount,
      latest_top_actor: latestTopActor,
      migration_in_progress_count: ownershipMigrations.summary.in_progress_count,
      latest_migration_partition_id: latestMigration?.partition_id ?? null,
      latest_migration_to_worker_id: latestMigration?.to_worker_id ?? null,
      top_owner_worker_id: topOwnerWorkerId,
      latest_rebalance_status: latestRebalance?.status ?? null,
      latest_rebalance_partition_id: latestRebalance?.partition_id ?? null,
      latest_rebalance_suppress_reason: latestRebalance?.suppress_reason ?? null,
      latest_stale_worker_id: latestStaleWorkerId
    }
  };
};
