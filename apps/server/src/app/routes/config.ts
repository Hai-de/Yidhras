import type { Express, NextFunction, Response } from 'express'
import { z } from 'zod'

import { logOperatorAudit } from '../../operator/audit/logger.js'
import type { OperatorRequest } from '../../operator/auth/types.js'
import { AUDIT_ACTION } from '../../operator/constants.js'
import { ApiError } from '../../utils/api_error.js'
import type { AppContext } from '../context.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { parseBody } from '../http/zod.js'
import {
  getDomainConfig,
  getMaskedConfig,
  listConfigDomains,
  updateDomainConfig
} from '../services/config.js'

const requireRoot = (req: OperatorRequest, _res: Response, next: NextFunction): void => {
  if (!req.operator?.is_root) {
    throw new ApiError(403, 'ROOT_REQUIRED', 'Root operator required')
  }
  next()
}

const updateConfigSchema = z.record(z.string(), z.unknown())

export interface ConfigRouteDependencies {
  asyncHandler(
    handler: (
      req: OperatorRequest,
      res: Response,
      next: NextFunction
    ) => Promise<void>
  ): (req: OperatorRequest, res: Response, next: NextFunction) => void
}

export const registerConfigRoutes = (
  app: Express,
  context: AppContext,
  deps: ConfigRouteDependencies
): void => {
  // GET /api/config — full config (masked)
  app.get(
    '/api/config',
    deps.asyncHandler(async (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        throw new ApiError(401, 'OPERATOR_REQUIRED', 'Authentication required')
      }
      const config = getMaskedConfig()
      jsonOk(res, toJsonSafe(config))
    })
  )

  // GET /api/config/domains — list domains with tiers
  app.get(
    '/api/config/domains',
    deps.asyncHandler(async (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        throw new ApiError(401, 'OPERATOR_REQUIRED', 'Authentication required')
      }
      jsonOk(res, toJsonSafe(listConfigDomains()))
    })
  )

  // GET /api/config/:domain — single domain config
  app.get(
    '/api/config/:domain',
    deps.asyncHandler(async (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        throw new ApiError(401, 'OPERATOR_REQUIRED', 'Authentication required')
      }
      const domainConfig = getDomainConfig(req.params.domain)
      if (!domainConfig) {
        throw new ApiError(404, 'CONFIG_DOMAIN_NOT_FOUND', `配置域 "${req.params.domain}" 不存在`)
      }
      jsonOk(res, toJsonSafe(domainConfig))
    })
  )

  // PATCH /api/config/:domain — update config domain (root required)
  app.patch(
    '/api/config/:domain',
    requireRoot,
    deps.asyncHandler(async (req, res) => {
      const body = parseBody(updateConfigSchema, req.body, 'INVALID_CONFIG_UPDATE')
      const domain = req.params.domain
      const result = updateDomainConfig(domain, body)

      if (!result) {
        throw new ApiError(404, 'CONFIG_DOMAIN_NOT_FOUND', `配置域 "${domain}" 不存在或无法更新`)
      }

      await logOperatorAudit(context, {
        operator_id: req.operator?.id ?? null,
        action: AUDIT_ACTION.UPDATE_CONFIG,
        target_id: domain,
        detail_json: { domain, tier: result.tier, hotReloaded: result.hotReloaded },
        client_ip: req.ip ?? null
      })

      jsonOk(res, toJsonSafe(result))
    })
  )
}
