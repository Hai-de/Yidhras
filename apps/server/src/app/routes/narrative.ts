import { packIdParamsSchema, packNarrativeProjectionDataSchema } from '@yidhras/contracts'

import { packAccessGuard } from '../../operator/guard/pack_access.js'
import { asyncHandler } from '../http/async_handler.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { parseParams } from '../http/zod.js'
import { getPackNarrativeTimelineProjection } from '../services/narrative.js'
import type { RouteModule } from './types.js'

export const narrativeRoutes: RouteModule = {
  register(app, context) {
    app.get(
    '/api/packs/projections/timeline',
    packAccessGuard(context, { packIdParam: 'packId' }),
    asyncHandler(async (req, res) => {
      context.assertRuntimeReady('pack narrative timeline')
      const params = parseParams(packIdParamsSchema, req.params, 'AGENT_QUERY_INVALID')
      const events = await getPackNarrativeTimelineProjection(context, params.packId)
      packNarrativeProjectionDataSchema.parse(events)
      jsonOk(res, toJsonSafe(events))
    })
  )
  }
}
