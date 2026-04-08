import {
  agentIdParamsSchema,
  agentSchedulerProjectionQuerySchema,
  agentSnrLogsQuerySchema,
  entityIdParamsSchema,
  entityOverviewDataSchema,
  entityOverviewQuerySchema
} from '@yidhras/contracts';
import type { Express, NextFunction, Request, Response } from 'express';

import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseParams, parseQuery } from '../http/zod.js';
import { getAgentContextSnapshot, getEntityOverview, listSnrAdjustmentLogs } from '../services/agent.js';
import { getAgentSchedulerProjection } from '../services/scheduler_observability.js';

export interface AgentRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

export const registerAgentRoutes = (
  app: Express,
  context: AppContext,
  deps: AgentRouteDependencies
): void => {
  const sendEntityOverview = async (
    req: Request,
    res: Response,
    options: {
      runtimeFeature: string;
    }
  ): Promise<void> => {
    context.assertRuntimeReady(options.runtimeFeature);
    const params = parseParams(entityIdParamsSchema, req.params, 'AGENT_QUERY_INVALID');
    const query = parseQuery(entityOverviewQuerySchema, req.query, 'AGENT_QUERY_INVALID');
    const overview = await getEntityOverview(context, params.id, {
      limit: query.limit
    });
    entityOverviewDataSchema.parse(overview);

    jsonOk(res, toJsonSafe(overview));
  };

  app.get(
    '/api/agent/:id/context',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('agent context');
      const params = parseParams(agentIdParamsSchema, req.params, 'AGENT_QUERY_INVALID');
      const snapshot = await getAgentContextSnapshot(context, params.id);

      jsonOk(res, toJsonSafe(snapshot));
    })
  );

  app.get(
    '/api/entities/:id/overview',
    deps.asyncHandler(async (req, res) => {
      await sendEntityOverview(req, res, {
        runtimeFeature: 'entity overview'
      });
    })
  );

  app.get(
    '/api/agent/:id/scheduler/projection',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('agent scheduler projection');
      const params = parseParams(agentIdParamsSchema, req.params, 'AGENT_QUERY_INVALID');
      const query = parseQuery(agentSchedulerProjectionQuerySchema, req.query, 'AGENT_QUERY_INVALID');
      const projection = await getAgentSchedulerProjection(context, params.id, {
        limit: query.limit
      });

      jsonOk(res, toJsonSafe(projection));
    })
  );

  app.get(
    '/api/agent/:id/snr/logs',
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('agent snr adjustment logs');
      const params = parseParams(agentIdParamsSchema, req.params, 'SNR_LOG_QUERY_INVALID');
      const query = parseQuery(agentSnrLogsQuerySchema, req.query, 'SNR_LOG_QUERY_INVALID');
      const logs = await listSnrAdjustmentLogs(context, {
        agent_id: params.id,
        limit: query.limit
      });

      jsonOk(res, toJsonSafe(logs));
    })
  );
};
