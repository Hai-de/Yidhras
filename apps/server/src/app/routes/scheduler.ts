import type { Express, NextFunction, Request, Response } from 'express';

import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import {
  getLatestSchedulerRunReadModel,
  getSchedulerRunReadModelById,
  getSchedulerSummarySnapshot,
  getSchedulerTrendsSnapshot,
  listAgentSchedulerDecisions,
  listSchedulerDecisions,
  listSchedulerRuns
} from '../services/scheduler_observability.js';

export interface SchedulerRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

const parseSampleRuns = (value: unknown): number | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

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
      const result = await listSchedulerRuns(context, {
        limit: typeof req.query.limit === 'string' ? req.query.limit : undefined,
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
        from_tick: typeof req.query.from_tick === 'string' ? req.query.from_tick : undefined,
        to_tick: typeof req.query.to_tick === 'string' ? req.query.to_tick : undefined,
        worker_id: typeof req.query.worker_id === 'string' ? req.query.worker_id : undefined
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
      const summary = await getSchedulerSummarySnapshot(context, {
        sampleRuns: parseSampleRuns(req.query.sample_runs)
      });
      jsonOk(res, toJsonSafe(summary));
    })
  );

  app.get(
    '/api/runtime/scheduler/trends',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler trends');
      const trends = await getSchedulerTrendsSnapshot(context, {
        sampleRuns: parseSampleRuns(req.query.sample_runs)
      });
      jsonOk(res, toJsonSafe(trends));
    })
  );

  app.get(
    '/api/runtime/scheduler/runs/:id',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler run read');
      const readModel = await getSchedulerRunReadModelById(context, req.params.id);
      jsonOk(res, toJsonSafe(readModel));
    })
  );

  app.get(
    '/api/runtime/scheduler/decisions',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('scheduler decisions list');
      const result = await listSchedulerDecisions(context, {
        limit: typeof req.query.limit === 'string' ? req.query.limit : undefined,
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
        actor_id: typeof req.query.actor_id === 'string' ? req.query.actor_id : undefined,
        kind: typeof req.query.kind === 'string' ? req.query.kind : undefined,
        reason: typeof req.query.reason === 'string' ? req.query.reason : undefined,
        skipped_reason: typeof req.query.skipped_reason === 'string' ? req.query.skipped_reason : undefined,
        from_tick: typeof req.query.from_tick === 'string' ? req.query.from_tick : undefined,
        to_tick: typeof req.query.to_tick === 'string' ? req.query.to_tick : undefined
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
