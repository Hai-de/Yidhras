import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../../src/app/context.js';
import { registerClockRoutes } from '../../../src/app/routes/clock.js';
import { createRuntimeClockProjectionService } from '../../../src/app/runtime/runtime_clock_projection.js';

const createFakeApp = () => {
  const gets = new Map<string, (req: unknown, res: unknown, next?: (error?: unknown) => void) => void>();
  const posts = new Map<string, (req: unknown, res: unknown, next?: (error?: unknown) => void) => void>();

  return {
    app: {
      get: vi.fn((path: string, handler: (req: unknown, res: unknown, next?: (error?: unknown) => void) => void) => {
        gets.set(path, handler);
      }),
      post: vi.fn((path: string, handler: (req: unknown, res: unknown, next?: (error?: unknown) => void) => void) => {
        posts.set(path, handler);
      })
    },
    gets,
    posts
  };
};

const createFakeResponse = () => {
  const body: { value: unknown } = { value: null };
  return {
    body,
    res: {
      status: vi.fn().mockReturnThis(),
      json: vi.fn((value: unknown) => {
        body.value = value;
        return value;
      })
    }
  };
};

const createContext = (): AppContext => {
  const projection = createRuntimeClockProjectionService();
  projection.rebuildFromRuntimeSeed({
    pack_id: 'world-test-pack',
    current_tick: '100',
    current_revision: '100',
    calendars: []
  });

  return {
    prisma: {} as never,
    sim: {
      getCurrentTick: () => 1n,
      getAllTimes: () => [{ calendar_id: 'fallback', display: 'fallback-time', units: {} }]
    } as never,
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

describe('clock routes host projection read path', () => {
  it('prefers host runtime projection for /api/clock/formatted', () => {
    const context = createContext();
    const { app, gets } = createFakeApp();

    registerClockRoutes(app as never, context, {
      parsePositiveStepTicks: value => BigInt(value as string),
      toJsonSafe: value => value,
      getErrorMessage: err => (err instanceof Error ? err.message : String(err))
    });

    const handler = gets.get('/api/clock/formatted');
    expect(handler).toBeTypeOf('function');

    const { res, body } = createFakeResponse();
    handler?.({}, res, vi.fn());

    expect(body.value).toEqual({
      success: true,
      data: {
        absolute_ticks: '100',
        calendars: []
      }
    });
  });

  it('serializes bigint units from host runtime projection for /api/clock/formatted', () => {
    const context = createContext();
    context.runtimeClockProjection?.rebuildFromRuntimeSeed({
      pack_id: 'world-test-pack',
      current_tick: '42',
      current_revision: '42',
      calendars: [
        {
          id: 'primary',
          name: 'Primary',
          tick_rate: 1000,
          units: [
            { name: 'tick', ratio: 1 },
            { name: 'cycle', ratio: 10 }
          ]
        }
      ]
    });
    const { app, gets } = createFakeApp();

    registerClockRoutes(app as never, context, {
      parsePositiveStepTicks: value => BigInt(value as string),
      toJsonSafe: value => JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item))),
      getErrorMessage: err => (err instanceof Error ? err.message : String(err))
    });

    const handler = gets.get('/api/clock/formatted');
    const { res, body } = createFakeResponse();
    handler?.({}, res, vi.fn());

    expect(body.value).toEqual({
      success: true,
      data: {
        absolute_ticks: '42',
        calendars: [{ calendar_id: 'primary', calendar_name: 'Primary', display: '4 cycle 2tick', units: { tick: '2', cycle: '4' } }]
      }
    });
  });

  it('falls back to simulation clock when no host projection exists', () => {
    const context = createContext();
    context.runtimeClockProjection = createRuntimeClockProjectionService();
    const { app, gets } = createFakeApp();

    registerClockRoutes(app as never, context, {
      parsePositiveStepTicks: value => BigInt(value as string),
      toJsonSafe: value => value,
      getErrorMessage: err => (err instanceof Error ? err.message : String(err))
    });

    const handler = gets.get('/api/clock/formatted');
    expect(handler).toBeTypeOf('function');

    const { res, body } = createFakeResponse();
    handler?.({}, res, vi.fn());

    expect(body.value).toEqual({
      success: true,
      data: {
        absolute_ticks: '1',
        calendars: [{ calendar_id: 'fallback', display: 'fallback-time', units: {} }]
      }
    });
  });
});
