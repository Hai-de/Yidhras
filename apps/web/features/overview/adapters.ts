import type { OverviewAuditEntry, OverviewSummarySnapshot } from '../../composables/api/useOverviewApi'
import type { SystemNotificationSnapshot } from '../../composables/api/useSystemApi'

export interface OverviewListItemViewModel {
  id: string
  title: string
  meta: string
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info'
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
