import type {
  SchedulerDecisionItem,
  SchedulerOperatorProjection,
  SchedulerOwnershipMigrationReadModel,
  SchedulerPartitionOwnershipReadModel,
  SchedulerRebalanceRecommendationReadModel,
  SchedulerRunReadModel,
  SchedulerRunSummary,
  SchedulerWorkerRuntimeReadModel
} from '../../composables/api/useSchedulerApi'

export interface SchedulerMetricCardViewModel {
  id: string
  label: string
  value: string
  subtitle: string
}

export interface SchedulerHighlightCardViewModel {
  id: string
  label: string
  value: string
  tone: 'neutral' | 'info' | 'warning' | 'danger' | 'success'
}

export interface SchedulerListRowViewModel {
  id: string
  title: string
  meta: string
  detail?: string
  tone: 'neutral' | 'info' | 'warning' | 'danger' | 'success'
  actionLabel?: string
}

const toListTone = (input: {
  danger?: boolean
  warning?: boolean
  success?: boolean
  info?: boolean
}): SchedulerListRowViewModel['tone'] => {
  if (input.danger) return 'danger'
  if (input.warning) return 'warning'
  if (input.success) return 'success'
  if (input.info) return 'info'
  return 'neutral'
}

export const buildSchedulerWorkspaceMetrics = (
  projection: SchedulerOperatorProjection | null
): SchedulerMetricCardViewModel[] => {
  if (!projection) {
    return []
  }

  return [
    {
      id: 'scheduler-created',
      label: 'Created Jobs',
      value: String(projection.summary.run_totals.created_total),
      subtitle: 'Sampled scheduler-created workflows'
    },
    {
      id: 'scheduler-signals',
      label: 'Signals',
      value: String(projection.summary.run_totals.signals_detected_total),
      subtitle: 'Recent sampled signal detections'
    },
    {
      id: 'scheduler-migrations',
      label: 'Migrations',
      value: String(projection.highlights.migration_in_progress_count),
      subtitle: 'Ownership migrations currently in progress'
    },
    {
      id: 'scheduler-stale-workers',
      label: 'Stale Workers',
      value: String(projection.workers.summary.stale_count + projection.workers.summary.suspected_dead_count),
      subtitle: 'Workers needing operator attention'
    }
  ]
}

export const buildSchedulerHighlightCards = (
  projection: SchedulerOperatorProjection | null
): SchedulerHighlightCardViewModel[] => {
  if (!projection) {
    return []
  }

  return [
    {
      id: 'latest-partition',
      label: 'Latest Partition',
      value: projection.highlights.latest_partition_id ?? '—',
      tone: 'info'
    },
    {
      id: 'latest-top-reason',
      label: 'Top Reason',
      value: projection.highlights.latest_top_reason ?? '—',
      tone: 'neutral'
    },
    {
      id: 'latest-top-skipped',
      label: 'Top Skipped',
      value: projection.highlights.latest_top_skipped_reason ?? '—',
      tone: projection.highlights.latest_skipped_count > 0 ? 'warning' : 'neutral'
    },
    {
      id: 'latest-stale-worker',
      label: 'Stale Worker',
      value: projection.highlights.latest_stale_worker_id ?? '—',
      tone: projection.highlights.latest_stale_worker_id ? 'danger' : 'success'
    },
    {
      id: 'latest-rebalance',
      label: 'Latest Rebalance',
      value: projection.highlights.latest_rebalance_status ?? '—',
      tone: projection.highlights.latest_rebalance_suppress_reason ? 'warning' : 'info'
    },
    {
      id: 'latest-failure-code',
      label: 'Failure Code',
      value: projection.highlights.latest_top_failure_code ?? '—',
      tone: projection.highlights.latest_top_failure_code ? 'danger' : 'neutral'
    }
  ]
}

export const buildSchedulerRunRows = (runs: SchedulerRunSummary[]): SchedulerListRowViewModel[] => {
  return runs.map(run => ({
    id: run.id,
    title: `Run ${run.id}`,
    meta: `tick ${run.tick} · ${run.partition_id} · ${run.worker_id}`,
    detail: `created ${run.summary.created_count} · linked workflows ${run.cross_link_summary?.linked_workflow_count ?? 0} · signals ${run.summary.signals_detected_count}`,
    tone: toListTone({
      warning: (run.summary.skipped_pending_count ?? 0) + (run.summary.skipped_cooldown_count ?? 0) > 0,
      success: run.summary.created_count > 0,
      info: true
    }),
    actionLabel: 'Inspect run'
  }))
}

