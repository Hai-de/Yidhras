import {
  agentIdParamsSchema,
  agentSchedulerProjectionQuerySchema,
  agentSnrLogsQuerySchema,
  entityIdParamsSchema,
  entityOverviewDataSchema,
  entityOverviewQuerySchema
} from '@yidhras/contracts'
import type { Request, Response } from 'express'

import { OPERATOR_CAPABILITY } from '../../operator/constants.js'
import { ApiError } from '../../utils/api_error.js'
import { asyncHandler } from '../http/async_handler.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { parseParams, parseQuery } from '../http/zod.js'
import { capabilityGuard } from '../middleware/capability.js'
import { getAgentContextSnapshot, getEntityOverview, listSnrAdjustmentLogs } from '../services/agent/agent.js'
import { getAgentSchedulerProjection } from '../services/scheduler/agent-queries.js'
import type { RouteModule } from './types.js'

export const agentRoutes: RouteModule = {
  register(app, context) {
  const sendEntityOverview = async (
    req: Request,
    res: Response,
    options: {
      runtimeFeature: string
    }
  ): Promise<void> => {
    context.assertRuntimeReady(options.runtimeFeature)
    const params = parseParams(entityIdParamsSchema, req.params, 'AGENT_QUERY_INVALID')
    const query = parseQuery(entityOverviewQuerySchema, req.query, 'AGENT_QUERY_INVALID')
// @ts-expect-error -- EOPT strict mode
    const overview = await getEntityOverview(context, params.id, {
      limit: query.limit
    })
    entityOverviewDataSchema.parse(overview)

    jsonOk(res, toJsonSafe(overview))
  }

  app.get(
    '/api/agent/:id/context',
    capabilityGuard(context, OPERATOR_CAPABILITY.PERCEIVE_AGENT_CONTEXT, {
      packIdQuery: 'packId',
      targetAgentIdParam: 'id'
    }),
    asyncHandler(async (req, res) => {
      context.assertRuntimeReady('agent context')
      const params = parseParams(agentIdParamsSchema, req.params, 'AGENT_QUERY_INVALID')
      const snapshot = await getAgentContextSnapshot(context, params.id)

      jsonOk(res, toJsonSafe(snapshot))
    })
  )

  app.get(
    '/api/entities/:id/overview',
    capabilityGuard(context, OPERATOR_CAPABILITY.PERCEIVE_ENTITY_OVERVIEW, {
      packIdQuery: 'packId',
      targetAgentIdParam: 'id'
    }),
    asyncHandler(async (req, res) => {
      await sendEntityOverview(req, res, {
        runtimeFeature: 'entity overview'
      })
    })
  )

  app.get(
    '/api/agent/:id/scheduler/projection',
    capabilityGuard(context, OPERATOR_CAPABILITY.PERCEIVE_AGENT_SCHEDULER, {
      packIdQuery: 'packId',
      targetAgentIdParam: 'id'
    }),
    asyncHandler(async (req, res) => {
      context.assertRuntimeReady('agent scheduler projection')
      const params = parseParams(agentIdParamsSchema, req.params, 'AGENT_QUERY_INVALID')
      const query = parseQuery(agentSchedulerProjectionQuerySchema, req.query, 'AGENT_QUERY_INVALID')
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express query value
      const packId = (req.query['packId'] as string | undefined) ?? (req.params['packId'] as string | undefined)
      if (!packId) {
        throw new ApiError(400, 'PACK_ID_REQUIRED', 'Pack ID is required for agent scheduler operations')
      }
// @ts-expect-error -- EOPT strict mode
      const projection = await getAgentSchedulerProjection(context, packId, params.id, {
        limit: query.limit
      })

      jsonOk(res, toJsonSafe(projection))
    })
  )

  app.get(
    '/api/agent/:id/snr/logs',
    capabilityGuard(context, OPERATOR_CAPABILITY.PERCEIVE_AGENT_LOGS, {
      packIdQuery: 'packId',
      targetAgentIdParam: 'id'
    }),
    asyncHandler(async (req, res) => {
      context.assertRuntimeReady('agent snr adjustment logs')
      const params = parseParams(agentIdParamsSchema, req.params, 'SNR_LOG_QUERY_INVALID')
      const query = parseQuery(agentSnrLogsQuerySchema, req.query, 'SNR_LOG_QUERY_INVALID')
// @ts-expect-error -- EOPT strict mode
      const logs = await listSnrAdjustmentLogs(context, {
        agent_id: params.id,
        limit: query.limit
      })

      jsonOk(res, toJsonSafe(logs))
    })
  )
  }
}
