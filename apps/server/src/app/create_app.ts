import cors from 'cors';
import express from 'express';

import { identityInjector } from '../identity/middleware.js';
import { pluginRuntimeRegistry } from '../plugins/runtime.js';
import type { AppContext, RouteRegistrar } from './context.js';
import { operatorAuthMiddleware } from './middleware/operator_auth.js';
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

  app.use(cors());
  app.use(express.json());
  app.use((req, res, next) => { void operatorAuthMiddleware(context)(req, res, next); });
  app.use(identityInjector());
  app.use(requestIdMiddleware());

  registerRoutes(app, context);

  const activePackId = context.sim.getActivePack()?.metadata.id;
  if (activePackId) {
    pluginRuntimeRegistry.applyPackRoutes(activePackId, app, context);
  }

  return app;
};
