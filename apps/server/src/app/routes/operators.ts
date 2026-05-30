import {
  createOperatorRequestSchema,
  updateOperatorRequestSchema
} from '@yidhras/contracts'

import type { OperatorRequest } from '../../operator/auth/types.js'
import { OPERATOR_ERROR_CODE } from '../../operator/constants.js'
import { ApiError } from '../../utils/api_error.js'
import { asyncHandler } from '../http/async_handler.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { parseBody } from '../http/zod.js'
import {
  createOperator,
  deleteOperator,
  getOperator,
  listOperators,
  updateOperator} from '../services/operator/operators.js'
import type { RouteModule } from './types.js'

const requireRoot = (req: OperatorRequest): void => {
  if (!req.operator?.is_root) {
    throw new ApiError(403, OPERATOR_ERROR_CODE.ROOT_REQUIRED, 'Root operator required')
  }
}

export const operatorRoutes: RouteModule = {
  register(app, context) {
  // POST /api/operators
  app.post(
    '/api/operators',
    asyncHandler(async (req, res) => {
      requireRoot(req)
      const body = parseBody(createOperatorRequestSchema, req.body, 'OPERATOR_INVALID')

      const operator = await createOperator(
        context,
// @ts-expect-error -- EOPT strict mode
        body,
        (req as OperatorRequest).operator?.id,
        req.ip
      )

      jsonOk(res, toJsonSafe(operator))
    })
  )

  // GET /api/operators
  app.get(
    '/api/operators',
    asyncHandler(async (req, res) => {
      requireRoot(req)
      const operators = await listOperators(context)
      jsonOk(res, toJsonSafe(operators))
    })
  )

  // GET /api/operators/:id
  app.get(
    '/api/operators/:id',
    asyncHandler(async (req, res) => {
      requireRoot(req)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
      const operator = await getOperator(context, req.params['id'] as string)
      jsonOk(res, toJsonSafe(operator))
    })
  )

  // PATCH /api/operators/:id
  app.patch(
    '/api/operators/:id',
    asyncHandler(async (req, res) => {
      requireRoot(req)
      const body = parseBody(updateOperatorRequestSchema, req.body, 'OPERATOR_INVALID')

      const operator = await updateOperator(
        context,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
        req.params['id'] as string,
// @ts-expect-error -- EOPT strict mode
        body,
        (req as OperatorRequest).operator?.id,
        req.ip
      )

      jsonOk(res, toJsonSafe(operator))
    })
  )

  // DELETE /api/operators/:id (软删除)
  app.delete(
    '/api/operators/:id',
    asyncHandler(async (req, res) => {
      requireRoot(req)
      const operator = await deleteOperator(
        context,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
        req.params['id'] as string,
        (req as OperatorRequest).operator?.id,
        req.ip
      )

      jsonOk(res, toJsonSafe(operator))
    })
  )
  },
}
