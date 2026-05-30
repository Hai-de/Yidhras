import { createApp } from '../../app/create_app.js';
import { getErrorMessage } from '../../app/http/errors.js';
import { toJsonSafe } from '../../app/http/json.js';
import { createLenientPackScopeMiddleware } from '../../app/http/pack_scope_middleware.js';
import { parseOptionalTick } from '../../app/http/runtime.js';
import { createGlobalErrorMiddleware } from '../../app/middleware/error_handler.js';
import {
  allGlobalRoutes,
  createPackActionsRoute,
  createPackFrontendAssetRoutes,
  createPackListRoutes
} from '../../app/routes/index.js';
import { registerPackRoutes } from '../../app/routes/packs/index.js';
import { PackQueryHandlerRegistry } from '../../app/services/action/pack_query_resolver.js';
import { TOKENS } from '../tokens.js';

export const queryHandlerRegistryProvider = {
  provide: TOKENS.queryHandlerRegistry,
  useFactory: () => new PackQueryHandlerRegistry()
} as const satisfies import('../provider.js').ServiceProvider;

export const registerRoutesProvider = {
  provide: TOKENS.registerRoutes,
  deps: [
    TOKENS.appContext,
    TOKENS.packScope,
    TOKENS.inferenceService,
    TOKENS.queryHandlerRegistry,
    TOKENS.cliConfig
  ] as const,
  useFactory: (deps) => {
    return (application: import('express').Express, context: import('../../app/context.js').AppContext) => {
      // Global routes (no pack prefix)
      for (const route of allGlobalRoutes) {
        route.register(application, context);
      }

      // Factory-based routes
      createPackListRoutes(deps.cliConfig.worldPacksDir).register(application, context);
      createPackFrontendAssetRoutes(deps.cliConfig.worldPacksDir).register(application, context);
      createPackActionsRoute(deps.queryHandlerRegistry).register(application, context);

      // Pack-scoped routes
      const packRouter = registerPackRoutes({
        context,
        scopeResolver: deps.packScope,
        inferenceService: deps.inferenceService,
        parseOptionalTick,
        toJsonSafe,
        getErrorMessage
      });
      application.use('/:packId', createLenientPackScopeMiddleware(deps.packScope), packRouter);
    };
  }
} as const satisfies import('../provider.js').ServiceProvider;

export const expressAppProvider = {
  provide: TOKENS.httpApp,
  deps: [TOKENS.appContext, TOKENS.registerRoutes, TOKENS.cliConfig] as const,
  useFactory: (deps) => {
    const apiOrigin = `http://localhost:${String(deps.cliConfig.port)}`;
    const app = createApp({
      context: deps.appContext,
      registerRoutes: deps.registerRoutes,
      cspOrigins: {
        webOrigin: 'http://localhost:3000',
        apiOrigin: apiOrigin
      }
    });
    app.use(createGlobalErrorMiddleware(deps.appContext));
    return app;
  }
} as const satisfies import('../provider.js').ServiceProvider;
