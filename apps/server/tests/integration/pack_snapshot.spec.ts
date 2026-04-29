import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'zlib';

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The config_backup feature has added backup.yaml to conf.d but the schema
// hasn't been updated yet, causing RuntimeConfigSchema.parse to reject the
// unrecognized "backup" key. Mock the support config to bypass this.
vi.mock('../support/config.js', () => ({
  DEFAULT_E2E_WORLD_PACK: 'snapshot-integration-pack'
}));

import type { AppContext } from '../../src/app/context.js';
import { capturePackSnapshot } from '../../src/packs/snapshots/snapshot_capture.js';
import {
  deleteSnapshotDir,
  listSnapshotDirs,
  readSnapshotMetadata,
  resolveSnapshotLocation,
  snapshotFilesExist
} from '../../src/packs/snapshots/snapshot_locator.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

const TEST_PACK_ID = 'snapshot-integration-pack';

const createMinimalRuntimeDb = (dbPath: string): void => {
  const db = new DatabaseSync(dbPath, { create: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS pack_world_entities (
      id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL,
      entity_kind TEXT NOT NULL,
      entity_type TEXT,
      label TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      static_schema_ref TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pack_entity_states (
      id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      state_namespace TEXT NOT NULL,
      state_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pack_authority_grants (
      id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL,
      source_entity_id TEXT NOT NULL,
      target_selector_json TEXT NOT NULL DEFAULT '{}',
      capability_key TEXT NOT NULL,
      grant_type TEXT NOT NULL,
      mediated_by_entity_id TEXT,
      scope_json TEXT,
      conditions_json TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      status TEXT,
      revocable INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pack_mediator_bindings (
      id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL,
      mediator_id TEXT NOT NULL,
      subject_entity_id TEXT,
      binding_kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pack_rule_execution_records (
      id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      capability_key TEXT,
      mediator_id TEXT,
      subject_entity_id TEXT,
      target_entity_id TEXT,
      execution_status TEXT NOT NULL DEFAULT 'pending',
      payload_json TEXT,
      emitted_events_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.close();
};
const SNAPSHOTS_DIRNAME = 'snapshots';

let testRoot: string;
let packRoot: string;
let runtimeDbPath: string;
let storagePlanPath: string;
let originalWorkspaceRoot: string | undefined;

let cleanupFixture: (() => Promise<void>) | null = null;
let context: AppContext;

describe('pack snapshot integration', () => {
  beforeAll(async () => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yidhras-snapshot-test-'));
    packRoot = path.join(testRoot, 'data', 'world_packs', TEST_PACK_ID);
    runtimeDbPath = path.join(packRoot, 'runtime.sqlite');
    storagePlanPath = `${runtimeDbPath}.storage-plan.json`;

    fs.mkdirSync(packRoot, { recursive: true });
    createMinimalRuntimeDb(runtimeDbPath);
    fs.writeFileSync(storagePlanPath, JSON.stringify({ strategy: 'sqlite', engine_owned_collections: [] }));

    // Ensure config loading uses the temp workspace root (no backup.yaml in conf.d)
    originalWorkspaceRoot = process.env.WORKSPACE_ROOT;
    process.env.WORKSPACE_ROOT = testRoot;
    process.env.APP_ENV = 'test';

    // Reset cached config since we changed WORKSPACE_ROOT
    const { resetRuntimeConfigCache } = await import('../../src/config/runtime_config.js');
    resetRuntimeConfigCache();

    const fixture = await createIsolatedAppContextFixture();
    cleanupFixture = fixture.cleanup;
    context = fixture.context;
  });

  afterAll(async () => {
    if (cleanupFixture) {
      await cleanupFixture();
    }
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
    if (originalWorkspaceRoot !== undefined) {
      process.env.WORKSPACE_ROOT = originalWorkspaceRoot;
    } else {
      delete process.env.WORKSPACE_ROOT;
    }
  });

  beforeEach(async () => {
    // Clean up Prisma pack-scoped records from previous tests
    await context.prisma.identityNodeBinding.deleteMany({ where: { id: { startsWith: `${TEST_PACK_ID}:` } } });
    await context.prisma.identity.deleteMany({ where: { id: { startsWith: `${TEST_PACK_ID}:identity:` } } });
    await context.prisma.post.deleteMany({ where: { author_id: { startsWith: `${TEST_PACK_ID}:` } } });
    await context.prisma.relationship.deleteMany({ where: { from_id: { startsWith: `${TEST_PACK_ID}:` } } });
    await context.prisma.agent.deleteMany({ where: { id: { startsWith: `${TEST_PACK_ID}:` } } });
    await context.prisma.memoryBlock.deleteMany({ where: { pack_id: TEST_PACK_ID } });
    await context.prisma.contextOverlayEntry.deleteMany({ where: { pack_id: TEST_PACK_ID } });
    await context.prisma.memoryCompactionState.deleteMany({ where: { pack_id: TEST_PACK_ID } });
    await context.prisma.scenarioEntityState.deleteMany({ where: { pack_id: TEST_PACK_ID } });

    // Clean up snapshot directories from temp pack root
    const snapshotsDir = path.join(packRoot, SNAPSHOTS_DIRNAME);
    if (fs.existsSync(snapshotsDir)) {
      fs.rmSync(snapshotsDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Recreate runtime.sqlite in case restore tests cleared it
    fs.mkdirSync(packRoot, { recursive: true });
    if (!fs.existsSync(runtimeDbPath)) {
      createMinimalRuntimeDb(runtimeDbPath);
    }
    if (!fs.existsSync(storagePlanPath)) {
      fs.writeFileSync(storagePlanPath, JSON.stringify({ strategy: 'sqlite' }));
    }
  });

  const seedPackPrismaData = async () => {
    const now = BigInt(Date.now());

    await context.prisma.agent.createMany({
      data: [
        { id: `${TEST_PACK_ID}:actor-1`, name: 'Hero', type: 'active', snr: 0.8, is_pinned: false, created_at: now, updated_at: now },
        { id: `${TEST_PACK_ID}:actor-2`, name: 'Villain', type: 'active', snr: 0.3, is_pinned: false, created_at: now, updated_at: now }
      ]
    });

    await context.prisma.identity.createMany({
      data: [
        { id: `${TEST_PACK_ID}:identity:actor-1`, type: 'agent', name: 'Hero', provider: 'pack', status: 'active', created_at: now, updated_at: now },
        { id: `${TEST_PACK_ID}:identity:actor-2`, type: 'agent', name: 'Villain', provider: 'pack', status: 'active', created_at: now, updated_at: now }
      ]
    });

    await context.prisma.identityNodeBinding.createMany({
      data: [
        { id: `${TEST_PACK_ID}:binding:actor-1`, identity_id: `${TEST_PACK_ID}:identity:actor-1`, agent_id: `${TEST_PACK_ID}:actor-1`, role: 'active', status: 'active', created_at: now, updated_at: now },
        { id: `${TEST_PACK_ID}:binding:actor-2`, identity_id: `${TEST_PACK_ID}:identity:actor-2`, agent_id: `${TEST_PACK_ID}:actor-2`, role: 'active', status: 'active', created_at: now, updated_at: now }
      ]
    });

    await context.prisma.post.create({
      data: { id: 'post-1', author_id: `${TEST_PACK_ID}:actor-1`, content: 'Hello world', noise_level: 0.1, is_encrypted: false, created_at: now }
    });

    await context.prisma.relationship.create({
      data: { id: 'rel-1', from_id: `${TEST_PACK_ID}:actor-1`, to_id: `${TEST_PACK_ID}:actor-2`, type: 'rival', weight: 1.0, created_at: now, updated_at: now }
    });
  };

  describe('capture and list', () => {
    it('creates a complete snapshot with all 4 files', async () => {
      await seedPackPrismaData();

      const result = await capturePackSnapshot({
        packId: TEST_PACK_ID,
        prisma: context.prisma,
        packStorageAdapter: context.packStorageAdapter,
        activePackRuntime: context.activePackRuntime,
        getExperimentalTick: () => null,
        getExperimentalRevision: () => null
      });

      const location = result.location;
      expect(snapshotFilesExist(location)).toBe(true);
      expect(fs.existsSync(location.metadataPath)).toBe(true);
      expect(fs.existsSync(location.runtimeDbPath)).toBe(true);
      expect(fs.existsSync(location.prismaJsonPath)).toBe(true);
      expect(fs.existsSync(location.storagePlanPath)).toBe(true);
    });

    it('captures correct agent count in prisma.json', async () => {
      await seedPackPrismaData();

      const result = await capturePackSnapshot({
        packId: TEST_PACK_ID,
        prisma: context.prisma,
        packStorageAdapter: context.packStorageAdapter,
        activePackRuntime: context.activePackRuntime,
        getExperimentalTick: () => null,
        getExperimentalRevision: () => null
      });

      const prismaCompressed = fs.readFileSync(result.location.prismaJsonPath);
      const prismaRaw = gunzipSync(prismaCompressed).toString('utf-8');
      const prismaData = JSON.parse(prismaRaw);

      expect(prismaData.agents).toHaveLength(2);
      expect(prismaData.identities).toHaveLength(2);
      expect(prismaData.identity_node_bindings).toHaveLength(2);
      expect(prismaData.posts).toHaveLength(1);
      expect(prismaData.relationships).toHaveLength(1);
    });

    it('captures correct metadata fields', async () => {
      await seedPackPrismaData();

      const result = await capturePackSnapshot({
        packId: TEST_PACK_ID,
        label: 'test-snapshot',
        prisma: context.prisma,
        packStorageAdapter: context.packStorageAdapter,
        activePackRuntime: context.activePackRuntime,
        getExperimentalTick: () => null,
        getExperimentalRevision: () => null
      });

      const metadata = result.metadata;
      expect(metadata.schema_version).toBe(1);
      expect(metadata.pack_id).toBe(TEST_PACK_ID);
      expect(metadata.label).toBe('test-snapshot');
      expect(metadata.captured_at_tick).toBeTruthy();
      expect(metadata.captured_at_timestamp).toBeTruthy();
      expect(metadata.runtime_db_size_bytes).toBeGreaterThan(0);
      // 2 agents + 2 identities + 2 bindings + 1 post + 1 relationship = 8
      expect(metadata.prisma_record_count).toBe(8);
    });

    it('lists snapshot directories after capture', async () => {
      await seedPackPrismaData();

      // Create multiple snapshots
      await capturePackSnapshot({
        packId: TEST_PACK_ID,
        prisma: context.prisma,
        packStorageAdapter: context.packStorageAdapter,
        activePackRuntime: context.activePackRuntime,
        getExperimentalTick: () => null,
        getExperimentalRevision: () => null
      });
      await capturePackSnapshot({
        packId: TEST_PACK_ID,
        prisma: context.prisma,
        packStorageAdapter: context.packStorageAdapter,
        activePackRuntime: context.activePackRuntime,
        getExperimentalTick: () => null,
        getExperimentalRevision: () => null
      });

      const snapshotIds = listSnapshotDirs(TEST_PACK_ID);
      expect(snapshotIds.length).toBe(2);
    });

    it('returns empty list for pack with no snapshots', () => {
      expect(listSnapshotDirs('no-snapshots-pack')).toEqual([]);
    });

    it('reads metadata from captured snapshot', async () => {
      await seedPackPrismaData();

      const result = await capturePackSnapshot({
        packId: TEST_PACK_ID,
        prisma: context.prisma,
        packStorageAdapter: context.packStorageAdapter,
        activePackRuntime: context.activePackRuntime,
        getExperimentalTick: () => null,
        getExperimentalRevision: () => null
      });

      const metadata = readSnapshotMetadata(result.location);
      expect(metadata.snapshot_id).toBe(result.metadata.snapshot_id);
      expect(metadata.pack_id).toBe(TEST_PACK_ID);
      expect(metadata.prisma_record_count).toBe(8);
    });
  });

  describe('restore Prisma data', () => {
    it('restores pack-scoped records from prisma.json', async () => {
      // First capture with seed data
      await seedPackPrismaData();
      const result = await capturePackSnapshot({
        packId: TEST_PACK_ID,
        prisma: context.prisma,
        packStorageAdapter: context.packStorageAdapter,
        activePackRuntime: context.activePackRuntime,
        getExperimentalTick: () => null,
        getExperimentalRevision: () => null
      });

      // Verify seed data exists
      let agentCount = await context.prisma.agent.count({ where: { id: { startsWith: `${TEST_PACK_ID}:` } } });
      expect(agentCount).toBe(2);

      // Delete all pack-scoped data to simulate "time passed"
      await context.prisma.identityNodeBinding.deleteMany({ where: { id: { startsWith: `${TEST_PACK_ID}:` } } });
      await context.prisma.identity.deleteMany({ where: { id: { startsWith: `${TEST_PACK_ID}:identity:` } } });
      await context.prisma.post.deleteMany({ where: { author_id: { startsWith: `${TEST_PACK_ID}:` } } });
      await context.prisma.relationship.deleteMany({ where: { from_id: { startsWith: `${TEST_PACK_ID}:` } } });
      await context.prisma.agent.deleteMany({ where: { id: { startsWith: `${TEST_PACK_ID}:` } } });

      agentCount = await context.prisma.agent.count({ where: { id: { startsWith: `${TEST_PACK_ID}:` } } });
      expect(agentCount).toBe(0);

      // Restore using the prisma.json from the snapshot
      const { restorePackSnapshot } = await import('../../src/packs/snapshots/snapshot_restore.js');
      const packMock = {
        metadata: { id: TEST_PACK_ID, name: 'Test Pack', version: '1.0.0' },
        entities: { actors: [], artifacts: [], domains: [], institutions: [], mediators: [] },
        time_systems: [],
        variables: {},
        bootstrap: { initial_states: [] },
        authorities: [],
        identities: [],
        state_transforms: []
      } as never;

      await restorePackSnapshot({
        packId: TEST_PACK_ID,
        snapshotId: result.metadata.snapshot_id,
        prisma: context.prisma,
        packStorageAdapter: context.packStorageAdapter,
        pack: packMock,
        sim: context.sim,
        activePackRuntime: context.activePackRuntime,
        notifications: context.notifications
      });

      // Verify data is restored
      agentCount = await context.prisma.agent.count({ where: { id: { startsWith: `${TEST_PACK_ID}:` } } });
      expect(agentCount).toBe(2);

      const identityCount = await context.prisma.identity.count({ where: { id: { startsWith: `${TEST_PACK_ID}:identity:` } } });
      expect(identityCount).toBe(2);

      const bindingCount = await context.prisma.identityNodeBinding.count({ where: { id: { startsWith: `${TEST_PACK_ID}:` } } });
      expect(bindingCount).toBe(2);

      const postCount = await context.prisma.post.count({ where: { author_id: { startsWith: `${TEST_PACK_ID}:` } } });
      expect(postCount).toBe(1);

      const relCount = await context.prisma.relationship.count({ where: { from_id: { startsWith: `${TEST_PACK_ID}:` } } });
      expect(relCount).toBe(1);
    });
  });

  describe('delete snapshot', () => {
    it('deletes snapshot directory', async () => {
      await seedPackPrismaData();
      const result = await capturePackSnapshot({
        packId: TEST_PACK_ID,
        prisma: context.prisma,
        packStorageAdapter: context.packStorageAdapter,
        activePackRuntime: context.activePackRuntime,
        getExperimentalTick: () => null,
        getExperimentalRevision: () => null
      });

      expect(fs.existsSync(result.location.snapshotDir)).toBe(true);
      deleteSnapshotDir(result.location);
      expect(fs.existsSync(result.location.snapshotDir)).toBe(false);
    });
  });

  describe('error handling', () => {
    it('throws when reading non-existent snapshot metadata', () => {
      const location = resolveSnapshotLocation(TEST_PACK_ID, 'nonexistent');
      expect(() => readSnapshotMetadata(location)).toThrow();
    });

    it('snapshotFilesExist returns false for non-existent snapshot', () => {
      const location = resolveSnapshotLocation(TEST_PACK_ID, 'nonexistent');
      expect(snapshotFilesExist(location)).toBe(false);
    });
  });
});
