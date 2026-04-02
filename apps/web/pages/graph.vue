<template>
  <div class="flex min-h-full flex-col gap-4 p-6">
    <WorkspacePageHeader
      eyebrow="Graph Projection"
      title="Relational and tree graph workspace"
      description="Switch between mesh and tree views, filter node kinds, search graph projections, and inspect selected node semantics in the operator console."
      :freshness="graphFreshness"
    >
      <template #actions>
        <button
          type="button"
          class="rounded-lg border border-yd-border-strong bg-yd-elevated px-4 py-2 text-xs uppercase tracking-[0.18em] text-yd-text-primary yd-font-mono"
          @click="refresh"
        >
          Refresh Graph
        </button>
      </template>
    </WorkspacePageHeader>

    <SourceContextBanner
      v-if="graphSourceSummary"
      :message="graphSourceSummary"
      return-label="Return to source"
      @return="returnToSource"
    />

    <GraphToolbar
      :view="routeView"
      :depth="routeDepth"
      :kinds="routeFilters.kinds"
      :search="routeFilters.search"
      :include-inactive="routeFilters.includeInactive"
      :include-unresolved="routeFilters.includeUnresolved"
      :auto-refresh-mode="graphAutoRefreshMode"
      :root-label="focusSummary.rootLabel"
      :selected-label="focusSummary.selectedNodeLabel"
      :result-summary="focusSummary.resultSummary"
      :filter-summary="focusSummary.filterSummary"
      :quick-roots="quickRoots"
      @apply="handleApplyToolbar"
      @clear-filters="clearFilters"
      @focus-selected="focusSelectedNode"
      @use-selected-as-root="useSelectedAsRoot"
      @use-quick-root="useQuickRoot"
      @refresh="refresh"
    />

    <WorkspaceStatusBanner
      v-if="errorMessage"
      title="Graph projection error"
      :message="errorMessage"
    />

    <WorkspaceStatusBanner
      v-else-if="!errorMessage"
      tone="info"
      title="Search Context"
      :message="searchExplainer"
    />

    <WorkspaceStatusBanner
      v-if="!errorMessage && metricItems.length > 0 && focusSummary.resultSummary.startsWith('0 node')"
      tone="warning"
      title="No graph results"
      message="Current graph filters returned no nodes. Clear filters or lower specificity to recover context."
    />

    <div class="grid gap-4 xl:grid-cols-4">
      <GraphMetricCard
        v-for="item in metricItems"
        :key="item.id"
        :label="item.label"
        :value="item.value"
        :subtitle="item.subtitle"
      />
    </div>

    <div class="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.15fr,0.85fr]">
      <div class="yd-panel-surface min-h-[34rem] overflow-hidden rounded-xl">
        <component
          :is="graphViewComponent"
          :snapshot="canvasSnapshot"
          :selected-node-id="routeSelectedNodeId"
          @select-node="selectNode"
        />
      </div>

      <GraphInspector
        :inspector="inspector"
        :summary-fields="summaryFields"
        @open-agent="openSelectedAgent"
        @open-workflow="openSelectedWorkflow"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { buildGraphSearchExplainer } from '../features/graph/adapters'
import GraphInspector from '../features/graph/components/GraphInspector.vue'
import GraphMeshView from '../features/graph/components/GraphMeshView.vue'
import GraphMetricCard from '../features/graph/components/GraphMetricCard.vue'
import GraphToolbar from '../features/graph/components/GraphToolbar.vue'
import GraphTreeView from '../features/graph/components/GraphTreeView.vue'
import { useGraphPage } from '../features/graph/composables/useGraphPage'
import { toGraphCanvasSnapshot } from '../features/graph/lib/normalize'
import { useGraphStore } from '../features/graph/store'
import SourceContextBanner from '../features/shared/components/SourceContextBanner.vue'
import WorkspacePageHeader from '../features/shared/components/WorkspacePageHeader.vue'
import WorkspaceStatusBanner from '../features/shared/components/WorkspaceStatusBanner.vue'
import { formatFreshnessLabel } from '../features/shared/feedback'

const graphPage = useGraphPage()
const graphStore = useGraphStore()

const routeView = graphPage.routeState.view
const routeDepth = graphPage.routeState.depth
const routeFilters = graphPage.routeState.filters
const routeSelectedNodeId = graphPage.routeState.selectedNodeId

const graphViewComponent = computed(() => {
  return routeView.value === 'tree' ? GraphTreeView : GraphMeshView
})

const metricItems = computed(() => graphPage.metricItems.value)
const summaryFields = computed(() => graphPage.summaryFields.value)
const focusSummary = computed(() => graphPage.focusSummary.value)
const quickRoots = computed(() => graphPage.quickRoots.value)
const inspector = computed(() => graphPage.inspector.value)
const errorMessage = computed(() => graphPage.errorMessage.value)
const graphAutoRefreshMode = computed(() => graphStore.autoRefreshMode)
const graphSourceSummary = graphPage.sourceSummary
const returnToSource = graphPage.returnToSource
const openSelectedAgent = graphPage.openSelectedAgent
const openSelectedWorkflow = graphPage.openSelectedWorkflow
const focusSelectedNode = graphPage.focusSelectedNode
const useSelectedAsRoot = graphPage.useSelectedAsRoot
const useQuickRoot = graphPage.useQuickRoot
const clearFilters = graphPage.clearFilters
const searchExplainer = computed(() => buildGraphSearchExplainer(graphPage.snapshot.value))

const graphFreshness = computed(() => {
  return formatFreshnessLabel(graphPage.lastSyncedAt.value, {
    isSyncing: graphPage.isFetching.value,
    syncingLabel: 'Refreshing graph projection',
    idleLabel: `Graph refresh mode · ${graphAutoRefreshMode.value}`
  })
})

const canvasSnapshot = computed(() => {
  return toGraphCanvasSnapshot(graphPage.snapshot.value?.nodes ?? [], graphPage.snapshot.value?.edges ?? [])
})

const handleApplyToolbar = (input: {
  view: 'mesh' | 'tree'
  depth: number
  kinds: string | null
  search: string | null
  includeInactive: boolean
  includeUnresolved: boolean
  autoRefreshMode: 'manual' | 'visible-polling'
}) => {
  graphPage.routeState.setGraphView(input.view)
  graphPage.routeState.setFilters({
    depth: input.depth,
    kinds: input.kinds,
    search: input.search,
    includeInactive: input.includeInactive,
    includeUnresolved: input.includeUnresolved
  })
  graphStore.setAutoRefreshMode(input.autoRefreshMode)
}

const refresh = () => {
  void graphPage.refresh()
}

const selectNode = (nodeId: string | null) => {
  graphPage.selectNode(nodeId)
}
</script>
