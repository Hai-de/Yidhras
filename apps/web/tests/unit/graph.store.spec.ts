import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useGraphStore } from '../../features/graph/store'

describe('useGraphStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('tracks fetch and refresh mode state', () => {
    const graph = useGraphStore()

    graph.setAutoRefreshMode('visible-polling')

    expect(graph.isFetching).toBe(false)
    expect(graph.autoRefreshMode).toBe('visible-polling')
    expect(graph.lastSyncedAt).toBeNull()
  })
})
