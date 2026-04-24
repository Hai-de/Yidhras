import type { NextFunction,Response } from 'express'

import { findActiveSession, verifyToken } from '../../operator/auth/token.js'
import type { OperatorRequest } from '../../operator/auth/types.js'
import { OPERATOR_STATUS } from '../../operator/constants.js'
import type { AppContext } from '../context.js'

/**
 * Operator 认证中间件。
 * - Bearer token → 验证 JWT → 查 session 未注销 → 注入 req.operator + req.identity
 * - 无 Bearer → 保留 x-m2-identity 路径（由 identityInjector 处理）
 */
export const operatorAuthMiddleware = (context: AppContext) => {
  return async (
    req: OperatorRequest,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    const bearer = req.header('authorization')
    if (!bearer?.startsWith('Bearer ')) {
      next()
      return
    }

    const token = bearer.slice(7)

    // 验证 JWT
    const payload = verifyToken(token)
    if (!payload) {
      next()
      return
    }

    // 查 session 未注销
    const session = await findActiveSession(context, token)
    if (!session) {
      next()
      return
    }

    // 查 Operator 状态
    const operator = await context.prisma.operator.findUnique({
      where: { id: payload.sub }
    })

    if (!operator || operator.status !== OPERATOR_STATUS.ACTIVE) {
      next()
      return
    }

    req.operator = {
      id: operator.id,
      identity_id: operator.identity_id,
      username: operator.username,
      is_root: operator.is_root,
      status: operator.status,
      display_name: operator.display_name
    }

    // 同时注入 identity 以兼容现有 L2/L3 体系
    req.identity = {
      id: operator.identity_id,
      type: 'user',
      name: operator.username
    }

    next()
  }
}
