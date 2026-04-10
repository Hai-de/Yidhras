import fs from 'fs';
import path from 'path';

import { getWorldBootstrapConfig, getWorldPacksDir } from '../config/runtime_config.js';
import { type InstalledPackRuntimeSummary,installPackRuntime } from '../kernel/install/install_pack.js';
import { PackManifestLoader } from '../packs/manifest/loader.js';

const DEFAULT_PACK_CONFIG_FILE = 'config.yaml';

export interface WorldPackBootstrapResult {
  status: 'disabled' | 'skipped' | 'created' | 'updated';
  worldPacksDir: string;
  targetPackDirPath: string;
  targetConfigPath: string;
  templateFilePath: string;
  packRuntime?: InstalledPackRuntimeSummary;
}

export const ensureBootstrapWorldPack = async (): Promise<WorldPackBootstrapResult> => {
  const worldPacksDir = getWorldPacksDir();
  const bootstrapConfig = getWorldBootstrapConfig();
  const targetConfigPath = path.join(bootstrapConfig.targetPackDirPath, DEFAULT_PACK_CONFIG_FILE);

  const result: WorldPackBootstrapResult = {
    status: 'skipped',
    worldPacksDir,
    targetPackDirPath: bootstrapConfig.targetPackDirPath,
    targetConfigPath,
    templateFilePath: bootstrapConfig.templateFilePath
  };

  if (!bootstrapConfig.enabled) {
    result.status = 'disabled';
    return result;
  }

  if (!fs.existsSync(bootstrapConfig.templateFilePath)) {
    throw new Error(`[bootstrap] Template file not found: ${bootstrapConfig.templateFilePath}`);
  }

  if (!fs.existsSync(worldPacksDir)) {
    fs.mkdirSync(worldPacksDir, { recursive: true });
  }

  if (!fs.existsSync(bootstrapConfig.targetPackDirPath)) {
    fs.mkdirSync(bootstrapConfig.targetPackDirPath, { recursive: true });
  }

  const shouldWrite = bootstrapConfig.overwrite || !fs.existsSync(targetConfigPath);
  if (!shouldWrite) {
    result.status = 'skipped';
  } else {
    fs.copyFileSync(bootstrapConfig.templateFilePath, targetConfigPath);
    result.status = bootstrapConfig.overwrite ? 'updated' : 'created';
  }

  const loader = new PackManifestLoader(worldPacksDir);
  const pack = loader.loadPack(bootstrapConfig.targetPackDirName);
  result.packRuntime = await installPackRuntime(pack);
  return result;
};

export const logWorldPackBootstrapResult = (
  result: WorldPackBootstrapResult,
  logger: (message: string) => void = console.log
): void => {
  switch (result.status) {
    case 'disabled':
      logger('[bootstrap] Disabled by config, skipped default world pack bootstrap.');
      return;
    case 'skipped':
      logger(`[bootstrap] World pack config exists, skipped: ${result.targetConfigPath}`);
      if (result.packRuntime) {
        logger(
          `[bootstrap] Pack runtime materialized at ${result.packRuntime.runtimeDbPath} (created=${String(result.packRuntime.runtimeDbCreated)})`
        );
      }
      return;
    case 'created':
    case 'updated':
      logger(`[bootstrap] ${result.status === 'updated' ? 'Updated' : 'Created'} default world pack config: ${result.targetConfigPath}`);
      if (result.packRuntime) {
        logger(
          `[bootstrap] Pack runtime materialized at ${result.packRuntime.runtimeDbPath} (created=${String(result.packRuntime.runtimeDbCreated)})`
        );
      }
      return;
  }
};
