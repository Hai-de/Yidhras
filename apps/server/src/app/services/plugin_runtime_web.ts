import type { AppContext } from '../context.js';

import { createPluginStore } from '../../plugins/store.js';

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
  }>;
}

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

    const manifest = artifact.manifest_json as {
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
    };

    plugins.push({
      installation_id: installation.installation_id,
      plugin_id: installation.plugin_id,
      pack_id: packId,
      web_bundle_url: manifest.entrypoints?.web?.dist ?? null,
      contributions: {
        panels: manifest.contributions?.web?.panels ?? [],
        routes: manifest.contributions?.web?.routes ?? [],
        menu_items: manifest.contributions?.web?.menu_items ?? []
      }
    });
  }

  return {
    pack_id: packId,
    plugins
  };
};
