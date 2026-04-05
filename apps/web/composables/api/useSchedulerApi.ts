import { requestApiData } from '../../lib/http/client'
import { normalizeOptionalString } from '../../lib/route/query'
import type { TickString } from '../../lib/time/tick'

export type SchedulerKind = 'periodic' | 'event_driven'
export type SchedulerReason =
  | 'periodic_tick'
  | 'bootstrap_seed'
  | 'event_followup'
  | 'relationship_change_followup'
  | 'snr_change_followup'
export type SchedulerSkipReason =
  | 'pending_workflow'
  | 'periodic_cooldown'
  | 'event_coalesced'
  | 'existing_same_idempotency'
  | 'limit_reached'
  | 'replay_window_periodic_suppressed'
  | 'replay_window_event_suppressed'
  | 'retry_window_periodic_suppressed'
  | 'retry_window_event_suppressed'
export type SchedulerOwnershipStatus = 'assigned' | 'migrating' | 'released'
export type SchedulerMigrationStatus = 'requested' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
export type SchedulerWorkerRuntimeStatus = 'active' | 'stale' | 'suspected_dead'
export type SchedulerRebalanceRecommendationStatus =
  | 'recommended'
  | 'suppressed'
  | 'applied'
  | 'superseded'
  | 'expired'

export interface SchedulerRunCrossLinkSummary {
  linked_workflow_count: number
  workflow_state_breakdown: Array<{
    workflow_state: string
    count: number
  }>
  linked_intent_type_breakdown: Array<{
    intent_type: string
    count: number
  }>
  status_breakdown: Array<{
    status: string
    count: number
  }>
  recent_audit_summaries: Array<{
    job_id: string
    summary: string | null
  }>
}

export interface SchedulerRunSummary {
  id: string
  worker_id: string
  partition_id: string
  lease_holder: string | null
  lease_expires_at_snapshot: TickString | null
  tick: TickString
  summary: {
    scanned_count: number
    eligible_count: number
    created_count: number
    skipped_pending_count: number
    skipped_cooldown_count: number
    created_periodic_count: number
    created_event_driven_count: number
    signals_detected_count: number
    scheduled_for_future_count: number
    skipped_existing_idempotency_count: number
    skipped_by_reason: Partial<Record<SchedulerSkipReason, number>>
    scheduler_run_id?: string
  }
  started_at: TickString
  finished_at: TickString
  created_at: TickString
  cross_link_summary: SchedulerRunCrossLinkSummary | null
}

export interface SchedulerDecisionWorkflowLink {
  job_id: string
  status: string
  intent_class: string | null
  workflow_state: string | null
  action_intent_id: string | null
  inference_id: string | null
  intent_type: string | null
  dispatch_stage: string | null
  failure_stage: string | null
  failure_code: string | null
  outcome_summary_excerpt: Record<string, unknown> | null
  audit_entry: {
    kind: 'workflow'
    id: string
    summary: string | null
  } | null
}

export interface SchedulerDecisionItem {
  id: string
  scheduler_run_id: string
  partition_id: string
  actor_id: string
  kind: SchedulerKind
  candidate_reasons: SchedulerReason[]
  chosen_reason: SchedulerReason
  scheduled_for_tick: TickString
  priority_score: number
  skipped_reason: SchedulerSkipReason | null
  coalesced_secondary_reason_count: number
  has_coalesced_signals: boolean
  created_job_id: string | null
  created_at: TickString
  workflow_link: SchedulerDecisionWorkflowLink | null
}

export interface SchedulerReasonAggregateItem {
  reason: string
  count: number
}

export interface SchedulerSkippedReasonAggregateItem {
  skipped_reason: string
  count: number
}

export interface SchedulerActorAggregateItem {
  actor_id: string
  count: number
}

export interface SchedulerPartitionAggregateItem {
  partition_id: string
  count: number
}

export interface SchedulerWorkerAggregateItem {
  worker_id: string
  count: number
}

export interface SchedulerIntentClassAggregateItem {
  intent_class: string
  count: number
}

export interface SchedulerSummarySnapshot {
  latest_run: SchedulerRunSummary | null
  run_totals: {
    sampled_runs: number
    created_total: number
    created_periodic_total: number
    created_event_driven_total: number
    skipped_pending_total: number
    skipped_cooldown_total: number
    signals_detected_total: number
  }
  top_reasons: SchedulerReasonAggregateItem[]
  top_skipped_reasons: SchedulerSkippedReasonAggregateItem[]
  top_actors: SchedulerActorAggregateItem[]
  top_partitions: SchedulerPartitionAggregateItem[]
  top_workers: SchedulerWorkerAggregateItem[]
  intent_class_breakdown: SchedulerIntentClassAggregateItem[]
}

