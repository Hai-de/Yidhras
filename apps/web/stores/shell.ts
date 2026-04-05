import { defineStore } from 'pinia'

export type OperatorWorkspaceId =
  | 'overview'
  | 'scheduler'
  | 'social'
  | 'workflow'
  | 'timeline'
  | 'graph'
  | 'agents'

export type DockTabId = 'traces' | 'jobs' | 'notifications'

export interface ShellRecentTarget {
  id: string
  label: string
  meta: string
  workspaceId: OperatorWorkspaceId
  routePath: string
}

const DEFAULT_DOCK_HEIGHT = 224
const MIN_DOCK_HEIGHT = 160

const readPersistedDockHeight = () => {
  if (typeof window === 'undefined') return DEFAULT_DOCK_HEIGHT

  const rawValue = window.localStorage.getItem('yd-shell-dock-height')
  if (!rawValue) return DEFAULT_DOCK_HEIGHT

  const parsedValue = Number(rawValue)
  if (!Number.isFinite(parsedValue)) return DEFAULT_DOCK_HEIGHT

  return Math.max(parsedValue, MIN_DOCK_HEIGHT)
}

const persistDockHeight = (height: number) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem('yd-shell-dock-height', String(height))
}

export const useShellStore = defineStore('shell', {
  state: () => ({
    activeWorkspaceId: 'overview' as OperatorWorkspaceId,
    activeDockTabId: 'jobs' as DockTabId,
    isDockExpanded: false,
    recentTargets: [] as ShellRecentTarget[],
    dockHeight: readPersistedDockHeight()
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
    },
    setDockHeight(height: number) {
      this.dockHeight = Math.max(height, MIN_DOCK_HEIGHT)
      persistDockHeight(this.dockHeight)
    },
    recordRecentTarget(target: ShellRecentTarget) {
      this.recentTargets = [target, ...this.recentTargets.filter(item => item.id !== target.id)].slice(0, 8)
    }
  }
})
