import { defineStore } from 'pinia'

export const useGraphStore = defineStore('graph', {
  state: () => ({
    view: 'mesh' as 'mesh' | 'tree',
    rootId: null as string | null,
    selectedNodeId: null as string | null,
    depth: 1,
    kinds: null as string | null,
    search: null as string | null,
    includeInactive: false,
    includeUnresolved: true,
    isFetching: false,
    lastSyncedAt: null as number | null,
    autoRefreshMode: 'manual' as 'manual' | 'visible-polling'
  }),
  actions: {
    setView(view: 'mesh' | 'tree') {
      this.view = view
    },
    setRootId(rootId: string | null) {
      this.rootId = rootId
    },
    setSelectedNodeId(nodeId: string | null) {
      this.selectedNodeId = nodeId
    },
    setDepth(depth: number) {
      this.depth = depth
    },
    setKinds(kinds: string | null) {
      this.kinds = kinds
    },
    setSearch(search: string | null) {
      this.search = search
    },
    setIncludeInactive(includeInactive: boolean) {
      this.includeInactive = includeInactive
    },
    setIncludeUnresolved(includeUnresolved: boolean) {
      this.includeUnresolved = includeUnresolved
    },
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
