import { describe, expect, it, vi } from 'vitest';

import { createPackListRoutes } from '../../../src/app/routes/packs.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp, unwrapData } from '../../helpers/test_app.js';

describe('packs routes', () => {
  describe('GET /api/packs', () => {
    it('returns empty packs list when no packs available', async () => {
      const ctx = createMockAppContext();
      const mockLoader = {
        listAvailablePacks: vi.fn().mockReturnValue([]),
        loadPack: vi.fn(),
        deriveInstanceId: vi.fn()
      };
      (ctx as Record<string, unknown>).packCatalog = {
        getLoader: vi.fn().mockReturnValue(mockLoader)
      };

      const app = createTestApp(ctx, { operator: { id: 'op-1', username: 'admin', is_root: true } });
      const routes = createPackListRoutes('/tmp/packs');
      routes.register(app.express, ctx);

      const res = await app.get('/api/packs');
      expect(res.status).toBe(200);
      await app.close();
    });

    it('returns packs list with loaded packs', async () => {
      const ctx = createMockAppContext();
      const mockPack = {
        metadata: {
          id: 'pack-1',
          name: 'Test Pack',
          version: '1.0.0',
          description: 'A test pack',
          presentation: { theme: 'dark' }
        }
      };
      const mockLoader = {
        listAvailablePacks: vi.fn().mockReturnValue(['test-pack']),
        loadPack: vi.fn().mockReturnValue(mockPack),
        deriveInstanceId: vi.fn().mockReturnValue('inst-1')
      };
      (ctx as Record<string, unknown>).packCatalog = {
        getLoader: vi.fn().mockReturnValue(mockLoader)
      };
      (ctx as Record<string, unknown>).listLoadedPackRuntimeIds = vi.fn().mockReturnValue([]);

      const app = createTestApp(ctx, { operator: { id: 'op-1', username: 'admin', is_root: true } });
      const routes = createPackListRoutes('/tmp/packs');
      routes.register(app.express, ctx);

      const res = await app.get('/api/packs');
      expect(res.status).toBe(200);
      await app.close();
    });

    it('returns packs with runtime status for loaded packs', async () => {
      const ctx = createMockAppContext();
      const mockPack = {
        metadata: {
          id: 'pack-1',
          name: 'Test Pack',
          version: '1.0.0',
          description: null,
          presentation: null
        }
      };
      const mockLoader = {
        listAvailablePacks: vi.fn().mockReturnValue(['test-pack']),
        loadPack: vi.fn().mockReturnValue(mockPack),
        deriveInstanceId: vi.fn().mockReturnValue('inst-1')
      };
      (ctx as Record<string, unknown>).packCatalog = {
        getLoader: vi.fn().mockReturnValue(mockLoader)
      };
      (ctx as Record<string, unknown>).listLoadedPackRuntimeIds = vi.fn().mockReturnValue(['inst-1']);
      (ctx as Record<string, unknown>).getPackRuntimeHandle = vi.fn().mockReturnValue({
        getHealthSnapshot: vi.fn().mockReturnValue({ status: 'running', message: 'all good' }),
        getClockSnapshot: vi.fn().mockReturnValue({ current_tick: '100' })
      });

      const app = createTestApp(ctx, { operator: { id: 'op-1', username: 'admin', is_root: true } });
      const routes = createPackListRoutes('/tmp/packs');
      routes.register(app.express, ctx);

      const res = await app.get('/api/packs');
      expect(res.status).toBe(200);

      const body = unwrapData<{ packs: Array<Record<string, unknown>> }>(res.body);
      expect(body.packs).toHaveLength(1);
      const pack = body.packs[0];
      expect(pack).toBeDefined();
      expect(pack!.runtime_status).toBe('loaded');
      expect(pack!.runtime_ready).toBe(true);
      expect(pack!.health_status).toBe('running');
      expect(pack!.health_message).toBe('all good');
      expect(pack!.current_tick).toBe('100');

      await app.close();
    });

    it('sets runtime_ready false when health status is failed', async () => {
      const ctx = createMockAppContext();
      const mockPack = {
        metadata: {
          id: 'pack-1',
          name: 'Broken Pack',
          version: '1.0.0',
          description: null,
          presentation: null
        }
      };
      const mockLoader = {
        listAvailablePacks: vi.fn().mockReturnValue(['broken-pack']),
        loadPack: vi.fn().mockReturnValue(mockPack),
        deriveInstanceId: vi.fn().mockReturnValue('inst-1')
      };
      (ctx as Record<string, unknown>).packCatalog = {
        getLoader: vi.fn().mockReturnValue(mockLoader)
      };
      (ctx as Record<string, unknown>).listLoadedPackRuntimeIds = vi.fn().mockReturnValue(['inst-1']);
      (ctx as Record<string, unknown>).getPackRuntimeHandle = vi.fn().mockReturnValue({
        getHealthSnapshot: vi.fn().mockReturnValue({ status: 'failed', message: 'engine crash' }),
        getClockSnapshot: vi.fn().mockReturnValue({ current_tick: '42' })
      });

      const app = createTestApp(ctx, { operator: { id: 'op-1', username: 'admin', is_root: true } });
      const routes = createPackListRoutes('/tmp/packs');
      routes.register(app.express, ctx);

      const res = await app.get('/api/packs');
      expect(res.status).toBe(200);

      const body = unwrapData<{ packs: Array<Record<string, unknown>> }>(res.body);
      expect(body.packs).toHaveLength(1);
      const pack = body.packs[0];
      expect(pack).toBeDefined();
      expect(pack!.runtime_status).toBe('loaded');
      expect(pack!.runtime_ready).toBe(false);
      expect(pack!.health_status).toBe('failed');
      expect(pack!.health_message).toBe('engine crash');

      await app.close();
    });

    it('sets runtime_ready false and null health for not-loaded packs', async () => {
      const ctx = createMockAppContext();
      const mockPack = {
        metadata: {
          id: 'pack-2',
          name: 'Unloaded Pack',
          version: '2.0.0',
          description: null,
          presentation: null
        }
      };
      const mockLoader = {
        listAvailablePacks: vi.fn().mockReturnValue(['unloaded-pack']),
        loadPack: vi.fn().mockReturnValue(mockPack),
        deriveInstanceId: vi.fn().mockReturnValue('inst-2')
      };
      (ctx as Record<string, unknown>).packCatalog = {
        getLoader: vi.fn().mockReturnValue(mockLoader)
      };
      (ctx as Record<string, unknown>).listLoadedPackRuntimeIds = vi.fn().mockReturnValue([]);

      const app = createTestApp(ctx, { operator: { id: 'op-1', username: 'admin', is_root: true } });
      const routes = createPackListRoutes('/tmp/packs');
      routes.register(app.express, ctx);

      const res = await app.get('/api/packs');
      expect(res.status).toBe(200);

      const body = unwrapData<{ packs: Array<Record<string, unknown>> }>(res.body);
      expect(body.packs).toHaveLength(1);
      const pack = body.packs[0];
      expect(pack).toBeDefined();
      expect(pack!.runtime_status).toBe('not_loaded');
      expect(pack!.runtime_ready).toBe(false);
      expect(pack!.health_status).toBeNull();
      expect(pack!.health_message).toBeNull();
      expect(pack!.current_tick).toBeNull();

      await app.close();
    });
  });
});
