import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { WorldEngineSidecarClient } from '../../src/app/runtime/sidecar/world_engine_sidecar_client.js';
import {
  clearTaintedWorldEnginePackId,
  executeWorldEnginePreparedStep,
  listTaintedWorldEnginePackIds
} from '../../src/app/runtime/world_engine_persistence.js';
import { createPackHostApi } from '../../src/app/runtime/world_engine_ports.js';
import { buildWorldPackHydrateRequest } from '../../src/app/runtime/world_engine_snapshot.js';
import { sim } from '../../src/core/simulation.js';
import { createIsolatedRuntimeEnvironment, migrateIsolatedDatabase } from '../helpers/runtime.js';

describe('world engine sidecar failure recovery integration', () => {
  let cleanup: (() => Promise<void>) | null = null;
  let context: AppContext;
  let sidecar: WorldEngineSidecarClient;
  const packId = 'world-death-note';
  const originalWorkspaceRoot = process.env.WORKSPACE_ROOT;
  const originalWorldPacksDir = process.env.WORLD_PACKS_DIR;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalAppEnv = process.env.APP_ENV;

  beforeAll(async () => {
    const environment = await createIsolatedRuntimeEnvironment();
    cleanup = environment.cleanup;
    await migrateIsolatedDatabase(environment);

    process.env.WORKSPACE_ROOT = environment.rootDir;
    process.env.WORLD_PACKS_DIR = environment.worldPacksDir;
    process.env.DATABASE_URL = environment.databaseUrl;
    process.env.APP_ENV = environment.envOverrides.APP_ENV;

    await sim.init('death_note');
    context = {
      prisma: sim.prisma,
      sim,
      runtimeBootstrap: sim,
      activePackRuntime: sim,
      packCatalog: sim,
      notifications: {
        push: () => ({ id: 'noop', level: 'info', content: 'noop', timestamp: Date.now() }),
        getMessages: () => [],
        clear: () => {}
      },
      startupHealth: {
        level: 'ok',
        checks: { db: true, world_pack_dir: true, world_pack_available: true },
        available_world_packs: [packId],
        errors: []
      },
      getRuntimeReady: () => true,
      setRuntimeReady: () => {},
      getPaused: () => false,
      setPaused: () => {},
      assertRuntimeReady: () => {}
    } as unknown as AppContext;

    sidecar = new WorldEngineSidecarClient();
    context.worldEngine = sidecar as unknown as AppContext['worldEngine'];
    context.packHostApi = createPackHostApi(context);

    await sidecar.loadPack({
      pack_id: packId,
      pack_ref: 'death_note',
      mode: 'active',
      hydrate: await buildWorldPackHydrateRequest(context, packId)
    });
  });

  afterAll(async () => {
    await sidecar?.unloadPack({ pack_id: packId });
    await sidecar?.stop();
    await sim.prisma.$disconnect();
    if (originalWorkspaceRoot === undefined) delete process.env.WORKSPACE_ROOT;
    else process.env.WORKSPACE_ROOT = originalWorkspaceRoot;
    if (originalWorldPacksDir === undefined) delete process.env.WORLD_PACKS_DIR;
    else process.env.WORLD_PACKS_DIR = originalWorldPacksDir;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalAppEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = originalAppEnv;
    await cleanup?.();
    clearTaintedWorldEnginePackId(packId);
  });

  it('aborts the prepared step when host persistence fails and keeps the pack untainted', async () => {
    clearTaintedWorldEnginePackId(packId);

    await expect(executeWorldEnginePreparedStep({
      context,
      worldEngine: sidecar,
      persistence: {
        persistPreparedStep: vi.fn(async () => {
          throw new Error('persist failed');
        })
      },
      prepareInput: {
        protocol_version: 'world_engine/v1alpha1',
        pack_id: packId,
        step_ticks: '1',
        reason: 'runtime_loop'
      }
    })).rejects.toThrow('persist failed');

    expect(listTaintedWorldEnginePackIds()).not.toContain(packId);

    const prepared = await sidecar.prepareStep({
      protocol_version: 'world_engine/v1alpha1',
      pack_id: packId,
      step_ticks: '1',
      reason: 'manual'
    });
    expect(prepared.state_delta.operations).toHaveLength(3);
    expect(prepared.emitted_events).toHaveLength(1);
    expect(prepared.observability.map(item => item.code)).toContain('WORLD_STEP_PREPARED');
    expect(prepared.observability.map(item => item.code)).toContain('WORLD_CORE_DELTA_BUILT');
    expect(prepared.observability.map(item => item.code)).toContain('WORLD_PREPARED_STATE_SUMMARY');
    expect(prepared.summary.mutated_entity_count).toBe(2);
    await sidecar.abortPreparedStep({ protocol_version: 'world_engine/v1alpha1', pack_id: packId, prepared_token: prepared.prepared_token, reason: 'cleanup-after-recovery-check' });

    const status = await sidecar.getStatus({ pack_id: packId });
    expect(status.pending_prepared_token).toBeNull();
  });

  it('marks the pack tainted when abort also fails', async () => {
    clearTaintedWorldEnginePackId(packId);

    const abortSpy = vi.spyOn(sidecar, 'abortPreparedStep').mockRejectedValueOnce(new Error('abort failed'));

    await expect(executeWorldEnginePreparedStep({
      context,
      worldEngine: sidecar,
      persistence: {
        persistPreparedStep: vi.fn(async () => {
          throw new Error('persist failed');
        })
      },
      prepareInput: {
        protocol_version: 'world_engine/v1alpha1',
        pack_id: packId,
        step_ticks: '1',
        reason: 'runtime_loop'
      }
    })).rejects.toThrow('persist failed');

    expect(listTaintedWorldEnginePackIds()).toContain(packId);
    abortSpy.mockRestore();
    clearTaintedWorldEnginePackId(packId);
  });
});
