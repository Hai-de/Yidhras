import {
  loginRequestSchema
} from '@yidhras/contracts'
import type { Express } from 'express'

import type { OperatorRequest } from '../../operator/auth/types.js'
import type { AppContext } from '../context.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { parseBody } from '../http/zod.js'
import {
  getSessionInfo,
  loginOperator,
  logoutOperator,
  refreshToken
} from '../services/operator_auth.js'

export interface OperatorAuthRouteDependencies {
  asyncHandler(
    handler: (req: OperatorRequest, res: import('express').Response, next: import('express').NextFunction) => Promise<void>
  ): (req: OperatorRequest, res: import('express').Response, next: import('express').NextFunction) => void
}

export const registerOperatorAuthRoutes = (
  app: Express,
  context: AppContext,
  deps: OperatorAuthRouteDependencies
): void => {
  // POST /api/auth/login
  app.post(
    '/api/auth/login',
    deps.asyncHandler(async (req, res) => {
      const body = parseBody(loginRequestSchema, req.body, 'LOGIN_INVALID')

      const result = await loginOperator(
        context,
        body.username,
        body.password,
        body.pack_id,
        req.ip
      )

      jsonOk(res, toJsonSafe(result))
    })
  )

  // POST /api/auth/logout
  app.post(
    '/api/auth/logout',
    deps.asyncHandler(async (req, res) => {
      const bearer = req.header('authorization')
      const token = bearer?.startsWith('Bearer ') ? bearer.slice(7) : ''
      const operatorId = (req).operator?.id

      if (token && operatorId) {
        await logoutOperator(context, token, operatorId, req.ip)
      }

      jsonOk(res, { logged_out: true })
    })
  )

  // GET /api/auth/session
  app.get(
    '/api/auth/session',
    (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        jsonOk(res, null)
        return
      }

      const session = getSessionInfo(operator)
      jsonOk(res, toJsonSafe(session))
    }
  )

  // POST /api/auth/refresh
  app.post(
    '/api/auth/refresh',
    deps.asyncHandler(async (req, res) => {
      const operator = (req).operator
      if (!operator) {
        jsonOk(res, null)
        return
      }

      const bearer = req.header('authorization')
      const oldToken = bearer?.startsWith('Bearer ') ? bearer.slice(7) : ''

      const result = await refreshToken(context, operator, oldToken)
      jsonOk(res, toJsonSafe(result))
    })
  )
}
