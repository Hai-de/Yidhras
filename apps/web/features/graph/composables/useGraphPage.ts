import { computed, ref, watch } from 'vue'

import type { GraphViewSnapshot } from '../../../composables/api/useGraphApi'
import { useGraphApi } from '../../../composables/api/useGraphApi'
import { useVisibilityPolling } from '../../../composables/app/useVisibilityPolling'
import {
  buildGraphInspectorViewModel,
  buildGraphMetricItems,
  buildGraphSummaryFields,
  findGraphNodeById,
  getConnectedEdges
} from '../adapters'
import { useGraphRouteState } from '../route'
import { useGraphStore } from '../store'

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : 'Unknown graph error'
}

export const useGraphPage = () => {
  const graphApi = useGraphApi()
  const graphRoute = useGraphRouteState()
  const graphStore = useGraphStore()

  const snapshot = ref<GraphViewSnapshot | null>(null)
  const errorMessage = ref<string | null>(null)
  const isFetching = ref(false)

  const fetchGraphView = async () => {
    isFetching.value = true
    graphStore.setFetching(true)

    try {
      snapshot.value = await graphApi.getView({
        view: graphRoute.view.value,
        rootId: graphRoute.rootId.value,
        depth: graphRoute.depth.value,
        kinds: graphRoute.filters.value.kinds,
        includeInactive: graphRoute.filters.value.includeInactive,
        includeUnresolved: graphRoute.filters.value.includeUnresolved,
        search: graphRoute.filters.value.search
      })

      graphStore.setDepth(graphRoute.depth.value)
      graphStore.setKinds(graphRoute.filters.value.kinds)
      graphStore.setSearch(graphRoute.filters.value.search)
      graphStore.markSynced()
      errorMessage.value = null
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      isFetching.value = false
      graphStore.setFetching(false)
    }
  }

  const polling = useVisibilityPolling(fetchGraphView, {
    visibleIntervalMs: 30000,
    hiddenIntervalMs: null,
    enabled: computed(() => graphStore.autoRefreshMode === 'visible-polling'),
    immediate: false,
    refreshOnVisible: true
  })

  graphRoute.applyRouteToStore()

  watch(
    [graphRoute.view, graphRoute.depth, graphRoute.rootId, graphRoute.selectedNodeId, graphRoute.filters],
    () => {
      graphRoute.applyRouteToStore()
      void fetchGraphView()
    },
    { deep: true, immediate: true }
  )

  const selectedNode = computed(() => findGraphNodeById(snapshot.value, graphRoute.selectedNodeId.value))
  const connectedEdges = computed(() => getConnectedEdges(snapshot.value, graphRoute.selectedNodeId.value))
  const inspector = computed(() => buildGraphInspectorViewModel(selectedNode.value, connectedEdges.value))
  const metricItems = computed(() => buildGraphMetricItems(snapshot.value))
  const summaryFields = computed(() => buildGraphSummaryFields(snapshot.value))

  const selectNode = (nodeId: string | null) => {
    graphRoute.setSelectedNodeId(nodeId)
  }

  return {
    snapshot,
    metricItems,
    summaryFields,
    selectedNode,
    connectedEdges,
    inspector,
    errorMessage,
    isFetching,
    routeState: graphRoute,
    refresh: fetchGraphView,
    refreshPolling: polling.refresh,
    selectNode
  }
}
