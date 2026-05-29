import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/app/services/runtime/experimental_multi_pack_runtime.js', () => ({
  buildExperimentalSystemHealthSnapshot: vi.fn(() => ({
    database: { status: 'ok' },
    packs: { loaded: 0, max: 10 }
  })),
  buildExperimentalPackRuntimeRegistrySnapshot: vi.fn(async () => ({
    packs: [],
    total: 0
  })),
  loadExperimentalPackRuntime: vi.fn(async () => ({
    handle: { instance_id: 'inst-1', pack_id: 'pack-1' },
    loaded: true,
    already_loaded: false
  })),
  unloadExperimentalPackRuntime: vi.fn(async () => ({
    unloaded: true
  })),
  getExperimentalPackRuntimeStatusSnapshot: vi.fn(async () => ({
    pack_id: 'pack-1',
    status: 'loaded',
    current_tick: '100'
  }))
}));

vi.mock('../../../src/app/runtime/runtime_kernel_service.js', () => ({
  createRuntimeKernelService: vi.fn(() => ({
    getSummary: vi.fn(async () => ({ partition_count: 1, worker_count: 1 })),
    getOwnershipAssignments: vi.fn(async () => ({ assignments: [] })),
    getWorkers: vi.fn(async () => []),
    getOperatorProjection: vi.fn(async () => ({}))
  }))
}));

vi.mock('../../../src/operator/guard/pack_access.js', () => ({
  packAccessGuard: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next())
}));

vi.mock('../../../src/app/middleware/capability.js', () => ({
  capabilityGuard: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  checkCapability: vi.fn(async () => true)
}));

vi.mock('../../../src/app/services/pack/pack_scope_resolver.js', () => ({
  assertPackScope: vi.fn()
}));

vi.mock('../../../src/app/services/app_context_ports.js', () => ({
  getPackRuntimeLookupPort: vi.fn(() => ({
    getPackRuntimeSummary: vi.fn(() => ({ pack_id: 'pack-1', status: 'loaded' }))
  }))
}));

import { experimentalRuntimeRoutes } from '../../../src/app/routes/experimental_runtime.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp, unwrapData } from '../../helpers/test_app.js';

describe('experimental_runtime routes', () => {
  const setup = () => {
    const ctx = createMockAppContext();
    (ctx as unknown as { getPackRuntimeHandle: (id: string) => unknown }).getPackRuntimeHandle = (id: string) => id === 'pack-1' ? {
      instance_id: 'inst-1',
      getClock: () => ({ getTicks: () => 100n, tick: vi.fn() }),
      getClockSnapshot: () => ({ current_tick: '100' }),
      getRuntimeSpeedSnapshot: () => ({ mode: 'variable', source: 'default' }),
      getHealthSnapshot: () => ({ status: 'ok' }),
      getPack: () => ({ metadata: { id: 'pack-1' } })
    } : null;
    (ctx as unknown as { getPackRuntimeHost: (id: string) => unknown }).getPackRuntimeHost = (id: string) => id === 'pack-1' ? {
      getClock: () => ({ getTicks: () => 100n, tick: vi.fn() })
    } : null;

    const app = createTestApp(ctx, {
      operator: { id: 'op-1', username: 'admin', is_root: true }
    });
    experimentalRuntimeRoutes.register(app.express, ctx);
    return { ctx, app };
  };

  describe('GET /api/experimental/runtime/system/health', () => {
    it('returns system health snapshot', async () => {
      const { app } = setup();
      const res = await app.get('/api/experimental/runtime/system/health');
      expect(res.status).toBe(200);
      const data = unwrapData<Record<string, unknown>>(res.body);
      expect(data.database).toBeDefined();
      await app.close();
    });
  });

  describe('GET /api/experimental/runtime/packs', () => {
    it('returns pack runtime registry snapshot', async () => {
      const { app } = setup();
      const res = await app.get('/api/experimental/runtime/packs');
      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('POST /api/experimental/runtime/packs/:packId/load', () => {
    it('loads pack runtime', async () => {
      const { app } = setup();
      const res = await app.post('/api/experimental/runtime/packs/pack-1/load');
      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('POST /api/experimental/runtime/packs/:packId/unload', () => {
    it('unloads pack runtime', async () => {
      const { app } = setup();
      const res = await app.post('/api/experimental/runtime/packs/pack-1/unload');
      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('POST /api/experimental/runtime/packs/:packId/step', () => {
    it('advances clock by specified amount', async () => {
      const { app } = setup();
      const res = await app.post('/api/experimental/runtime/packs/pack-1/step', { amount: 5 });
      expect(res.status).toBe(200);
      const data = unwrapData<Record<string, unknown>>(res.body);
      expect(data.pack_id).toBe('pack-1');
      await app.close();
    });

    it('advances clock by 1 when no amount specified', async () => {
      const { app } = setup();
      const res = await app.post('/api/experimental/runtime/packs/pack-1/step', {});
      expect(res.status).toBe(200);
      const data = unwrapData<Record<string, unknown>>(res.body);
      expect(data.advanced_by).toBe('1');
      await app.close();
    });
  });

  describe('GET /api/experimental/runtime/packs/:packId/status', () => {
    it('returns pack runtime status', async () => {
      const { app } = setup();
      const res = await app.get('/api/experimental/runtime/packs/pack-1/status');
      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/experimental/runtime/packs/:packId/clock', () => {
    it('returns clock snapshot', async () => {
      const { app } = setup();
      const res = await app.get('/api/experimental/runtime/packs/pack-1/clock');
      expect(res.status).toBe(200);
      const data = unwrapData<Record<string, unknown>>(res.body);
      expect(data.clock).toBeDefined();
      await app.close();
    });
  });

  describe('GET /api/experimental/runtime/packs/:packId/scheduler/summary', () => {
    it('returns scheduler summary', async () => {
      const { app } = setup();
      const res = await app.get('/api/experimental/runtime/packs/pack-1/scheduler/summary');
      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/experimental/runtime/packs/:packId/scheduler/ownership', () => {
    it('returns scheduler ownership', async () => {
      const { app } = setup();
      const res = await app.get('/api/experimental/runtime/packs/pack-1/scheduler/ownership');
      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/experimental/runtime/packs/:packId/scheduler/workers', () => {
    it('returns scheduler workers', async () => {
      const { app } = setup();
      const res = await app.get('/api/experimental/runtime/packs/pack-1/scheduler/workers');
      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/experimental/runtime/packs/:packId/scheduler/operator', () => {
    it('returns scheduler operator projection', async () => {
      const { app } = setup();
      const res = await app.get('/api/experimental/runtime/packs/pack-1/scheduler/operator');
      expect(res.status).toBe(200);
      await app.close();
    });
  });
});
