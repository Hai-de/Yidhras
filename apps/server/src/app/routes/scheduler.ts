import {
  schedulerDecisionsQuerySchema,
  schedulerMigrationsQuerySchema,
  schedulerOperatorQuerySchema,
  schedulerOwnershipQuerySchema,
  schedulerRebalanceRecommendationsQuerySchema,
  schedulerRunIdParamsSchema,
  schedulerRunsQuerySchema,
  schedulerSummaryQuerySchema,
  schedulerTrendsQuerySchema,
  schedulerWorkersQuerySchema
} from '@yidhras/contracts'

import { OPERATOR_CAPABILITY } from '../../operator/constants.js'
import { ApiError } from '../../utils/api_error.js'
import type { AppContext } from '../context.js'
import { asyncHandler } from '../http/async_handler.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { parseParams, parseQuery } from '../http/zod.js'
import { capabilityGuard } from '../middleware/capability.js'
import { createRuntimeKernelService } from '../runtime/runtime_kernel_service.js'
import { listSchedulerDecisions } from '../services/scheduler/decision-queries.js'
import { listSchedulerOwnershipAssignments,listSchedulerOwnershipMigrations  } from '../services/scheduler/ownership-queries.js'
import { listSchedulerRebalanceRecommendations } from '../services/scheduler/rebalance-queries.js'
import {
  getLatestSchedulerRunReadModel,
  getSchedulerRunReadModelById,
  listSchedulerRuns
} from '../services/scheduler/run-queries.js'
import { getSchedulerOperatorProjection,getSchedulerSummarySnapshot, getSchedulerTrendsSnapshot   } from '../services/scheduler/summary-queries.js'
import { listSchedulerWorkers } from '../services/scheduler/worker-queries.js'
import type { RouteModule } from './types.js'

const resolvePackIdFromRequest = (req: import('express').Request): string => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express mergeParams
  const fromParams = req.params.packId as string | undefined
  if (fromParams) return fromParams
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express query value
  const fromQuery = req.query.packId as string | undefined
  if (fromQuery) return fromQuery
  throw new ApiError(400, 'PACK_ID_REQUIRED', 'Pack ID is required for scheduler operations')
}

const observeGuard = (context: AppContext) =>
  capabilityGuard(context, OPERATOR_CAPABILITY.PERCEIVE_SCHEDULER_OBSERVABILITY, {
    packIdQuery: 'packId'
  })

