import type { RuntimeConfigMetadata } from '../config/runtime_config.js';
import type { RuntimeConfigScaffoldResult } from './runtime_scaffold.js';
import type { WorldPackBootstrapResult } from './world_pack_bootstrap.js';

export interface InitReport {
  kind: 'configw' | 'world_pack' | 'runtime';
  timestamp: string;
  runtime?: {
    env: string;
    config_dir: string;
    loaded_files: string[];
    world_packs_dir?: string;
    preferred_world_pack?: string;
  };
  scaffold?: {
    created_count: number;
    existing_count: number;
    created_files: string[];
    existing_files: string[];
  };
  world_pack_bootstrap?: {
    status: WorldPackBootstrapResult['status'];
    target_pack_dir: string;
    target_config_path: string;
    template_file_path: string;
    pack_runtime?: {
      runtime_db_path: string;
      runtime_db_created: boolean;
      engine_owned_collections: string[];
      pack_collections: string[];
    };
  };
}

export const buildRuntimeMetadataReport = (
  metadata: RuntimeConfigMetadata,
  extras?: {
    worldPacksDir?: string;
    preferredWorldPack?: string;
  }
): InitReport['runtime'] => {
  return {
    env: metadata.activeEnv,
    config_dir: metadata.configDir,
    loaded_files: metadata.loadedFiles,
    ...(extras?.worldPacksDir !== undefined ? { world_packs_dir: extras.worldPacksDir } : {}),
    ...(extras?.preferredWorldPack !== undefined ? { preferred_world_pack: extras.preferredWorldPack } : {})
  };
};

export const buildRuntimeConfigScaffoldReport = (
  result: RuntimeConfigScaffoldResult
): InitReport['scaffold'] => {
  return {
    created_count: result.createdFiles.length,
    existing_count: result.existingFiles.length,
    created_files: result.createdFiles,
    existing_files: result.existingFiles
  };
};

export const buildWorldPackBootstrapReport = (
  result: WorldPackBootstrapResult
): InitReport['world_pack_bootstrap'] => {
  return {
    status: result.status,
    target_pack_dir: result.targetPackDirPath,
    target_config_path: result.targetConfigPath,
    template_file_path: result.templateFilePath,
    ...(result.packRuntime
      ? {
          pack_runtime: {
            runtime_db_path: result.packRuntime.runtimeDbPath,
            runtime_db_created: result.packRuntime.runtimeDbCreated,
            engine_owned_collections: result.packRuntime.engineOwnedCollections,
            pack_collections: result.packRuntime.packCollections
          }
        }
      : {})
  };
};

export const printInitReport = (
  report: InitReport,
  logger: (message: string) => void = console.log
): void => {
  logger(`[init-report] ${JSON.stringify(report)}`);
};
