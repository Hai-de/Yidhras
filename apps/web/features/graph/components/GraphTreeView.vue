<template>
  <ClientOnly>
    <GraphCanvas
      :snapshot="snapshot"
      view="tree"
      :selected-node-id="selectedNodeId"
      @select-node="$emit('selectNode', $event)"
    />
  </ClientOnly>
</template>

<script setup lang="ts">
import type { GraphCanvasSnapshot } from '../lib/normalize'
import GraphCanvas from './GraphCanvas.vue'

defineProps<{
  snapshot: GraphCanvasSnapshot
  selectedNodeId: string | null
}>()

defineEmits<{
  selectNode: [nodeId: string | null]
}>()
</script>
