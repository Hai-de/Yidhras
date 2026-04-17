import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'node:crypto';

import YAML from 'yaml';

import type { WorldPack } from '../packs/schema/constitution_schema.js';
import { ApiError } from '../utils/api_error.js';
import {
  PLUGIN_MANIFEST_INVALID_CODE,
  parsePluginManifest
} from './contracts.js';
import { createPluginManagerService } from './service.js';
import type { PluginStoreContext } from './store.js';
import { createPluginStore } from './store.js';
import type { PluginRegistrationResult } from './types.js';

const PLUGIN_MANIFEST_FILE_NAMES = ['plugin.manifest.yaml', 'plugin.manifest.yml'] as const;

export interface DiscoveredPluginCandidate {
  plugin_dir_name: string;
  plugin_dir_path: string;
  manifest_path: string;
}

export interface PluginDiscoveryFailure {
  manifest_path: string;
  code: string;
  message: string;
}

export interface PluginDiscoveryResult {
  discovered: DiscoveredPluginCandidate[];
  registrations: PluginRegistrationResult[];
  failures: PluginDiscoveryFailure[];
}

const readPluginManifestCandidate = (pluginDirPath: string): string | null => {
  for (const fileName of PLUGIN_MANIFEST_FILE_NAMES) {
    const candidatePath = path.join(pluginDirPath, fileName);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
};

export const listPackPluginCandidates = (packRootDir: string): DiscoveredPluginCandidate[] => {
  const pluginsRootDir = path.join(packRootDir, 'plugins');
  if (!fs.existsSync(pluginsRootDir)) {
    return [];
  }

  return fs
    .readdirSync(pluginsRootDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const pluginDirPath = path.join(pluginsRootDir, entry.name);
      const manifestPath = readPluginManifestCandidate(pluginDirPath);
      if (!manifestPath) {
        return null;
      }

      return {
        plugin_dir_name: entry.name,
        plugin_dir_path: pluginDirPath,
        manifest_path: manifestPath
      } satisfies DiscoveredPluginCandidate;
    })
    .filter((value): value is DiscoveredPluginCandidate => value !== null);
};

const createPluginArtifactChecksum = (input: {
  manifest_path: string;
  manifest_content: string;
}): string => {
  return createHash('sha256').update(`${input.manifest_path}\n${input.manifest_content}`).digest('hex');
};

const validatePackCompatibility = (pack: WorldPack, manifestPackId: string): void => {
  if (pack.metadata.id !== manifestPackId) {
    throw new ApiError(400, 'PLUGIN_PACK_COMPATIBILITY_INVALID', 'Plugin manifest pack_id does not match active world pack', {
      pack_id: pack.metadata.id,
      manifest_pack_id: manifestPackId
    });
  }
};

const loadManifestFromCandidate = (candidate: DiscoveredPluginCandidate) => {
  const manifestContent = fs.readFileSync(candidate.manifest_path, 'utf-8');
  const manifest = parsePluginManifest(YAML.parse(manifestContent) as unknown);

  return {
    manifest,
    manifestContent
  };
};

export const discoverPackLocalPlugins = async (input: {
  prismaContext: PluginStoreContext;
  pack: WorldPack;
  packRootDir: string;
}): Promise<PluginDiscoveryResult> => {
  const { prismaContext, pack, packRootDir } = input;
  const candidates = listPackPluginCandidates(packRootDir);
  const store = createPluginStore(prismaContext);
  const manager = createPluginManagerService(store);
  const registrations: PluginRegistrationResult[] = [];
  const failures: PluginDiscoveryFailure[] = [];

  for (const candidate of candidates) {
    try {
      const { manifest, manifestContent } = loadManifestFromCandidate(candidate);
      validatePackCompatibility(pack, manifest.compatibility.pack_id);

      const checksum = createPluginArtifactChecksum({
        manifest_path: candidate.manifest_path,
        manifest_content: manifestContent
      });
      const existingArtifact = await store.getArtifactByChecksum(checksum);
      const artifact = existingArtifact
        ?? (await manager.registerArtifact({
          artifact_id: randomUUID(),
          plugin_id: manifest.id,
          version: manifest.version,
          manifest_version: manifest.manifest_version,
          source_type: 'bundled_by_pack',
          source_pack_id: pack.metadata.id,
          source_path: candidate.plugin_dir_path,
          checksum,
          manifest_json: JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>,
          imported_at: String(Date.now())
        }));

      const registration = await manager.ensurePackLocalInstallation({
        artifact,
        pack_id: pack.metadata.id,
        requested_capabilities: manifest.requested_capabilities,
        granted_capabilities: [],
        trust_mode: 'trusted'
      });

      registrations.push(registration);
    } catch (error) {
      failures.push({
        manifest_path: candidate.manifest_path,
        code: error instanceof ApiError ? error.code : PLUGIN_MANIFEST_INVALID_CODE,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    discovered: candidates,
    registrations,
    failures
  };
};
