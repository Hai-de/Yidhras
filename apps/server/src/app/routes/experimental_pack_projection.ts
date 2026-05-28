import { entityIdParamsSchema } from '@yidhras/contracts'
import { z } from 'zod'

import { packAccessGuard } from '../../operator/guard/pack_access.js'
import { ApiError } from '../../utils/api_error.js'
import { asyncHandler } from '../http/async_handler.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { parseParams } from '../http/zod.js'
import {
  getExperimentalPackAgentOverview,
  getExperimentalPackEntityProjection,
  getExperimentalPackNarrativeProjection,
  getExperimentalPackOverviewProjection,
  getExperimentalPackPluginInstallations
} from '../services/runtime/experimental_projection_runtime.js'
import type { RouteModule } from './types.js'

const packIdParamsSchema = z.object({
  packId: z.string().min(1, 'packId is required')
})

const resolvePackId = (reqParams: unknown): string => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express request body/param parsing
  const params = parseParams(packIdParamsSchema, reqParams as Record<string, unknown>, 'EXPERIMENTAL_PACK_ID_INVALID')

  return params.packId
}

const resolveEntityId = (reqParams: unknown): string => {
  const params = parseParams(entityIdParamsSchema, reqParams, 'AGENT_QUERY_INVALID')
  return params.id
}

const translateExperimentalProjectionError = (packId: string, error: unknown): never => {
  const message = error instanceof Error ? error.message : 'Experimental pack projection failed'
  if (message.includes('not found')) {
    throw new ApiError(404, 'EXPERIMENTAL_PACK_RUNTIME_NOT_FOUND', message, { pack_id: packId })
  }
  throw new ApiError(409, 'EXPERIMENTAL_PACK_PROJECTION_FAILED', message, { pack_id: packId })
}

export const experimentalPackProjectionRoutes: RouteModule = {
  register(app, context) {
  const packGuard = packAccessGuard(context, { packIdParam: 'packId' })

  app.get(
    '/api/experimental/packs/overview',
    packGuard,
    asyncHandler(async (req, res) => {
const packId = resolvePackId(req.params)
      try {
        jsonOk(res, toJsonSafe(await getExperimentalPackOverviewProjection(context, packId)))
      } catch (error) {
        translateExperimentalProjectionError(packId, error)
      }
    })
  )

  app.get(
    '/api/experimental/packs/projections/timeline',
    packGuard,
    asyncHandler(async (req, res) => {
const packId = resolvePackId(req.params)
      try {
        jsonOk(res, toJsonSafe(await getExperimentalPackNarrativeProjection(context, packId)))
      } catch (error) {
        translateExperimentalProjectionError(packId, error)
      }
    })
  )

  app.get(
    '/api/experimental/packs/projections/entities',
    packGuard,
    asyncHandler(async (req, res) => {
const packId = resolvePackId(req.params)
      try {
        jsonOk(res, toJsonSafe(await getExperimentalPackEntityProjection(context, packId)))
      } catch (error) {
        translateExperimentalProjectionError(packId, error)
      }
    })
  )

  app.get(
    '/api/experimental/packs/entities/:id/overview',
    packGuard,
    asyncHandler(async (req, res) => {
const packId = resolvePackId(req.params)
      const entityId = resolveEntityId({ id: req.params.id })
      try {
        jsonOk(res, toJsonSafe(await getExperimentalPackAgentOverview(context, packId, entityId)))
      } catch (error) {
        translateExperimentalProjectionError(packId, error)
      }
    })
  )

  app.get(
    '/api/experimental/packs/plugins',
    packGuard,
    asyncHandler(async (req, res) => {
const packId = resolvePackId(req.params)
      try {
        jsonOk(res, toJsonSafe(await getExperimentalPackPluginInstallations(context, packId)))
      } catch (error) {
        translateExperimentalProjectionError(packId, error)
      }
    })
  )
  }
}
