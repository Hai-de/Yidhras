import type { Express, NextFunction, Request, Response } from 'express';

import type { AppContext } from '../context.js';
import { listNarrativeTimeline } from '../services/narrative.js';

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
    '/api/narrative/timeline',
    deps.asyncHandler(async (_req, res) => {
      context.assertRuntimeReady('narrative timeline');
      const events = await listNarrativeTimeline(context);
      res.json(events);
    })
  );
};
