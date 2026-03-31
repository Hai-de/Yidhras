import type { GraphEdgeView, GraphNodeView } from '../../../composables/api/useGraphApi'

export interface GraphCanvasNodeData extends GraphNodeView {
  title: string
}

export interface GraphCanvasEdgeData extends GraphEdgeView {
  title: string
}

export interface GraphCanvasSnapshot {
  nodes: Array<{ data: GraphCanvasNodeData }>
  edges: Array<{ data: GraphCanvasEdgeData }>
}

export const toGraphCanvasSnapshot = (
  nodes: GraphNodeView[],
  edges: GraphEdgeView[]
): GraphCanvasSnapshot => {
  return {
    nodes: nodes.map(node => ({
      data: {
        ...node,
        title: node.label
      }
    })),
    edges: edges.map(edge => ({
      data: {
        ...edge,
        title: edge.label ?? edge.kind
      }
    }))
  }
}
