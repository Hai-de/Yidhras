import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deleteSnapshotDir,
  getPackSnapshotsDir,
  listSnapshotDirs,
  readSnapshotMetadata,
  resolveSnapshotLocation,
  snapshotFilesExist,
  writeSnapshotMetadata
} from '../../src/packs/snapshots/snapshot_locator.js';
import { getPackRootDir } from '../../src/packs/storage/pack_db_locator.js';

const TEST_PACK_ID = 'snapshot-locator-test-pack';
const TEST_SNAPSHOT_ID = 'snap-test-001';

const testLocation = resolveSnapshotLocation(TEST_PACK_ID, TEST_SNAPSHOT_ID);

const validMetadata = {
  schema_version: 1 as const,
  snapshot_id: TEST_SNAPSHOT_ID,
  pack_id: TEST_PACK_ID,
  label: 'test',
  captured_at_tick: '1000',
  captured_at_revision: '1000',
  captured_at_timestamp: '2026-04-28T00:00:00.000Z',
  runtime_db_size_bytes: 1024,
  prisma_record_count: 10
};

describe('snapshot_locator', () => {
  beforeEach(() => {
    fs.mkdirSync(testLocation.snapshotDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testLocation.snapshotDir)) {
      fs.rmSync(testLocation.snapshotDir, { recursive: true, force: true });
    }

    const snapshotsDir = getPackSnapshotsDir(TEST_PACK_ID);
    if (fs.existsSync(snapshotsDir)) {
      const remaining = fs.readdirSync(snapshotsDir);
      if (remaining.length === 0) {
        fs.rmdirSync(snapshotsDir);
      }
    }

    const packDir = getPackRootDir(TEST_PACK_ID);
    if (fs.existsSync(packDir)) {
      const remaining = fs.readdirSync(packDir);
      if (remaining.length === 0) {
        fs.rmdirSync(packDir);
      }
    }
  });

  describe('resolveSnapshotLocation', () => {
    it('returns correct paths', () => {
      expect(testLocation.packId).toBe(TEST_PACK_ID);
      expect(testLocation.snapshotId).toBe(TEST_SNAPSHOT_ID);
      expect(testLocation.snapshotDir).toContain('snapshots');
      expect(testLocation.snapshotDir).toContain(TEST_SNAPSHOT_ID);
      expect(path.basename(testLocation.metadataPath)).toBe('metadata.json');
      expect(path.basename(testLocation.runtimeDbPath)).toBe('runtime.sqlite');
      expect(path.basename(testLocation.prismaJsonPath)).toBe('prisma.json');
      expect(path.basename(testLocation.storagePlanPath)).toBe('storage-plan.json');
    });

    it('throws on empty packId', () => {
      expect(() => resolveSnapshotLocation('  ', 'snap-1')).toThrow('packId');
    });

    it('throws on empty snapshotId', () => {
      expect(() => resolveSnapshotLocation('pack-1', '  ')).toThrow('snapshotId');
    });
  });

  describe('getPackSnapshotsDir', () => {
    it('returns path under pack root', () => {
      const dir = getPackSnapshotsDir(TEST_PACK_ID);
      expect(dir).toContain(TEST_PACK_ID);
      expect(dir).toContain('snapshots');
    });
  });

  describe('listSnapshotDirs', () => {
    it('returns empty array for non-existent directory', () => {
      const nonExistentDir = getPackSnapshotsDir('non-existent-pack');
      if (fs.existsSync(nonExistentDir)) {
        fs.rmdirSync(nonExistentDir);
      }
      expect(listSnapshotDirs('non-existent-pack')).toEqual([]);
    });

    it('lists snapshot directories', () => {
      fs.mkdirSync(path.join(testLocation.snapshotDir, '..', 'snap-a'), { recursive: true });
      fs.mkdirSync(path.join(testLocation.snapshotDir, '..', 'snap-b'), { recursive: true });

      const dirs = listSnapshotDirs(TEST_PACK_ID);
      expect(dirs).toContain('snap-a');
      expect(dirs).toContain('snap-b');

      fs.rmSync(path.join(testLocation.snapshotDir, '..', 'snap-a'), { recursive: true, force: true });
      fs.rmSync(path.join(testLocation.snapshotDir, '..', 'snap-b'), { recursive: true, force: true });
    });

    it('ignores non-directory entries', () => {
      const snapshotsDir = getPackSnapshotsDir(TEST_PACK_ID);
      fs.mkdirSync(snapshotsDir, { recursive: true });
      fs.writeFileSync(path.join(snapshotsDir, 'readme.md'), 'hello');

      const dirs = listSnapshotDirs(TEST_PACK_ID);
      expect(dirs).not.toContain('readme.md');

      fs.unlinkSync(path.join(snapshotsDir, 'readme.md'));
    });
  });

  describe('writeSnapshotMetadata / readSnapshotMetadata', () => {
    it('writes and reads metadata round-trip', () => {
      writeSnapshotMetadata(testLocation, validMetadata);
      const read = readSnapshotMetadata(testLocation);
      expect(read).toEqual(validMetadata);
    });

    it('throws reading non-existent metadata', () => {
      expect(() => readSnapshotMetadata(testLocation)).toThrow('not found');
    });

    it('throws on invalid metadata format', () => {
      fs.writeFileSync(testLocation.metadataPath, JSON.stringify({ invalid: true }), 'utf-8');
      expect(() => readSnapshotMetadata(testLocation)).toThrow();
    });
  });

  describe('deleteSnapshotDir', () => {
    it('deletes snapshot directory and contents', () => {
      writeSnapshotMetadata(testLocation, validMetadata);
      expect(fs.existsSync(testLocation.snapshotDir)).toBe(true);

      deleteSnapshotDir(testLocation);
      expect(fs.existsSync(testLocation.snapshotDir)).toBe(false);
    });

    it('is no-op for non-existent directory', () => {
      const nonExistent = resolveSnapshotLocation(TEST_PACK_ID, 'nonexistent');
      expect(() => deleteSnapshotDir(nonExistent)).not.toThrow();
    });
  });

  describe('snapshotFilesExist', () => {
    it('returns false when files are missing', () => {
      expect(snapshotFilesExist(testLocation)).toBe(false);
    });

    it('returns true when all 4 files exist', () => {
      writeSnapshotMetadata(testLocation, validMetadata);
      fs.writeFileSync(testLocation.runtimeDbPath, 'mock-sqlite-content');
      fs.writeFileSync(testLocation.prismaJsonPath, '{}');
      fs.writeFileSync(testLocation.storagePlanPath, '{}');

      expect(snapshotFilesExist(testLocation)).toBe(true);
    });
  });
});
