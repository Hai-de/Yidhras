import type { NextFunction, Request, Response } from 'express';

import type { PackScope, PackScopeResolver } from '../runtime/PackScopeResolver.js';

interface PackScopedRequest extends Request {
  packScope?: PackScope;
}

export const createPackScopeMiddleware = (resolver: PackScopeResolver) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express query/param value
    const packId = req.params.packId as string;
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
