import type { Express, NextFunction, Request, Response } from 'express';

import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import {
  getAuditEntryById,
  listAuditFeed
} from '../services/audit.js';

export interface AuditRouteDependencies {
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

export const registerAuditRoutes = (
  app: Express,
  context: AppContext,
  deps: AuditRouteDependencies
): void => {
  app.get(
    '/api/audit/feed',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('audit feed');
      const snapshot = await listAuditFeed(context, {
        limit: typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined,
        kinds: parseKindsQuery(req.query.kinds),
        from_tick: typeof req.query.from_tick === 'string' ? req.query.from_tick : undefined,
        to_tick: typeof req.query.to_tick === 'string' ? req.query.to_tick : undefined,
        job_id: typeof req.query.job_id === 'string' ? req.query.job_id : undefined,
        inference_id: typeof req.query.inference_id === 'string' ? req.query.inference_id : undefined,
        agent_id: typeof req.query.agent_id === 'string' ? req.query.agent_id : undefined,
        action_intent_id: typeof req.query.action_intent_id === 'string' ? req.query.action_intent_id : undefined,
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined
      });

      jsonOk(res, toJsonSafe(snapshot), {
        pagination: snapshot.summary.page_info
      });
    })
  );

  app.get(
    '/api/audit/entries/:kind/:id',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('audit entry detail');
      const entry = await getAuditEntryById(context, {
        kind: req.params.kind,
        id: req.params.id
      });

      jsonOk(res, toJsonSafe(entry));
    })
  );
};
