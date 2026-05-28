/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- deps cast from ServiceContainer Record<string, unknown> */
import type { Express } from 'express';

import type { AppContext, RouteRegistrar } from '../../app/context.js';
import { createApp } from '../../app/create_app.js';
import { getErrorMessage } from '../../app/http/errors.js';
import { toJsonSafe } from '../../app/http/json.js';
import { createPackScopeMiddleware } from '../../app/http/pack_scope_middleware.js';
import { parseOptionalTick } from '../../app/http/runtime.js';
import { createGlobalErrorMiddleware } from '../../app/middleware/error_handler.js';
import {
  allGlobalRoutes,
  createPackActionsRoute,
  createPackFrontendAssetRoutes,
  createPackListRoutes
} from '../../app/routes/index.js';
import { registerPackRoutes } from '../../app/routes/packs/index.js';
import type { PackScopeResolver } from '../../app/runtime/PackScopeResolver.js';
import { PackQueryHandlerRegistry } from '../../app/services/action/pack_query_resolver.js';
import type { InferenceService } from '../../inference/service.js';
import type { ServiceProvider } from '../provider.js';
import { TOKENS } from '../tokens.js';

interface CliConfig {
  worldPacksDir: string;
}

interface RoutesDeps {
  appContext: AppContext;
  packScope: PackScopeResolver;
  inferenceService: InferenceService;
  queryHandlerRegistry: PackQueryHandlerRegistry;
  cliConfig: CliConfig;
}

export const queryHandlerRegistryProvider: ServiceProvider = {
  provide: TOKENS.queryHandlerRegistry,
  useFactory: () => new PackQueryHandlerRegistry()
};

export const registerRoutesProvider: ServiceProvider = {
  provide: TOKENS.registerRoutes,
  deps: [
    TOKENS.appContext,
    TOKENS.packScope,
    TOKENS.inferenceService,
    TOKENS.queryHandlerRegistry,
    TOKENS.cliConfig
  ],
  useFactory: (deps) => {
    const d = deps as unknown as RoutesDeps;
    const packScopeMiddleware = createPackScopeMiddleware(d.packScope);
    return (application: Express, context: AppContext) => {
      // Global routes (no pack prefix)
      for (const route of allGlobalRoutes) {
        route.register(application, context);
      }

      // Factory-based routes
      createPackListRoutes(d.cliConfig.worldPacksDir).register(application, context);
      createPackFrontendAssetRoutes(d.cliConfig.worldPacksDir).register(application, context);
      createPackActionsRoute(d.queryHandlerRegistry).register(application, context);

      // Pack-scoped routes
      const packRouter = registerPackRoutes({
        context,
        scopeResolver: d.packScope,
        inferenceService: d.inferenceService,
        parseOptionalTick,
        toJsonSafe,
        getErrorMessage
      });
      application.use('/:packId', packScopeMiddleware, packRouter);
    };
  }
};

export const expressAppProvider: ServiceProvider = {
  provide: TOKENS.httpApp,
  deps: [TOKENS.appContext, TOKENS.registerRoutes],
  useFactory: (deps) => {
     
    const { appContext, registerRoutes } = deps as unknown as {
      appContext: AppContext;
      registerRoutes: RouteRegistrar;
    };
    const app = createApp({ context: appContext, registerRoutes });
    app.use(createGlobalErrorMiddleware(appContext));
    return app;
  }
};
