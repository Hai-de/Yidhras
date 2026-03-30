import type { Express, NextFunction, Request, Response } from 'express';

import type { AppContext } from '../context.js';
import { toJsonSafe } from '../http/json.js';
import {
  getAgentContextSnapshot,
  listSnrAdjustmentLogs
} from '../services/agent.js';

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

  app.get(
    '/api/agent/:id/snr/logs',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('agent snr adjustment logs');
      const logs = await listSnrAdjustmentLogs(context, {
        agent_id: req.params.id,
        limit: typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined
      });

      res.json(toJsonSafe(logs));
    })
  );
};
