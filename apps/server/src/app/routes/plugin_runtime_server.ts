import type { Express, NextFunction, Request, Response } from 'express';
import { z } from 'zod';

import { getRuntimeConfig } from '../../config/runtime_config.js';
import { pluginRuntimeRegistry } from '../../plugins/runtime.js';
import type { WorkerPackRouteProxy } from '../../plugins/worker/contribution_proxy.js';
import { PluginWorkerTimeoutError } from '../../plugins/worker/errors.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';

const pluginServerRouteParamsSchema = z.object({
  packId: z.string().trim().min(1),
  pluginId: z.string().trim().min(1),
  installationId: z.string().trim().min(1)
});

export interface PluginRuntimeServerRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

const normalizeRoutePath = (value: unknown): string => {
  if (Array.isArray(value)) {
    return normalizeRoutePath(value.join('/'));
  }
  if (typeof value !== 'string') {
    return '/';
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '/';
  }
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+/g, '/');
};

const findRouteProxy = (routes: WorkerPackRouteProxy[], method: string, routePath: string): WorkerPackRouteProxy | null => {
  return routes.find(route => route.method === method && normalizeRoutePath(route.path) === routePath) ?? null;
};

const isTimeoutError = (error: unknown): boolean => {
  return error instanceof PluginWorkerTimeoutError || (
    error instanceof Error && (
      error.name === 'PluginWorkerTimeoutError' ||
      (error as Error & { code?: unknown }).code === 'PLUGIN_WORKER_TIMEOUT'
    )
  );
};

export const registerPluginRuntimeServerRoutes = (
  app: Express,
  _context: AppContext,
  deps: PluginRuntimeServerRouteDependencies
): void => {
  app.all(
    '/api/packs/:packId/plugins/:pluginId/runtime/server/:installationId/routes/{*runtimePath}',
    deps.asyncHandler(async (req, res) => {
      const paramsResult = pluginServerRouteParamsSchema.safeParse({
        packId: req.params.packId,
        pluginId: req.params.pluginId,
        installationId: req.params.installationId
      });
      if (!paramsResult.success) {
        throw new ApiError(400, 'PLUGIN_ROUTE_INVALID', 'Invalid plugin runtime route parameters', {
          issues: paramsResult.error.issues
        });
      }

      const { packId, pluginId, installationId } = paramsResult.data;
      const runtime = pluginRuntimeRegistry.getRuntime(packId, installationId);
      if (!runtime || runtime.plugin_id !== pluginId || !runtime.worker_client) {
        throw new ApiError(404, 'PLUGIN_ROUTE_NOT_FOUND', 'Plugin runtime route not found');
      }

      const method = req.method.toUpperCase();
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
        throw new ApiError(404, 'PLUGIN_ROUTE_NOT_FOUND', 'Plugin runtime route not found');
      }

      const routePath = normalizeRoutePath(req.params.runtimePath);
      const route = findRouteProxy(runtime.pack_routes, method, routePath);
      if (!route) {
        throw new ApiError(404, 'PLUGIN_ROUTE_NOT_FOUND', 'Plugin runtime route not found');
      }

      try {
        const result = await route.handle(
          {
            method,
            path: routePath,
            params: req.params,
            query: req.query,
            body: req.body as unknown ?? null,
            headers: req.headers
          },
          getRuntimeConfig().plugins.isolation.route_timeout_ms
        );
        res.json(result);
      } catch (error) {
        if (isTimeoutError(error)) {
          throw new ApiError(504, 'PLUGIN_ROUTE_TIMEOUT', 'Plugin runtime route timed out');
        }
        throw error;
      }
    })
  );
};
