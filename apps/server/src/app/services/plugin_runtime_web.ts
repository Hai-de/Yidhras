import fs from 'node:fs';
import path from 'node:path';

import { createPluginStore } from '../../plugins/store.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';

export interface ActivePackPluginRuntimeWebSnapshot {
  pack_id: string;
  plugins: Array<{
    installation_id: string;
    plugin_id: string;
    pack_id: string;
    web_bundle_url: string | null;
    contributions: {
      panels: Array<{ target: string; panel_id: string }>;
      routes: string[];
      menu_items: string[];
    };
    runtime_module: {
      format: 'browser_esm';
      export_name: 'default';
      panel_export: 'panels';
      route_export: 'routes';
    };
  }>;
}

export interface ResolvedPluginWebAsset {
  absolute_path: string;
  relative_path: string;
}

interface PluginWebManifestView {
  contributions?: {
    web?: {
      panels?: Array<{ target: string; panel_id: string }>;
      routes?: string[];
      menu_items?: string[];
    };
  };
  entrypoints?: {
    web?: {
      dist?: string;
    };
  };
}

const normalizePluginRelativePath = (value: string): string => {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  const resolved = path.posix.normalize(normalized);

  if (
    resolved.length === 0
    || resolved === '.'
    || resolved.startsWith('../')
    || path.posix.isAbsolute(resolved)
  ) {
    throw new ApiError(400, 'PLUGIN_WEB_ASSET_PATH_INVALID', 'Plugin web asset path is invalid', {
      path: value
    });
  }

  return resolved;
};

const resolveManifestView = (manifestJson: unknown): PluginWebManifestView => {
  return (manifestJson ?? {}) as PluginWebManifestView;
};

const getPluginWebEntrypoint = (manifestJson: unknown): string | null => {
  const manifest = resolveManifestView(manifestJson);
  const dist = manifest.entrypoints?.web?.dist;
  if (typeof dist !== 'string' || dist.trim().length === 0) {
    return null;
  }

  return normalizePluginRelativePath(dist);
};

const getAllowedWebAssetRoot = (entrypointRelativePath: string): string => {
  const [firstSegment] = entrypointRelativePath.split('/');
  return firstSegment ?? entrypointRelativePath;
};

export const buildPluginWebAssetUrl = (input: {
  pack_id: string;
  plugin_id: string;
  installation_id: string;
  asset_path: string;
}): string => {
  return `/api/packs/${encodeURIComponent(input.pack_id)}/plugins/${encodeURIComponent(input.plugin_id)}/runtime/web/${encodeURIComponent(input.installation_id)}/${input.asset_path}`;
};

export const getActivePackPluginRuntimeWebSnapshot = async (
  context: AppContext,
  packId: string
): Promise<ActivePackPluginRuntimeWebSnapshot> => {
  const store = createPluginStore({ prisma: context.prisma });
  const installations = await store.listInstallationsByScope({
    scope_type: 'pack_local',
    scope_ref: packId
  });

  const plugins = [] as ActivePackPluginRuntimeWebSnapshot['plugins'];

  for (const installation of installations) {
    if (installation.lifecycle_state !== 'enabled') {
      continue;
    }

    const artifact = await store.getArtifactById(installation.artifact_id);
    if (!artifact) {
      continue;
    }

    const manifest = resolveManifestView(artifact.manifest_json);
    const webEntrypoint = getPluginWebEntrypoint(artifact.manifest_json);

    plugins.push({
      installation_id: installation.installation_id,
      plugin_id: installation.plugin_id,
      pack_id: packId,
      web_bundle_url: webEntrypoint
        ? buildPluginWebAssetUrl({
            pack_id: packId,
            plugin_id: installation.plugin_id,
            installation_id: installation.installation_id,
            asset_path: webEntrypoint
          })
        : null,
      contributions: {
        panels: manifest.contributions?.web?.panels ?? [],
        routes: manifest.contributions?.web?.routes ?? [],
        menu_items: manifest.contributions?.web?.menu_items ?? []
      },
      runtime_module: {
        format: 'browser_esm',
        export_name: 'default',
        panel_export: 'panels',
        route_export: 'routes'
      }
    });
  }

  return {
    pack_id: packId,
    plugins
  };
};

export const resolveEnabledPluginWebAsset = async (
  context: AppContext,
  input: {
    pack_id: string;
    plugin_id: string;
    installation_id: string;
    asset_path: string;
  }
): Promise<ResolvedPluginWebAsset> => {
  const store = createPluginStore({ prisma: context.prisma });
  const installation = await store.getInstallationById(input.installation_id);

  if (!installation) {
    throw new ApiError(404, 'PLUGIN_INSTALLATION_NOT_FOUND', 'Plugin installation not found', {
      installation_id: input.installation_id
    });
  }

  if (installation.scope_ref !== input.pack_id || installation.plugin_id !== input.plugin_id) {
    throw new ApiError(404, 'PLUGIN_WEB_ASSET_NOT_FOUND', 'Plugin web asset not found for the requested pack-local scope');
  }

  if (installation.lifecycle_state !== 'enabled') {
    throw new ApiError(409, 'PLUGIN_WEB_ASSET_NOT_ENABLED', 'Plugin web asset is only available for enabled installations', {
      installation_id: installation.installation_id,
      lifecycle_state: installation.lifecycle_state
    });
  }

  const artifact = await store.getArtifactById(installation.artifact_id);
  if (!artifact) {
    throw new ApiError(404, 'PLUGIN_ARTIFACT_NOT_FOUND', 'Plugin artifact not found', {
      artifact_id: installation.artifact_id
    });
  }

  const entrypointRelativePath = getPluginWebEntrypoint(artifact.manifest_json);
  if (!entrypointRelativePath) {
    throw new ApiError(404, 'PLUGIN_WEB_ENTRYPOINT_NOT_FOUND', 'Plugin web entrypoint is not declared', {
      installation_id: installation.installation_id
    });
  }

  const normalizedAssetPath = normalizePluginRelativePath(input.asset_path);
  const allowedRoot = getAllowedWebAssetRoot(entrypointRelativePath);
  if (normalizedAssetPath !== entrypointRelativePath && !normalizedAssetPath.startsWith(`${allowedRoot}/`)) {
    throw new ApiError(403, 'PLUGIN_WEB_ASSET_FORBIDDEN', 'Plugin web asset path is outside the exposed runtime root', {
      asset_path: normalizedAssetPath,
      allowed_root: allowedRoot
    });
  }

  const absolutePath = path.resolve(artifact.source_path, normalizedAssetPath);
  const pluginRoot = path.resolve(artifact.source_path);
  const relativeToPluginRoot = path.relative(pluginRoot, absolutePath);
  if (
    relativeToPluginRoot.length === 0
    || relativeToPluginRoot.startsWith('..')
    || path.isAbsolute(relativeToPluginRoot)
  ) {
    throw new ApiError(403, 'PLUGIN_WEB_ASSET_FORBIDDEN', 'Plugin web asset path escapes the plugin root', {
      asset_path: normalizedAssetPath
    });
  }

  if (!fs.existsSync(absolutePath)) {
    throw new ApiError(404, 'PLUGIN_WEB_ASSET_NOT_FOUND', 'Plugin web asset file not found', {
      asset_path: normalizedAssetPath,
      installation_id: installation.installation_id
    });
  }

  return {
    absolute_path: absolutePath,
    relative_path: normalizedAssetPath
  };
};
