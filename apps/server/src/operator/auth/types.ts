import type { Request } from 'express'

import type { IdentityContext } from '../../identity/types.js'

/**
 * 经过 JWT 认证后注入 req 的 Operator 上下文。
 * 此上下文由 OperatorAuthMiddleware 产生，
 * 与 x-m2-identity 头注入的 req.identity 是平行的两条路径。
 */
export interface OperatorContext {
  id: string
  identity_id: string
  username: string
  is_root: boolean
  status: string
  display_name: string | null
}

/**
 * JWT Token Payload 结构
 */
export interface JwtPayload {
  sub: string // operator.id
  identity_id: string
  username: string
  is_root: boolean
  iat: number
  exp: number
}

/**
 * 扩展 Express Request，同时支持 Operator（Bearer）和 Identity（x-m2-identity）
 */
export interface OperatorRequest extends Request {
  /** 由 identityInjector 中间件注入 (x-m2-identity) */
  identity?: IdentityContext
  /** 由 operatorAuthMiddleware 中间件注入 (Authorization: Bearer) */
  operator?: OperatorContext
}

/**
 * 登录响应
 */
export interface LoginResponse {
  token: string
  operator: {
    id: string
    username: string
    is_root: boolean
    display_name: string | null
  }
}

/**
 * Session 信息响应
 */
export interface SessionResponse {
  operator: {
    id: string
    username: string
    is_root: boolean
    display_name: string | null
  }
  identity: {
    id: string
    type: string
    name: string | null
  }
}
