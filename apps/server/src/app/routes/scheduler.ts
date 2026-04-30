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
import type { Express, NextFunction, Request, Response } from 'express'

import { OPERATOR_CAPABILITY } from '../../operator/constants.js'
import type { AppContext } from '../context.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { parseParams, parseQuery } from '../http/zod.js'
import { capabilityGuard } from '../middleware/capability.js'
import { createRuntimeKernelService } from '../runtime/runtime_kernel_service.js'
import {
  getLatestSchedulerRunReadModel,
  getSchedulerRunReadModelById,
  getSchedulerTrendsSnapshot,
  listAgentSchedulerDecisions,
  listSchedulerDecisions,
  listSchedulerOwnershipMigrations,
  listSchedulerRebalanceRecommendations,
  listSchedulerRuns
} from '../services/scheduler_observability.js'

export interface SchedulerRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void
}

const observeGuard = (context: AppContext) =>
  capabilityGuard(context, OPERATOR_CAPABILITY.PERCEIVE_SCHEDULER_OBSERVABILITY, {
    packIdQuery: 'packId'
  })

export const registerSchedulerRoutes = (
  app: Express,
  context: AppContext,
  deps: SchedulerRouteDependencies
): void => {
  app.get(
    '/api/runtime/scheduler/runs/latest',
    observeGuard(context),
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler latest run')
      const packId = req.query.packId as string | undefined
      const readModel = await getLatestSchedulerRunReadModel(context, packId)
      jsonOk(res, toJsonSafe(readModel))
    })
  )

  app.get(
    '/api/runtime/scheduler/runs',
    observeGuard(context),
      // eslint-disable-next-line @typescript-eslint/require-await
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler runs list')
      const query = parseQuery(schedulerRunsQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID')
      const result = listSchedulerRuns(context, {
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
      // eslint-disable-next-line @typescript-eslint/require-await
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler summary')
      const query = parseQuery(schedulerSummaryQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID')
      const packId = req.query.packId as string
      const runtimeKernel = createRuntimeKernelService(context, packId)
      const summary = await runtimeKernel.getSummary?.({
        sampleRuns: query.sample_runs
      })
      jsonOk(res, toJsonSafe(summary))
    })
  )

  app.get(
    '/api/runtime/scheduler/trends',
    observeGuard(context),
      // eslint-disable-next-line @typescript-eslint/require-await
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler trends')
      const query = parseQuery(schedulerTrendsQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID')
      const trends = getSchedulerTrendsSnapshot(context, {
        sampleRuns: query.sample_runs,
        packId: query.pack_id
      })
      jsonOk(res, toJsonSafe(trends))
    })
  )

  app.get(
    '/api/runtime/scheduler/operator',
    observeGuard(context),
      // eslint-disable-next-line @typescript-eslint/require-await
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler operator projection')
      const query = parseQuery(schedulerOperatorQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID')
      const packId = req.query.packId as string
      const runtimeKernel = createRuntimeKernelService(context, packId)
      const projection = await runtimeKernel.getOperatorProjection?.({
        sampleRuns: query.sample_runs,
        recentLimit: query.recent_limit
      })
      jsonOk(res, toJsonSafe(projection))
    })
  )

  app.get(
    '/api/runtime/scheduler/ownership',
    observeGuard(context),
      // eslint-disable-next-line @typescript-eslint/require-await
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler ownership projection')
      const query = parseQuery(schedulerOwnershipQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID')
      const packId = req.query.packId as string
      const runtimeKernel = createRuntimeKernelService(context, packId)
      const result = await runtimeKernel.getOwnershipAssignments?.({
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
      // eslint-disable-next-line @typescript-eslint/require-await
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler ownership migrations')
      const query = parseQuery(schedulerMigrationsQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID')
      const result = listSchedulerOwnershipMigrations(context, {
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
      // eslint-disable-next-line @typescript-eslint/require-await
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler worker runtime states')
      const query = parseQuery(schedulerWorkersQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID')
      const packId = req.query.packId as string
      const runtimeKernel = createRuntimeKernelService(context, packId)
      const result = await runtimeKernel.getWorkers?.({
        worker_id: query.worker_id,
        status: query.status
      })
      jsonOk(res, toJsonSafe(result))
    })
  )

  app.get(
    '/api/runtime/scheduler/rebalance/recommendations',
    observeGuard(context),
      // eslint-disable-next-line @typescript-eslint/require-await
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler rebalance recommendations')
      const query = parseQuery(schedulerRebalanceRecommendationsQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID')
      const result = listSchedulerRebalanceRecommendations(context, {
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
      // eslint-disable-next-line @typescript-eslint/require-await
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler run read')
      const params = parseParams(schedulerRunIdParamsSchema, req.params, 'SCHEDULER_QUERY_INVALID')
      const packId = req.query.packId as string | undefined
      const readModel = await getSchedulerRunReadModelById(context, params.id, packId)
      jsonOk(res, toJsonSafe(readModel))
    })
  )

  app.get(
    '/api/runtime/scheduler/decisions',
    observeGuard(context),
      // eslint-disable-next-line @typescript-eslint/require-await
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler decisions list')
      const query = parseQuery(schedulerDecisionsQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID')
      const result = await listSchedulerDecisions(context, {
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
      // eslint-disable-next-line @typescript-eslint/require-await
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('agent scheduler decisions')
      const packId = req.query.packId as string | undefined
      const decisions = listAgentSchedulerDecisions(context, req.params.id, undefined, packId)
      jsonOk(res, toJsonSafe(decisions))
    })
  )
}
