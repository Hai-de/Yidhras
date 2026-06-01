import type { Router } from 'express';

import type { AppContext } from '../context.js';

export interface RouteModule {
  register(app: Router, context: AppContext): void;
}
