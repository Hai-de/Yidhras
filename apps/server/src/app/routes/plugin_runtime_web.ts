import path from 'node:path';

import { activePackPluginRuntimeDataSchema, pluginPackParamsSchema } from '@yidhras/contracts';
import type { Express, NextFunction, Request, Response } from 'express';

import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseParams } from '../http/zod.js';
import {
  getActivePackPluginRuntimeWebSnapshot,
  resolveEnabledPluginWebAsset
} from '../services/plugin_runtime_web.js';

export interface PluginRuntimeWebRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

const pluginWebAssetParamsSchema = pluginPackParamsSchema.extend({
  pluginId: pluginPackParamsSchema.shape.packId,
  installationId: pluginPackParamsSchema.shape.packId
});

const getContentType = (assetPath: string): string | undefined => {
  const extension = path.extname(assetPath).toLowerCase();
  switch (extension) {
    case '.mjs':
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    default:
      return undefined;
  }
};

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

  app.get(
    '/api/packs/:packId/plugins/:pluginId/runtime/web/:installationId/*',
    deps.asyncHandler(async (req, res) => {
      const params = parseParams(
        pluginWebAssetParamsSchema,
        {
          packId: req.params.packId,
          pluginId: req.params.pluginId,
          installationId: req.params.installationId
        },
        'PLUGIN_QUERY_INVALID'
      );
      const wildcardAssetPath = typeof req.params[0] === 'string' ? req.params[0] : '';
      const asset = await resolveEnabledPluginWebAsset(context, {
        pack_id: params.packId,
        plugin_id: params.pluginId,
        installation_id: params.installationId,
        asset_path: wildcardAssetPath
      });

      const contentType = getContentType(asset.relative_path);
      if (contentType) {
        res.type(contentType);
      }

      res.setHeader('Cache-Control', 'private, max-age=60');
      res.sendFile(asset.absolute_path);
    })
  );
};
