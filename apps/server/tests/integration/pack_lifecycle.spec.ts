import { PrismaClient } from '@prisma/client';
import { afterAll,beforeAll, describe, expect, it } from 'vitest';

import { SimulationManager } from '../../src/core/simulation.js';
import { SqlitePackStorageAdapter } from '../../src/packs/storage/internal/SqlitePackStorageAdapter.js';
import {
  createIsolatedRuntimeEnvironment,
  createPrismaClientForEnvironment,
  type IsolatedRuntimeEnvironment,
  migrateIsolatedDatabase} from '../helpers/runtime.js';

describe('pack lifecycle', () => {
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

  describe('load/unload cycles', () => {
    it('load → unload → reload produces valid state', async () => {
      await sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);

      const beforeUnload = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);
      expect(beforeUnload).not.toBeNull();
      expect(beforeUnload?.pack_id).toBe(EXAMPLE_PACK_ID);

      const unloaded = await sim.unloadExperimentalPackRuntime(EXAMPLE_PACK_ID);
      expect(unloaded).toBe(true);

      const afterUnload = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);
      expect(afterUnload).toBeNull();

      const result = await sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);
      expect(result.loaded).toBe(true);

      const afterReload = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);
      expect(afterReload).not.toBeNull();
      expect(afterReload?.pack_id).toBe(EXAMPLE_PACK_ID);
    });

    it('rapid sequential unload → reload is idempotent over 5 cycles', async () => {
      for (let i = 0; i < 5; i++) {
        const result = await sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);
        if (result.already_loaded) {
          // Already loaded from previous cycle — unload first
          await sim.unloadExperimentalPackRuntime(EXAMPLE_PACK_ID);
          const reloaded = await sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);
          expect(reloaded.loaded || reloaded.already_loaded).toBe(true);
        } else {
          expect(result.loaded).toBe(true);
        }

        const handle = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);
        expect(handle).not.toBeNull();
        expect(handle?.pack_id).toBe(EXAMPLE_PACK_ID);

        const unloaded = await sim.unloadExperimentalPackRuntime(EXAMPLE_PACK_ID);
        expect(unloaded).toBe(true);

        const afterUnload = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);
        expect(afterUnload).toBeNull();
      }
    });

    it('unloaded pack ID disappears from loaded list', async () => {
      await sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);
      expect(sim.listLoadedPackRuntimeIds()).toContain(EXAMPLE_PACK_ID);

      await sim.unloadExperimentalPackRuntime(EXAMPLE_PACK_ID);
      expect(sim.listLoadedPackRuntimeIds()).not.toContain(EXAMPLE_PACK_ID);
    });

    it('reload assigns a handle with correct pack_id', async () => {
      await sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);
      await sim.unloadExperimentalPackRuntime(EXAMPLE_PACK_ID);
      await sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);

      const handle = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);
      expect(handle).not.toBeNull();
      expect(handle?.pack_id).toBe(EXAMPLE_PACK_ID);
      expect(typeof handle?.pack_folder_name).toBe('string');
    });
  });

  describe('edge cases', () => {
    it('load nonexistent pack ref throws', async () => {
      await expect(sim.loadExperimentalPackRuntime('nonexistent-pack')).rejects.toThrow();
    });

    it('unload with nonexistent pack returns false', async () => {
      const result = await sim.unloadExperimentalPackRuntime('nonexistent-pack-id');
      expect(result).toBe(false);
    });

    it('double load returns already_loaded when not unloaded', async () => {
      const first = await sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);
      expect(first.loaded || first.already_loaded).toBe(true);

      const second = await sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);
      expect(second.already_loaded).toBe(true);

      const handle = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);
      expect(handle).not.toBeNull();
    });

    it('unload primary pack (loaded via init()) works normally', async () => {
      await sim.loadExperimentalPackRuntime(DEATH_NOTE_REF);
      expect(sim.listLoadedPackRuntimeIds()).toContain(DEATH_NOTE_ID);

      const unloaded = await sim.unloadExperimentalPackRuntime(DEATH_NOTE_ID);
      expect(unloaded).toBe(true);

      expect(sim.listLoadedPackRuntimeIds()).not.toContain(DEATH_NOTE_ID);
    });
  });

  describe('handle validity', () => {
    it('handle returns clock snapshot after load', async () => {
      await sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);

      const handle = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);
      expect(handle).not.toBeNull();

      const clock = handle!.getClockSnapshot();
      expect(clock).toBeTruthy();
      expect(typeof clock.current_tick).toBe('string');
    });

    it('handle returns health snapshot after load', async () => {
      const handle = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);
      expect(handle).not.toBeNull();

      const health = handle!.getHealthSnapshot();
      expect(health).toBeTruthy();
      expect(typeof health.status).toBe('string');
    });

    it('handle is null after unload', async () => {
      await sim.unloadExperimentalPackRuntime(EXAMPLE_PACK_ID);

      const handle = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);
      expect(handle).toBeNull();
    });

    it('status snapshot transitions: loaded pack returns non-null', async () => {
      await sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);

      const snapshot = sim.getPackRuntimeStatusSnapshot(EXAMPLE_PACK_ID);
      expect(snapshot).not.toBeNull();
      expect(snapshot?.pack_id).toBe(EXAMPLE_PACK_ID);

      await sim.unloadExperimentalPackRuntime(EXAMPLE_PACK_ID);

      const afterSnapshot = sim.getPackRuntimeStatusSnapshot(EXAMPLE_PACK_ID);
      expect(afterSnapshot).toBeNull();
    });
  });
});
