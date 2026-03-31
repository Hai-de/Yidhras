import type { TimeFormatted } from '@yidhras/contracts'

import { requestApiData } from '../../lib/http/client'
import { type TickString,toTickString } from '../../lib/time/tick'

export interface RuntimeWorldMetadata {
  id: string
  name: string
  version: string
  description?: string
}

export interface RuntimeSpeedSnapshot {
  mode: 'fixed'
  source: 'default' | 'world_pack' | 'override'
  configured_step_ticks: TickString | null
  override_step_ticks: TickString | null
  override_since: number | null
  effective_step_ticks: TickString
}

export interface RuntimeStatusSnapshot {
  status: 'running' | 'paused'
  runtime_ready: boolean
  runtime_speed: RuntimeSpeedSnapshot
  health_level: 'ok' | 'degraded' | 'fail'
  world_pack: RuntimeWorldMetadata | null
  has_error: boolean
  startup_errors: string[]
}

export interface FormattedClockSnapshot {
  absolute_ticks: TickString
  calendars: TimeFormatted[]
}

interface RawSystemNotification {
  id: string
  level: 'info' | 'warning' | 'error'
  content: string
  timestamp: TickString | number
  code?: string
  details?: unknown
}

export interface SystemNotificationSnapshot {
  id: string
  level: 'info' | 'warning' | 'error'
  content: string
  timestamp: TickString
  code?: string
  details?: unknown
}

export interface ClearNotificationsResponse {
  acknowledged: true
}

const normalizeSystemNotification = (
  notification: RawSystemNotification
): SystemNotificationSnapshot => {
  return {
    ...notification,
    timestamp: toTickString(notification.timestamp, 'notification timestamp')
  }
}

export const useSystemApi = () => {
  return {
    getRuntimeStatus: () => requestApiData<RuntimeStatusSnapshot>('/api/status'),
    getFormattedClock: () => requestApiData<FormattedClockSnapshot>('/api/clock/formatted'),
    listNotifications: async () => {
      const notifications = await requestApiData<RawSystemNotification[]>('/api/system/notifications')
      return notifications.map(normalizeSystemNotification)
    },
    clearNotifications: () =>
      requestApiData<ClearNotificationsResponse>('/api/system/notifications/clear', {
        method: 'POST'
      })
  }
}
