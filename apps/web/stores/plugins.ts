import { defineStore } from 'pinia'

import type { ActivePackPluginRuntimeSnapshot } from '../composables/api/usePluginApi'

export const usePluginRuntimeStore = defineStore('plugin-runtime', {
  state: () => ({
    activePackId: null as string | null,
    runtime: null as ActivePackPluginRuntimeSnapshot | null,
    isFetching: false,
    errorMessage: null as string | null,
    lastSyncedAt: null as number | null
  }),
  getters: {
    panelPlugins: state => (target: string) =>
      state.runtime?.plugins.filter(plugin => plugin.contributions.panels.some(panel => panel.target === target)) ?? []
  },
  actions: {
    applyRuntime(snapshot: ActivePackPluginRuntimeSnapshot) {
      this.activePackId = snapshot.pack_id
      this.runtime = snapshot
      this.lastSyncedAt = Date.now()
    },
    setFetching(value: boolean) {
      this.isFetching = value
    },
    setErrorMessage(message: string | null) {
      this.errorMessage = message
    }
  }
})
