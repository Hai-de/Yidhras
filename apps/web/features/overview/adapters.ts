import type { OverviewAuditEntry, OverviewSummarySnapshot } from '../../composables/api/useOverviewApi'
import type {
  SchedulerActorAggregateItem,
  SchedulerDecisionItem,
  SchedulerIntentClassAggregateItem,
  SchedulerReasonAggregateItem,
  SchedulerRunSummary,
  SchedulerSummarySnapshot,
  SchedulerTrendPoint
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
  items: Array<SchedulerReasonAggregateItem | SchedulerActorAggregateItem | SchedulerIntentClassAggregateItem>,
  resolveLabel: (item: SchedulerReasonAggregateItem | SchedulerActorAggregateItem | SchedulerIntentClassAggregateItem) => string
): string[] => {
  return items.slice(0, 3).map(item => `${resolveLabel(item)} · ${item.count}`)
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
  summary: SchedulerSummarySnapshot | null
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
      value: String(summary.run_totals.total_created_count)
    },
    {
      id: 'scheduler-skipped-pending',
      label: 'Skipped Pending',
      value: String(summary.run_totals.total_skipped_pending_count)
    },
    {
      id: 'scheduler-signals',
      label: 'Signals Detected',
      value: String(summary.run_totals.total_signals_detected_count)
    }
  ]
}

export const buildSchedulerHighlightGroups = (
  summary: SchedulerSummarySnapshot | null
): OverviewSchedulerHighlightGroup[] => {
  if (!summary) {
    return []
  }

  return [
    {
      title: 'Top Reasons',
      items: formatAggregateItems(summary.top_reasons, item => ('reason' in item ? item.reason : 'unknown'))
    },
    {
      title: 'Top Skipped',
      items: formatAggregateItems(summary.top_skipped_reasons, item => ('reason' in item ? item.reason : 'unknown'))
    },
    {
      title: 'Top Actors',
      items: formatAggregateItems(summary.top_actors, item => ('actor_id' in item ? item.actor_id : 'unknown'))
    },
    {
      title: 'Intent Classes',
      items: formatAggregateItems(summary.intent_class_breakdown, item => ('intent_class' in item ? item.intent_class : 'unknown'))
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
    title: `tick ${run.tick} · created ${run.summary.created_count} · scanned ${run.summary.scanned_count}`,
    meta: `${run.worker_id} · signals ${run.summary.signals_detected_count} · skipped ${run.summary.skipped_pending_count + run.summary.skipped_cooldown_count}`,
    tone: run.summary.created_count > 0 ? 'info' : 'neutral',
    actionLabel: 'Open workflow context'
  }))
}

export const buildSchedulerDecisionListItems = (decisions: SchedulerDecisionItem[]): OverviewListItemViewModel[] => {
  return decisions.map(decision => ({
    id: decision.id,
    title: `${decision.actor_id} · ${decision.chosen_reason}`,
    meta: `${decision.kind} · priority ${decision.priority_score} · tick ${decision.scheduled_for_tick}${decision.skipped_reason ? ` · skipped ${decision.skipped_reason}` : decision.created_job_id ? ` · job ${decision.created_job_id}` : ''}`,
    tone: decision.skipped_reason ? 'warning' : 'success',
    actionLabel: decision.created_job_id ? 'Open workflow' : 'Open agent'
  }))
}
