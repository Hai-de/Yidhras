import { describe, expect, it, vi } from 'vitest';

import { relationalRoutes } from '../../../src/app/routes/relational.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp, unwrapData } from '../../helpers/test_app.js';

describe('relational routes', () => {
  describe('GET /api/relational/graph', () => {
    it('returns relational graph', async () => {
      const ctx = createMockAppContext();
      // Mock dependencies for getRelationalGraph
      ctx.prisma.agent.findMany = vi.fn().mockResolvedValue([]);
      ctx.prisma.relationship.findMany = vi.fn().mockResolvedValue([]);
      ctx.prisma.identityNodeBinding.findMany = vi.fn().mockResolvedValue([]);
      ctx.prisma.atmosphereNode.findMany = vi.fn().mockResolvedValue([]);
      ctx.prisma.actionIntent.findMany = vi.fn().mockResolvedValue([]);

      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      relationalRoutes.register(app.express, ctx);

      const res = await app.get('/api/relational/graph');

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.success).toBe(true);
      const data = unwrapData<Record<string, unknown>>(body);
      expect(data).toBeDefined();
      await app.close();
    });
  });

  describe('GET /api/relational/circles', () => {
    it('returns relational circles', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.circle.findMany = vi.fn().mockResolvedValue([]);

      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      relationalRoutes.register(app.express, ctx);

      const res = await app.get('/api/relational/circles');

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.success).toBe(true);
      await app.close();
    });
  });

  describe('GET /api/atmosphere/nodes', () => {
    it('returns atmosphere nodes', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.atmosphereNode.findMany = vi.fn().mockResolvedValue([]);

      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      relationalRoutes.register(app.express, ctx);

      const res = await app.get('/api/atmosphere/nodes');

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.success).toBe(true);
      await app.close();
    });
  });

  describe('GET /api/relationships/:from_id/:to_id/:type/logs', () => {
    it('returns relationship adjustment logs', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.relationshipAdjustmentLog.findMany = vi.fn().mockResolvedValue([]);

      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      relationalRoutes.register(app.express, ctx);

      const res = await app.get('/api/relationships/agent-1/agent-2/friend/logs');

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.success).toBe(true);
      await app.close();
    });
  });
});
