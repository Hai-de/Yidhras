import {
  overviewSummaryDataSchema,
  packIdParamsSchema,
  packOverviewDataSchema
} from '@yidhras/contracts';
import type { Express, NextFunction, Request, Response } from 'express';

import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseParams } from '../http/zod.js';
import { getOverviewSummary, getPackOverviewProjectionSummary } from '../services/overview.js';

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
      overviewSummaryDataSchema.parse(summary);
      jsonOk(res, toJsonSafe(summary));
    })
  );

  app.get(
    '/api/packs/:packId/overview',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('pack overview');
      const params = parseParams(packIdParamsSchema, req.params, 'AGENT_QUERY_INVALID');
      const projection = await getPackOverviewProjectionSummary(context, params.packId);
      packOverviewDataSchema.parse(projection);
      jsonOk(res, toJsonSafe(projection));
    })
  );
};
