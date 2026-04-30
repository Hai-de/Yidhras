import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import type { AppContext } from '../../../src/app/context.js';
import { createRuntimeClockProjectionService } from '../../../src/app/runtime/runtime_clock_projection.js';
import { wrapPrismaAsRepositories } from '../../helpers/mock_repos.js';
import { getOverviewSummary } from '../../../src/app/services/overview.js';

vi.mock('../../../src/kernel/projections/operator_overview_service.js', () => ({
  getOperatorOverviewProjection: vi.fn(async () => ({
    runtime: {
      status: 'running',
      runtime_ready: true,
      runtime_speed: { configured_step_ticks: '1', effective_step_ticks: '1', override_step_ticks: null },
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

vi.mock('../../../src/app/services/audit.js', () => ({
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
  repos.agent = {
    getPrisma: () => mockPrisma,
    countActiveAgents: vi.fn(async () => 0)
  } as unknown as typeof repos.agent;

  return {
    repos,
    prisma: mockPrisma,
    sim: {
      getCurrentTick: () => 1n,
      getAllTimes: () => [{ calendar_id: 'fallback', display: 'fallback-time', units: {} }],
      isRuntimeReady: () => true,
      isPaused: () => false
    } as never,
    clock: {
      getCurrentTick: () => 1n
    } as AppContext['clock'],
    activePack: { getActivePack: () => undefined, getCurrentRevision: () => 1n } as AppContext['activePack'],
    activePackRuntime: {
      getActivePack: () => ({ metadata: { id: 'world-test-pack' } })
    } as never,
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
    assertRuntimeReady: vi.fn()
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

  it('falls back to visible sim clock when host projection is unavailable but sim still has an active pack', async () => {
    const context = createContext();
    context.runtimeClockProjection = createRuntimeClockProjectionService();
    context.activePackRuntime = undefined;
    context.sim = {
      getCurrentTick: () => 7n,
      getAllTimes: () => [{ calendar_id: 'sim-only', display: 'sim-only-time', units: {} }],
      getActivePack: () => ({ metadata: { id: 'world-test-pack' } }),
      isRuntimeReady: () => true,
      isPaused: () => false
    } as never;
    (context as AppContext).clock = { getCurrentTick: () => 7n } as AppContext['clock'];
    (context as AppContext).activePack = { getActivePack: () => ({ metadata: { id: 'world-test-pack' } } as never), getCurrentRevision: () => 7n };

    const summary = await getOverviewSummary(context);

    expect(summary.world_time).toEqual({
      tick: '7',
      calendars: []
    });
  });
});
