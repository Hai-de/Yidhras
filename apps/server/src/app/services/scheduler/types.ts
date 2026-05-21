import type {
  AgentSchedulerRunResult,
  SchedulerKind,
  SchedulerReason,
  SchedulerSkipReason
} from '../../runtime/agent_scheduler.js';

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

// ---------------------------------------------------------------------------
// Internal filter / cursor types
// ---------------------------------------------------------------------------

export interface SchedulerListCursor {
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
  pack_id?: string;
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
  pack_id?: string;
}

export interface ListSchedulerOwnershipAssignmentsInput {
  worker_id?: string;
  partition_id?: string;
  status?: string;
  pack_id?: string;
}

export interface ListSchedulerOwnershipMigrationsInput {
  limit?: string | number;
  partition_id?: string;
  worker_id?: string;
  status?: string;
  pack_id?: string;
}

export interface ListSchedulerWorkersInput {
  worker_id?: string;
  status?: string;
  pack_id?: string;
}

export interface ListSchedulerRebalanceRecommendationsInput {
  limit?: string | number;
  partition_id?: string;
  worker_id?: string;
  status?: string;
  suppress_reason?: string;
  pack_id?: string;
}

export interface SchedulerRunFilters {
  limit: number;
  cursor: SchedulerListCursor | null;
  from_tick: bigint | null;
  to_tick: bigint | null;
  worker_id: string | null;
  partition_id: string | null;
  pack_id: string | null;
}

export interface SchedulerDecisionFilters {
  limit: number;
  cursor: SchedulerListCursor | null;
  actor_id: string | null;
  kind: SchedulerKind | null;
  reason: SchedulerReason | null;
  skipped_reason: SchedulerSkipReason | null;
  from_tick: bigint | null;
  to_tick: bigint | null;
  partition_id: string | null;
  pack_id: string | null;
}

export interface SchedulerOwnershipAssignmentFilters {
  worker_id: string | null;
  partition_id: string | null;
  status: string | null;
  pack_id: string | null;
}

export interface SchedulerOwnershipMigrationFilters {
  limit: number;
  partition_id: string | null;
  worker_id: string | null;
  status: string | null;
  pack_id: string | null;
}

export interface SchedulerWorkerFilters {
  worker_id: string | null;
  status: string | null;
  pack_id: string | null;
}

export interface SchedulerRebalanceRecommendationFilters {
  limit: number;
  partition_id: string | null;
  worker_id: string | null;
  status: string | null;
  suppress_reason: string | null;
  pack_id: string | null;
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
      pack_id: string | null;
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
      pack_id: string | null;
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
      pack_id: string | null;
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
      pack_id: string | null;
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
      pack_id: string | null;
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
      pack_id: string | null;
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

// ---------------------------------------------------------------------------
// Raw storage row types (internal)
// ---------------------------------------------------------------------------

export interface RawSchedulerRunRow {
  id: string;
  worker_id: string;
  partition_id: string;
  lease_holder: string | null;
  lease_expires_at_snapshot: number | null;
  tick: number;
  summary: string;
  started_at: number;
  finished_at: number;
  created_at: number;
}

export interface RawSchedulerCandidateDecisionRow {
  id: string;
  scheduler_run_id: string;
  partition_id: string;
  actor_id: string;
  kind: string;
  candidate_reasons: string;
  chosen_reason: string;
  scheduled_for_tick: number;
  priority_score: number;
  skipped_reason: string | null;
  created_job_id: string | null;
  created_at: number;
}

export interface RawSchedulerPartitionRow {
  partition_id: string;
  worker_id: string | null;
  status: string;
  version: number;
  source: string;
  updated_at: number;
}

export interface RawSchedulerMigrationRow {
  id: string;
  partition_id: string;
  from_worker_id: string | null;
  to_worker_id: string;
  status: string;
  reason: string | null;
  details: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}
