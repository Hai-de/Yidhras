import { defineStore } from 'pinia'

export interface TimeFormatted {
  calendar_id: string
  calendar_name: string
  display: string
  units: Record<string, string | number>
}

interface ClockResponse {
  absolute_ticks: string
  calendars: TimeFormatted[]
}

export const useClockStore = defineStore('clock', {
  state: () => ({
    absoluteTicks: 0n,
    calendars: [] as TimeFormatted[],
    syncInterval: null as ReturnType<typeof setInterval> | null
  }),
  getters: {
    formattedTicks: (state) => state.absoluteTicks.toString().padStart(9, '0'),
    
    primaryCalendarTime: (state) => {
      return state.calendars[0]?.display || 'Syncing...'
    }
  },
  actions: {
    async fetchCurrentTime() {
      try {
        const data = await $fetch<ClockResponse>('http://localhost:3001/api/clock')
        // 后端返回的是字符串 BigInt，前端转回 BigInt
        this.absoluteTicks = BigInt(data.absolute_ticks)
        this.calendars = data.calendars
      } catch (err) {
        console.error('[ClockStore] Failed to sync clock:', err)
      }
    },

    startSync() {
      if (this.syncInterval) return
      // 每秒与后端同步一次核心心跳
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