export const schedulerRoutes: RouteModule = {
  register(app, context) {
    app.get(
      '/api/runtime/scheduler/runs/latest',
      observeGuard(context),
      asyncHandler(async (req, res) => {
        context.assertRuntimeReady('scheduler latest run')
        const packId = resolvePackIdFromRequest(req)
        const readModel = await getLatestSchedulerRunReadModel(context, packId)
        jsonOk(res, toJsonSafe(readModel))
      })
    )

    app.get(
      '/api/runtime/scheduler/runs',
      observeGuard(context),
      asyncHandler(async (req, res) => {
        context.assertRuntimeReady('scheduler runs list')
        const query = parseQuery(schedulerRunsQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID')
        const packId = resolvePackIdFromRequest(req)
        const result = listSchedulerRuns(context, packId, {
          limit: query.limit,
          cursor: query.cursor,
          from_tick: query.from_tick,
          to_tick: query.to_tick,
          worker_id: query.worker_id,
          partition_id: query.partition_id,
          pack_id: query.pack_id
        })
        jsonOk(
          res,
          toJsonSafe({
            items: result.items,
            page_info: result.page_info,
            summary: result.summary
          }),
          {
            pagination: result.page_info
          }
        )
      })
    )

    app.get(
      '/api/runtime/scheduler/summary',
      observeGuard(context),
      asyncHandler(async (req, res) => {
        context.assertRuntimeReady('scheduler summary')
        const query = parseQuery(schedulerSummaryQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID')
        const packId = resolvePackIdFromRequest(req)
        const summary = await getSchedulerSummarySnapshot(context, packId, {
          sampleRuns: query.sample_runs
        })
        jsonOk(res, toJsonSafe(summary))
      })
    )

    app.get(
      '/api/runtime/scheduler/trends',
      observeGuard(context),
      asyncHandler(async (req, res) => {
        context.assertRuntimeReady('scheduler trends')
        const query = parseQuery(schedulerTrendsQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID')
        const packId = resolvePackIdFromRequest(req)
        const trends = getSchedulerTrendsSnapshot(context, packId, {
          sampleRuns: query.sample_runs
        })
        jsonOk(res, toJsonSafe(trends))
      })
    )

    app.get(
      '/api/runtime/scheduler/operator',
      observeGuard(context),
      asyncHandler(async (req, res) => {
        context.assertRuntimeReady('scheduler operator projection')
        const query = parseQuery(schedulerOperatorQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID')
        const packId = resolvePackIdFromRequest(req)
        const projection = await getSchedulerOperatorProjection(context, packId, {
          sampleRuns: query.sample_runs,
          recentLimit: query.recent_limit
        })
        jsonOk(res, toJsonSafe(projection))
      })
    )

    app.get(
      '/api/runtime/scheduler/ownership',
      observeGuard(context),
      asyncHandler(async (req, res) => {
        context.assertRuntimeReady('scheduler ownership projection')
        const query = parseQuery(schedulerOwnershipQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID')
        const packId = resolvePackIdFromRequest(req)
        const result = listSchedulerOwnershipAssignments(context, packId, {
          worker_id: query.worker_id,
          partition_id: query.partition_id,
          status: query.status
        })
        jsonOk(res, toJsonSafe(result))
      })
    )

    app.get(
      '/api/runtime/scheduler/migrations',
      observeGuard(context),
      asyncHandler(async (req, res) => {
        context.assertRuntimeReady('scheduler ownership migrations')
        const query = parseQuery(schedulerMigrationsQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID')
        const packId = resolvePackIdFromRequest(req)
        const result = listSchedulerOwnershipMigrations(context, packId, {
          limit: query.limit,
          worker_id: query.worker_id,
          partition_id: query.partition_id,
          status: query.status,
          pack_id: query.pack_id
        })
        jsonOk(res, toJsonSafe(result))
      })
    )

    app.get(
      '/api/runtime/scheduler/workers',
      observeGuard(context),
      asyncHandler(async (req, res) => {
        context.assertRuntimeReady('scheduler worker runtime states')
        const query = parseQuery(schedulerWorkersQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID')
        const packId = resolvePackIdFromRequest(req)
        const result = listSchedulerWorkers(context, packId, {
          worker_id: query.worker_id,
          status: query.status
        })
        jsonOk(res, toJsonSafe(result))
      })
    )

    app.get(
      '/api/runtime/scheduler/rebalance/recommendations',
      observeGuard(context),
      asyncHandler(async (req, res) => {
        context.assertRuntimeReady('scheduler rebalance recommendations')
        const query = parseQuery(schedulerRebalanceRecommendationsQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID')
        const packId = resolvePackIdFromRequest(req)
        const result = listSchedulerRebalanceRecommendations(context, packId, {
          limit: query.limit,
          worker_id: query.worker_id,
          partition_id: query.partition_id,
          status: query.status,
          suppress_reason: query.suppress_reason,
          pack_id: query.pack_id
        })
        jsonOk(res, toJsonSafe(result))
      })
    )

    app.get(
      '/api/runtime/scheduler/runs/:id',
      observeGuard(context),
      asyncHandler(async (req, res) => {
        context.assertRuntimeReady('scheduler run read')
        const params = parseParams(schedulerRunIdParamsSchema, req.params, 'SCHEDULER_QUERY_INVALID')
        const packId = resolvePackIdFromRequest(req)
        const readModel = await getSchedulerRunReadModelById(context, packId, params.id)
        jsonOk(res, toJsonSafe(readModel))
      })
    )

    app.get(
      '/api/runtime/scheduler/decisions',
      observeGuard(context),
      asyncHandler(async (req, res) => {
        context.assertRuntimeReady('scheduler decisions list')
        const query = parseQuery(schedulerDecisionsQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID')
        const packId = resolvePackIdFromRequest(req)
        const result = await listSchedulerDecisions(context, packId, {
          limit: query.limit,
          cursor: query.cursor,
          actor_id: query.actor_id,
          kind: query.kind,
          reason: query.reason,
          skipped_reason: query.skipped_reason,
          from_tick: query.from_tick,
          to_tick: query.to_tick,
          partition_id: query.partition_id,
          pack_id: query.pack_id
        })
        jsonOk(
          res,
          toJsonSafe({
            items: result.items,
            page_info: result.page_info,
            summary: result.summary
          }),
          {
            pagination: result.page_info
          }
        )
      })
    )

    app.get(
      '/api/agent/:id/scheduler',
      capabilityGuard(context, OPERATOR_CAPABILITY.PERCEIVE_AGENT_SCHEDULER, {
        packIdQuery: 'packId',
        targetAgentIdParam: 'id'
      }),
      asyncHandler(async (req, res) => {
        context.assertRuntimeReady('agent scheduler decisions')
        const packId = resolvePackIdFromRequest(req)
        const { listAgentSchedulerDecisions } = await import(
          '../services/scheduler/agent-queries.js'
        )
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
        const decisions = listAgentSchedulerDecisions(context, packId, req.params.id as string)
        jsonOk(res, toJsonSafe(decisions))
      })
    )
  }
}
