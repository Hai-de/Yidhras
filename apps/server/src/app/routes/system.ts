import {
  acknowledgementDataSchema,
  runtimeStatusDataSchema,
  startupHealthDataSchema,
  systemMessageSchema
} from '@yidhras/contracts'
import type { Express, NextFunction, Response } from 'express'

import type { OperatorRequest } from '../../operator/auth/types.js'
import { OPERATOR_ERROR_CODE } from '../../operator/constants.js'
import { ApiError } from '../../utils/api_error.js'
import type { AppContext } from '../context.js'
import { jsonOk } from '../http/json.js'
import {
  clearSystemNotifications,
  getRuntimeStatusSnapshot,
  getStartupHealthSnapshot,
  listSystemNotifications
} from '../services/system.js'

const requireRoot = (req: OperatorRequest, _res: Response, next: NextFunction): void => {
  if (!req.operator?.is_root) {
    throw new ApiError(403, OPERATOR_ERROR_CODE.ROOT_REQUIRED, 'Root operator required')
  }
  next()
}

export const registerSystemRoutes = (app: Express, context: AppContext): void => {
  app.get(
    '/api/system/notifications',
    requireRoot,
    (_req, res) => {
      const messages = listSystemNotifications(context)
      systemMessageSchema.array().parse(messages)
      jsonOk(res, messages)
    }
  )

  app.post(
    '/api/system/notifications/clear',
    requireRoot,
    (_req, res) => {
      const snapshot = clearSystemNotifications(context)
      acknowledgementDataSchema.parse(snapshot)
      jsonOk(res, snapshot)
    }
  )

  app.get(
    '/api/status',
    requireRoot,
    (_req, res, next) => {
      const packId = context.packRuntimeLookup?.getActivePackId() ?? undefined;
      getRuntimeStatusSnapshot(context, {
        packId,
        schedulerWorkerId: process.env.SCHEDULER_WORKER_ID,
        schedulerPartitionIds: undefined
      })
        .then(snapshot => {
          runtimeStatusDataSchema.parse(snapshot)
          jsonOk(res, snapshot)
        })
        .catch(next)
    }
  )

  app.get('/api/health', async (_req, res) => {
    const snapshot = getStartupHealthSnapshot(context)

    // Include sidecar health if world engine is available
    let sidecars: Record<string, { alive: boolean }> | undefined;
    try {
      if (context.worldEngine) {
        const weHealth = await context.worldEngine.getHealth();
        sidecars = {
          world_engine: { alive: weHealth.engine_status === 'ready' || weHealth.engine_status === 'degraded' }
        };
      }
    } catch {
      sidecars = { world_engine: { alive: false } };
    }

    const body = { ...snapshot.body, ...(sidecars ? { sidecars } : {}) };
    startupHealthDataSchema.parse(snapshot.body);
    res.status(snapshot.statusCode);
    jsonOk(res, body);
  })
}
