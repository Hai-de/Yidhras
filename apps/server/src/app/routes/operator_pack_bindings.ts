import {
  createPackBindingRequestSchema,
  updatePackBindingRequestSchema
} from '@yidhras/contracts'
import type { Express } from 'express'

import type { OperatorRequest } from '../../operator/auth/types.js'
import { OPERATOR_ERROR_CODE } from '../../operator/constants.js'
import { ApiError } from '../../utils/api_error.js'
import type { AppContext } from '../context.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { parseBody } from '../http/zod.js'
import {
  createPackBinding,
  listMyPackBindings,
  listPackBindings,
  removePackBinding,
  updatePackBinding} from '../services/operator_pack_bindings.js'

export interface PackBindingRouteDependencies {
  asyncHandler(
    handler: (req: OperatorRequest, res: import('express').Response, next: import('express').NextFunction) => Promise<void>
  ): (req: OperatorRequest, res: import('express').Response, next: import('express').NextFunction) => void
}

export const registerPackBindingRoutes = (
  app: Express,
  context: AppContext,
  deps: PackBindingRouteDependencies
): void => {
  // POST /api/packs/:packId/bindings — 邀请加入
  app.post(
    '/api/packs/:packId/bindings',
    deps.asyncHandler(async (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      const body = parseBody(createPackBindingRequestSchema, req.body, 'BINDING_INVALID')

      const binding = await createPackBinding(
        context,
        req.params.packId,
        body.operator_id,
        body.binding_type,
        operator.id,
        req.ip
      )

      jsonOk(res, toJsonSafe(binding))
    })
  )

  // GET /api/packs/:packId/bindings — 成员列表
  app.get(
    '/api/packs/:packId/bindings',
    deps.asyncHandler(async (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      const bindings = await listPackBindings(context, req.params.packId)
      jsonOk(res, toJsonSafe(bindings))
    })
  )

  // PATCH /api/packs/:packId/bindings/:operatorId — 修改角色
  app.patch(
    '/api/packs/:packId/bindings/:operatorId',
    deps.asyncHandler(async (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      const body = parseBody(updatePackBindingRequestSchema, req.body, 'BINDING_INVALID')

      const binding = await updatePackBinding(
        context,
        req.params.packId,
        req.params.operatorId,
        body.binding_type,
        operator.id,
        req.ip
      )

      jsonOk(res, toJsonSafe(binding))
    })
  )

  // DELETE /api/packs/:packId/bindings/:operatorId — 移除成员
  app.delete(
    '/api/packs/:packId/bindings/:operatorId',
    deps.asyncHandler(async (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      const result = await removePackBinding(
        context,
        req.params.packId,
        req.params.operatorId,
        operator.id,
        req.ip
      )

      jsonOk(res, toJsonSafe(result))
    })
  )

  // GET /api/me/bindings — 当前 Operator 的 Pack 列表
  app.get(
    '/api/me/bindings',
    deps.asyncHandler(async (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      const bindings = await listMyPackBindings(context, operator.id)
      jsonOk(res, toJsonSafe(bindings))
    })
  )
}
