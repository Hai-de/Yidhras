import type { PackSnapshotMetadata } from '@yidhras/contracts';
import { packSnapshotMetadataSchema } from '@yidhras/contracts';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { safeFs } from '../../utils/safe_fs.js';
import { getPackRootDir } from '../storage/pack_db_locator.js';

export interface SnapshotLocation {
  packId: string;
  snapshotId: string;
  snapshotDir: string;
  metadataPath: string;
  runtimeDbPath: string;
  prismaJsonPath: string;
  storagePlanPath: string;
}

const SNAPSHOTS_DIRNAME = 'snapshots';
const METADATA_FILENAME = 'metadata.json';
const RUNTIME_DB_FILENAME = 'runtime.sqlite.gz';
const PRISMA_JSON_FILENAME = 'prisma.json.gz';
const STORAGE_PLAN_FILENAME = 'storage-plan.json';

export const getPackSnapshotsDir = (packId: string): string => {
  return path.join(getPackRootDir(packId), SNAPSHOTS_DIRNAME);
};

export const resolveSnapshotLocation = (packId: string, snapshotId: string): SnapshotLocation => {
  const normalizedPackId = packId.trim();
  const normalizedSnapshotId = snapshotId.trim();

  if (normalizedPackId.length === 0) {
    throw new Error('[snapshot_locator] packId must not be empty');
  }
  if (normalizedSnapshotId.length === 0) {
    throw new Error('[snapshot_locator] snapshotId must not be empty');
  }

  const snapshotDir = path.join(getPackSnapshotsDir(normalizedPackId), normalizedSnapshotId);

  return {
    packId: normalizedPackId,
    snapshotId: normalizedSnapshotId,
    snapshotDir,
    metadataPath: path.join(snapshotDir, METADATA_FILENAME),
    runtimeDbPath: path.join(snapshotDir, RUNTIME_DB_FILENAME),
    prismaJsonPath: path.join(snapshotDir, PRISMA_JSON_FILENAME),
    storagePlanPath: path.join(snapshotDir, STORAGE_PLAN_FILENAME)
  };
};

export const listSnapshotDirs = (packId: string): string[] => {
  const packRoot = getPackRootDir(packId);
  const snapshotsDir = getPackSnapshotsDir(packId);

  if (!safeFs.existsSync(packRoot, snapshotsDir)) {
    return [];
  }

  return safeFs
    .readdirSync(packRoot, snapshotsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
};

export const readSnapshotMetadata = (location: SnapshotLocation): PackSnapshotMetadata => {
  const packRoot = getPackRootDir(location.packId);
  if (!safeFs.existsSync(packRoot, location.metadataPath)) {
    throw new Error(`Snapshot metadata not found: ${location.metadataPath}`);
  }

  const raw = safeFs.readFileSync(packRoot, location.metadataPath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;

  return packSnapshotMetadataSchema.parse(parsed);
};

export const writeSnapshotMetadata = (location: SnapshotLocation, metadata: PackSnapshotMetadata): void => {
  const packRoot = getPackRootDir(location.packId);
  safeFs.mkdirSync(packRoot, location.snapshotDir, { recursive: true });
  safeFs.writeFileSync(packRoot, location.metadataPath, JSON.stringify(metadata, null, 2));
};

export const deleteSnapshotDir = (location: SnapshotLocation): void => {
  const packRoot = getPackRootDir(location.packId);
  if (safeFs.existsSync(packRoot, location.snapshotDir)) {
    safeFs.rmSync(packRoot, location.snapshotDir, { recursive: true, force: true });
  }
};

export const snapshotFilesExist = (location: SnapshotLocation): boolean => {
  const packRoot = getPackRootDir(location.packId);

  if (!safeFs.existsSync(packRoot, location.metadataPath)) {
    return false;
  }

  const hasRuntimeDb = safeFs.existsSync(packRoot, location.runtimeDbPath);
  const hasPrismaJson = safeFs.existsSync(packRoot, location.prismaJsonPath);
  const hasStoragePlan = safeFs.existsSync(packRoot, location.storagePlanPath);

  let metadata: PackSnapshotMetadata;
  try {
    metadata = readSnapshotMetadata(location);
  } catch {
    return false;
  }

  if (metadata.storage_plan_inherits_from) {
    return hasRuntimeDb && hasPrismaJson;
  }

  return hasRuntimeDb && hasPrismaJson && hasStoragePlan;
};

export const computeSha256 = (absolutePath: string): string => {
  const content = fs.readFileSync(absolutePath);
  return crypto.createHash('sha256').update(content).digest('hex');
};

export const resolveStoragePlanPathInChain = (
  packId: string,
  snapshotId: string,
  maxDepth: number = 20
): string | null => {
  const packRoot = getPackRootDir(packId);

  for (let depth = 0; depth < maxDepth; depth++) {
    const location = resolveSnapshotLocation(packId, snapshotId);

    if (!safeFs.existsSync(packRoot, location.metadataPath)) {
      return null;
    }

    const metadata = readSnapshotMetadata(location);

    if (safeFs.existsSync(packRoot, location.storagePlanPath)) {
      return location.storagePlanPath;
    }

    const parentId = metadata.storage_plan_inherits_from ?? null;
    if (!parentId) {
      return null;
    }

    snapshotId = parentId;
  }

  return null;
};
