import type { NextFunction, Response } from 'express'

import type { OperatorRequest } from '../../operator/auth/types.js'
import { OPERATOR_ERROR_CODE } from '../../operator/constants.js'
import { ApiError } from '../../utils/api_error.js'

/**
 * 强制要求 Operator 认证。无有效 token 时返回 401。
 */
export const requireAuth = () => {
  return (req: OperatorRequest, _res: Response, next: NextFunction): void => {
    if (!req.operator) {
      throw new ApiError(
        401,
        OPERATOR_ERROR_CODE.OPERATOR_REQUIRED,
        'Authentication required'
      )
    }
    next()
  }
}
