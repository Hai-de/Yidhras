import fs from 'fs';
import path from 'path';

import { resolveFromWorkspaceRoot, resolveWorkspaceRoot } from '../../config/loader.js';

const DEFAULT_PACK_RUNTIME_DB_BASENAME = 'runtime.sqlite';

export interface PackRuntimeDatabaseLocation {
  packId: string;
  packRootDir: string;
  runtimeDbPath: string;
}

const normalizePackId = (packId: string): string => {
  const normalized = packId.trim();
  if (normalized.length === 0) {
    throw new Error('[pack_db_locator] packId must not be empty');
  }
  return normalized;
};

export const getPackRootDir = (packId: string): string => {
  return resolveFromWorkspaceRoot(
    path.join('data', 'world_packs', normalizePackId(packId)),
    resolveWorkspaceRoot()
  );
};

export const resolvePackRuntimeDatabaseLocation = (
  packId: string,
  runtimeDbFileName: string = DEFAULT_PACK_RUNTIME_DB_BASENAME
): PackRuntimeDatabaseLocation => {
  const normalizedPackId = normalizePackId(packId);
  const normalizedRuntimeDbFileName = runtimeDbFileName.trim().length > 0
    ? runtimeDbFileName.trim()
    : DEFAULT_PACK_RUNTIME_DB_BASENAME;
  const packRootDir = getPackRootDir(normalizedPackId);

  return {
    packId: normalizedPackId,
    packRootDir,
    runtimeDbPath: path.join(packRootDir, normalizedRuntimeDbFileName)
  };
};

export const ensurePackRuntimeDirectory = (
  packId: string,
  runtimeDbFileName?: string
): PackRuntimeDatabaseLocation => {
  const location = resolvePackRuntimeDatabaseLocation(packId, runtimeDbFileName);
  fs.mkdirSync(location.packRootDir, { recursive: true });
  return location;
};
