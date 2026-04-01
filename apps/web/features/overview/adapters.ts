import type { OverviewAuditEntry, OverviewSummarySnapshot } from '../../composables/api/useOverviewApi'
import type {
  SchedulerDecisionItem,
  SchedulerRunSummary
} from '../../composables/api/useSchedulerApi'
import type { SystemNotificationSnapshot } from '../../composables/api/useSystemApi'

export interface OverviewListItemViewModel {
  id: string
  title: string
  meta: string
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info'
  actionLabel?: string
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

export const buildSchedulerRunListItems = (runs: SchedulerRunSummary[]): OverviewListItemViewModel[] => {
  return runs.map(run => ({
    id: run.id,
    title: `tick ${run.tick} · created ${run.summary.created_count} · scanned ${run.summary.scanned_count}`,
    meta: `${run.worker_id} · periodic ${run.summary.created_periodic_count} · event ${run.summary.created_event_driven_count}`,
    tone: run.summary.created_count > 0 ? 'info' : 'neutral',
    actionLabel: 'Open run'
  }))
}

export const buildSchedulerDecisionListItems = (decisions: SchedulerDecisionItem[]): OverviewListItemViewModel[] => {
  return decisions.map(decision => ({
    id: decision.id,
    title: `${decision.actor_id} · ${decision.chosen_reason}`,
    meta: `${decision.kind} · tick ${decision.scheduled_for_tick}${decision.skipped_reason ? ` · skipped ${decision.skipped_reason}` : ''}`,
    tone: decision.skipped_reason ? 'warning' : 'success',
    actionLabel: decision.created_job_id ? 'Open workflow' : 'Open agent'
  }))
}
