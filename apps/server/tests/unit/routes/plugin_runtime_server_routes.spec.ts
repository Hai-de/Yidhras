import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/plugins/runtime.js', () => ({
  pluginRuntimeRegistry: {
    getRuntime: vi.fn()
  }
}));

vi.mock('../../../src/config/runtime_config.js', () => ({
  getRuntimeConfig: vi.fn(() => ({
    plugins: {
      isolation: {
        route_timeout_ms: 5000
      }
    }
  })),
  getPreferredWorldPack: vi.fn(() => 'test-pack'),
  getWorldPacksDir: vi.fn(() => '/tmp/packs'),
  getAiModelsConfigPath: vi.fn(() => '/tmp/ai_models.yaml')
}));

vi.mock('../../../src/plugins/worker/errors.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/plugins/worker/errors.js')>('../../../src/plugins/worker/errors.js');
  return {
    PluginWorkerTimeoutError: actual.PluginWorkerTimeoutError,
    PluginWorkerError: actual.PluginWorkerError
  };
});

import { pluginRuntimeServerRoutes } from '../../../src/app/routes/plugin_runtime_server.js';
import { pluginRuntimeRegistry } from '../../../src/plugins/runtime.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp } from '../../helpers/test_app.js';

describe('plugin_runtime_server routes', () => {
  describe('ALL /api/packs/:packId/plugins/:pluginId/runtime/server/:installationId/routes/{*runtimePath}', () => {
    it('returns 404 when runtime not found', async () => {
      (pluginRuntimeRegistry.getRuntime as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      pluginRuntimeServerRoutes.register(app.express, ctx);

      const res = await app.get('/api/packs/pack-1/plugins/plugin-1/runtime/server/inst-1/routes/test');
      expect(res.status).toBe(404);
      await app.close();
    });

    it('returns 404 when plugin_id mismatch', async () => {
      (pluginRuntimeRegistry.getRuntime as ReturnType<typeof vi.fn>).mockReturnValue({
        plugin_id: 'different-plugin',
        worker_client: {},
        pack_routes: []
      });

      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      pluginRuntimeServerRoutes.register(app.express, ctx);

      const res = await app.get('/api/packs/pack-1/plugins/plugin-1/runtime/server/inst-1/routes/test');
      expect(res.status).toBe(404);
      await app.close();
    });

    it('returns 404 when no worker_client', async () => {
      (pluginRuntimeRegistry.getRuntime as ReturnType<typeof vi.fn>).mockReturnValue({
        plugin_id: 'plugin-1',
        worker_client: null,
        pack_routes: []
      });

      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      pluginRuntimeServerRoutes.register(app.express, ctx);

      const res = await app.get('/api/packs/pack-1/plugins/plugin-1/runtime/server/inst-1/routes/test');
      expect(res.status).toBe(404);
      await app.close();
    });

    it('returns 404 when no matching route', async () => {
      (pluginRuntimeRegistry.getRuntime as ReturnType<typeof vi.fn>).mockReturnValue({
        plugin_id: 'plugin-1',
        worker_client: {},
        pack_routes: []
      });

      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      pluginRuntimeServerRoutes.register(app.express, ctx);

      const res = await app.get('/api/packs/pack-1/plugins/plugin-1/runtime/server/inst-1/routes/nonexistent');
      expect(res.status).toBe(404);
      await app.close();
    });

    it('proxies request to matching route handler', async () => {
      const mockHandle = vi.fn(async () => ({ data: 'test-result' }));
      (pluginRuntimeRegistry.getRuntime as ReturnType<typeof vi.fn>).mockReturnValue({
        plugin_id: 'plugin-1',
        worker_client: {},
        pack_routes: [{
          method: 'GET',
          path: '/hello',
          handle: mockHandle
        }]
      });

      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      pluginRuntimeServerRoutes.register(app.express, ctx);

      const res = await app.get('/api/packs/pack-1/plugins/plugin-1/runtime/server/inst-1/routes/hello');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: 'test-result' });
      expect(mockHandle).toHaveBeenCalled();
      await app.close();
    });

    it('normalizes route path with leading slash', async () => {
      const mockHandle = vi.fn(async () => ({ ok: true }));
      (pluginRuntimeRegistry.getRuntime as ReturnType<typeof vi.fn>).mockReturnValue({
        plugin_id: 'plugin-1',
        worker_client: {},
        pack_routes: [{
          method: 'POST',
          path: 'api/data',
          handle: mockHandle
        }]
      });

      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      pluginRuntimeServerRoutes.register(app.express, ctx);

      const res = await app.post('/api/packs/pack-1/plugins/plugin-1/runtime/server/inst-1/routes/api/data', {});
      expect(res.status).toBe(200);
      expect(mockHandle).toHaveBeenCalled();
      await app.close();
    });
  });
});
