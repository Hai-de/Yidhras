<template>
  <div ref="containerRef" class="h-full w-full bg-yd-app"></div>
</template>

<script setup lang="ts">
import type cytoscape from 'cytoscape'
import { onMounted, onUnmounted, ref, watch } from 'vue'

import type { GraphViewMode } from '../../../composables/api/useGraphApi'
import { createGraphInstance, focusGraphNeighborhood, updateGraphInstance } from '../lib/cytoscape'
import type { GraphCanvasSnapshot } from '../lib/normalize'

const props = defineProps<{
  snapshot: GraphCanvasSnapshot
  view: GraphViewMode
  selectedNodeId: string | null
}>()

const emit = defineEmits<{
  selectNode: [nodeId: string | null]
}>()

const containerRef = ref<HTMLDivElement | null>(null)
let graphInstance: cytoscape.Core | null = null

const bindSelectionEvents = (instance: cytoscape.Core) => {
  instance.on('tap', 'node', event => {
    emit('selectNode', event.target.id())
  })

  instance.on('tap', event => {
    if (event.target === instance) {
      emit('selectNode', null)
    }
  })
}

const applySelectedNode = (selectedNodeId: string | null) => {
  if (!graphInstance) {
    return
  }

  graphInstance.elements().unselect()

  if (!selectedNodeId) {
    return
  }

  const node = graphInstance.getElementById(selectedNodeId)
  if (node.nonempty()) {
    node.select()
    focusGraphNeighborhood(graphInstance, selectedNodeId)
  }
}

const mountGraph = () => {
  if (!containerRef.value) {
    return
  }

  const container = containerRef.value as unknown as HTMLElement
  graphInstance = createGraphInstance(container, props.snapshot, props.view)
  bindSelectionEvents(graphInstance)
  applySelectedNode(props.selectedNodeId)
}

watch(
  () => [props.snapshot, props.view] as const,
  ([snapshot, view]) => {
    if (!graphInstance) {
      return
    }

    updateGraphInstance(graphInstance, snapshot, view)
    applySelectedNode(props.selectedNodeId)
  },
  { deep: true }
)

watch(
  () => props.selectedNodeId,
  nextNodeId => {
    applySelectedNode(nextNodeId)
  }
)

onMounted(() => {
  mountGraph()
})

onUnmounted(() => {
  graphInstance?.destroy()
  graphInstance = null
})
</script>
