import type { TimeFormatted } from '@yidhras/contracts'
import { defineStore } from 'pinia'

import type {
  FormattedClockSnapshot,
  RuntimeSpeedSnapshot,
  RuntimeStatusSnapshot,
  RuntimeWorldMetadata
} from '../composables/api/useSystemApi'
import { padTickString } from '../lib/time/format'
import { type TickString,ZERO_TICK } from '../lib/time/tick'

export const useRuntimeStore = defineStore('runtime', {
  state: () => ({
    absoluteTicks: ZERO_TICK as TickString,
    calendars: [] as TimeFormatted[],
    status: 'idle' as 'idle' | 'running' | 'paused' | 'error',
    worldPack: null as RuntimeWorldMetadata | null,
    healthLevel: 'ok' as 'ok' | 'degraded' | 'fail',
    runtimeReady: false,
    runtimeSpeed: null as RuntimeSpeedSnapshot | null,
    startupErrors: [] as string[],
    isClockSyncing: false,
    isStatusSyncing: false,
    lastClockSyncedAt: null as number | null,
    lastStatusSyncedAt: null as number | null,
    clockError: null as string | null,
    statusError: null as string | null
  }),
  getters: {
    formattedTicks: state => padTickString(state.absoluteTicks, 9),
    primaryCalendarTime: state => state.calendars[0]?.display ?? 'Syncing...',
    hasStartupErrors: state => state.startupErrors.length > 0,
    hasRuntimeError: state => state.status === 'error' || state.healthLevel === 'fail'
  },
  actions: {
    applyClockSnapshot(snapshot: FormattedClockSnapshot) {
      this.absoluteTicks = snapshot.absolute_ticks
      this.calendars = snapshot.calendars
      this.lastClockSyncedAt = Date.now()
    },
    applyRuntimeStatusSnapshot(snapshot: RuntimeStatusSnapshot) {
      this.status = snapshot.runtime_ready ? snapshot.status : 'error'
      this.worldPack = snapshot.world_pack
      this.healthLevel = snapshot.health_level
      this.runtimeReady = snapshot.runtime_ready
      this.runtimeSpeed = snapshot.runtime_speed
      this.startupErrors = snapshot.startup_errors
      this.lastStatusSyncedAt = Date.now()
    },
    setClockSyncing(isSyncing: boolean) {
      this.isClockSyncing = isSyncing
    },
    setStatusSyncing(isSyncing: boolean) {
      this.isStatusSyncing = isSyncing
    },
    setClockError(errorMessage: string | null) {
      this.clockError = errorMessage
    },
    setStatusError(errorMessage: string | null) {
      this.statusError = errorMessage
    }
  }
})
