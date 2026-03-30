import type { Express, NextFunction, Request, Response } from 'express';

import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { getOverviewSummary } from '../services/overview.js';

export interface OverviewRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

export const registerOverviewRoutes = (
  app: Express,
  context: AppContext,
  deps: OverviewRouteDependencies
): void => {
  app.get(
    '/api/overview/summary',
    deps.asyncHandler(async (_req, res) => {
      context.assertRuntimeReady('overview summary');
      const summary = await getOverviewSummary(context);
      jsonOk(res, toJsonSafe(summary));
    })
  );
};
