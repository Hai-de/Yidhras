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
} from '@yidhras/contracts';
import type { Express, NextFunction, Request, Response } from 'express';

import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseParams, parseQuery } from '../http/zod.js';
import {
  getLatestSchedulerRunReadModel,
  getSchedulerOperatorProjection,
  getSchedulerRunReadModelById,
  getSchedulerSummarySnapshot,
  getSchedulerTrendsSnapshot,
  listAgentSchedulerDecisions,
  listSchedulerDecisions,
  listSchedulerOwnershipAssignments,
  listSchedulerOwnershipMigrations,
  listSchedulerRebalanceRecommendations,
  listSchedulerRuns,
  listSchedulerWorkers,
} from '../services/scheduler_observability.js';

export interface SchedulerRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

export const registerSchedulerRoutes = (
  app: Express,
  context: AppContext,
  deps: SchedulerRouteDependencies
): void => {
  app.get(
    '/api/runtime/scheduler/runs/latest',
    deps.asyncHandler(async (_req, res) => {
      context.assertRuntimeReady('scheduler latest run');
      const readModel = await getLatestSchedulerRunReadModel(context);
      jsonOk(res, toJsonSafe(readModel));
    })
  );

  app.get(
    '/api/runtime/scheduler/runs',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler runs list');
      const query = parseQuery(schedulerRunsQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID');
      const result = await listSchedulerRuns(context, {
        limit: query.limit,
        cursor: query.cursor,
        from_tick: query.from_tick,
        to_tick: query.to_tick,
        worker_id: query.worker_id,
        partition_id: query.partition_id
      });
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
      );
    })
  );

  app.get(
    '/api/runtime/scheduler/summary',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler summary');
      const query = parseQuery(schedulerSummaryQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID');
      const summary = await getSchedulerSummarySnapshot(context, {
        sampleRuns: query.sample_runs
      });
      jsonOk(res, toJsonSafe(summary));
    })
  );

  app.get(
    '/api/runtime/scheduler/trends',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler trends');
      const query = parseQuery(schedulerTrendsQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID');
      const trends = await getSchedulerTrendsSnapshot(context, {
        sampleRuns: query.sample_runs
      });
      jsonOk(res, toJsonSafe(trends));
    })
  );

  app.get(
    '/api/runtime/scheduler/operator',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler operator projection');
      const query = parseQuery(schedulerOperatorQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID');
      const projection = await getSchedulerOperatorProjection(context, {
        sampleRuns: query.sample_runs,
        recentLimit: query.recent_limit
      });
      jsonOk(res, toJsonSafe(projection));
    })
  );

  app.get(
    '/api/runtime/scheduler/ownership',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler ownership projection');
      const query = parseQuery(schedulerOwnershipQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID');
      const result = await listSchedulerOwnershipAssignments(context, {
        worker_id: query.worker_id,
        partition_id: query.partition_id,
        status: query.status
      });
      jsonOk(res, toJsonSafe(result));
    })
  );

  app.get(
    '/api/runtime/scheduler/migrations',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler ownership migrations');
      const query = parseQuery(schedulerMigrationsQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID');
      const result = await listSchedulerOwnershipMigrations(context, {
        limit: query.limit,
        worker_id: query.worker_id,
        partition_id: query.partition_id,
        status: query.status
      });
      jsonOk(res, toJsonSafe(result));
    })
  );

  app.get(
    '/api/runtime/scheduler/workers',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler worker runtime states');
      const query = parseQuery(schedulerWorkersQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID');
      const result = await listSchedulerWorkers(context, {
        worker_id: query.worker_id,
        status: query.status
      });
      jsonOk(res, toJsonSafe(result));
    })
  );

  app.get(
    '/api/runtime/scheduler/rebalance/recommendations',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler rebalance recommendations');
      const query = parseQuery(schedulerRebalanceRecommendationsQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID');
      const result = await listSchedulerRebalanceRecommendations(context, {
        limit: query.limit,
        worker_id: query.worker_id,
        partition_id: query.partition_id,
        status: query.status,
        suppress_reason: query.suppress_reason
      });
      jsonOk(res, toJsonSafe(result));
    })
  );

  app.get(
    '/api/runtime/scheduler/runs/:id',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler run read');
      const params = parseParams(schedulerRunIdParamsSchema, req.params, 'SCHEDULER_QUERY_INVALID');
      const readModel = await getSchedulerRunReadModelById(context, params.id);
      jsonOk(res, toJsonSafe(readModel));
    })
  );

  app.get(
    '/api/runtime/scheduler/decisions',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler decisions list');
      const query = parseQuery(schedulerDecisionsQuerySchema, req.query, 'SCHEDULER_QUERY_INVALID');
      const result = await listSchedulerDecisions(context, {
        limit: query.limit,
        cursor: query.cursor,
        actor_id: query.actor_id,
        kind: query.kind,
        reason: query.reason,
        skipped_reason: query.skipped_reason,
        from_tick: query.from_tick,
        to_tick: query.to_tick,
        partition_id: query.partition_id
      });
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
      );
    })
  );

  app.get(
    '/api/agent/:id/scheduler',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('agent scheduler decisions');
      const decisions = await listAgentSchedulerDecisions(context, req.params.id);
      jsonOk(res, toJsonSafe(decisions));
    })
  );
};
