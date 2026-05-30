import {
  createAgentBindingRequestSchema
} from '@yidhras/contracts'

import type { OperatorRequest } from '../../operator/auth/types.js'
import { OPERATOR_ERROR_CODE } from '../../operator/constants.js'
import { ApiError } from '../../utils/api_error.js'
import { asyncHandler } from '../http/async_handler.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { parseBody } from '../http/zod.js'
import {
  createAgentBinding,
  listAgentOperators,
  unbindAgent} from '../services/operator/operator_agent_bindings.js'
import type { RouteModule } from './types.js'

export const agentBindingRoutes: RouteModule = {
  register(app, context) {
  // POST /api/agents/:agentId/bindings
  app.post(
    '/api/agents/:agentId/bindings',
    asyncHandler(async (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      const body = parseBody(createAgentBindingRequestSchema, req.body, 'BINDING_INVALID')

      const binding = await createAgentBinding(
        context,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
        req.params['agentId'] as string,
        body.operator_id || operator.identity_id,
        body.role,
        operator.id,
        req.ip
      )

      jsonOk(res, toJsonSafe(binding))
    })
  )

  // DELETE /api/agents/:agentId/bindings/me
  app.delete(
    '/api/agents/:agentId/bindings/me',
    asyncHandler(async (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      const result = await unbindAgent(
        context,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
        req.params['agentId'] as string,
        operator.identity_id,
        operator.id,
        req.ip
      )

      jsonOk(res, toJsonSafe(result))
    })
  )

  // GET /api/agents/:agentId/operators
  app.get(
    '/api/agents/:agentId/operators',
    asyncHandler(async (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
      const operators = await listAgentOperators(context, req.params['agentId'] as string)
      jsonOk(res, toJsonSafe(operators))
    })
  )
  },
}
