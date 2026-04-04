import { defineStore } from 'pinia'

export const useWorkflowStore = defineStore('workflow', {
  state: () => ({
    isListFetching: false,
    lastListSyncedAt: null as number | null,
    detailPollingEnabled: true
  }),
  actions: {
    setListFetching(isFetching: boolean) {
      this.isListFetching = isFetching
    },
    markListSynced() {
      this.lastListSyncedAt = Date.now()
    },
    setDetailPollingEnabled(enabled: boolean) {
      this.detailPollingEnabled = enabled
    }
  }
})
