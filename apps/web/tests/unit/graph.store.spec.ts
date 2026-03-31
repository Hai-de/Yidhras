import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useGraphStore } from '../../features/graph/store'

describe('useGraphStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('updates graph route driven state', () => {
    const graph = useGraphStore()

    graph.setView('tree')
    graph.setRootId('agent-root')
    graph.setSelectedNodeId('relay:123')
    graph.setDepth(2)
    graph.setKinds('agent,relay')
    graph.setSearch('alpha')
    graph.setIncludeInactive(true)
    graph.setIncludeUnresolved(false)

    expect(graph.view).toBe('tree')
    expect(graph.rootId).toBe('agent-root')
    expect(graph.selectedNodeId).toBe('relay:123')
    expect(graph.depth).toBe(2)
    expect(graph.kinds).toBe('agent,relay')
    expect(graph.search).toBe('alpha')
    expect(graph.includeInactive).toBe(true)
    expect(graph.includeUnresolved).toBe(false)
  })

  it('tracks fetch and refresh mode state', () => {
    const graph = useGraphStore()

    graph.setFetching(true)
    graph.setAutoRefreshMode('visible-polling')
    graph.markSynced()

    expect(graph.isFetching).toBe(true)
    expect(graph.autoRefreshMode).toBe('visible-polling')
    expect(graph.lastSyncedAt).toEqual(expect.any(Number))
  })
})