export interface SchedulerTrendPoint {
  tick: TickString
  run_id: string
  partition_id: string
  worker_id: string
  created_count: number
  created_periodic_count: number
  created_event_driven_count: number
  signals_detected_count: number
  skipped_by_reason: Partial<Record<SchedulerSkipReason, number>>
}

export interface SchedulerTrendsSnapshot {
  points: SchedulerTrendPoint[]
}

export interface SchedulerRunsSnapshot {
  items: SchedulerRunSummary[]
  page_info: {
    has_next_page: boolean
    next_cursor: string | null
  }
  summary: {
    returned: number
    limit: number
    filters: {
      cursor: string | null
      from_tick: TickString | null
      to_tick: TickString | null
      worker_id: string | null
      partition_id: string | null
    }
  }
}

export interface SchedulerDecisionsSnapshot {
  items: SchedulerDecisionItem[]
  page_info: {
    has_next_page: boolean
    next_cursor: string | null
  }
  summary: {
    returned: number
    limit: number
    filters: {
      cursor: string | null
      actor_id: string | null
      kind: SchedulerKind | null
      reason: SchedulerReason | null
      skipped_reason: SchedulerSkipReason | null
      from_tick: TickString | null
      to_tick: TickString | null
      partition_id: string | null
    }
  }
}

export interface SchedulerRunReadModel {
  run: SchedulerRunSummary
  candidates: SchedulerDecisionItem[]
}

export interface SchedulerPartitionOwnershipReadModel {
  partition_id: string
  worker_id: string | null
  status: SchedulerOwnershipStatus
  version: number
  source: string
  updated_at: TickString
  latest_migration: SchedulerOwnershipMigrationReadModel | null
}

export interface SchedulerOwnershipMigrationReadModel {
  id: string
  partition_id: string
  from_worker_id: string | null
  to_worker_id: string
  status: SchedulerMigrationStatus
  reason: string | null
  details: unknown
  created_at: TickString
  updated_at: TickString
  completed_at: TickString | null
}

export interface SchedulerOwnershipSummary {
  returned: number
  assigned_count: number
  migrating_count: number
  released_count: number
  active_partition_count: number
  top_workers: Array<{
    worker_id: string
    partition_count: number
  }>
  source_breakdown: Array<{
    source: string
    count: number
  }>
}

export interface SchedulerOwnershipAssignmentsSnapshot {
  items: SchedulerPartitionOwnershipReadModel[]
  summary: SchedulerOwnershipSummary & {
    filters: {
      worker_id: string | null
      partition_id: string | null
      status: SchedulerOwnershipStatus | null
    }
  }
}

export interface SchedulerWorkerRuntimeReadModel {
  worker_id: string
  status: SchedulerWorkerRuntimeStatus
  last_heartbeat_at: TickString
  owned_partition_count: number
  active_migration_count: number
  capacity_hint: number | null
  updated_at: TickString
}

export interface SchedulerWorkersSnapshot {
  items: SchedulerWorkerRuntimeReadModel[]
  summary: {
    returned: number
    active_count: number
    stale_count: number
    suspected_dead_count: number
    filters: {
      worker_id: string | null
      status: SchedulerWorkerRuntimeStatus | null
    }
  }
}

export interface SchedulerRebalanceRecommendationReadModel {
  id: string
  partition_id: string
  from_worker_id: string | null
  to_worker_id: string | null
  status: SchedulerRebalanceRecommendationStatus
  reason: string
  score: number | null
  suppress_reason: string | null
  details: unknown
  created_at: TickString
  updated_at: TickString
  applied_migration_id: string | null
}

export interface SchedulerRebalanceRecommendationsSnapshot {
  items: SchedulerRebalanceRecommendationReadModel[]
  summary: {
    returned: number
    limit: number
    status_breakdown: Array<{
      status: string
      count: number
    }>
    suppress_reason_breakdown: Array<{
      suppress_reason: string
      count: number
    }>
    filters: {
      worker_id: string | null
      partition_id: string | null
      status: SchedulerRebalanceRecommendationStatus | null
      suppress_reason: string | null
    }
  }
}

