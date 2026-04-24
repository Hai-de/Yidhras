import { entityIdParamsSchema } from '@yidhras/contracts'
import type { Express, NextFunction, Request, Response } from 'express'

import { isExperimentalMultiPackOperatorApiEnabled } from '../../config/runtime_config.js'
import { packAccessGuard } from '../../operator/guard/pack_access.js'
import { ApiError } from '../../utils/api_error.js'
import type { AppContext } from '../context.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { parseParams } from '../http/zod.js'
import {
  getExperimentalPackAgentOverview,
  getExperimentalPackEntityProjection,
  getExperimentalPackNarrativeProjection,
  getExperimentalPackOverviewProjection,
  getExperimentalPackPluginInstallations
} from '../services/experimental_projection_runtime.js'

const packIdParamsSchema = {
  safeParse(value: unknown) {
    const packId = typeof (value as { packId?: unknown })?.packId === 'string'
      ? (value as { packId: string }).packId.trim()
      : ''

    if (packId.length === 0) {
      return {
        success: false as const,
        error: { issues: [{ message: 'packId is required' }] }
      }
    }

    return {
      success: true as const,
      data: { packId }
    }
  }
}

export interface ExperimentalPackProjectionRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void
}

const assertExperimentalProjectionApiEnabled = (context: AppContext): void => {
  if (!context.sim.isExperimentalMultiPackRuntimeEnabled() || !isExperimentalMultiPackOperatorApiEnabled()) {
    throw new ApiError(404, 'EXPERIMENTAL_MULTI_PACK_RUNTIME_DISABLED', 'Experimental multi-pack runtime operator API is disabled')
  }
}

const resolvePackId = (reqParams: unknown): string => {
  const params = parseParams(packIdParamsSchema as never, reqParams, 'EXPERIMENTAL_PACK_ID_INVALID') as { packId: string }
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

export const registerExperimentalPackProjectionRoutes = (
  app: Express,
  context: AppContext,
  deps: ExperimentalPackProjectionRouteDependencies
): void => {
  const packGuard = packAccessGuard(context, { packIdParam: 'packId' })

  app.get(
    '/api/experimental/packs/:packId/overview',
    packGuard,
    deps.asyncHandler(async (req, res) => {
      assertExperimentalProjectionApiEnabled(context)
      const packId = resolvePackId(req.params)
      try {
        jsonOk(res, toJsonSafe(await getExperimentalPackOverviewProjection(context, packId)))
      } catch (error) {
        translateExperimentalProjectionError(packId, error)
      }
    })
  )

  app.get(
    '/api/experimental/packs/:packId/projections/timeline',
    packGuard,
    deps.asyncHandler(async (req, res) => {
      assertExperimentalProjectionApiEnabled(context)
      const packId = resolvePackId(req.params)
      try {
        jsonOk(res, toJsonSafe(await getExperimentalPackNarrativeProjection(context, packId)))
      } catch (error) {
        translateExperimentalProjectionError(packId, error)
      }
    })
  )

  app.get(
    '/api/experimental/packs/:packId/projections/entities',
    packGuard,
    deps.asyncHandler(async (req, res) => {
      assertExperimentalProjectionApiEnabled(context)
      const packId = resolvePackId(req.params)
      try {
        jsonOk(res, toJsonSafe(await getExperimentalPackEntityProjection(context, packId)))
      } catch (error) {
        translateExperimentalProjectionError(packId, error)
      }
    })
  )

  app.get(
    '/api/experimental/packs/:packId/entities/:id/overview',
    packGuard,
    deps.asyncHandler(async (req, res) => {
      assertExperimentalProjectionApiEnabled(context)
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
    '/api/experimental/packs/:packId/plugins',
    packGuard,
    deps.asyncHandler(async (req, res) => {
      assertExperimentalProjectionApiEnabled(context)
      const packId = resolvePackId(req.params)
      try {
        jsonOk(res, toJsonSafe(await getExperimentalPackPluginInstallations(context, packId)))
      } catch (error) {
        translateExperimentalProjectionError(packId, error)
      }
    })
  )
}
