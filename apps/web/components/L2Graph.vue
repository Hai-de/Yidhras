<template>
  <div ref="cyContainer" class="w-full h-full bg-[#0a0a0b]"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import cytoscape from 'cytoscape'

interface GraphData {
  nodes: any[]
  edges: any[]
}

const props = defineProps<{
  data: GraphData
}>()

const cyContainer = ref<HTMLElement | null>(null)
let cy: cytoscape.Core | null = null

const initCytoscape = () => {
  if (!cyContainer.value) return

  cy = cytoscape({
    container: cyContainer.value,
    elements: props.data,
    style: [
      {
        selector: 'node',
        style: {
          'background-color': '#4f46e5',
          'label': 'data(label)',
          'color': '#cbd5e1',
          'font-size': '10px',
          'width': (ele: any) => 10 + (ele.data('snr') || 0) * 30,
          'height': (ele: any) => 10 + (ele.data('snr') || 0) * 30,
          'text-valign': 'bottom',
          'text-margin-y': 5,
          'border-width': 2,
          'border-color': (ele: any) => ele.data('is_pinned') ? '#fbbf24' : '#312e81'
        }
      },
      {
        selector: 'edge',
        style: {
          'width': 'data(weight)',
          'line-color': '#334155',
          'target-arrow-color': '#334155',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'opacity': 0.6
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

watch(() => props.data, (newData) => {
  if (cy) {
    cy.elements().remove()
    cy.add(newData)
    cy.layout({ name: 'cose', animate: true }).run()
  }
}, { deep: true })

onMounted(() => {
  initCytoscape()
})

onUnmounted(() => {
  if (cy) {
    cy.destroy()
  }
})
</script>
