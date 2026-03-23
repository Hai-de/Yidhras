import type { Express, NextFunction, Request, Response } from 'express';

import type { AppContext } from '../context.js';
import { getAgentContextSnapshot } from '../services/agent.js';

export interface AgentRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

export const registerAgentRoutes = (
  app: Express,
  context: AppContext,
  deps: AgentRouteDependencies
): void => {
  app.get(
    '/api/agent/:id/context',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('agent context');
      const snapshot = await getAgentContextSnapshot(context, req.params.id);

      res.json(snapshot);
    })
  );
};
