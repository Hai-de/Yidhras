import {
  graphViewQuerySchema
} from '@yidhras/contracts';

import { asyncHandler } from '../http/async_handler.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseQuery } from '../http/zod.js';
import { getGraphView } from '../services/relational.js';
import type { RouteModule } from './types.js';

export const graphRoutes: RouteModule = {
  register(app, context) {
    app.get(
    '/api/graph/view',
    asyncHandler(async (req, res) => {
      context.assertRuntimeReady('graph view');
      const query = parseQuery(graphViewQuerySchema, req.query, 'GRAPH_VIEW_QUERY_INVALID');
      const kinds = Array.isArray(query.kinds)
        ? query.kinds
        : typeof query.kinds === 'string'
          ? [query.kinds]
          : undefined;
      const includeInactive = query.include_inactive === 'true' ? true : query.include_inactive === 'false' ? false : undefined;
      const includeUnresolved = query.include_unresolved === 'true' ? true : query.include_unresolved === 'false' ? false : undefined;

      const snapshot = await getGraphView(context, {
        view: query.view,
        root_id: query.root_id,
        depth: query.depth,
        kinds,
        include_inactive: includeInactive,
        include_unresolved: includeUnresolved,
        search: query.search ?? query.q
      });

      jsonOk(res, toJsonSafe(snapshot), {
        schema_version: 'graph'
      });
    })
  );
  }
};
