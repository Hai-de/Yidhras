<template>
  <div class="flex h-full flex-col gap-4 overflow-hidden p-6">
    <GraphToolbar
      :view="routeView"
      :depth="routeDepth"
      :kinds="routeFilters.kinds"
      :search="routeFilters.search"
      :include-inactive="routeFilters.includeInactive"
      :include-unresolved="routeFilters.includeUnresolved"
      :auto-refresh-mode="graphAutoRefreshMode"
      @apply="handleApplyToolbar"
      @refresh="refresh"
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

    <div
      v-if="errorMessage"
      class="rounded-lg border border-yd-state-danger/40 bg-yd-app px-4 py-3 text-sm text-yd-state-danger"
    >
      {{ errorMessage }}
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

      <GraphInspector :inspector="inspector" :summary-fields="summaryFields" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import GraphInspector from '../features/graph/components/GraphInspector.vue'
import GraphMeshView from '../features/graph/components/GraphMeshView.vue'
import GraphMetricCard from '../features/graph/components/GraphMetricCard.vue'
import GraphToolbar from '../features/graph/components/GraphToolbar.vue'
import GraphTreeView from '../features/graph/components/GraphTreeView.vue'
import { useGraphPage } from '../features/graph/composables/useGraphPage'
import { toGraphCanvasSnapshot } from '../features/graph/lib/normalize'
import { useGraphStore } from '../features/graph/store'

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
const inspector = computed(() => graphPage.inspector.value)
const errorMessage = computed(() => graphPage.errorMessage.value)
const graphAutoRefreshMode = computed(() => graphStore.autoRefreshMode)

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
