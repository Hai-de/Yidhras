import { requestApiData } from '../../lib/http/client'
import type { TickString } from '../../lib/time/tick'
import type {
  RuntimeStatusSnapshot,
  SystemNotificationSnapshot
} from './useSystemApi'

export interface OverviewAuditEntry {
  kind: 'workflow' | 'post' | 'relationship_adjustment' | 'snr_adjustment' | 'event'
  id: string
  created_at: TickString
  refs: Record<string, string | null>
  summary: string
  data: Record<string, unknown>
}

export interface OverviewSummarySnapshot {
  runtime: RuntimeStatusSnapshot
  world_time: {
    tick: TickString
    calendars: Array<{ display?: string } & Record<string, unknown>>
  }
  active_agent_count: number
  recent_events: OverviewAuditEntry[]
  latest_posts: OverviewAuditEntry[]
  latest_propagation: OverviewAuditEntry[]
  failed_jobs: OverviewAuditEntry[]
  dropped_intents: OverviewAuditEntry[]
  notifications: SystemNotificationSnapshot[]
}

export const useOverviewApi = () => {
  return {
    getSummary: () => requestApiData<OverviewSummarySnapshot>('/api/overview/summary')
  }
}
