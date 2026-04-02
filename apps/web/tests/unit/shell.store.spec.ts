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

    expect(shell.isDockExpanded).toBe(false)
    shell.toggleDockExpanded()
    expect(shell.isDockExpanded).toBe(true)
    shell.setDockExpanded(true)
    expect(shell.isDockExpanded).toBe(true)
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
