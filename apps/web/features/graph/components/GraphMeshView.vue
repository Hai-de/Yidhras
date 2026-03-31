<template>
  <ClientOnly>
    <GraphCanvas
      :snapshot="snapshot"
      view="mesh"
      :selected-node-id="selectedNodeId"
      @select-node="$emit('selectNode', $event)"
    />
  </ClientOnly>
</template>

<script setup lang="ts">
import GraphCanvas from './GraphCanvas.vue'
import type { GraphCanvasSnapshot } from '../lib/normalize'

defineProps<{
  snapshot: GraphCanvasSnapshot
  selectedNodeId: string | null
}>()

defineEmits<{
  selectNode: [nodeId: string | null]
}>()
</script>
