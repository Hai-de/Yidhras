<template>
  <div ref="cyContainer" class="w-full h-full bg-[#0a0a0b]"></div>
</template>

<script setup lang="ts">
import cytoscape from 'cytoscape'
import { onMounted, onUnmounted, ref, watch } from 'vue'

type GraphNodeDefinition = cytoscape.NodeDefinition
type GraphEdgeDefinition = cytoscape.EdgeDefinition
type CytoscapeContainer = cytoscape.CytoscapeOptions['container']

interface GraphData {
  nodes: GraphNodeDefinition[]
  edges: GraphEdgeDefinition[]
}

const props = defineProps<{
  data: GraphData
}>()

const cyContainer = ref<CytoscapeContainer>(null)
let cy: cytoscape.Core | null = null

const resolveNodeSize = (ele: cytoscape.NodeSingular): number => {
  const snr = ele.data('snr')
  return 10 + (typeof snr === 'number' ? snr : 0) * 30
}

const resolveNodeBorderColor = (ele: cytoscape.NodeSingular): string => {
  return ele.data('is_pinned') ? '#fbbf24' : '#312e81'
}

const toElementsDefinition = (data: GraphData): cytoscape.ElementsDefinition => ({
  nodes: data.nodes,
  edges: data.edges
})

const initCytoscape = () => {
  if (!cyContainer.value) return

  cy = cytoscape({
    container: cyContainer.value,
    elements: toElementsDefinition(props.data),
    style: [
      {
        selector: 'node',
        style: {
          'background-color': '#4f46e5',
          label: 'data(label)',
          color: '#cbd5e1',
          'font-size': '10px',
          width: resolveNodeSize,
          height: resolveNodeSize,
          'text-valign': 'bottom',
          'text-margin-y': 5,
          'border-width': 2,
          'border-color': resolveNodeBorderColor
        }
      },
      {
        selector: 'edge',
        style: {
          width: 'data(weight)',
          'line-color': '#334155',
          'target-arrow-color': '#334155',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          opacity: 0.6
        }
      },
      {
        selector: 'node[type="noise"]',
        style: {
          'background-color': '#1e293b',
          'border-style': 'dashed'
        }
      }
    ],
    layout: {
      name: 'cose',
      animate: true,
      animationDuration: 500,
      randomize: true,
      componentSpacing: 100,
      nodeRepulsion: 4000
    }
  })
}

watch(
  () => props.data,
  newData => {
    if (cy) {
      cy.elements().remove()
      cy.add(toElementsDefinition(newData))
      cy.layout({ name: 'cose', animate: true }).run()
    }
  },
  { deep: true }
)

onMounted(() => {
  initCytoscape()
})

onUnmounted(() => {
  if (cy) {
    cy.destroy()
  }
})
</script>
