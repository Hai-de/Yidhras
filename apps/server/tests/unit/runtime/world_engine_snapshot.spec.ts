import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import type { AppContext } from '../../../src/app/context.js';
import { buildWorldPackHydrateRequest, buildWorldPackSnapshot } from '../../../src/app/runtime/world_engine_snapshot.js';
import type { SimulationManager } from '../../../src/core/simulation.js';
import { SqlitePackStorageAdapter } from '../../../src/packs/storage/internal/SqlitePackStorageAdapter.js';
import { wrapPrismaAsRepositories } from '../../helpers/mock_repos.js';

const TEST_PACK_ID = 'world-test-pack';

const createContext = (): AppContext => {
  const sim = {
    getActivePack: () => ({ metadata: { id: TEST_PACK_ID } }),
    getCurrentTick: () => 1000n,
    getPackRuntimeHandle: () => null
  } as unknown as SimulationManager;

  const prisma = {} as AppContext['prisma'];
  return {
    repos: wrapPrismaAsRepositories(prisma as PrismaClient),
    prisma,
    packStorageAdapter: new SqlitePackStorageAdapter(),
    sim,
    clock: sim as AppContext['clock'],
    activePack: sim as AppContext['activePack'],
    activePackRuntime: {
      init: vi.fn(async () => undefined),
      getActivePack: () => ({ metadata: { id: TEST_PACK_ID } }) as never,
      resolvePackVariables: vi.fn(() => ''),
      getStepTicks: () => 1n,
      getRuntimeSpeedSnapshot: vi.fn(() => ({
        mode: 'fixed',
        source: 'default',
        configured_step_ticks: null,
        override_step_ticks: null,
        override_since: null,
        effective_step_ticks: '1'
      })),
      setRuntimeSpeedOverride: vi.fn(),
      clearRuntimeSpeedOverride: vi.fn(),
      getCurrentTick: () => 1000n,
      getAllTimes: vi.fn(() => ({})),
      step: vi.fn(async () => undefined)
    },
    notifications: {
      push: vi.fn() as never,
      getMessages: vi.fn(() => []),
      clear: vi.fn()
    },
    startupHealth: {
      level: 'ok',
      checks: { db: true, world_pack_dir: true, world_pack_available: true },
      available_world_packs: [TEST_PACK_ID],
      errors: []
    },
    getRuntimeReady: () => true,
    setRuntimeReady: vi.fn(),
    getPaused: () => false,
    setPaused: vi.fn(),
    assertRuntimeReady: vi.fn()
  } as unknown as AppContext;
};

describe('world engine snapshot assembly', () => {
  it('builds a host snapshot and hydrate request for an active pack', async () => {
    const context = createContext();

    const snapshot = await buildWorldPackSnapshot(context, TEST_PACK_ID);
    expect(snapshot.pack_id).toBe(TEST_PACK_ID);
    expect(snapshot.clock.current_tick).toBe('1000');
    expect(Array.isArray(snapshot.world_entities)).toBe(true);
    expect(Array.isArray(snapshot.entity_states)).toBe(true);
    expect(Array.isArray(snapshot.authority_grants)).toBe(true);
    expect(Array.isArray(snapshot.mediator_bindings)).toBe(true);
    expect(Array.isArray(snapshot.rule_execution_records)).toBe(true);

    const hydrate = await buildWorldPackHydrateRequest(context, TEST_PACK_ID);
    expect(hydrate.source).toBe('host_snapshot');
    expect(hydrate.snapshot.pack_id).toBe(TEST_PACK_ID);
    expect(hydrate.snapshot.clock.current_revision).toBe('1000');
  });
});
