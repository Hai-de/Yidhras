import { describe, expect, it, vi } from 'vitest';

import { configRoutes } from '../../../src/app/routes/config.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp, unwrapData } from '../../helpers/test_app.js';

vi.mock('../../../src/app/services/config/config.js', () => ({
  getMaskedConfig: vi.fn(() => ({ server: { port: 3000 }, ai: { provider: 'openai' } })),
  listConfigDomains: vi.fn(() => [
    { domain: 'server', tier: 'static', description: 'Server config' },
    { domain: 'ai', tier: 'hot', description: 'AI config' }
  ]),
  getDomainConfig: vi.fn((domain: string) => {
    if (domain === 'server') return { port: 3000 };
    return undefined;
  }),
  updateDomainConfig: vi.fn((domain: string) => ({
    domain,
    tier: 'hot',
    hotReloaded: true,
    config: { updated: true }
  }))
}));

vi.mock('../../../src/operator/audit/logger.js', () => ({
  logOperatorAudit: vi.fn(async () => {})
}));

describe('config routes', () => {
  describe('GET /api/config', () => {
    it('returns masked config', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      configRoutes.register(app.express, ctx);

      const res = await app.get('/api/config');

      expect(res.status).toBe(200);
      const data = unwrapData<{ server: { port: number }; ai: { provider: string } }>(res.body);
      expect(data.server.port).toBe(3000);
      await app.close();
    });

    it('rejects unauthenticated request', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx);
      configRoutes.register(app.express, ctx);

      const res = await app.get('/api/config');

      expect(res.status).toBe(401);
      await app.close();
    });
  });

  describe('GET /api/config/domains', () => {
    it('returns config domains', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      configRoutes.register(app.express, ctx);

      const res = await app.get('/api/config/domains');

      expect(res.status).toBe(200);
      const data = unwrapData<Array<{ domain: string; tier: string; description: string }>>(res.body);
      expect(data).toHaveLength(2);
      await app.close();
    });
  });

  describe('GET /api/config/:domain', () => {
    it('returns single domain config', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      configRoutes.register(app.express, ctx);

      const res = await app.get('/api/config/server');

      expect(res.status).toBe(200);
      const data = unwrapData<{ port: number }>(res.body);
      expect(data.port).toBe(3000);
      await app.close();
    });

    it('returns 404 for unknown domain', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      configRoutes.register(app.express, ctx);

      const res = await app.get('/api/config/nonexistent');

      expect(res.status).toBe(404);
      await app.close();
    });
  });

  describe('PATCH /api/config/:domain', () => {
    it('updates domain config for root operator', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'root-1', username: 'root', is_root: true }
      });
      configRoutes.register(app.express, ctx);

      const res = await app.patch('/api/config/ai', { key: 'value' });

      expect(res.status).toBe(200);
      const data = unwrapData<{ hotReloaded: boolean }>(res.body);
      expect(data.hotReloaded).toBe(true);
      await app.close();
    });

    it('rejects non-root operator', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'user', is_root: false }
      });
      configRoutes.register(app.express, ctx);

      const res = await app.patch('/api/config/ai', { key: 'value' });

      expect(res.status).toBe(403);
      await app.close();
    });

    it('returns 404 for unknown domain', async () => {
      const { updateDomainConfig } = await import('../../../src/app/services/config/config.js');
      (updateDomainConfig as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);

      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'root-1', username: 'root', is_root: true }
      });
      configRoutes.register(app.express, ctx);

      const res = await app.patch('/api/config/nonexistent', { key: 'value' });

      expect(res.status).toBe(404);
      await app.close();
    });
  });
});
