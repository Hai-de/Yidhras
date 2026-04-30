import { getGraphData } from '../../core/graph_data.js'
import type { AppContext } from '../context.js'
import { getGraphView } from './relational/graph_projection.js'
import {
  listAtmosphereNodes,
  listRelationalCircles,
  listRelationshipAdjustmentLogs
} from './relational/queries.js'
import type {
  GraphEdgeView,
  GraphNodeView,
  GraphViewInput,
  GraphViewSnapshot,
  ListAtmosphereNodesInput,
  ListRelationshipAdjustmentLogsInput
} from './relational/types.js'

export type { GraphEdgeView, GraphNodeView, GraphViewInput, GraphViewSnapshot, ListAtmosphereNodesInput, ListRelationshipAdjustmentLogsInput }

export const getRelationalGraph = async (context: AppContext) => {
  return getGraphData(context.prisma);
}

export {
  getGraphView,
  listAtmosphereNodes,
  listRelationalCircles,
  listRelationshipAdjustmentLogs
}
