import { describe, expect, it, vi } from 'vitest';

import { operatorRoutes } from '../../../src/app/routes/operators.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp, unwrapData } from '../../helpers/test_app.js';

const mockOperator = {
  id: 'op-1',
  identity_id: 'id-1',
  username: 'alice',
  is_root: false,
  status: 'active',
  display_name: 'Alice',
  created_at: 1000n,
  updated_at: 1000n
};

describe('operator routes', () => {
  describe('GET /api/operators', () => {
    it('returns operators for root', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operator.findMany = vi.fn().mockResolvedValue([mockOperator] as any);

      const app = createTestApp(ctx, {
        operator: { id: 'root-1', username: 'root', is_root: true }
      });
      operatorRoutes.register(app.express, ctx);
      const res = await app.get('/api/operators');

      expect(res.status).toBe(200);
      await app.close();
    });

    it('rejects non-root operator', async () => {
      const ctx = createMockAppContext();

      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'user', is_root: false }
      });
      operatorRoutes.register(app.express, ctx);
      const res = await app.get('/api/operators');

      expect(res.status).toBe(403);
      await app.close();
    });
  });

  describe('POST /api/operators', () => {
    it('creates operator for root', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operator.findUnique = vi.fn().mockResolvedValue(null);
      ctx.prisma.identity.create = vi.fn().mockResolvedValue({ id: 'id-new' } as any);
      ctx.prisma.operator.create = vi.fn().mockResolvedValue({
        id: 'op-new',
        username: 'bob',
        is_root: false,
        status: 'active'
      } as any);

      const app = createTestApp(ctx, {
        operator: { id: 'root-1', username: 'root', is_root: true }
      });
      operatorRoutes.register(app.express, ctx);
      const res = await app.post('/api/operators', {
        username: 'bob',
        password: 'securepass123'
      });

      expect(res.status).toBe(200);
      await app.close();
    });

    it('rejects non-root', async () => {
      const ctx = createMockAppContext();

      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'user', is_root: false }
      });
      operatorRoutes.register(app.express, ctx);
      const res = await app.post('/api/operators', {
        username: 'bob',
        password: 'securepass123'
      });

      expect(res.status).toBe(403);
      await app.close();
    });
  });

  describe('GET /api/operators/:id', () => {
    it('returns operator by id for root', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operator.findUnique = vi.fn().mockResolvedValue({
        ...mockOperator,
        pack_bindings: []
      } as any);

      const app = createTestApp(ctx, {
        operator: { id: 'root-1', username: 'root', is_root: true }
      });
      operatorRoutes.register(app.express, ctx);
      const res = await app.get('/api/operators/op-1');

      expect(res.status).toBe(200);
      await app.close();
    });

    it('returns 404 for missing operator', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operator.findUnique = vi.fn().mockResolvedValue(null);

      const app = createTestApp(ctx, {
        operator: { id: 'root-1', username: 'root', is_root: true }
      });
      operatorRoutes.register(app.express, ctx);
      const res = await app.get('/api/operators/nonexistent');

      expect(res.status).toBe(404);
      await app.close();
    });
  });

  describe('PATCH /api/operators/:id', () => {
    it('updates operator for root', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operator.findUnique = vi.fn().mockResolvedValue(mockOperator as any);
      ctx.prisma.operator.update = vi.fn().mockResolvedValue({ ...mockOperator, display_name: 'New Name' } as any);

      const app = createTestApp(ctx, {
        operator: { id: 'root-1', username: 'root', is_root: true }
      });
      operatorRoutes.register(app.express, ctx);
      const res = await app.patch('/api/operators/op-1', { display_name: 'New Name' });

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('DELETE /api/operators/:id', () => {
    it('soft deletes operator for root', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operator.findUnique = vi.fn().mockResolvedValue(mockOperator as any);
      ctx.prisma.operator.update = vi.fn().mockResolvedValue({ ...mockOperator, status: 'disabled' } as any);

      const app = createTestApp(ctx, {
        operator: { id: 'root-1', username: 'root', is_root: true }
      });
      operatorRoutes.register(app.express, ctx);
      const res = await app.delete('/api/operators/op-1');

      expect(res.status).toBe(200);
      await app.close();
    });
  });
});
