import type { TimeFormatted } from '@yidhras/contracts'
import { defineStore } from 'pinia'

import { requestApiData } from '../lib/http/client'
import { padTickString } from '../lib/time/format'
import { type TickString,ZERO_TICK } from '../lib/time/tick'

interface ClockResponse {
  absolute_ticks: TickString
  calendars: TimeFormatted[]
}

export const useClockStore = defineStore('clock', {
  state: () => ({
    absoluteTicks: ZERO_TICK as TickString,
    calendars: [] as TimeFormatted[],
    syncInterval: null as ReturnType<typeof setInterval> | null
  }),
  getters: {
    formattedTicks: (state) => padTickString(state.absoluteTicks, 9),

    primaryCalendarTime: (state) => {
      return state.calendars[0]?.display || 'Syncing...'
    }
  },
  actions: {
    async fetchCurrentTime() {
      try {
        const data = await requestApiData<ClockResponse>('/api/clock/formatted')
        this.absoluteTicks = data.absolute_ticks
        this.calendars = data.calendars
      } catch (err) {
        console.error('[ClockStore] Failed to sync clock:', err)
      }
    },

    startSync() {
      if (this.syncInterval) return

      this.fetchCurrentTime()
      this.syncInterval = setInterval(() => {
        this.fetchCurrentTime()
      }, 1000)
    },

    stopSync() {
      if (this.syncInterval) {
        clearInterval(this.syncInterval)
        this.syncInterval = null
      }
    }
  }
})
