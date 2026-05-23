import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import type { AppContext } from '../../../src/app/context.js';
import { createRuntimeClockProjectionService } from '../../../src/app/runtime/runtime_clock_projection.js';
import { wrapPrismaAsRepositories } from '../../helpers/mock_repos.js';
import { getOverviewSummary } from '../../../src/app/services/overview/overview.js';
import { createVariableRuntimeSpeedSnapshot } from '../../helpers/runtime_speed.js';

vi.mock('../../../src/kernel/projections/operator_overview_service.js', () => ({
  getOperatorOverviewProjection: vi.fn(async () => ({
    runtime: {
      status: 'running',
      runtime_ready: true,
      runtime_speed: createVariableRuntimeSpeedSnapshot(),
      health_level: 'ok',
      world_pack: null,
      has_error: false,
      startup_errors: []
    },
    pack_projection: {
      pack_id: 'world-test-pack',
      entity_count: 0,
      entity_state_count: 0,
      authority_grant_count: 0,
      mediator_binding_count: 0,
      rule_execution_count: 0,
      latest_rule_execution: null
    }
  }))
}));

vi.mock('../../../src/kernel/projections/projection_extractor.js', () => ({
  extractGlobalProjectionIndex: vi.fn(async () => ({ packs: [] }))
}));

vi.mock('../../../src/app/services/audit/audit.js', () => ({
  listAuditFeed: vi.fn(async () => ({ entries: [] }))
}));

const createContext = (): AppContext => {
  const projection = createRuntimeClockProjectionService();
  projection.rebuildFromRuntimeSeed({
    pack_id: 'world-test-pack',
    current_tick: '200',
    current_revision: '200',
    calendars: []
  });

  const mockPrisma = {} as unknown as PrismaClient;
  const repos = wrapPrismaAsRepositories(mockPrisma);
  Object.defineProperty(repos, 'agent', {
    value: {
      getPrisma: () => mockPrisma,
      countActiveAgents: vi.fn(async () => 0)
    } as unknown as typeof repos.agent,
    writable: true,
    configurable: true
  });

  const mockHost = {
    getCurrentTick: () => 7n,
    getCurrentRevision: () => 7n,
    getPack: () => ({ metadata: { id: 'world-test-pack', name: 'test', version: '0.0.0' } }),
    getStepTicks: () => 1n,
    getRuntimeSpeedSnapshot: () => createVariableRuntimeSpeedSnapshot(),
    setRuntimeSpeedOverride: vi.fn(),
    clearRuntimeSpeedOverride: vi.fn(),
    getAllTimes: () => [],
    step: vi.fn().mockResolvedValue(undefined),
    getPackSlotDeclarations: () => null,
    applyClockProjection: vi.fn(),
    getHealthSnapshot: () => ({ status: 'ok', message: null }),
    getClockSnapshot: () => ({ current_tick: '7', current_revision: '7' }),
    getHandle: vi.fn(),
    getClock: vi.fn(),
    load: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
    getPackId: () => 'world-test-pack'
  } as unknown as import('../../../src/core/pack_runtime_host.js').PackRuntimeHost;

  return {
    repos,
    prisma: mockPrisma,
    isRuntimeReady: () => true,
    isPaused: () => false,
    runtimeClockProjection: projection,
    notifications: {
      push: vi.fn() as never,
      getMessages: vi.fn(() => []),
      clear: vi.fn()
    },
    startupHealth: {
      level: 'ok',
      checks: { db: true, world_pack_dir: true, world_pack_available: true },
      available_world_packs: ['world-test-pack'],
      errors: []
    },
    getRuntimeReady: () => true,
    setRuntimeReady: vi.fn(),
    getPaused: () => false,
    setPaused: vi.fn(),
    assertRuntimeReady: vi.fn(),
    packRuntimeLookup: {
      hasPackRuntime: () => true,
      assertPackScope: (id: string) => id,
      getPackRuntimeSummary: () => null
    },
    getPackRuntimeHost: () => mockHost,
    getPackRuntimeHandle: (id: string) => ({
      pack_id: id,
      pack_folder_name: 'test',
      pack: { metadata: { id, name: 'test', version: '0.0.0' } } as unknown as import('../../../src/packs/manifest/loader.js').WorldPack,
      getHealthSnapshot: () => ({ status: 'ok', message: null }),
      getClockSnapshot: () => ({ current_tick: '7', current_revision: '7' }),
      getRuntimeSpeedSnapshot: () => createVariableRuntimeSpeedSnapshot()
    })
  } as unknown as AppContext;
};

describe('overview summary world time projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers host runtime projection for world_time', async () => {
    const summary = await getOverviewSummary(createContext());

    expect(summary.world_time).toEqual({
      tick: '200',
      calendars: []
    });
  });

  it('keeps host-projection source metadata available through visible clock helper consumers', async () => {
    const summary = await getOverviewSummary(createContext());

    expect(summary.world_time.tick).toBe('200');
    expect(Array.isArray(summary.world_time.calendars)).toBe(true);
  });

  it('returns 0 as fallback when host projection is unavailable', async () => {
    const context = createContext();
    context.runtimeClockProjection = createRuntimeClockProjectionService();

    const summary = await getOverviewSummary(context);

    expect(summary.world_time).toEqual({
      tick: '0',
      calendars: []
    });
  });
});
