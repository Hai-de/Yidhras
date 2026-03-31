import { defineStore } from 'pinia'

export type OperatorWorkspaceId =
  | 'overview'
  | 'social'
  | 'workflow'
  | 'timeline'
  | 'graph'
  | 'agents'

export type DockTabId = 'traces' | 'jobs' | 'notifications'

export const useShellStore = defineStore('shell', {
  state: () => ({
    activeWorkspaceId: 'overview' as OperatorWorkspaceId,
    activeDockTabId: 'jobs' as DockTabId,
    isDockExpanded: true
  }),
  actions: {
    setActiveWorkspace(workspaceId: OperatorWorkspaceId) {
      this.activeWorkspaceId = workspaceId
    },
    setActiveDockTab(tabId: DockTabId) {
      this.activeDockTabId = tabId
    },
    setDockExpanded(isExpanded: boolean) {
      this.isDockExpanded = isExpanded
    },
    toggleDockExpanded() {
      this.isDockExpanded = !this.isDockExpanded
    }
  }
})
