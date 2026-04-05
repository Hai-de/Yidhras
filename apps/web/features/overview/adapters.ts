import type { OverviewAuditEntry, OverviewSummarySnapshot } from '../../composables/api/useOverviewApi'
import type {
  SchedulerActorAggregateItem,
  SchedulerDecisionItem,
  SchedulerIntentClassAggregateItem,
  SchedulerOperatorProjection,
  SchedulerReasonAggregateItem,
  SchedulerRunSummary,
  SchedulerSkippedReasonAggregateItem,
  SchedulerSummarySnapshot,
  SchedulerTrendPoint,
  SchedulerWorkerRuntimeReadModel
} from '../../composables/api/useSchedulerApi'
import type { SystemNotificationSnapshot } from '../../composables/api/useSystemApi'

export interface OverviewListItemViewModel {
  id: string
  title: string
  meta: string
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info'
  actionLabel?: string
}

export interface OverviewSchedulerSummaryMetric {
  id: string
  label: string
  value: string
}

export interface OverviewSchedulerHighlightGroup {
  title: string
  items: string[]
}

export interface OverviewSchedulerTrendViewModel {
  id: string
  tick: string
  createdCount: string
  cadenceBreakdown: string
  signalsDetected: string
}

const toneByLevel = (level: string): OverviewListItemViewModel['tone'] => {
  switch (level) {
    case 'error':
      return 'danger'
    case 'warning':
      return 'warning'
    case 'info':
      return 'info'
    default:
      return 'neutral'
  }
}

const formatAggregateItems = (
  items: Array<SchedulerReasonAggregateItem | SchedulerSkippedReasonAggregateItem | SchedulerActorAggregateItem | SchedulerIntentClassAggregateItem>,
  resolveLabel: (
    item: SchedulerReasonAggregateItem | SchedulerSkippedReasonAggregateItem | SchedulerActorAggregateItem | SchedulerIntentClassAggregateItem
  ) => string
): string[] => {
  return items.slice(0, 3).map(item => `${resolveLabel(item)} · ${item.count}`)
}

const formatWorkerItems = (items: SchedulerWorkerRuntimeReadModel[]): string[] => {
  return items.slice(0, 3).map(item => `${item.worker_id} · ${item.status} · partitions ${item.owned_partition_count}`)
}

const appendHighlight = (target: string[], value: string | null | undefined) => {
  if (!value) {
    return
  }
  target.push(value)
}

export const toOverviewAuditListItems = (entries: OverviewAuditEntry[]): OverviewListItemViewModel[] => {
  return entries.map(entry => ({
    id: `${entry.kind}:${entry.id}`,
    title: entry.summary,
    meta: `${entry.kind} · tick ${entry.created_at}`,
    tone:
      entry.kind === 'workflow' && entry.data.workflow_state === 'workflow_failed'
        ? 'danger'
        : entry.kind === 'workflow' && entry.data.workflow_state === 'workflow_dropped'
          ? 'warning'
          : 'neutral'
  }))
}

export const toOverviewNotificationListItems = (
  notifications: SystemNotificationSnapshot[]
): OverviewListItemViewModel[] => {
  return notifications.map(notification => ({
    id: notification.id,
    title: notification.content,
    meta: `${notification.level} · tick ${notification.timestamp}`,
    tone: toneByLevel(notification.level)
  }))
}

export const buildOverviewMetricItems = (summary: OverviewSummarySnapshot) => {
  return [
    {
      id: 'active-agent-count',
      label: 'Active Agents',
      value: String(summary.active_agent_count),
      subtitle: 'Currently materialized active nodes'
    },
    {
      id: 'latest-posts-count',
      label: 'Latest Posts',
      value: String(summary.latest_posts.length),
      subtitle: 'Recent public social activity'
    },
    {
      id: 'failed-jobs-count',
      label: 'Failed Jobs',
      value: String(summary.failed_jobs.length),
      subtitle: 'Workflow failures in the latest audit window'
    },
    {
      id: 'notifications-count',
      label: 'Notifications',
      value: String(summary.notifications.length),
      subtitle: 'System queue snapshot'
    }
  ]
}

export const buildSchedulerSummaryMetrics = (
  summary: SchedulerSummarySnapshot | null,
  projection: SchedulerOperatorProjection | null = null
): OverviewSchedulerSummaryMetric[] => {
  if (!summary) {
    return []
  }

  return [
    {
      id: 'scheduler-sampled-runs',
      label: 'Sampled Runs',
      value: String(summary.run_totals.sampled_runs)
    },
    {
      id: 'scheduler-created-total',
      label: 'Created Jobs',
      value: String(summary.run_totals.created_total)
    },
    {
      id: 'scheduler-skipped-pending',
      label: 'Skipped Pending',
      value: String(summary.run_totals.skipped_pending_total)
    },
    {
      id: 'scheduler-signals',
      label: 'Signals Detected',
      value: String(summary.run_totals.signals_detected_total)
    },
    {
      id: 'scheduler-migrations-in-progress',
      label: 'Migrations In Progress',
      value: String(projection?.highlights.migration_in_progress_count ?? 0)
    },
    {
      id: 'scheduler-stale-workers',
      label: 'Stale Workers',
      value: String(projection?.workers.summary.stale_count ?? 0)
    }
  ]
}

