import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { identityInjector } from '../identity/middleware.js';
import type { AppContext, RouteRegistrar } from './context.js';
import { operatorAuthMiddleware } from './middleware/operator_auth.js';
import { authRateLimiter, globalRateLimiter } from './middleware/rate_limit.js';
import { requestIdMiddleware } from './middleware/request_id.js';

export interface CreateAppOptions {
  context: AppContext;
  registerRoutes: RouteRegistrar;
  cspOrigins?: {
    webOrigin?: string;
    apiOrigin?: string;
  };
}

export const createApp = ({ context, registerRoutes, cspOrigins }: CreateAppOptions) => {
  const app = express();

  app.set('trust proxy', 1);

  const extraScriptOrigins = [cspOrigins?.webOrigin, cspOrigins?.apiOrigin].filter(
    (o): o is string => typeof o === 'string' && o.length > 0
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", ...extraScriptOrigins],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          styleSrcAttr: ["'unsafe-inline'"],
          connectSrc: ["'self'", ...extraScriptOrigins],
          imgSrc: ["'self'", 'data:', 'blob:'],
          workerSrc: ["'self'", 'blob:'],
          fontSrc: ["'self'", 'data:'],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: []
        }
      }
    })
  );
  app.use(cors({
    origin: true,
    credentials: true
  }));
  app.use(globalRateLimiter);
  app.use('/api/auth/login', authRateLimiter);
  app.use('/api/auth/refresh', authRateLimiter);
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => { void operatorAuthMiddleware(context)(req, res, next); });
  app.use(identityInjector());
  app.use(requestIdMiddleware());

  registerRoutes(app, context);

  return app;
};
