import {
  createPackBindingRequestSchema,
  updatePackBindingRequestSchema
} from '@yidhras/contracts'

import type { OperatorRequest } from '../../operator/auth/types.js'
import { OPERATOR_ERROR_CODE } from '../../operator/constants.js'
import { ApiError } from '../../utils/api_error.js'
import { asyncHandler } from '../http/async_handler.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { parseBody } from '../http/zod.js'
import {
  createPackBinding,
  listMyPackBindings,
  listPackBindings,
  removePackBinding,
  updatePackBinding} from '../services/operator/operator_pack_bindings.js'
import type { RouteModule } from './types.js'

export const packBindingRoutes: RouteModule = {
  register(app, context) {
  // POST /api/packs/:packId/bindings — 邀请加入
  app.post(
    '/api/packs/:packId/bindings',
    asyncHandler(async (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      const body = parseBody(createPackBindingRequestSchema, req.body, 'BINDING_INVALID')

      const binding = await createPackBinding(
        context,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
        req.params['packId'] as string,
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
    asyncHandler(async (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
      const bindings = await listPackBindings(context, req.params['packId'] as string)
      jsonOk(res, toJsonSafe(bindings))
    })
  )

  // PATCH /api/packs/:packId/bindings/:operatorId — 修改角色
  app.patch(
    '/api/packs/:packId/bindings/:operatorId',
    asyncHandler(async (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      const body = parseBody(updatePackBindingRequestSchema, req.body, 'BINDING_INVALID')

      const binding = await updatePackBinding(
        context,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
        req.params['packId'] as string,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
        req.params['operatorId'] as string,
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
    asyncHandler(async (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      const result = await removePackBinding(
        context,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
        req.params['packId'] as string,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
        req.params['operatorId'] as string,
        operator.id,
        req.ip
      )

      jsonOk(res, toJsonSafe(result))
    })
  )

  // GET /api/me/bindings — 当前 Operator 的 Pack 列表
  app.get(
    '/api/me/bindings',
    asyncHandler(async (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      const bindings = await listMyPackBindings(context, operator.id)
      jsonOk(res, toJsonSafe(bindings))
    })
  )
  },
}
