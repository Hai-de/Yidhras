import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useShellStore } from '../../stores/shell'

describe('useShellStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
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

    expect(shell.isDockExpanded).toBe(true)
    shell.toggleDockExpanded()
    expect(shell.isDockExpanded).toBe(false)
    shell.setDockExpanded(true)
    expect(shell.isDockExpanded).toBe(true)
  })
})
