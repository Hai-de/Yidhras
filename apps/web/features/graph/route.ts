import { useRouteQuery } from '@vueuse/router'
import { computed } from 'vue'

import { normalizeBooleanQuery, normalizeOptionalString } from '../../lib/route/query'

export const normalizeBooleanQuery = (value: string | null | undefined, fallback: boolean): boolean => {
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

export const normalizeGraphView = (value: string | null | undefined): 'mesh' | 'tree' => {
  return value === 'tree' ? 'tree' : 'mesh'
}

export const normalizeGraphDepth = (value: string | null | undefined): number => {
  const parsed = Number.parseInt(value ?? '1', 10)
  return Number.isFinite(parsed) ? Math.min(3, Math.max(0, parsed)) : 1
}

export const useGraphRouteState = () => {
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
  const depth = computed(() => normalizeGraphDepth(depthQuery.value))
  const rootId = computed(() => normalizeOptionalString(rootIdQuery.value))
  const selectedNodeId = computed(() => normalizeOptionalString(selectedNodeIdQuery.value))

  const filters = computed(() => ({
    kinds: normalizeOptionalString(kindsQuery.value),
    includeInactive: normalizeBooleanQuery(includeInactiveQuery.value, false),
    includeUnresolved: normalizeBooleanQuery(includeUnresolvedQuery.value, true),
    search: normalizeOptionalString(searchQuery.value)
  }))

  const setGraphView = (nextView: 'mesh' | 'tree') => {
    viewQuery.value = nextView === 'mesh' ? null : nextView
  }

  const setRootId = (nextRootId: string | null) => {
    rootIdQuery.value = normalizeOptionalString(nextRootId)
  }

  const setSelectedNodeId = (nodeId: string | null) => {
    selectedNodeIdQuery.value = normalizeOptionalString(nodeId)
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
    setGraphView,
    setRootId,
    setSelectedNodeId,
    setFilters
  }
}
