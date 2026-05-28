import type { Express } from 'express';

import type { AppContext } from '../context.js';

export interface RouteModule {
  register(app: Express, context: AppContext): void;
}
