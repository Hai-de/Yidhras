import { defineStore } from 'pinia'

export const useGraphStore = defineStore('graph', {
  state: (): {
    isFetching: boolean
    lastSyncedAt: number | null
    autoRefreshMode: 'manual' | 'visible-polling'
  } => ({
    isFetching: false,
    lastSyncedAt: null as number | null,
    autoRefreshMode: 'manual'
  }),
  actions: {
    setFetching(isFetching: boolean) {
      this.isFetching = isFetching
    },
    markSynced() {
      this.lastSyncedAt = Date.now()
    },
    setAutoRefreshMode(mode: 'manual' | 'visible-polling') {
      this.autoRefreshMode = mode
    }
  }
})
