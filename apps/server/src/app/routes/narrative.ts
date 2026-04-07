import { packIdParamsSchema, packNarrativeProjectionDataSchema } from '@yidhras/contracts';
import type { Express, NextFunction, Request, Response } from 'express';

import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseParams } from '../http/zod.js';
import { getPackNarrativeTimelineProjection } from '../services/narrative.js';

export interface NarrativeRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

export const registerNarrativeRoutes = (
  app: Express,
  context: AppContext,
  deps: NarrativeRouteDependencies
): void => {
  app.get(
    '/api/packs/:packId/projections/timeline',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('pack narrative timeline');
      const params = parseParams(packIdParamsSchema, req.params, 'AGENT_QUERY_INVALID');
      const events = await getPackNarrativeTimelineProjection(context, params.packId);
      packNarrativeProjectionDataSchema.parse(events);
      jsonOk(res, toJsonSafe(events));
    })
  );
};
