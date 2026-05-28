import {
  overviewSummaryDataSchema,
  packIdParamsSchema,
  packOverviewDataSchema
} from '@yidhras/contracts'

import { packAccessGuard } from '../../operator/guard/pack_access.js'
import { asyncHandler } from '../http/async_handler.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { parseParams } from '../http/zod.js'
import { getOverviewSummary, getPackOverviewProjectionSummary } from '../services/overview/overview.js'
import type { RouteModule } from './types.js'

export const overviewRoutes: RouteModule = {
  register(app, context) {
    app.get(
    '/api/overview/summary',
    asyncHandler(async (_req, res) => {
      context.assertRuntimeReady('overview summary')
      const summary = await getOverviewSummary(context)
      overviewSummaryDataSchema.parse(summary)
      jsonOk(res, toJsonSafe(summary))
    })
  )

  app.get(
    '/api/packs/overview',
    packAccessGuard(context, { packIdParam: 'packId' }),
    asyncHandler(async (req, res) => {
      context.assertRuntimeReady('pack overview')
      const params = parseParams(packIdParamsSchema, req.params, 'AGENT_QUERY_INVALID')
      const projection = await getPackOverviewProjectionSummary(context, params.packId)
      packOverviewDataSchema.parse(projection)
      jsonOk(res, toJsonSafe(projection))
    })
  )
  }
}
