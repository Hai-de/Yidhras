import {
  createOperatorGrantRequestSchema
} from '@yidhras/contracts'

import type { OperatorRequest } from '../../operator/auth/types.js'
import { OPERATOR_ERROR_CODE } from '../../operator/constants.js'
import { ApiError } from '../../utils/api_error.js'
import { asyncHandler } from '../http/async_handler.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { parseBody } from '../http/zod.js'
import {
  createOperatorGrant,
  listOperatorGrants,
  revokeOperatorGrant
} from '../services/operator/operator_grants.js'
import type { RouteModule } from './types.js'

export const grantRoutes: RouteModule = {
  register(app, context) {
  // POST /api/packs/:packId/grants
  app.post(
    '/api/packs/:packId/grants',
    asyncHandler(async (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      const body = parseBody(createOperatorGrantRequestSchema, req.body, 'GRANT_INVALID')

      const expiresAt = body.expires_at !== undefined
        ? (body.expires_at === null ? null : BigInt(body.expires_at))
        : undefined

      const grant = await createOperatorGrant(
        context,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
        req.params['packId'] as string,
        operator.id,
        body.receiver_identity_id,
        body.capability_key,
// @ts-expect-error -- EOPT strict mode
        {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Prisma JSON column
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
    asyncHandler(async (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
      const grants = await listOperatorGrants(context, req.params['packId'] as string, operator.id)
      jsonOk(res, toJsonSafe(grants))
    })
  )

  // DELETE /api/packs/:packId/grants/:grantId
  app.delete(
    '/api/packs/:packId/grants/:grantId',
    asyncHandler(async (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      const result = await revokeOperatorGrant(
        context,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
        req.params['grantId'] as string,
        operator.id,
        req.ip
      )

      jsonOk(res, toJsonSafe(result))
    })
  )
  },
}
