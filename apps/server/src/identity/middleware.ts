import { NextFunction, Request, Response } from 'express';

import type { OperatorRequest } from '../operator/auth/types.js';
import { IdentityContext } from './types.js';

export interface IdentityRequest extends Request {
  identity?: IdentityContext;
}

export const ANONYMOUS_IDENTITY: IdentityContext = {
  id: 'anonymous',
  type: 'anonymous',
  name: 'Anonymous'
};

export const SYSTEM_IDENTITY: IdentityContext = {
  id: 'system',
  type: 'system',
  name: 'System'
};

const parseHeaderIdentity = (value: string): IdentityContext | null => {
  try {
    const parsed = JSON.parse(value) as Partial<IdentityContext>;
    if (!parsed.id || !parsed.type) {
      return null;
    }
    return {
      id: parsed.id,
      type: parsed.type,
      name: parsed.name ?? null,
      provider: parsed.provider ?? null,
      status: parsed.status ?? null,
      claims: parsed.claims ?? null
    };
  } catch {
    return null;
  }
};

/**
 * 身份注入中间件。必须在 operatorAuthMiddleware 之后运行。
 *
 * - 已认证 operator → 使用 operator 的身份（已由 operatorAuthMiddleware 注入）。
 *   root operator 可通过 x-m2-identity 头代理为其他身份（用于模拟/测试）。
 * - 未认证请求 → ANONYMOUS_IDENTITY，x-m2-identity 头被忽略。
 * - SYSTEM_IDENTITY 仅限内部调用使用，HTTP 路径不注入。
 */
export const identityInjector = () => {
  return (req: IdentityRequest, _res: Response, next: NextFunction) => {
    const opReq = req as OperatorRequest;

    if (opReq.operator) {
      if (opReq.operator.is_root) {
        const header = req.header('x-m2-identity');
        if (header) {
          const parsed = parseHeaderIdentity(header);
          if (parsed) {
            req.identity = parsed;
            next();
            return;
          }
        }
      }
      if (!req.identity) {
        req.identity = {
          id: opReq.operator.identity_id,
          type: 'user',
          name: opReq.operator.username
        };
      }
      next();
      return;
    }

    req.identity = ANONYMOUS_IDENTITY;
    next();
  };
};
