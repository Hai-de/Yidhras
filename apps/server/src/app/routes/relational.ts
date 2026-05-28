import {
  atmosphereNodesQuerySchema,
  relationshipLogsParamsSchema,
  relationshipLogsQuerySchema
} from '@yidhras/contracts';

import { asyncHandler } from '../http/async_handler.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseParams, parseQuery } from '../http/zod.js';
import {
  getRelationalGraph,
  listAtmosphereNodes,
  listRelationalCircles,
  listRelationshipAdjustmentLogs
} from '../services/relational.js';
import type { RouteModule } from './types.js';

export const relationalRoutes: RouteModule = {
  register(app, context) {
  app.get(
    '/api/relational/graph',
    asyncHandler(async (_req, res) => {
      context.assertRuntimeReady('relational graph');
      const graph = await getRelationalGraph(context);
      jsonOk(res, toJsonSafe(graph));
    })
  );

  app.get(
    '/api/relational/circles',
    asyncHandler(async (_req, res) => {
      context.assertRuntimeReady('relational circles');
      const circles = await listRelationalCircles(context);
      jsonOk(res, toJsonSafe(circles));
    })
  );

  app.get(
    '/api/atmosphere/nodes',
    asyncHandler(async (req, res) => {
      context.assertRuntimeReady('atmosphere nodes');
      const query = parseQuery(atmosphereNodesQuerySchema, req.query, 'RELATIONAL_QUERY_INVALID');
      const nodes = await listAtmosphereNodes(context, {
        owner_id: query.owner_id,
        include_expired: query.include_expired === 'true'
      });

      jsonOk(res, toJsonSafe(nodes));
    })
  );

  app.get(
    '/api/relationships/:from_id/:to_id/:type/logs',
    asyncHandler(async (req, res) => {
      context.assertRuntimeReady('relationship adjustment logs');
      const params = parseParams(relationshipLogsParamsSchema, req.params, 'RELATIONSHIP_LOG_QUERY_INVALID');
      const query = parseQuery(relationshipLogsQuerySchema, req.query, 'RELATIONSHIP_LOG_QUERY_INVALID');
      const logs = await listRelationshipAdjustmentLogs(context, {
        from_id: params.from_id,
        to_id: params.to_id,
        type: params.type,
        limit: query.limit
      });

      jsonOk(res, toJsonSafe(logs));
    })
  );
  }
};
