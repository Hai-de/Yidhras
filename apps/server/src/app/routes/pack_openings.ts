import type { RouteModule } from './types.js';

export const packOpeningRoutes: RouteModule = {
  register(_app, _context) {
    // Pack opening routes are pending migration to MultiPackRuntimePort.
    // Endpoint registration will be restored after route-layer refactoring is complete.
  }
};
