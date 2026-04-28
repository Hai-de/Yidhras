import type { PackSnapshotMetadata } from '@yidhras/contracts';
import { packSnapshotMetadataSchema } from '@yidhras/contracts';
import fs from 'fs';
import path from 'path';

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
const RUNTIME_DB_FILENAME = 'runtime.sqlite';
const PRISMA_JSON_FILENAME = 'prisma.json';
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
  const snapshotsDir = getPackSnapshotsDir(packId);

  if (!fs.existsSync(snapshotsDir)) {
    return [];
  }

  return fs
    .readdirSync(snapshotsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
};

export const readSnapshotMetadata = (location: SnapshotLocation): PackSnapshotMetadata => {
  if (!fs.existsSync(location.metadataPath)) {
    throw new Error(`Snapshot metadata not found: ${location.metadataPath}`);
  }

  const raw = fs.readFileSync(location.metadataPath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;

  return packSnapshotMetadataSchema.parse(parsed);
};

export const writeSnapshotMetadata = (location: SnapshotLocation, metadata: PackSnapshotMetadata): void => {
  fs.mkdirSync(location.snapshotDir, { recursive: true });
  fs.writeFileSync(location.metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
};

export const deleteSnapshotDir = (location: SnapshotLocation): void => {
  if (fs.existsSync(location.snapshotDir)) {
    fs.rmSync(location.snapshotDir, { recursive: true, force: true });
  }
};

export const snapshotFilesExist = (location: SnapshotLocation): boolean => {
  return (
    fs.existsSync(location.metadataPath) &&
    fs.existsSync(location.runtimeDbPath) &&
    fs.existsSync(location.prismaJsonPath) &&
    fs.existsSync(location.storagePlanPath)
  );
};
