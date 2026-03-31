import type cytoscape from 'cytoscape'

import type { GraphViewMode } from '../../../composables/api/useGraphApi'

export const buildGraphLayout = (view: GraphViewMode): cytoscape.LayoutOptions => {
  if (view === 'tree') {
    return {
      name: 'breadthfirst',
      directed: true,
      fit: true,
      spacingFactor: 1.4,
      padding: 40,
      animate: true,
      animationDuration: 300
    }
  }

  return {
    name: 'cose',
    animate: true,
    animationDuration: 350,
    randomize: true,
    componentSpacing: 120,
    nodeRepulsion: 5200,
    idealEdgeLength: 140
  }
}
