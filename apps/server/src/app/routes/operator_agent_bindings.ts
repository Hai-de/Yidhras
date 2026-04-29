import {
  createAgentBindingRequestSchema
} from '@yidhras/contracts'
import type { Express } from 'express'

import type { OperatorRequest } from '../../operator/auth/types.js'
import { OPERATOR_ERROR_CODE } from '../../operator/constants.js'
import { ApiError } from '../../utils/api_error.js'
import type { AppContext } from '../context.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { parseBody } from '../http/zod.js'
import {
  createAgentBinding,
  listAgentOperators,
  unbindAgent} from '../services/operator_agent_bindings.js'

export interface AgentBindingRouteDependencies {
  asyncHandler(
    handler: (req: OperatorRequest, res: import('express').Response, next: import('express').NextFunction) => Promise<void>
  ): (req: OperatorRequest, res: import('express').Response, next: import('express').NextFunction) => void
}

export const registerAgentBindingRoutes = (
  app: Express,
  context: AppContext,
  deps: AgentBindingRouteDependencies
): void => {
  // POST /api/agents/:agentId/bindings
  app.post(
    '/api/agents/:agentId/bindings',
    deps.asyncHandler(async (req, res) => {
      const operator = (req).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      const body = parseBody(createAgentBindingRequestSchema, req.body, 'BINDING_INVALID')

      const binding = await createAgentBinding(
        context,
        req.params.agentId,
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
    deps.asyncHandler(async (req, res) => {
      const operator = (req).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      const result = await unbindAgent(
        context,
        req.params.agentId,
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
    deps.asyncHandler(async (req, res) => {
      const operators = await listAgentOperators(context, req.params.agentId)
      jsonOk(res, toJsonSafe(operators))
    })
  )
}
