import fs from 'fs';
import path from 'path';

import { getWorldBootstrapConfig, getWorldPacksDir } from '../config/runtime_config.js';

const DEFAULT_PACK_CONFIG_FILE = 'config.yaml';

export interface WorldPackBootstrapResult {
  status: 'disabled' | 'skipped' | 'created' | 'updated';
  worldPacksDir: string;
  targetPackDirPath: string;
  targetConfigPath: string;
  templateFilePath: string;
}

export const ensureBootstrapWorldPack = (): WorldPackBootstrapResult => {
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
    return result;
  }

  fs.copyFileSync(bootstrapConfig.templateFilePath, targetConfigPath);
  result.status = bootstrapConfig.overwrite ? 'updated' : 'created';
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
      return;
    case 'created':
    case 'updated':
      logger(`[bootstrap] ${result.status === 'updated' ? 'Updated' : 'Created'} default world pack config: ${result.targetConfigPath}`);
      return;
  }
};
