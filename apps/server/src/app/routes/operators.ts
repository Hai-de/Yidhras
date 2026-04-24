import {
  createOperatorRequestSchema,
  updateOperatorRequestSchema
} from '@yidhras/contracts'
import type { Express } from 'express'

import type { OperatorRequest } from '../../operator/auth/types.js'
import { OPERATOR_ERROR_CODE } from '../../operator/constants.js'
import { ApiError } from '../../utils/api_error.js'
import type { AppContext } from '../context.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { parseBody } from '../http/zod.js'
import {
  createOperator,
  deleteOperator,
  getOperator,
  listOperators,
  updateOperator} from '../services/operators.js'

export interface OperatorCrudRouteDependencies {
  asyncHandler(
    handler: (req: OperatorRequest, res: import('express').Response, next: import('express').NextFunction) => Promise<void>
  ): (req: OperatorRequest, res: import('express').Response, next: import('express').NextFunction) => void
}

const requireRoot = (req: OperatorRequest): void => {
  if (!req.operator?.is_root) {
    throw new ApiError(403, OPERATOR_ERROR_CODE.ROOT_REQUIRED, 'Root operator required')
  }
}

export const registerOperatorRoutes = (
  app: Express,
  context: AppContext,
  deps: OperatorCrudRouteDependencies
): void => {
  // POST /api/operators
  app.post(
    '/api/operators',
    deps.asyncHandler(async (req, res) => {
      requireRoot(req)
      const body = parseBody(createOperatorRequestSchema, req.body, 'OPERATOR_INVALID')

      const operator = await createOperator(
        context,
        body,
        req.operator?.id,
        req.ip
      )

      jsonOk(res, toJsonSafe(operator))
    })
  )

  // GET /api/operators
  app.get(
    '/api/operators',
    deps.asyncHandler(async (req, res) => {
      requireRoot(req)
      const operators = await listOperators(context)
      jsonOk(res, toJsonSafe(operators))
    })
  )

  // GET /api/operators/:id
  app.get(
    '/api/operators/:id',
    deps.asyncHandler(async (req, res) => {
      requireRoot(req)
      const operator = await getOperator(context, req.params.id)
      jsonOk(res, toJsonSafe(operator))
    })
  )

  // PATCH /api/operators/:id
  app.patch(
    '/api/operators/:id',
    deps.asyncHandler(async (req, res) => {
      requireRoot(req)
      const body = parseBody(updateOperatorRequestSchema, req.body, 'OPERATOR_INVALID')

      const operator = await updateOperator(
        context,
        req.params.id,
        body,
        req.operator?.id,
        req.ip
      )

      jsonOk(res, toJsonSafe(operator))
    })
  )

  // DELETE /api/operators/:id (软删除)
  app.delete(
    '/api/operators/:id',
    deps.asyncHandler(async (req, res) => {
      requireRoot(req)
      const operator = await deleteOperator(
        context,
        req.params.id,
        req.operator?.id,
        req.ip
      )

      jsonOk(res, toJsonSafe(operator))
    })
  )
}
