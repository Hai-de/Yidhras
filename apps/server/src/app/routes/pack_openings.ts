import type { Express } from 'express';

import type { AppContext } from '../context.js';

export interface PackOpeningRouteDependencies {
  asyncHandler(
    handler: (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<void>
  ): (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => void;
}

export const registerPackOpeningRoutes = (
  _app: Express,
  _context: AppContext,
  _deps: PackOpeningRouteDependencies
): void => {
  // Pack opening routes are pending migration to MultiPackRuntimePort.
  // Endpoint registration will be restored after route-layer refactoring is complete.
};
