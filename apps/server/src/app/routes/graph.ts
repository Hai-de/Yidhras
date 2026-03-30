import type { Express, NextFunction, Request, Response } from 'express';

import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { getGraphView } from '../services/relational.js';

export interface GraphRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

const parseKindsQuery = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) {
    return value.flatMap(item =>
      typeof item === 'string'
        ? item
            .split(',')
            .map(part => part.trim())
            .filter(part => part.length > 0)
        : []
    );
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map(part => part.trim())
      .filter(part => part.length > 0);
  }

  return undefined;
};

const parseBooleanQuery = (value: unknown): boolean | undefined => {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return undefined;
};

export const registerGraphRoutes = (
  app: Express,
  context: AppContext,
  deps: GraphRouteDependencies
): void => {
  app.get(
    '/api/graph/view',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('graph view');
      const snapshot = await getGraphView(context, {
        view: typeof req.query.view === 'string' ? req.query.view : undefined,
        root_id: typeof req.query.root_id === 'string' ? req.query.root_id : undefined,
        depth: typeof req.query.depth === 'string' ? Number.parseInt(req.query.depth, 10) : undefined,
        kinds: parseKindsQuery(req.query.kinds),
        include_inactive: parseBooleanQuery(req.query.include_inactive),
        include_unresolved: parseBooleanQuery(req.query.include_unresolved),
        search: typeof req.query.search === 'string' ? req.query.search : typeof req.query.q === 'string' ? req.query.q : undefined
      });

      jsonOk(res, toJsonSafe(snapshot), {
        schema_version: 'graph-v2'
      });
    })
  );
};