export interface AgentSchedulerProjection {
  actor_id: string
  summary: {
    total_decisions: number
    created_count: number
    skipped_count: number
    periodic_count: number
    event_driven_count: number
    latest_scheduled_tick: TickString | null
    latest_run_id: string | null
    latest_partition_id: string | null
    top_reason: {
      reason: SchedulerReason
      count: number
    } | null
    top_skipped_reason: {
      skipped_reason: SchedulerSkipReason
      count: number
    } | null
  }
  reason_breakdown: Array<{
    reason: SchedulerReason
    count: number
  }>
  skipped_reason_breakdown: Array<{
    skipped_reason: SchedulerSkipReason
    count: number
  }>
  timeline: SchedulerDecisionItem[]
  linkage: {
    recent_runs: Array<{
      run_id: string
      tick: TickString
      worker_id: string
      partition_id: string
      created_at: TickString
    }>
    recent_created_jobs: Array<{
      decision_id: string
      job_id: string
      scheduler_run_id: string
      partition_id: string
      scheduled_for_tick: TickString
      created_at: TickString
    }>
  }
}

export interface SchedulerOperatorProjection {
  latest_run: SchedulerRunReadModel | null
  summary: SchedulerSummarySnapshot
  trends: SchedulerTrendsSnapshot
  recent_runs: SchedulerRunSummary[]
  recent_decisions: SchedulerDecisionItem[]
  ownership: {
    assignments: SchedulerPartitionOwnershipReadModel[]
    recent_migrations: SchedulerOwnershipMigrationReadModel[]
    summary: SchedulerOwnershipSummary
  }
  workers: SchedulerWorkersSnapshot
  rebalance: {
    recommendations: SchedulerRebalanceRecommendationReadModel[]
    summary: SchedulerRebalanceRecommendationsSnapshot['summary']
  }
  highlights: {
    latest_partition_id: string | null
    latest_created_workflow_count: number
    latest_skipped_count: number
    latest_top_reason: string | null
    latest_top_intent_type: string | null
    latest_top_workflow_state: string | null
    latest_top_skipped_reason: string | null
    latest_top_failure_code: string | null
    latest_failed_workflow_count: number
    latest_pending_workflow_count: number
    latest_completed_workflow_count: number
    latest_top_actor: string | null
    migration_in_progress_count: number
    latest_migration_partition_id: string | null
    latest_migration_to_worker_id: string | null
    top_owner_worker_id: string | null
    latest_rebalance_status: string | null
    latest_rebalance_partition_id: string | null
    latest_rebalance_suppress_reason: string | null
    latest_stale_worker_id: string | null
  }
}

export interface SchedulerRunsQueryInput {
  limit?: number
  cursor?: string | null
  fromTick?: TickString | null
  toTick?: TickString | null
  workerId?: string | null
  partitionId?: string | null
}

export interface SchedulerDecisionsQueryInput {
  limit?: number
  cursor?: string | null
  actorId?: string | null
  kind?: SchedulerKind | null
  reason?: SchedulerReason | null
  skippedReason?: SchedulerSkipReason | null
  fromTick?: TickString | null
  toTick?: TickString | null
  partitionId?: string | null
}

export interface SchedulerOwnershipAssignmentsQueryInput {
  workerId?: string | null
  partitionId?: string | null
  status?: SchedulerOwnershipStatus | null
}

export interface SchedulerOwnershipMigrationsQueryInput {
  limit?: number
  workerId?: string | null
  partitionId?: string | null
  status?: SchedulerMigrationStatus | null
}

export interface SchedulerWorkersQueryInput {
  workerId?: string | null
  status?: SchedulerWorkerRuntimeStatus | null
}

export interface SchedulerRebalanceRecommendationsQueryInput {
  limit?: number
  workerId?: string | null
  partitionId?: string | null
  status?: SchedulerRebalanceRecommendationStatus | null
  suppressReason?: string | null
}

const buildQueryString = (input: Record<string, string | number | null | undefined>): string => {
  const searchParams = new URLSearchParams()

  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined || value === '') {
      continue
    }
    searchParams.set(key, String(value))
  }

  const queryString = searchParams.toString()
  return queryString.length > 0 ? `?${queryString}` : ''
}

