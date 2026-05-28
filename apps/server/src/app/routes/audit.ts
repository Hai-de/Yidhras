import {
  auditEntryParamsSchema,
  auditFeedQuerySchema
} from '@yidhras/contracts';

import { asyncHandler } from '../http/async_handler.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseParams, parseQuery } from '../http/zod.js';
import {
  getAuditEntryById,
  listAuditFeed
} from '../services/audit/audit.js';
import type { RouteModule } from './types.js';

export const auditRoutes: RouteModule = {
  register(app, context) {
  app.get(
    '/api/audit/feed',
    asyncHandler(async (req, res) => {
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
        pagination: snapshot.page_info
      });
    })
  );

  app.get(
    '/api/audit/entries/:kind/:id',
    asyncHandler(async (req, res) => {
      context.assertRuntimeReady('audit entry detail');
      const params = parseParams(auditEntryParamsSchema, req.params, 'AUDIT_VIEW_QUERY_INVALID');
      const entry = await getAuditEntryById(context, params);

      jsonOk(res, toJsonSafe(entry));
    })
  );
  }
};
