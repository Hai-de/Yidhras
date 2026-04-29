import {
  operatorAuditLogQuerySchema
} from '@yidhras/contracts'
import type { Express } from 'express'

import type { OperatorRequest } from '../../operator/auth/types.js'
import { OPERATOR_ERROR_CODE } from '../../operator/constants.js'
import { ApiError } from '../../utils/api_error.js'
import type { AppContext } from '../context.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { parseQuery } from '../http/zod.js'
import { queryAuditLogs } from '../services/operator_audit.js'

export interface AuditRouteDependencies {
  asyncHandler(
    handler: (req: OperatorRequest, res: import('express').Response, next: import('express').NextFunction) => Promise<void>
  ): (req: OperatorRequest, res: import('express').Response, next: import('express').NextFunction) => void
}

export const registerOperatorAuditRoutes = (
  app: Express,
  context: AppContext,
  deps: AuditRouteDependencies
): void => {
  // GET /api/audit/logs
  app.get(
    '/api/audit/logs',
    deps.asyncHandler(async (req, res) => {
      const operator = (req).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      const query = parseQuery(operatorAuditLogQuerySchema, req.query, 'AUDIT_QUERY_INVALID')

      const result = await queryAuditLogs(
        context,
        {
          operator_id: query.operator_id,
          pack_id: query.pack_id,
          action: query.action,
          from_date: query.from_date,
          to_date: query.to_date,
          limit: query.limit,
          cursor: query.cursor
        },
        operator.is_root,
        operator.id
      )

      jsonOk(res, toJsonSafe(result), {
        pagination: {
          has_next_page: result.next_cursor !== null,
          next_cursor: result.next_cursor
        }
      })
    })
  )

  // GET /api/audit/logs/me
  app.get(
    '/api/audit/logs/me',
    deps.asyncHandler(async (req, res) => {
      const operator = (req).operator
      if (!operator) {
        throw new ApiError(401, OPERATOR_ERROR_CODE.OPERATOR_REQUIRED, 'Authentication required')
      }

      const query = parseQuery(operatorAuditLogQuerySchema, req.query, 'AUDIT_QUERY_INVALID')

      const result = await queryAuditLogs(
        context,
        {
          operator_id: operator.id,
          pack_id: query.pack_id,
          action: query.action,
          from_date: query.from_date,
          to_date: query.to_date,
          limit: query.limit,
          cursor: query.cursor
        },
        true,
        operator.id
      )

      jsonOk(res, toJsonSafe(result), {
        pagination: {
          has_next_page: result.next_cursor !== null,
          next_cursor: result.next_cursor
        }
      })
    })
  )
}
