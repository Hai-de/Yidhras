import cytoscape from 'cytoscape'

import type { GraphViewMode } from '../../../composables/api/useGraphApi'
import { buildGraphLayout } from './layout'
import type { GraphCanvasSnapshot } from './normalize'
import { buildGraphStylesheet } from './styles'

export const createGraphInstance = (
  container: HTMLElement,
  snapshot: GraphCanvasSnapshot,
  view: GraphViewMode
): cytoscape.Core => {
  return cytoscape({
    container,
    elements: snapshot,
    // Cytoscape's runtime mapper support is wider than the shipped TypeScript style surface.
    style: buildGraphStylesheet() as never,
    layout: buildGraphLayout(view)
  })
}

export const updateGraphInstance = (
  instance: cytoscape.Core,
  snapshot: GraphCanvasSnapshot,
  view: GraphViewMode
): void => {
  instance.elements().remove()
  instance.add(snapshot)
  instance.layout(buildGraphLayout(view)).run()
}

export const focusGraphNeighborhood = (
  instance: cytoscape.Core,
  selectedNodeId: string | null
): void => {
  const allElements = instance.elements()
  allElements.removeClass('yd-focus yd-dim')

  if (!selectedNodeId) {
    instance.fit(undefined, 36)
    return
  }

  const node = instance.getElementById(selectedNodeId)
  if (node.empty()) {
    return
  }

  const neighborhood = node.closedNeighborhood()
  const remainder = allElements.difference(neighborhood)

  neighborhood.addClass('yd-focus')
  remainder.addClass('yd-dim')
  instance.animate({ fit: { eles: neighborhood, padding: 48 }, duration: 180 })
}
