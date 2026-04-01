import { computed, ref, watch } from 'vue'

import type { GraphViewSnapshot } from '../../../composables/api/useGraphApi'
import { useGraphApi } from '../../../composables/api/useGraphApi'
import { useVisibilityPolling } from '../../../composables/app/useVisibilityPolling'
import { useNotificationsStore } from '../../../stores/notifications'
import { useOperatorNavigation } from '../../shared/navigation'
import { useOperatorSourceContext } from '../../shared/source-context'
import {
  buildGraphFocusSummary,
  buildGraphInspectorViewModel,
  buildGraphMetricItems,
  buildGraphQuickRoots,
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
  const navigation = useOperatorNavigation()
  const sourceContext = useOperatorSourceContext()
  const notifications = useNotificationsStore()

  const snapshot = ref<GraphViewSnapshot | null>(null)
  const errorMessage = ref<string | null>(null)

  const fetchGraphView = async () => {
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

      graphStore.markSynced()
      errorMessage.value = null
    } catch (error) {
      const message = getErrorMessage(error)
      errorMessage.value = message
      notifications.pushLocalItem({
        level: 'error',
        content: `Graph projection refresh failed: ${message}`,
        code: 'graph_refresh_failed'
      })
    } finally {
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

  watch(
    [graphRoute.view, graphRoute.depth, graphRoute.rootId, graphRoute.selectedNodeId, graphRoute.filters],
    () => {
      void fetchGraphView()
    },
    { deep: true, immediate: true }
  )

  const selectedNode = computed(() => findGraphNodeById(snapshot.value, graphRoute.selectedNodeId.value))
  const connectedEdges = computed(() => getConnectedEdges(snapshot.value, graphRoute.selectedNodeId.value))
  const inspector = computed(() => buildGraphInspectorViewModel(selectedNode.value, connectedEdges.value))
  const metricItems = computed(() => buildGraphMetricItems(snapshot.value))
  const summaryFields = computed(() => buildGraphSummaryFields(snapshot.value))
  const focusSummary = computed(() => buildGraphFocusSummary(snapshot.value, selectedNode.value))
  const quickRoots = computed(() => buildGraphQuickRoots(snapshot.value, graphRoute.rootId.value))
  const selectedAgentId = computed(() => selectedNode.value?.refs?.agent_id ?? null)
  const selectedActionIntentId = computed(() => selectedNode.value?.refs?.source_action_intent_id ?? null)

  const selectNode = (nodeId: string | null) => {
    graphRoute.setSelectedNodeId(nodeId)
  }

  const focusSelectedNode = () => {
    if (!graphRoute.selectedNodeId.value && snapshot.value?.nodes[0]?.id) {
      graphRoute.setSelectedNodeId(snapshot.value.nodes[0].id)
    }
  }

  const setRootById = (rootId: string) => {
    graphRoute.setRootId(rootId)
    graphRoute.setSelectedNodeId(rootId)

    const rootNode = findGraphNodeById(snapshot.value, rootId)
    notifications.pushLocalItem({
      level: 'info',
      content: `Graph root updated to ${rootNode?.label ?? rootId}`,
      code: 'graph_root_updated'
    })
  }

  const useSelectedAsRoot = () => {
    if (!selectedNode.value) {
      return
    }

    setRootById(selectedNode.value.id)
  }

  const useQuickRoot = (rootId: string) => {
    setRootById(rootId)
  }

  const clearFilters = () => {
    graphRoute.setRootId(null)
    graphRoute.setSelectedNodeId(null)
    graphRoute.setGraphView('mesh')
    graphRoute.setFilters({
      depth: 1,
      kinds: null,
      search: null,
      includeInactive: false,
      includeUnresolved: true
    })
    notifications.pushLocalItem({
      level: 'info',
      content: 'Graph filters reset to baseline view',
      code: 'graph_filters_cleared'
    })
  }

  const openSelectedAgent = () => {
    if (!selectedAgentId.value) {
      return
    }

    void navigation.goToAgent(selectedAgentId.value, {
      context: {
        sourcePage: 'graph',
        ...(graphRoute.rootId.value ? { sourceRootId: graphRoute.rootId.value } : {}),
        ...(graphRoute.selectedNodeId.value ? { sourceNodeId: graphRoute.selectedNodeId.value } : {})
      }
    })
  }

  const openSelectedWorkflow = () => {
    if (!selectedActionIntentId.value) {
      return
    }

    void navigation.goToWorkflowActionIntent(selectedActionIntentId.value, 'intent', {
      sourcePage: 'graph',
      ...(graphRoute.rootId.value ? { sourceRootId: graphRoute.rootId.value } : {}),
      ...(graphRoute.selectedNodeId.value ? { sourceNodeId: graphRoute.selectedNodeId.value } : {})
    })
  }

  const returnToSource = () => {
    if (sourceContext.source.value.sourcePage === 'social' && sourceContext.source.value.sourcePostId) {
      void navigation.goToSocialPost(sourceContext.source.value.sourcePostId)
      return
    }

    if (sourceContext.source.value.sourcePage === 'timeline' && sourceContext.source.value.sourceEventId) {
      void navigation.goToTimelineEvent(sourceContext.source.value.sourceEventId)
    }
  }

  return {
    snapshot,
    metricItems,
    summaryFields,
    focusSummary,
    quickRoots,
    selectedNode,
    connectedEdges,
    inspector,
    errorMessage,
    isFetching: computed(() => graphStore.isFetching),
    lastSyncedAt: computed(() => graphStore.lastSyncedAt),
    routeState: graphRoute,
    refresh: fetchGraphView,
    refreshPolling: polling.refresh,
    selectNode,
    focusSelectedNode,
    useSelectedAsRoot,
    useQuickRoot,
    clearFilters,
    openSelectedAgent,
    openSelectedWorkflow,
    sourceSummary: sourceContext.summary,
    hasSource: sourceContext.hasSource,
    returnToSource
  }
}
