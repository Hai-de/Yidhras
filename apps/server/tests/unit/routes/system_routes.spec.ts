import { describe, expect, it } from 'vitest';

import { systemRoutes } from '../../../src/app/routes/system.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp } from '../../helpers/test_app.js';

describe('system routes', () => {
  describe('GET /api/health', () => {
    it('returns startup health with 200 when level is ok', async () => {
      const ctx = createMockAppContext();
      ctx.startupHealth = {
        level: 'ok',
        checks: { db: true, world_pack_dir: true, world_pack_available: true },
        available_world_packs: ['pack-1'],
        errors: []
      };
      ctx.isRuntimeReady = () => true;

      const app = createTestApp(ctx);
      systemRoutes.register(app.express, ctx);
      const res = await app.get('/api/health');

      expect(res.status).toBe(200);
      const data = unwrapData<Record<string, unknown>>(res.body);
      expect(data.healthy).toBe(true);
      expect(data.level).toBe('ok');
      expect(data.runtime_ready).toBe(true);
      await app.close();
    });

    it('returns 503 when level is fail', async () => {
      const ctx = createMockAppContext();
      ctx.startupHealth = {
        level: 'fail',
        checks: { db: false, world_pack_dir: true, world_pack_available: false },
        available_world_packs: [],
        errors: ['DB connection failed']
      };
      ctx.isRuntimeReady = () => false;

      const app = createTestApp(ctx);
      systemRoutes.register(app.express, ctx);
      const res = await app.get('/api/health');

      expect(res.status).toBe(503);
      const data = unwrapData<Record<string, unknown>>(res.body);
      expect(data.healthy).toBe(false);
      expect(data.level).toBe('fail');
      expect(data.errors).toEqual(['DB connection failed']);
      await app.close();
    });
  });

  describe('GET /api/system/notifications', () => {
    it('requires auth — succeeds with operator', async () => {
      const ctx = createMockAppContext();
      ctx.notifications.push('info', 'test message', 'TEST_CODE');

      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'test', is_root: true }
      });
      systemRoutes.register(app.express, ctx);
      const res = await app.get('/api/system/notifications');

      expect(res.status).toBe(200);
      const data = unwrapData<Array<Record<string, unknown>>>(res.body);
      expect(data.length).toBeGreaterThanOrEqual(1);
      expect(data[0].code).toBe('TEST_CODE');
      await app.close();
    });
  });

  describe('POST /api/system/notifications/clear', () => {
    it('requires root operator', async () => {
      const ctx = createMockAppContext();
      ctx.notifications.push('info', 'msg', 'CODE');

      // non-root operator
      const app = createTestApp(ctx, {
        operator: { id: 'op-2', username: 'user', is_root: false }
      });
      systemRoutes.register(app.express, ctx);
      const res = await app.post('/api/system/notifications/clear');

      expect(res.status).toBe(403);
      const err = (res.body as Record<string, unknown>).error as Record<string, unknown>;
      expect(err.code).toBe('ROOT_REQUIRED');
      await app.close();
    });

    it('clears notifications when root', async () => {
      const ctx = createMockAppContext();
      ctx.notifications.push('info', 'msg', 'CODE');

      const app = createTestApp(ctx, {
        operator: { id: 'root-1', username: 'root', is_root: true }
      });
      systemRoutes.register(app.express, ctx);
      const res = await app.post('/api/system/notifications/clear');

      expect(res.status).toBe(200);
      const data = unwrapData<Record<string, unknown>>(res.body);
      expect(data.acknowledged).toBe(true);
      expect(ctx.notifications.getMessages()).toHaveLength(0);
      await app.close();
    });
  });
});
