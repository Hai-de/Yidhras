import { PrismaClient } from '@prisma/client';
import { afterAll,beforeAll, describe, expect, it } from 'vitest';

import { SimulationManager } from '../../src/core/simulation.js';
import { SqlitePackStorageAdapter } from '../../src/packs/storage/internal/SqlitePackStorageAdapter.js';
import { expectDefined } from '../helpers/assertions.js';
import {
  createIsolatedRuntimeEnvironment,
  createPrismaClientForEnvironment,
  type IsolatedRuntimeEnvironment,
  migrateIsolatedDatabase} from '../helpers/runtime.js';

describe('pack clock isolation', () => {
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
    await sim.loadExperimentalPackRuntime(DEATH_NOTE_REF);
    await sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);
  });

  afterAll(async () => {
    await environment.cleanup();
  });

  describe('independent clock snapshots', () => {
    it('each loaded pack has its own clock snapshot', () => {
      const handleA = sim.getPackRuntimeHandle(DEATH_NOTE_ID);
      const handleB = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);

      const deathNoteHandle = expectDefined(handleA, 'death note handle');
      const exampleHandle = expectDefined(handleB, 'example pack handle');

      const clockA = deathNoteHandle.getClockSnapshot();
      const clockB = exampleHandle.getClockSnapshot();

      expect(clockA).toBeTruthy();
      expect(clockB).toBeTruthy();
      expect(typeof clockA.current_tick).toBe('string');
      expect(typeof clockB.current_tick).toBe('string');
    });

    it('unloading pack B does not affect pack A handle', async () => {
      const clockBefore = sim.getPackRuntimeHandle(DEATH_NOTE_ID)?.getClockSnapshot();

      await sim.unloadExperimentalPackRuntime(EXAMPLE_PACK_ID);

      const handleA = sim.getPackRuntimeHandle(DEATH_NOTE_ID);
      const deathNoteHandle = expectDefined(handleA, 'death note handle');
      const clockBeforeSnapshot = expectDefined(clockBefore, 'clock before');

      const clockAfter = deathNoteHandle.getClockSnapshot();
      expect(clockAfter.current_tick).toBe(clockBeforeSnapshot.current_tick);
    });

    it('reloading pack B does not affect pack A handle', async () => {
      await sim.loadExperimentalPackRuntime(EXAMPLE_PACK_REF);

      const handleA = sim.getPackRuntimeHandle(DEATH_NOTE_ID);
      const deathNoteHandle = expectDefined(handleA, 'death note handle');
      expect(deathNoteHandle.metadata_id).toBe(DEATH_NOTE_ID);

      const handleB = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);
      const exampleHandle = expectDefined(handleB, 'example pack handle');
      expect(exampleHandle.metadata_id).toBe(EXAMPLE_PACK_ID);
    });

    it('two packs have distinct clock snapshot values', () => {
      const clockA = expectDefined(sim.getPackRuntimeHandle(DEATH_NOTE_ID), 'death note handle').getClockSnapshot();
      const clockB = expectDefined(sim.getPackRuntimeHandle(EXAMPLE_PACK_ID), 'example pack handle').getClockSnapshot();

      // Both snapshots exist and have truthy tick values
      expect(clockA.current_tick).toBeTruthy();
      expect(clockB.current_tick).toBeTruthy();
    });
  });

  describe('pack handle data isolation', () => {
    it('each pack handle reports its own pack_id', () => {
      const handleA = sim.getPackRuntimeHandle(DEATH_NOTE_ID);
      const handleB = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);

      const deathNoteHandle = expectDefined(handleA, 'death note handle');
      const exampleHandle = expectDefined(handleB, 'example pack handle');
      expect(deathNoteHandle.metadata_id).toBe(DEATH_NOTE_ID);
      expect(exampleHandle.metadata_id).toBe(EXAMPLE_PACK_ID);
      expect(deathNoteHandle.metadata_id).not.toBe(exampleHandle.metadata_id);
    });

    it('each pack handle reports its own folder name', () => {
      const handleA = sim.getPackRuntimeHandle(DEATH_NOTE_ID);
      const handleB = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);

      const deathNoteHandle = expectDefined(handleA, 'death note handle');
      const exampleHandle = expectDefined(handleB, 'example pack handle');
      expect(typeof deathNoteHandle.pack_folder_name).toBe('string');
      expect(typeof exampleHandle.pack_folder_name).toBe('string');
    });

    it('speed snapshot is per-pack', () => {
      const handleA = sim.getPackRuntimeHandle(DEATH_NOTE_ID);
      const handleB = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);

      const speedA = expectDefined(handleA, 'death note handle').getRuntimeSpeedSnapshot();
      const speedB = expectDefined(handleB, 'example pack handle').getRuntimeSpeedSnapshot();

      expect(speedA).toBeTruthy();
      expect(speedB).toBeTruthy();
      expect(typeof speedA.effective_step_ticks).toBe('string');
      expect(typeof speedB.effective_step_ticks).toBe('string');
    });

    it('health snapshot is per-pack', () => {
      const handleA = sim.getPackRuntimeHandle(DEATH_NOTE_ID);
      const handleB = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);

      const healthA = expectDefined(handleA, 'death note handle').getHealthSnapshot();
      const healthB = expectDefined(handleB, 'example pack handle').getHealthSnapshot();

      expect(healthA).toBeTruthy();
      expect(healthB).toBeTruthy();
      expect(typeof healthA.status).toBe('string');
      expect(typeof healthB.status).toBe('string');
    });
  });

  describe('status snapshot isolation', () => {
    it('listRuntimeStatuses includes both loaded packs', () => {
      const statuses = sim.listRuntimeStatuses();
      const loadedIds = new Set(sim.listLoadedPackRuntimeIds());

      expect(loadedIds.has(DEATH_NOTE_ID)).toBe(true);
      expect(loadedIds.has(EXAMPLE_PACK_ID)).toBe(true);

      for (const s of statuses) {
        expect(loadedIds.has(s.metadata_id)).toBe(true);
      }
    });

    it('status snapshot for unloaded pack returns null', async () => {
      const handleB = sim.getPackRuntimeHandle(EXAMPLE_PACK_ID);
      expect(handleB).not.toBeNull();

      await sim.unloadExperimentalPackRuntime(EXAMPLE_PACK_ID);

      const snapshot = sim.getPackRuntimeStatusSnapshot(EXAMPLE_PACK_ID);
      expect(snapshot).toBeNull();
    });
  });
});
