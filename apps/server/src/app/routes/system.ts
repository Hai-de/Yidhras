import {
  acknowledgementDataSchema,
  runtimeStatusDataSchema,
  startupHealthDataSchema,
  systemMessageSchema
} from '@yidhras/contracts'
import type { Express, NextFunction, Response } from 'express'

import { getMetricsRegistry, setSidecarHealth } from '../../observability/metrics.js'
import type { OperatorRequest } from '../../operator/auth/types.js'
import { OPERATOR_ERROR_CODE } from '../../operator/constants.js'
import { ApiError } from '../../utils/api_error.js'
import type { AppContext } from '../context.js'
import { getErrorMessage } from '../http/errors.js'
import { jsonOk } from '../http/json.js'
import { requireAuth } from '../middleware/require_auth.js'
import {
  clearSystemNotifications,
  getRuntimeStatusSnapshot,
  getStartupHealthSnapshot,
  listSystemNotifications
} from '../services/system/system.js'

const requireRoot = (req: OperatorRequest, _res: Response, next: NextFunction): void => {
  if (!req.operator?.is_root) {
    throw new ApiError(403, OPERATOR_ERROR_CODE.ROOT_REQUIRED, 'Root operator required')
  }
  next()
}

export const registerSystemRoutes = (app: Express, context: AppContext): void => {
  app.get('/metrics', (_req, res) => {
    void (async () => {
      try {
        const registry = getMetricsRegistry()
        const metrics = await registry.metrics()
        res.type(registry.contentType)
        res.status(200).send(metrics)
      } catch (err) {
        res.status(500).type('text/plain').send(`Failed to collect metrics: ${getErrorMessage(err)}`)
      }
    })()
  })

  app.get(
    '/api/system/notifications',
    requireAuth(),
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
    requireAuth(),
    (req, res, next) => {
      const rawPackId = req.query.packId;
      const packId = typeof rawPackId === 'string' && rawPackId.trim().length > 0
        ? rawPackId.trim()
        : undefined;
      if (!packId) {
        next(new ApiError(400, 'PACK_ID_REQUIRED', 'packId query parameter is required'));
        return;
      }

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
    let sidecars: Record<string, {
      alive: boolean
      engine_status?: string
      protocol_version?: string
      error?: string
    }> | undefined;
    try {
      if (context.worldEngine) {
        const weHealth = await context.worldEngine.getHealth();
        const alive = weHealth.engine_status === 'ready' || weHealth.engine_status === 'degraded'
        setSidecarHealth('world_engine', alive)
        sidecars = {
          world_engine: {
            alive,
            engine_status: weHealth.engine_status,
            protocol_version: weHealth.protocol_version
          }
        };
      }
    } catch (err) {
      setSidecarHealth('world_engine', false)
      sidecars = { world_engine: { alive: false, error: getErrorMessage(err) } };
    }

    const body = { ...snapshot.body, ...(sidecars ? { sidecars } : {}) };
    startupHealthDataSchema.parse(body);
    res.status(snapshot.statusCode);
    jsonOk(res, body);
  })
}
