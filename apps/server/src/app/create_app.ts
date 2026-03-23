import cors from 'cors';
import express from 'express';

import { identityInjector } from '../identity/middleware.js';
import type { AppContext, RouteRegistrar } from './context.js';
import { requestIdMiddleware } from './middleware/request_id.js';

export interface CreateAppOptions {
  context: AppContext;
  registerRoutes: RouteRegistrar;
}

export const createApp = ({ context, registerRoutes }: CreateAppOptions) => {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(identityInjector());
  app.use(requestIdMiddleware());

  registerRoutes(app, context);

  return app;
};
