import { defineStore } from 'pinia'

export const useGraphStore = defineStore('graph', {
  state: () => ({
    isFetching: false,
    lastSyncedAt: null as number | null,
    autoRefreshMode: 'manual' as 'manual' | 'visible-polling'
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