export const useSchedulerApi = () => {
  return {
    listRuns: (input: SchedulerRunsQueryInput = {}) =>
      requestApiData<SchedulerRunsSnapshot>(
        `/api/runtime/scheduler/runs${buildQueryString({
          limit: input.limit,
          cursor: normalizeOptionalString(input.cursor),
          from_tick: normalizeOptionalString(input.fromTick),
          to_tick: normalizeOptionalString(input.toTick),
          worker_id: normalizeOptionalString(input.workerId),
          partition_id: normalizeOptionalString(input.partitionId)
        })}`
      ),
    getSummary: (input: { sampleRuns?: number } = {}) =>
      requestApiData<SchedulerSummarySnapshot>(
        `/api/runtime/scheduler/summary${buildQueryString({
          sample_runs: input.sampleRuns
        })}`
      ),
    getTrends: (input: { sampleRuns?: number } = {}) =>
      requestApiData<SchedulerTrendsSnapshot>(
        `/api/runtime/scheduler/trends${buildQueryString({
          sample_runs: input.sampleRuns
        })}`
      ),
    getOperatorProjection: (input: { sampleRuns?: number; recentLimit?: number } = {}) =>
      requestApiData<SchedulerOperatorProjection>(
        `/api/runtime/scheduler/operator${buildQueryString({
          sample_runs: input.sampleRuns,
          recent_limit: input.recentLimit
        })}`
      ),
    getLatestRun: () => requestApiData<SchedulerRunReadModel | null>('/api/runtime/scheduler/runs/latest'),
    getRunById: (runId: string) => requestApiData<SchedulerRunReadModel | null>(`/api/runtime/scheduler/runs/${runId}`),
    listDecisions: (input: SchedulerDecisionsQueryInput = {}) =>
      requestApiData<SchedulerDecisionsSnapshot>(
        `/api/runtime/scheduler/decisions${buildQueryString({
          limit: input.limit,
          cursor: normalizeOptionalString(input.cursor),
          actor_id: normalizeOptionalString(input.actorId),
          kind: input.kind,
          reason: input.reason,
          skipped_reason: input.skippedReason,
          from_tick: normalizeOptionalString(input.fromTick),
          to_tick: normalizeOptionalString(input.toTick),
          partition_id: normalizeOptionalString(input.partitionId)
        })}`
      ),
    listOwnershipAssignments: (input: SchedulerOwnershipAssignmentsQueryInput = {}) =>
      requestApiData<SchedulerOwnershipAssignmentsSnapshot>(
        `/api/runtime/scheduler/ownership${buildQueryString({
          worker_id: normalizeOptionalString(input.workerId),
          partition_id: normalizeOptionalString(input.partitionId),
          status: input.status
        })}`
      ),
    listOwnershipMigrations: (input: SchedulerOwnershipMigrationsQueryInput = {}) =>
      requestApiData<{ items: SchedulerOwnershipMigrationReadModel[]; summary: { returned: number; limit: number; in_progress_count: number; filters: { worker_id: string | null; partition_id: string | null; status: SchedulerMigrationStatus | null } } }>(
        `/api/runtime/scheduler/migrations${buildQueryString({
          limit: input.limit,
          worker_id: normalizeOptionalString(input.workerId),
          partition_id: normalizeOptionalString(input.partitionId),
          status: input.status
        })}`
      ),
    listWorkers: (input: SchedulerWorkersQueryInput = {}) =>
      requestApiData<SchedulerWorkersSnapshot>(
        `/api/runtime/scheduler/workers${buildQueryString({
          worker_id: normalizeOptionalString(input.workerId),
          status: input.status
        })}`
      ),
    listRebalanceRecommendations: (input: SchedulerRebalanceRecommendationsQueryInput = {}) =>
      requestApiData<SchedulerRebalanceRecommendationsSnapshot>(
        `/api/runtime/scheduler/rebalance/recommendations${buildQueryString({
          limit: input.limit,
          worker_id: normalizeOptionalString(input.workerId),
          partition_id: normalizeOptionalString(input.partitionId),
          status: input.status,
          suppress_reason: normalizeOptionalString(input.suppressReason)
        })}`
      ),
    listAgentDecisions: (agentId: string) => requestApiData<SchedulerDecisionItem[]>(`/api/agent/${agentId}/scheduler`),
    getAgentProjection: (agentId: string, input: { limit?: number } = {}) =>
      requestApiData<AgentSchedulerProjection>(
        `/api/agent/${agentId}/scheduler/projection${buildQueryString({
          limit: input.limit
        })}`
      )
  }
}
