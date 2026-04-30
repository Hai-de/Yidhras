import type { NextFunction, Request, Response } from 'express';

import type { PackScope, PackScopeResolver } from '../runtime/PackScopeResolver.js';

interface PackScopedRequest extends Request {
  packScope?: PackScope;
}

export const createPackScopeMiddleware = (resolver: PackScopeResolver) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const packId = req.params.packId;
    if (!packId) {
      next();
      return;
    }

    try {
      (req as PackScopedRequest).packScope = resolver.resolve(packId);
      next();
    } catch (error) {
      next(error);
    }
  };
};
