import type {
  SchedulerCandidateDecisionRecord,
  SchedulerRunRecord} from '../../../packs/storage/SchedulerStorageAdapter.js';
import type { AgentSchedulerRunResult, SchedulerSkipReason } from '../../runtime/agent_scheduler.js';
import type { SchedulerRebalanceRecommendationRecord } from '../../runtime/scheduler_rebalance.js';
import type {
  SchedulerCandidateDecisionReadModel,
  SchedulerDecisionWorkflowLink,
  SchedulerOwnershipMigrationReadModel,
  SchedulerOwnershipSummary,
  SchedulerPartitionOwnershipReadModel,
  SchedulerRebalanceRecommendationReadModel,
  SchedulerRunCrossLinkSummary,
  SchedulerRunReadModel,
  SchedulerWorkerRuntimeReadModel} from './types.js';

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

export const parseSummaryJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export const toRunReadModel = (
  record: SchedulerRunRecord,
  crossLinkSummary?: SchedulerRunCrossLinkSummary | null
): SchedulerRunReadModel['run'] => ({
  id: record.id,
  worker_id: record.worker_id,
  partition_id: record.partition_id,
  lease_holder: record.lease_holder,
  lease_expires_at_snapshot: record.lease_expires_at_snapshot?.toString() ?? null,
  tick: record.tick.toString(),
  summary: parseSummaryJson(record.summary) as AgentSchedulerRunResult,
  started_at: record.started_at.toString(),
  finished_at: record.finished_at.toString(),
  created_at: record.created_at.toString(),
  cross_link_summary: crossLinkSummary ?? null
});

// ---------------------------------------------------------------------------
// Candidate Decision
// ---------------------------------------------------------------------------

export const toCandidateDecisionReadModel = (
  record: SchedulerCandidateDecisionRecord,
  workflowLink?: SchedulerDecisionWorkflowLink | null
): SchedulerCandidateDecisionReadModel => {
  const candidateReasons: string[] = parseSummaryJson(record.candidate_reasons) as string[];
  const reasons = Array.isArray(candidateReasons) ? candidateReasons : [];
  const coalescedSecondaryReasonCount = record.kind === 'event_driven' ? Math.max(reasons.length - 1, 0) : 0;

  return {
    id: record.id,
    scheduler_run_id: record.scheduler_run_id,
    partition_id: record.partition_id,
    actor_id: record.actor_id,
    kind: record.kind,
    candidate_reasons: reasons,
    chosen_reason: record.chosen_reason,
    scheduled_for_tick: record.scheduled_for_tick.toString(),
    priority_score: record.priority_score,
    skipped_reason: record.skipped_reason as SchedulerSkipReason | null,
    coalesced_secondary_reason_count: coalescedSecondaryReasonCount,
    has_coalesced_signals: coalescedSecondaryReasonCount > 0,
    created_job_id: record.created_job_id,
    created_at: record.created_at.toString(),
    workflow_link: workflowLink ?? null
  };
};

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

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

export const buildSchedulerOwnershipSummary = (
  items: SchedulerPartitionOwnershipReadModel[]
): SchedulerOwnershipSummary => {
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

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Rebalance
// ---------------------------------------------------------------------------

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
// Cross-link
// ---------------------------------------------------------------------------

export const buildRunCrossLinkSummary = (
  candidates: SchedulerCandidateDecisionReadModel[]
): SchedulerRunCrossLinkSummary | null => {
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
