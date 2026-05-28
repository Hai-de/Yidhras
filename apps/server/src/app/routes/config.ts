import type { NextFunction, Response } from 'express'
import { z } from 'zod'

import { logOperatorAudit } from '../../operator/audit/logger.js'
import type { OperatorRequest } from '../../operator/auth/types.js'
import { AUDIT_ACTION } from '../../operator/constants.js'
import { ApiError } from '../../utils/api_error.js'
import { asyncHandler } from '../http/async_handler.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { parseBody } from '../http/zod.js'
import {
  getDomainConfig,
  getMaskedConfig,
  listConfigDomains,
  updateDomainConfig
} from '../services/config/config.js'
import type { RouteModule } from './types.js'

const requireRoot = (req: OperatorRequest, _res: Response, next: NextFunction): void => {
  if (!req.operator?.is_root) {
    throw new ApiError(403, 'ROOT_REQUIRED', 'Root operator required')
  }
  next()
}

const updateConfigSchema = z.record(z.string(), z.unknown())

export const configRoutes: RouteModule = {
  register(app, context) {
    // GET /api/config — full config (masked)
    app.get(
      '/api/config',
      (req, res) => {
        const operator = (req as OperatorRequest).operator
        if (!operator) {
          throw new ApiError(401, 'OPERATOR_REQUIRED', 'Authentication required')
        }
        const config = getMaskedConfig()
        jsonOk(res, toJsonSafe(config))
      }
    )

    // GET /api/config/domains — list domains with tiers
    app.get(
      '/api/config/domains',
      (req, res) => {
        const operator = (req as OperatorRequest).operator
        if (!operator) {
          throw new ApiError(401, 'OPERATOR_REQUIRED', 'Authentication required')
        }
        jsonOk(res, toJsonSafe(listConfigDomains()))
      }
    )

    // GET /api/config/:domain — single domain config
    app.get(
      '/api/config/:domain',
      (req, res) => {
        const operator = (req as OperatorRequest).operator
        if (!operator) {
          throw new ApiError(401, 'OPERATOR_REQUIRED', 'Authentication required')
        }
        const domainConfig = getDomainConfig(req.params.domain)
        if (!domainConfig) {
          throw new ApiError(404, 'CONFIG_DOMAIN_NOT_FOUND', `配置域 "${req.params.domain}" 不存在`)
        }
        jsonOk(res, toJsonSafe(domainConfig))
      }
    )

    // PATCH /api/config/:domain — update config domain (root required)
    app.patch(
      '/api/config/:domain',
      requireRoot,
      asyncHandler(async (req, res) => {
        const body = parseBody(updateConfigSchema, req.body, 'INVALID_CONFIG_UPDATE')
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
        const domain = req.params.domain as string
        const result = updateDomainConfig(domain, body)
        const opReq = req as OperatorRequest

        if (!result) {
          throw new ApiError(404, 'CONFIG_DOMAIN_NOT_FOUND', `配置域 "${domain}" 不存在或无法更新`)
        }

        await logOperatorAudit(context, {
          operator_id: opReq.operator?.id ?? null,
          action: AUDIT_ACTION.UPDATE_CONFIG,
          target_id: domain,
          detail_json: { domain, tier: result.tier, hotReloaded: result.hotReloaded },
          client_ip: opReq.ip ?? null
        })

        jsonOk(res, toJsonSafe(result))
      })
    )
  }
}
