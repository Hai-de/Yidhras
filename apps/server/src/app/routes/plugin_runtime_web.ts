import { activePackPluginRuntimeDataSchema, pluginPackParamsSchema } from '@yidhras/contracts';
import type { Express, NextFunction, Request, Response } from 'express';

import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseParams } from '../http/zod.js';
import { getActivePackPluginRuntimeWebSnapshot } from '../services/plugin_runtime_web.js';

export interface PluginRuntimeWebRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

export const registerPluginRuntimeWebRoutes = (
  app: Express,
  context: AppContext,
  deps: PluginRuntimeWebRouteDependencies
): void => {
  app.get(
    '/api/packs/:packId/plugins/runtime/web',
    deps.asyncHandler(async (req, res) => {
      const params = parseParams(pluginPackParamsSchema, req.params, 'PLUGIN_QUERY_INVALID');
      const snapshot = await getActivePackPluginRuntimeWebSnapshot(context, params.packId);
      activePackPluginRuntimeDataSchema.parse(toJsonSafe(snapshot));
      jsonOk(res, toJsonSafe(snapshot));
    })
  );
};
