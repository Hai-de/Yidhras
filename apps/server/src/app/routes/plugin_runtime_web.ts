import path from 'node:path';

import { packPluginRuntimeDataSchema, pluginPackParamsSchema } from '@yidhras/contracts';

import { asyncHandler } from '../http/async_handler.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseParams } from '../http/zod.js';
import { createPackScopedPluginRuntimeService } from '../services/pack/pack_scoped_plugin_runtime_service.js';
import type { RouteModule } from './types.js';

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

export const pluginRuntimeWebRoutes: RouteModule = {
  register(app, context) {
  const packScopedPluginRuntimeService = createPackScopedPluginRuntimeService(context);

  app.get(
    '/api/packs/:packId/plugins/runtime/web',
    asyncHandler(async (req, res) => {
      const params = parseParams(pluginPackParamsSchema, req.params, 'PLUGIN_QUERY_INVALID');
      const snapshot = await packScopedPluginRuntimeService.getRuntimeWebSnapshot({
        pack_id: params.packId
      });
      packPluginRuntimeDataSchema.parse(toJsonSafe(snapshot));
      jsonOk(res, toJsonSafe(snapshot));
    })
  );

  app.get(
    '/api/packs/:packId/plugins/:pluginId/runtime/web/:installationId/{*assetPath}',
    asyncHandler(async (req, res) => {
      const params = parseParams(
        pluginWebAssetParamsSchema,
        {
          packId: req.params['packId'],
          pluginId: req.params['pluginId'],
          installationId: req.params['installationId']
        },
        'PLUGIN_QUERY_INVALID'
      );
      const wildcardAssetPath = Array.isArray(req.params['assetPath'])
        ? req.params['assetPath'].join('/')
        : typeof req.params['assetPath'] === 'string'
          ? req.params['assetPath']
          : '';
      const asset = await packScopedPluginRuntimeService.resolveEnabledPluginWebAsset({
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
  },
};
