import { useRouteQuery } from '@vueuse/router'
import { computed } from 'vue'

import { useGraphStore } from './store'

const normalizeOptionalString = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const normalizeBooleanQuery = (value: string | null | undefined, fallback: boolean): boolean => {
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

const normalizeGraphView = (value: string | null | undefined): 'mesh' | 'tree' => {
  return value === 'tree' ? 'tree' : 'mesh'
}

export const useGraphRouteState = () => {
  const graph = useGraphStore()

  const rootIdQuery = useRouteQuery<string | null>('root_id', null, { mode: 'replace' })
  const selectedNodeIdQuery = useRouteQuery<string | null>('selected_node_id', null, { mode: 'replace' })
  const viewQuery = useRouteQuery<string | null>('view', 'mesh', { mode: 'replace' })
  const depthQuery = useRouteQuery<string | null>('depth', '1', { mode: 'replace' })
  const kindsQuery = useRouteQuery<string | null>('kinds', null, { mode: 'replace' })
  const includeInactiveQuery = useRouteQuery<string | null>('include_inactive', null, {
    mode: 'replace'
  })
  const includeUnresolvedQuery = useRouteQuery<string | null>('include_unresolved', null, {
    mode: 'replace'
  })
  const searchQuery = useRouteQuery<string | null>('search', null, { mode: 'replace' })

  const view = computed(() => normalizeGraphView(viewQuery.value))
  const depth = computed(() => {
    const parsed = Number.parseInt(depthQuery.value ?? '1', 10)
    return Number.isFinite(parsed) ? Math.min(3, Math.max(0, parsed)) : 1
  })
  const rootId = computed(() => normalizeOptionalString(rootIdQuery.value))
  const selectedNodeId = computed(() => normalizeOptionalString(selectedNodeIdQuery.value))

  const filters = computed(() => ({
    kinds: normalizeOptionalString(kindsQuery.value),
    includeInactive: normalizeBooleanQuery(includeInactiveQuery.value, false),
    includeUnresolved: normalizeBooleanQuery(includeUnresolvedQuery.value, true),
    search: normalizeOptionalString(searchQuery.value)
  }))

  const applyRouteToStore = () => {
    graph.setView(view.value)
    graph.setRootId(rootId.value)
    graph.setSelectedNodeId(selectedNodeId.value)
    graph.setDepth(depth.value)
    graph.setKinds(filters.value.kinds)
    graph.setSearch(filters.value.search)
    graph.setIncludeInactive(filters.value.includeInactive)
    graph.setIncludeUnresolved(filters.value.includeUnresolved)
  }

  const setGraphView = (nextView: 'mesh' | 'tree') => {
    viewQuery.value = nextView === 'mesh' ? null : nextView
    graph.setView(nextView)
  }

  const setRootId = (nextRootId: string | null) => {
    rootIdQuery.value = normalizeOptionalString(nextRootId)
    graph.setRootId(normalizeOptionalString(nextRootId))
  }

  const setSelectedNodeId = (nodeId: string | null) => {
    selectedNodeIdQuery.value = normalizeOptionalString(nodeId)
    graph.setSelectedNodeId(normalizeOptionalString(nodeId))
  }

  const setFilters = (nextFilters: {
    depth?: number
    kinds?: string | null
    includeInactive?: boolean
    includeUnresolved?: boolean
    search?: string | null
  }) => {
    if (typeof nextFilters.depth === 'number' && Number.isFinite(nextFilters.depth)) {
      depthQuery.value = String(Math.min(3, Math.max(0, Math.trunc(nextFilters.depth))))
    }

    if ('kinds' in nextFilters) {
      kindsQuery.value = normalizeOptionalString(nextFilters.kinds ?? null)
    }

    if (typeof nextFilters.includeInactive === 'boolean') {
      includeInactiveQuery.value = nextFilters.includeInactive ? 'true' : null
    }

    if (typeof nextFilters.includeUnresolved === 'boolean') {
      includeUnresolvedQuery.value = nextFilters.includeUnresolved ? null : 'false'
    }

    if ('search' in nextFilters) {
      searchQuery.value = normalizeOptionalString(nextFilters.search ?? null)
    }
  }

  return {
    view,
    depth,
    rootId,
    selectedNodeId,
    filters,
    applyRouteToStore,
    setGraphView,
    setRootId,
    setSelectedNodeId,
    setFilters
  }
}
