import { defineStore } from 'pinia'

export const useWorkflowStore = defineStore('workflow', {
  state: () => ({
    selectedJobId: null as string | null,
    selectedTraceId: null as string | null,
    selectedIntentId: null as string | null,
    activeTab: 'job' as 'job' | 'trace' | 'intent' | 'workflow',
    listFilters: {
      status: null as string | null,
      agentId: null as string | null,
      strategy: null as string | null,
      actionIntentId: null as string | null
    },
    isListFetching: false,
    lastListSyncedAt: null as number | null,
    detailPollingEnabled: true
  }),
  actions: {
    setSelectedJobId(jobId: string | null) {
      this.selectedJobId = jobId
    },
    setSelectedTraceId(traceId: string | null) {
      this.selectedTraceId = traceId
    },
    setSelectedIntentId(intentId: string | null) {
      this.selectedIntentId = intentId
    },
    setActiveTab(tab: 'job' | 'trace' | 'intent' | 'workflow') {
      this.activeTab = tab
    },
    setListFilters(filters: {
      status?: string | null
      agentId?: string | null
      strategy?: string | null
      actionIntentId?: string | null
    }) {
      this.listFilters = {
        status: filters.status ?? null,
        agentId: filters.agentId ?? null,
        strategy: filters.strategy ?? null,
        actionIntentId: filters.actionIntentId ?? null
      }
    },
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
