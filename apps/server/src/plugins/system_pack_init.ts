import { createHash, randomUUID } from 'node:crypto';

import path from 'path';
import YAML from 'yaml';

import { safeFs } from '../utils/safe_fs.js';
import { parsePluginManifest } from './contracts.js';
import { createPluginManagerService } from './service.js';
import type { PluginStoreContext } from './store.js';
import { createPluginStore } from './store.js';

const PLUGIN_MANIFEST_FILE_NAMES = ['plugin.manifest.yaml', 'plugin.manifest.yml'] as const;

const findManifestPath = (pluginDirPath: string): string | null => {
  for (const fileName of PLUGIN_MANIFEST_FILE_NAMES) {
    const candidatePath = path.join(pluginDirPath, fileName);
    if (safeFs.existsSync(pluginDirPath, candidatePath)) {
      return candidatePath;
    }
  }

  return null;
};

const createChecksum = (manifestPath: string, manifestContent: string): string => {
  return createHash('sha256').update(`${manifestPath}\n${manifestContent}`).digest('hex');
};

/**
 * Initialize system pack plugins at startup.
 * Discovers built-in plugins, creates DB records, auto-confirms and enables them.
 * Idempotent — safe to call multiple times.
 */
export const initSystemPackPlugins = async (
  prismaContext: PluginStoreContext,
  systemPackPluginsDir: string
): Promise<{
  enabled: string[];
  errors: string[];
}> => {
  const enabled: string[] = [];
  const errors: string[] = [];
  const store = createPluginStore(prismaContext);
  const manager = createPluginManagerService(store);

  let pluginDirs: string[];
  try {
    const entries = safeFs.readdirSync(systemPackPluginsDir, systemPackPluginsDir, { withFileTypes: true });
    pluginDirs = entries.filter(e => e.isDirectory()).map(e => path.join(systemPackPluginsDir, e.name));
  } catch {
    return { enabled, errors: ['System pack plugins directory not found'] };
  }

  for (const pluginDir of pluginDirs) {
    try {
      const manifestPath = findManifestPath(pluginDir);
      if (!manifestPath) {
        errors.push(`No manifest found in ${pluginDir}`);
        continue;
      }

      const manifestContent = safeFs.readFileSync(pluginDir, manifestPath, 'utf-8');
      const manifest = parsePluginManifest(YAML.parse(manifestContent) as unknown);
      const checksum = createChecksum(manifestPath, manifestContent);

      const existingArtifact = await store.getArtifactByChecksum(checksum);
      const artifact = existingArtifact ?? (await manager.registerArtifact({
        artifact_id: randomUUID(),
        plugin_id: manifest.id,
        version: manifest.version,
        manifest_version: manifest.manifest_version,
        source_type: 'bundled_by_pack',
        source_pack_id: 'yidhras-system',
        source_path: pluginDir,
        checksum,
        manifest_json: JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>,
        imported_at: String(Date.now())
      }));

      const existingInstallation = await store.getInstallationByScope({
        plugin_id: manifest.id,
        scope_type: 'global'
      });

      if (!existingInstallation || existingInstallation.lifecycle_state === 'archived') {
        const registration = await manager.ensurePackLocalInstallation({
          artifact,
          pack_id: 'yidhras-system',
          requested_capabilities: manifest.requested_capabilities,
          granted_capabilities: [],
          trust_mode: 'trusted'
        });

        await manager.confirmInstallation({
          installation_id: registration.installation.installation_id,
          confirmed_at: String(Date.now())
        });

        await manager.enableInstallation({
          installation_id: registration.installation.installation_id,
          enabled_at: String(Date.now())
        });

        enabled.push(manifest.id);
      } else if (existingInstallation.lifecycle_state !== 'enabled') {
        try {
          await manager.enableInstallation({
            installation_id: existingInstallation.installation_id,
            enabled_at: String(Date.now())
          });
          enabled.push(manifest.id);
        } catch {
          errors.push(`Failed to enable ${manifest.id}: current state ${existingInstallation.lifecycle_state}`);
        }
      } else {
        enabled.push(manifest.id);
      }
    } catch (err) {
      errors.push(`Failed to init plugin in ${pluginDir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { enabled, errors };
};
