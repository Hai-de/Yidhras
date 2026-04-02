import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useShellStore } from '../../stores/shell'

const createMemoryStorage = () => {
  const storage = new Map<string, string>()

  return {
    clear: () => {
      storage.clear()
    },
    getItem: (key: string) => {
      return storage.get(key) ?? null
    },
    key: (index: number) => {
      return Array.from(storage.keys())[index] ?? null
    },
    removeItem: (key: string) => {
      storage.delete(key)
    },
    setItem: (key: string, value: string) => {
      storage.set(key, value)
    },
    get length() {
      return storage.size
    }
  }
}

const localStorageMock = createMemoryStorage()

if (!('window' in globalThis)) {
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: localStorageMock },
    configurable: true
  })
} else {
  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    configurable: true
  })
}

describe('useShellStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('updates active workspace and dock tab', () => {
    const shell = useShellStore()

    shell.setActiveWorkspace('graph')
    shell.setActiveDockTab('notifications')

    expect(shell.activeWorkspaceId).toBe('graph')
    expect(shell.activeDockTabId).toBe('notifications')
  })

  it('toggles dock expanded state', () => {
    const shell = useShellStore()

    expect(shell.isDockExpanded).toBe(false)
    shell.toggleDockExpanded()
    expect(shell.isDockExpanded).toBe(true)
    shell.setDockExpanded(true)
    expect(shell.isDockExpanded).toBe(true)
  })

  it('persists dock height and enforces minimum height', () => {
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem')
    const shell = useShellStore()

    shell.setDockHeight(320)
    expect(shell.dockHeight).toBe(320)
    expect(setItemSpy).toHaveBeenLastCalledWith('yd-shell-dock-height', '320')

    shell.setDockHeight(80)
    expect(shell.dockHeight).toBe(160)
    expect(setItemSpy).toHaveBeenLastCalledWith('yd-shell-dock-height', '160')
  })

  it('hydrates dock height from localStorage on store creation', () => {
    window.localStorage.setItem('yd-shell-dock-height', '288')

    const shell = useShellStore()

    expect(shell.dockHeight).toBe(288)
  })

  it('records recent targets with dedupe and cap', () => {
    const shell = useShellStore()

    shell.recordRecentTarget({
      id: 'workflow:job-1',
      label: 'Workflow job job-1',
      meta: 'workflow',
      workspaceId: 'workflow',
      routePath: '/workflow?job_id=job-1'
    })
    shell.recordRecentTarget({
      id: 'agent:agent-1',
      label: 'Agent agent-1',
      meta: 'agent',
      workspaceId: 'agents',
      routePath: '/agents/agent-1'
    })
    shell.recordRecentTarget({
      id: 'workflow:job-1',
      label: 'Workflow job job-1',
      meta: 'workflow repeat',
      workspaceId: 'workflow',
      routePath: '/workflow?job_id=job-1'
    })

    expect(shell.recentTargets).toHaveLength(2)
    expect(shell.recentTargets[0]?.id).toBe('workflow:job-1')
    expect(shell.recentTargets[0]?.meta).toBe('workflow repeat')
  })
})
