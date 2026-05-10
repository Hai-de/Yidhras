import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { identityInjector } from '../identity/middleware.js';
import { pluginRuntimeRegistry } from '../plugins/runtime.js';
import type { AppContext, RouteRegistrar } from './context.js';
import { operatorAuthMiddleware } from './middleware/operator_auth.js';
import { authRateLimiter, globalRateLimiter } from './middleware/rate_limit.js';
import { requestIdMiddleware } from './middleware/request_id.js';

export interface CreateAppOptions {
  context: AppContext;
  registerRoutes: RouteRegistrar;
}

export const createApp = ({ context, registerRoutes }: CreateAppOptions) => {
  const app = express();

  if (context.setHttpApp) {
    context.setHttpApp(app);
  }

  app.use(helmet());
  app.use(cors());
  app.use(globalRateLimiter);
  app.use('/api/auth/login', authRateLimiter);
  app.use('/api/auth/refresh', authRateLimiter);
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => { void operatorAuthMiddleware(context)(req, res, next); });
  app.use(identityInjector());
  app.use(requestIdMiddleware());

  registerRoutes(app, context);

  const activePackId = context.activePackRuntime?.getActivePack()?.metadata.id;
  if (activePackId) {
    pluginRuntimeRegistry.applyPackRoutes(activePackId, app, context);
  }

  return app;
};
