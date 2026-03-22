import { NextFunction, Request, Response } from 'express';

import { ApiError } from '../utils/api_error.js';
import { IdentityContext } from './types.js';

export interface IdentityRequest extends Request {
  identity?: IdentityContext;
}

const SYSTEM_IDENTITY: IdentityContext = {
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

export const identityInjector = () => {
  return (req: IdentityRequest, _res: Response, next: NextFunction) => {
    const header = req.header('x-m2-identity');
    if (header) {
      const parsed = parseHeaderIdentity(header);
      if (!parsed) {
        throw new ApiError(400, 'IDENTITY_HEADER_INVALID', 'Invalid x-m2-identity header');
      }
      req.identity = parsed;
      next();
      return;
    }

    req.identity = SYSTEM_IDENTITY;
    next();
  };
};
