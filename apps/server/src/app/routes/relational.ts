import type { Express, NextFunction, Request, Response } from 'express';

import type { AppContext } from '../context.js';
import { toJsonSafe } from '../http/json.js';
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
      res.json(graph);
    })
  );

  app.get(
    '/api/relational/circles',
    deps.asyncHandler(async (_req, res) => {
      context.assertRuntimeReady('relational circles');
      const circles = await listRelationalCircles(context);
      res.json(circles);
    })
  );

  app.get(
    '/api/atmosphere/nodes',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('atmosphere nodes');
      const nodes = await listAtmosphereNodes(context, {
        owner_id: typeof req.query.owner_id === 'string' ? req.query.owner_id : undefined,
        include_expired: req.query.include_expired === 'true'
      });

      res.json(nodes);
    })
  );

  app.get(
    '/api/relationships/:from_id/:to_id/:type/logs',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('relationship adjustment logs');
      const logs = await listRelationshipAdjustmentLogs(context, {
        from_id: req.params.from_id,
        to_id: req.params.to_id,
        type: req.params.type,
        limit: typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined
      });

      res.json(toJsonSafe(logs));
    })
  );
};
