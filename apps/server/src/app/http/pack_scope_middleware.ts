import type { NextFunction, Request, Response } from 'express';

import { captureError } from '../../utils/capture_error.js';
import type { PackScope, PackScopeResolver } from '../runtime/PackScopeResolver.js';

interface PackScopedRequest extends Request {
  packScope?: PackScope;
}

export const createPackScopeMiddleware = (resolver: PackScopeResolver) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express query/param value
    const packId = req.params['packId'] as string;
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

/**
 * Resolve pack scope without throwing for unready packs.
 * Returns `{ packId }` even if the pack is not loaded yet,
 * allowing read-only routes to proceed with degraded data.
 */
export const createLenientPackScopeMiddleware = (resolver: PackScopeResolver) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express query/param value
    const packId = req.params['packId'] as string;
    if (!packId) {
      next();
      return;
    }

    try {
      (req as PackScopedRequest).packScope = resolver.resolve(packId);
    } catch (err: unknown) {
      captureError(err, { module: 'pack-scope-middleware', message: 'Pack scope resolution failed', code: 'PACK_SCOPE_FAIL' });
      (req as PackScopedRequest).packScope = { packId };
    }
    next();
  };
};