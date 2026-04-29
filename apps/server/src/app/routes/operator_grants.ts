import {
  createOperatorGrantRequestSchema
} from '@yidhras/contracts'
import type { Express } from 'express'

import type { OperatorRequest } from '../../operator/auth/types.js'
import { OPERATOR_ERROR_CODE } from '../../operator/constants.js'
import { ApiError } from '../../utils/api_error.js'
import type { AppContext } from '../context.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { parseBody } from '../http/zod.js'
import {
  createOperatorGrant,
  listOperatorGrants,
  revokeOperatorGrant
} from '../services/operator_grants.js'

export interface GrantRouteDependencies {
  asyncHandler(
    handler: (req: OperatorRequest, res: import('express').Response, next: import('express').NextFunction) => Promise<void>
  ): (req: OperatorRequest, res: import('express').Response, next: import('express').NextFunction) => void
}

export const registerGrantRoutes = (
  app: Express,
  context: AppContext,
  deps: GrantRouteDependencies
): void => {
  // POST /api/packs/:packId/grants
  app.post(
    '/api/packs/:packId/grants',
    deps.asyncHandler(async (req, res) => {
      const operator = (req).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      const body = parseBody(createOperatorGrantRequestSchema, req.body, 'GRANT_INVALID')

      const expiresAt = body.expires_at !== undefined
        ? (body.expires_at === null ? null : BigInt(body.expires_at))
        : undefined

      const grant = await createOperatorGrant(
        context,
        req.params.packId,
        operator.id,
        body.receiver_identity_id,
        body.capability_key,
        {
          scope_json: body.scope_json as Record<string, unknown> | undefined,
          revocable: body.revocable,
          expires_at: expiresAt === undefined ? undefined : expiresAt
        },
        req.ip
      )

      jsonOk(res, toJsonSafe(grant))
    })
  )

  // GET /api/packs/:packId/grants
  app.get(
    '/api/packs/:packId/grants',
    deps.asyncHandler(async (req, res) => {
      const operator = (req).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      const grants = await listOperatorGrants(context, req.params.packId, operator.id)
      jsonOk(res, toJsonSafe(grants))
    })
  )

  // DELETE /api/packs/:packId/grants/:grantId
  app.delete(
    '/api/packs/:packId/grants/:grantId',
    deps.asyncHandler(async (req, res) => {
      const operator = (req).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      const result = await revokeOperatorGrant(
        context,
        req.params.grantId,
        operator.id,
        req.ip
      )

      jsonOk(res, toJsonSafe(result))
    })
  )
}
