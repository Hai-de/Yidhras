import type { AppContext } from '../context.js';

import { getGraphView } from './relational/graph_projection.js';
import {
  listAtmosphereNodes,
  listRelationshipAdjustmentLogs,
  listRelationalCircles
} from './relational/queries.js';
import type {
  GraphEdgeView,
  GraphNodeView,
  GraphViewInput,
  GraphViewSnapshot,
  ListAtmosphereNodesInput,
  ListRelationshipAdjustmentLogsInput
} from './relational/types.js';

export type {
  GraphEdgeView,
  GraphNodeView,
  GraphViewInput,
  GraphViewSnapshot,
  ListAtmosphereNodesInput,
  ListRelationshipAdjustmentLogsInput
};

export const getRelationalGraph = async (context: AppContext) => {
  return context.sim.getGraphData();
};

export {
  getGraphView,
  listAtmosphereNodes,
  listRelationshipAdjustmentLogs,
  listRelationalCircles
};
