import {
  atmosphereNodesQuerySchema,
  relationshipLogsParamsSchema,
  relationshipLogsQuerySchema
} from '@yidhras/contracts';
import type { Express, NextFunction, Request, Response } from 'express';

import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseParams, parseQuery } from '../http/zod.js';
import {
  getRelationalGraph,
  listAtmosphereNodes,
  listRelationalCircles,
  listRelationshipAdjustmentLogs
} from '../services/relational.js';

export interface RelationalRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

export const registerRelationalRoutes = (
  app: Express,
  context: AppContext,
  deps: RelationalRouteDependencies
): void => {
  app.get(
    '/api/relational/graph',
    deps.asyncHandler(async (_req, res) => {
      context.assertRuntimeReady('relational graph');
      const graph = await getRelationalGraph(context);
      jsonOk(res, toJsonSafe(graph));
    })
  );

  app.get(
    '/api/relational/circles',
    deps.asyncHandler(async (_req, res) => {
      context.assertRuntimeReady('relational circles');
      const circles = await listRelationalCircles(context);
      jsonOk(res, toJsonSafe(circles));
    })
  );

  app.get(
    '/api/atmosphere/nodes',
    deps.asyncHandler(async (req, res) => {
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
    deps.asyncHandler(async (req, res) => {
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
};
