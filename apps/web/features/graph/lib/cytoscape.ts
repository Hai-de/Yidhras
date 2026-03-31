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
