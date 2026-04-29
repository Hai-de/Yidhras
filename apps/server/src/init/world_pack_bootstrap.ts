import path from 'path';

import {
  getRuntimeConfigMetadata,
  getWorldBootstrapConfig,
  getWorldPacksDir
} from '../config/runtime_config.js';
import { type InstalledPackRuntimeSummary,installPackRuntime } from '../kernel/install/install_pack.js';
import { PackManifestLoader } from '../packs/manifest/loader.js';
import { SqlitePackStorageAdapter } from '../packs/storage/internal/SqlitePackStorageAdapter.js';
import { createLogger } from '../utils/logger.js';
import { safeFs } from '../utils/safe_fs.js';

const log = createLogger('world-pack-bootstrap');

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
  const workspaceRoot = getRuntimeConfigMetadata().workspaceRoot;
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

  if (!safeFs.existsSync(workspaceRoot, bootstrapConfig.templateFilePath)) {
    throw new Error(`[bootstrap] Template file not found: ${bootstrapConfig.templateFilePath}`);
  }

  if (!safeFs.existsSync(workspaceRoot, worldPacksDir)) {
    safeFs.mkdirSync(workspaceRoot, worldPacksDir, { recursive: true });
  }

  if (!safeFs.existsSync(workspaceRoot, bootstrapConfig.targetPackDirPath)) {
    safeFs.mkdirSync(workspaceRoot, bootstrapConfig.targetPackDirPath, { recursive: true });
  }

  const shouldWrite = bootstrapConfig.overwrite || !safeFs.existsSync(workspaceRoot, targetConfigPath);
  if (!shouldWrite) {
    result.status = 'skipped';
  } else {
    safeFs.copyFileSync(workspaceRoot, bootstrapConfig.templateFilePath, targetConfigPath);

    const templateDir = path.dirname(bootstrapConfig.templateFilePath);
    const templateBasename = path.basename(
      bootstrapConfig.templateFilePath,
      path.extname(bootstrapConfig.templateFilePath)
    );
    const readmeTemplatePath = path.join(templateDir, `${templateBasename}.README.md`);
    const changelogTemplatePath = path.join(templateDir, `${templateBasename}.CHANGELOG.md`);
    const targetReadmePath = path.join(bootstrapConfig.targetPackDirPath, 'README.md');
    const targetChangelogPath = path.join(bootstrapConfig.targetPackDirPath, 'CHANGELOG.md');

    if (safeFs.existsSync(workspaceRoot, readmeTemplatePath) && (bootstrapConfig.overwrite || !safeFs.existsSync(workspaceRoot, targetReadmePath))) {
      safeFs.copyFileSync(workspaceRoot, readmeTemplatePath, targetReadmePath);
    }

    if (safeFs.existsSync(workspaceRoot, changelogTemplatePath) && (bootstrapConfig.overwrite || !safeFs.existsSync(workspaceRoot, targetChangelogPath))) {
      safeFs.copyFileSync(workspaceRoot, changelogTemplatePath, targetChangelogPath);
    }

    result.status = bootstrapConfig.overwrite ? 'updated' : 'created';
  }

  const loader = new PackManifestLoader(worldPacksDir);
  const pack = loader.loadPack(bootstrapConfig.targetPackDirName);
  result.packRuntime = await installPackRuntime(pack, new SqlitePackStorageAdapter());
  return result;
};

export const logWorldPackBootstrapResult = (
  result: WorldPackBootstrapResult,
  logger: (message: string) => void = (...args) => log.info(...args)
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
