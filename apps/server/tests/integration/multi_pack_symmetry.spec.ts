import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { PrismaClient } from '@prisma/client';

import { SimulationManager } from '../../src/core/simulation.js';
import { SqlitePackStorageAdapter } from '../../src/packs/storage/internal/SqlitePackStorageAdapter.js';
import {
  createIsolatedRuntimeEnvironment,
  createPrismaClientForEnvironment,
  migrateIsolatedDatabase,
  type IsolatedRuntimeEnvironment
} from '../helpers/runtime.js';

describe('multi-pack symmetry', () => {
  let environment: IsolatedRuntimeEnvironment;
  let prisma: PrismaClient;
  let sim: SimulationManager;
  const DEATH_NOTE_REF = 'death_note';
  const DEATH_NOTE_ID = 'world-death-note';
  const EXAMPLE_PACK_REF = 'example_pack';
  const EXAMPLE_PACK_ID = 'world-example-pack';

  beforeAll(async () => {
    environment = await createIsolatedRuntimeEnvironment({
      seededPackRefs: ['death_note', 'example_pack']
    });
    await migrateIsolatedDatabase(environment);

    process.env.WORKSPACE_ROOT = environment.rootDir;
    process.env.WORLD_PACKS_DIR = environment.worldPacksDir;
    process.env.DATABASE_URL = environment.databaseUrl;

    prisma = createPrismaClientForEnvironment(environment);
    sim = new SimulationManager({
      prisma,
      packStorageAdapter: new SqlitePackStorageAdapter()
    });

    await sim.prepareDatabase();
  });

  afterAll(async () => {
    await environment.cleanup();
  });

  describe('dual pack loading', () => {
    it('loads primary pack via legacy init()', async () => {
      await sim.init(DEATH_NOTE_REF);
      const ids = sim.listLoadedPackRuntimeIds();
      expect(ids.length).toBeGreaterThanOrEqual(1);
      expect(ids).toContain(DEATH_NOTE_ID);
    });

    it('loads secondary pack via registry service', async () => {
      const result = await sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);
      expect(result.loaded).toBe(true);
      expect(result.handle.pack_id).toBe(EXAMPLE_PACK_ID);
    });

    it('lists all loaded pack IDs', () => {
      const ids = sim.listLoadedPackRuntimeIds();
      expect(ids.length).toBeGreaterThanOrEqual(2);
      expect(ids).toContain(DEATH_NOTE_ID);
      expect(ids).toContain(EXAMPLE_PACK_ID);
    });

    it('each pack has distinct handles', () => {
      const ids = sim.listLoadedPackRuntimeIds();
      const handles = ids.map(id => sim.getPackRuntimeHandle(id));
      const packIds = handles.map(h => h?.pack_id);
      expect(new Set(packIds).size).toBe(ids.length);
    });

    it('each pack has its own clock', () => {
      const ids = sim.listLoadedPackRuntimeIds();
      const clocks = ids.map(id => {
        const h = sim.getPackRuntimeHandle(id);
        return h?.getClockSnapshot().current_tick;
      });
      expect(clocks.every(c => typeof c === 'string')).toBe(true);
    });
  });

  describe('pack clock isolation', () => {
    it('clock snapshots are per-pack', () => {
      const ids = sim.listLoadedPackRuntimeIds();
      expect(ids.length).toBeGreaterThanOrEqual(2);

      const clockA = sim.getPackRuntimeHandle(ids[0])?.getClockSnapshot();
      const clockB = sim.getPackRuntimeHandle(ids[1])?.getClockSnapshot();

      expect(clockA).toBeTruthy();
      expect(clockB).toBeTruthy();
    });

    it('pack statuses are independent', () => {
      const statuses = sim.listRuntimeStatuses();
      expect(statuses.length).toBeGreaterThanOrEqual(2);

      const loadedIds = new Set(sim.listLoadedPackRuntimeIds());
      for (const s of statuses) {
        expect(loadedIds.has(s.pack_id)).toBe(true);
      }
    });
  });

  describe('pack lifecycle', () => {
    it('can unload a secondary pack', async () => {
      const idsBefore = sim.listLoadedPackRuntimeIds();
      expect(idsBefore).toContain(EXAMPLE_PACK_ID);

      const unloaded = await sim.unloadExperimentalPackRuntime(EXAMPLE_PACK_ID);
      expect(unloaded).toBe(true);

      const idsAfter = sim.listLoadedPackRuntimeIds();
      expect(idsAfter).not.toContain(EXAMPLE_PACK_ID);
    });

    it('pack handle returns null after unload', async () => {
      const handle = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);
      expect(handle).toBeNull();
    });

    it('can reload a previously unloaded pack', async () => {
      const result = await sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);
      expect(result.loaded).toBe(true);

      const handle = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);
      expect(handle).not.toBeNull();
      expect(handle?.pack_id).toBe(EXAMPLE_PACK_ID);
    });

    it('reloaded pack gets a fresh handle', async () => {
      const ids = sim.listLoadedPackRuntimeIds();
      expect(ids).toContain(EXAMPLE_PACK_ID);
      expect(ids).toContain(DEATH_NOTE_ID);
    });
  });

  describe('pack catalog', () => {
    it('lists all available packs on disk', () => {
      const packs = sim.listAvailablePacks();
      expect(packs).toContain(DEATH_NOTE_REF);
      expect(packs).toContain(EXAMPLE_PACK_REF);
    });

    it('returns the packs directory', () => {
      expect(sim.getPacksDir()).toBe(environment.worldPacksDir);
    });
  });

  describe('pack runtime health', () => {
    it('each loaded pack has a health status', () => {
      const statuses = sim.listRuntimeStatuses();
      for (const s of statuses) {
        expect(s.health_status).toMatch(/^(loaded|running|stopped|paused|failed)$/);
        expect(s.pack_id).toBeTruthy();
      }
    });

    it('getPackRuntimeStatusSnapshot returns null for unloaded pack', () => {
      const snapshot = sim.getPackRuntimeStatusSnapshot('nonexistent-pack');
      expect(snapshot).toBeNull();
    });

    it('getPackRuntimeStatusSnapshot returns valid data for loaded pack', () => {
      const ids = sim.listLoadedPackRuntimeIds();
      expect(ids.length).toBeGreaterThan(0);

      const snapshot = sim.getPackRuntimeStatusSnapshot(ids[0]);
      expect(snapshot).not.toBeNull();
      expect(snapshot?.pack_id).toBe(ids[0]);
      expect(snapshot?.current_tick).toBeTruthy();
    });
  });

  describe('edge cases', () => {
    it('loading an already-loaded pack returns handle', async () => {
      const ids = sim.listLoadedPackRuntimeIds();
      expect(ids.length).toBeGreaterThan(0);

      const result = await sim.loadExperimentalPackRuntime(DEATH_NOTE_REF);
      expect(result.handle).toBeTruthy();
    });

    it('unloading a nonexistent pack returns false', async () => {
      const result = await sim.unloadExperimentalPackRuntime('nonexistent-pack-id');
      expect(result).toBe(false);
    });

    it('listLoadedPackRuntimeIds with no packs returns empty', async () => {
      const emptyPrisma = createPrismaClientForEnvironment(environment);
      const emptySim = new SimulationManager({
        prisma: emptyPrisma,
        packStorageAdapter: new SqlitePackStorageAdapter()
      });
      await emptySim.prepareDatabase();

      expect(emptySim.listLoadedPackRuntimeIds()).toEqual([]);
      expect(emptySim.listRuntimeStatuses()).toEqual([]);
    });
  });
});