export const buildSchedulerDecisionRows = (decisions: SchedulerDecisionItem[]): SchedulerListRowViewModel[] => {
  return decisions.map(decision => ({
    id: decision.id,
    title: `${decision.actor_id} · ${decision.chosen_reason}`,
    meta: `${decision.kind} · ${decision.partition_id} · tick ${decision.scheduled_for_tick}`,
    detail: decision.skipped_reason
      ? `Skipped: ${decision.skipped_reason}`
      : decision.workflow_link?.job_id
        ? `Workflow job ${decision.workflow_link.job_id} · state ${decision.workflow_link.workflow_state ?? 'unknown'}`
        : decision.created_job_id
          ? `Created job ${decision.created_job_id}`
          : 'No workflow job materialized.',
    tone: toListTone({
      warning: Boolean(decision.skipped_reason),
      success: Boolean(decision.workflow_link?.job_id || decision.created_job_id)
    }),
    actionLabel: decision.workflow_link?.job_id || decision.created_job_id ? 'Open workflow' : 'Open agent'
  }))
}

export const buildSchedulerOwnershipRows = (
  items: SchedulerPartitionOwnershipReadModel[]
): SchedulerListRowViewModel[] => {
  return items.map(item => ({
    id: item.partition_id,
    title: `Partition ${item.partition_id}`,
    meta: `${item.worker_id ?? 'unassigned'} · ${item.status} · source ${item.source}`,
    detail: item.latest_migration
      ? `Latest migration → ${item.latest_migration.to_worker_id} · ${item.latest_migration.status}`
      : `Version ${item.version} · updated ${item.updated_at}`,
    tone: toListTone({
      warning: item.status === 'migrating',
      info: item.status === 'assigned'
    }),
    actionLabel: 'Filter partition'
  }))
}

export const buildSchedulerWorkerRows = (
  items: SchedulerWorkerRuntimeReadModel[]
): SchedulerListRowViewModel[] => {
  return items.map(item => ({
    id: item.worker_id,
    title: item.worker_id,
    meta: `${item.status} · partitions ${item.owned_partition_count} · migrations ${item.active_migration_count}`,
    detail: `heartbeat ${item.last_heartbeat_at} · capacity ${item.capacity_hint ?? '—'}`,
    tone: toListTone({
      danger: item.status === 'suspected_dead',
      warning: item.status === 'stale',
      success: item.status === 'active'
    }),
    actionLabel: 'Filter worker'
  }))
}

export const buildSchedulerMigrationRows = (
  items: SchedulerOwnershipMigrationReadModel[]
): SchedulerListRowViewModel[] => {
  return items.map(item => ({
    id: item.id,
    title: `Migration ${item.partition_id}`,
    meta: `${item.from_worker_id ?? 'unassigned'} → ${item.to_worker_id} · ${item.status}`,
    detail: item.reason ?? 'No migration reason recorded.',
    tone: toListTone({
      warning: item.status === 'in_progress' || item.status === 'requested',
      danger: item.status === 'failed',
      success: item.status === 'completed'
    }),
    actionLabel: 'Open scheduler context'
  }))
}

export const buildSchedulerRebalanceRows = (
  items: SchedulerRebalanceRecommendationReadModel[]
): SchedulerListRowViewModel[] => {
  return items.map(item => ({
    id: item.id,
    title: `Rebalance ${item.partition_id}`,
    meta: `${item.status} · score ${item.score ?? '—'} · ${item.from_worker_id ?? 'unassigned'} → ${item.to_worker_id ?? '—'}`,
    detail: item.suppress_reason ? `Suppressed: ${item.suppress_reason}` : `Reason: ${item.reason}`,
    tone: toListTone({
      warning: item.status === 'suppressed',
      success: item.status === 'applied',
      info: item.status === 'recommended',
      danger: item.status === 'expired'
    }),
    actionLabel: 'Filter partition'
  }))
}

export const buildSchedulerRunDetailFields = (run: SchedulerRunReadModel | null): Array<{ label: string; value: string }> => {
  if (!run) {
    return []
  }

  return [
    { label: 'run_id', value: run.run.id },
    { label: 'partition_id', value: run.run.partition_id },
    { label: 'worker_id', value: run.run.worker_id },
    { label: 'lease_holder', value: run.run.lease_holder ?? '—' },
    { label: 'tick', value: run.run.tick },
    { label: 'created_count', value: String(run.run.summary.created_count) },
    { label: 'signals_detected', value: String(run.run.summary.signals_detected_count) },
    { label: 'linked_workflows', value: String(run.run.cross_link_summary?.linked_workflow_count ?? 0) }
  ]
}
