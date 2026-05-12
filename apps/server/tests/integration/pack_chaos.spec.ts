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

describe('pack chaos', () => {
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

  describe('concurrent operations', () => {
    it('concurrent load of two different packs succeeds', async () => {
      const [resultA, resultB] = await Promise.all([
        sim.loadExperimentalPackRuntime(DEATH_NOTE_REF),
        sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF)
      ]);

      expect(resultA.handle).toBeTruthy();
      expect(resultB.handle).toBeTruthy();

      const ids = sim.listLoadedPackRuntimeIds();
      expect(ids).toContain(DEATH_NOTE_ID);
      expect(ids).toContain(EXAMPLE_PACK_ID);
    });

    it('concurrent load of same pack does not corrupt state', async () => {
      const results = await Promise.all([
        sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF),
        sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF)
      ]);

      const atLeastOneLoaded = results.some(r => r.loaded);
      const atLeastOneAlreadyLoaded = results.some(r => r.already_loaded);

      expect(atLeastOneLoaded || atLeastOneAlreadyLoaded).toBe(true);

      const handle = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);
      expect(handle).not.toBeNull();
      expect(handle?.pack_id).toBe(EXAMPLE_PACK_ID);

      const occurrences = sim.listLoadedPackRuntimeIds()
        .filter(id => id === EXAMPLE_PACK_ID).length;
      expect(occurrences).toBe(1);
    });

    it('load during unload eventually reaches a consistent state', async () => {
      // Load a pack, then fire concurrent unload and load without awaiting in sequence.
      // The system should end up in a consistent state — either loaded or unloaded,
      // but never corrupted (no duplicates, no hangs, no crashes).
      await sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);

      const unloadPromise = sim.unloadExperimentalPackRuntime(EXAMPLE_PACK_ID);
      const loadPromise = sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);

      await Promise.all([unloadPromise, loadPromise]);

      // The final state depends on which operation won the race.
      // What matters is consistency, not a specific outcome.
      const ids = sim.listLoadedPackRuntimeIds();
      const count = ids.filter(id => id === EXAMPLE_PACK_ID).length;

      // Must not have duplicates — at most one entry
      expect(count).toBeLessThanOrEqual(1);

      // If the pack is loaded, its handle must be valid
      if (count === 1) {
        const handle = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);
        expect(handle).not.toBeNull();
        expect(handle?.pack_id).toBe(EXAMPLE_PACK_ID);
      }
    });

    it('rapid load/unload stress over 10 cycles leaves clean state', async () => {
      for (let cycle = 0; cycle < 10; cycle++) {
        const loadResult = await sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);
        if (!loadResult.loaded && !loadResult.already_loaded) {
          throw new Error(`Load failed on cycle ${cycle}`);
        }

        const handle = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);
        expect(handle).not.toBeNull();

        const unloadResult = await sim.unloadExperimentalPackRuntime(EXAMPLE_PACK_ID);
        expect(unloadResult).toBe(true);

        const afterHandle = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);
        expect(afterHandle).toBeNull();
      }
    });
  });

  describe('resource isolation under stress', () => {
    it('rapid unload/reload of pack B while pack A is loaded does not affect pack A', async () => {
      // Load pack A first
      await sim.loadExperimentalPackRuntime(DEATH_NOTE_REF);
      const handleABefore = sim.getPackRuntimeHandle(DEATH_NOTE_ID);
      expect(handleABefore).not.toBeNull();

      // Stress pack B
      for (let i = 0; i < 5; i++) {
        await sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);
        await sim.unloadExperimentalPackRuntime(EXAMPLE_PACK_ID);
      }

      // Pack A should still be intact
      const handleAAfter = sim.getPackRuntimeHandle(DEATH_NOTE_ID);
      expect(handleAAfter).not.toBeNull();
      expect(handleAAfter?.pack_id).toBe(DEATH_NOTE_ID);

      const ids = sim.listLoadedPackRuntimeIds();
      expect(ids).toContain(DEATH_NOTE_ID);
    });

    it('all packs unloaded leaves empty state', async () => {
      await sim.loadExperimentalPackRuntime(DEATH_NOTE_REF);
      await sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);

      expect(sim.listLoadedPackRuntimeIds().length).toBeGreaterThanOrEqual(2);

      for (const id of sim.listLoadedPackRuntimeIds()) {
        await sim.unloadExperimentalPackRuntime(id);
      }

      expect(sim.listLoadedPackRuntimeIds()).toEqual([]);
      expect(sim.listRuntimeStatuses()).toEqual([]);
    });

    it('reload after all packs unloaded restores valid state', async () => {
      // Unload everything
      for (const id of sim.listLoadedPackRuntimeIds()) {
        await sim.unloadExperimentalPackRuntime(id);
      }
      expect(sim.listLoadedPackRuntimeIds()).toEqual([]);

      // Reload
      await sim.loadExperimentalPackRuntime(DEATH_NOTE_REF);
      await sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);

      const ids = sim.listLoadedPackRuntimeIds();
      expect(ids).toContain(DEATH_NOTE_ID);
      expect(ids).toContain(EXAMPLE_PACK_ID);
      expect(ids.length).toBe(2);
    });
  });

  describe('degradation and recovery', () => {
    it('unloading and reloading a pack produces a valid handle each time', async () => {
      for (let i = 0; i < 3; i++) {
        await sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);

        const handle = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);
        expect(handle).not.toBeNull();
        expect(handle?.getHealthSnapshot().status).toBeTruthy();

        await sim.unloadExperimentalPackRuntime(EXAMPLE_PACK_ID);

        const nullHandle = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);
        expect(nullHandle).toBeNull();
      }
    });

    it('unknown pack IDs consistently return null across all queries', async () => {
      const fakeId = 'world-fake-never-loaded';

      expect(sim.getPackRuntimeHandle(fakeId)).toBeNull();
      expect(sim.getPackRuntimeStatusSnapshot(fakeId)).toBeNull();
      expect(await sim.unloadExperimentalPackRuntime(fakeId)).toBe(false);
    });
  });
});