export const buildSchedulerHighlightGroups = (
  summary: SchedulerSummarySnapshot | null,
  projection: SchedulerOperatorProjection | null = null
): OverviewSchedulerHighlightGroup[] => {
  if (!summary) {
    return []
  }

  const latestHighlights: string[] = []
  appendHighlight(
    latestHighlights,
    projection?.highlights.latest_partition_id ? `Latest partition · ${projection.highlights.latest_partition_id}` : null
  )
  appendHighlight(
    latestHighlights,
    projection ? `Created workflows · ${projection.highlights.latest_created_workflow_count}` : null
  )
  appendHighlight(
    latestHighlights,
    projection ? `Skipped decisions · ${projection.highlights.latest_skipped_count}` : null
  )
  appendHighlight(
    latestHighlights,
    projection?.highlights.latest_rebalance_status ? `Rebalance · ${projection.highlights.latest_rebalance_status}` : null
  )

  const ownershipHighlights: string[] = []
  appendHighlight(
    ownershipHighlights,
    projection?.highlights.top_owner_worker_id ? `Top owner · ${projection.highlights.top_owner_worker_id}` : null
  )
  appendHighlight(
    ownershipHighlights,
    projection?.highlights.latest_stale_worker_id ? `Stale worker · ${projection.highlights.latest_stale_worker_id}` : null
  )
  appendHighlight(
    ownershipHighlights,
    projection?.highlights.latest_migration_partition_id
      ? `Latest migration · ${projection.highlights.latest_migration_partition_id}`
      : null
  )
  appendHighlight(
    ownershipHighlights,
    projection?.highlights.latest_rebalance_partition_id
      ? `Latest rebalance partition · ${projection.highlights.latest_rebalance_partition_id}`
      : null
  )

  return [
    {
      title: 'Latest Highlights',
      items: latestHighlights
    },
    {
      title: 'Top Reasons',
      items: formatAggregateItems(summary.top_reasons, item => ('reason' in item ? item.reason : 'unknown'))
    },
    {
      title: 'Top Skipped',
      items: formatAggregateItems(summary.top_skipped_reasons, item => ('skipped_reason' in item ? item.skipped_reason : 'unknown'))
    },
    {
      title: 'Top Actors',
      items: formatAggregateItems(summary.top_actors, item => ('actor_id' in item ? item.actor_id : 'unknown'))
    },
    {
      title: 'Worker Health',
      items: projection ? formatWorkerItems(projection.workers.items) : []
    },
    {
      title: 'Intent Classes',
      items: formatAggregateItems(summary.intent_class_breakdown, item => ('intent_class' in item ? item.intent_class : 'unknown'))
    },
    {
      title: 'Ownership / Rebalance',
      items: ownershipHighlights
    }
  ]
}

export const buildSchedulerTrendItems = (points: SchedulerTrendPoint[]): OverviewSchedulerTrendViewModel[] => {
  return points.slice(0, 6).map(point => ({
    id: point.run_id,
    tick: point.tick,
    createdCount: String(point.created_count),
    cadenceBreakdown: `${point.created_periodic_count} periodic · ${point.created_event_driven_count} event`,
    signalsDetected: String(point.signals_detected_count)
  }))
}

export const buildSchedulerRunListItems = (runs: SchedulerRunSummary[]): OverviewListItemViewModel[] => {
  return runs.map(run => ({
    id: run.id,
    title: `tick ${run.tick} · ${run.partition_id} · created ${run.summary.created_count}`,
    meta: `${run.worker_id} · signals ${run.summary.signals_detected_count} · skipped ${run.summary.skipped_pending_count + run.summary.skipped_cooldown_count}`,
    tone: run.summary.created_count > 0 ? 'info' : 'neutral',
    actionLabel: 'Open workflow context'
  }))
}

export const buildSchedulerDecisionListItems = (decisions: SchedulerDecisionItem[]): OverviewListItemViewModel[] => {
  return decisions.map(decision => ({
    id: decision.id,
    title: `${decision.actor_id} · ${decision.chosen_reason}`,
    meta: `${decision.kind} · ${decision.partition_id} · priority ${decision.priority_score} · tick ${decision.scheduled_for_tick}${decision.skipped_reason ? ` · skipped ${decision.skipped_reason}` : decision.workflow_link?.job_id ? ` · job ${decision.workflow_link.job_id}` : decision.created_job_id ? ` · job ${decision.created_job_id}` : ''}`,
    tone: decision.skipped_reason ? 'warning' : 'success',
    actionLabel: decision.created_job_id || decision.workflow_link?.job_id ? 'Open workflow' : 'Open agent'
  }))
}
