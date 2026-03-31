import {
  auditEntryParamsSchema,
  auditFeedQuerySchema
} from '@yidhras/contracts';
import type { Express, NextFunction, Request, Response } from 'express';

import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseParams, parseQuery } from '../http/zod.js';
import {
  getAuditEntryById,
  listAuditFeed
} from '../services/audit.js';

export interface AuditRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

export const registerAuditRoutes = (
  app: Express,
  context: AppContext,
  deps: AuditRouteDependencies
): void => {
  app.get(
    '/api/audit/feed',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('audit feed');
      const query = parseQuery(auditFeedQuerySchema, req.query, 'AUDIT_VIEW_QUERY_INVALID');
      const kinds = Array.isArray(query.kinds)
        ? query.kinds
        : typeof query.kinds === 'string'
          ? [query.kinds]
          : undefined;
      const limit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : undefined;

      const snapshot = await listAuditFeed(context, {
        limit,
        kinds,
        from_tick: query.from_tick,
        to_tick: query.to_tick,
        job_id: query.job_id,
        inference_id: query.inference_id,
        agent_id: query.agent_id,
        action_intent_id: query.action_intent_id,
        cursor: query.cursor
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
      const params = parseParams(auditEntryParamsSchema, req.params, 'AUDIT_VIEW_QUERY_INVALID');
      const entry = await getAuditEntryById(context, params);

      jsonOk(res, toJsonSafe(entry));
    })
  );
};
