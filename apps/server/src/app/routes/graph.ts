import {
  graphViewQuerySchema
} from '@yidhras/contracts';
import type { Express, NextFunction, Request, Response } from 'express';

import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseQuery } from '../http/zod.js';
import { getGraphView } from '../services/relational.js';

export interface GraphRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

export const registerGraphRoutes = (
  app: Express,
  context: AppContext,
  deps: GraphRouteDependencies
): void => {
  app.get(
    '/api/graph/view',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('graph view');
      const query = parseQuery(graphViewQuerySchema, req.query, 'GRAPH_VIEW_QUERY_INVALID');
      const kinds = Array.isArray(query.kinds)
        ? query.kinds
        : typeof query.kinds === 'string'
          ? [query.kinds]
          : undefined;
      const includeInactive = query.include_inactive === 'true' ? true : query.include_inactive === 'false' ? false : undefined;
      const includeUnresolved = query.include_unresolved === 'true' ? true : query.include_unresolved === 'false' ? false : undefined;

      const snapshot = await getGraphView(context, {
        view: query.view,
        root_id: query.root_id,
        depth: query.depth,
        kinds,
        include_inactive: includeInactive,
        include_unresolved: includeUnresolved,
        search: query.search ?? query.q
      });

      jsonOk(res, toJsonSafe(snapshot), {
        schema_version: 'graph'
      });
    })
  );
};
