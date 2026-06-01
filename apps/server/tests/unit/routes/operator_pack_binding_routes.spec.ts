import { describe, expect, it, vi } from 'vitest';

import { packBindingRoutes } from '../../../src/app/routes/operator_pack_bindings.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp } from '../../helpers/test_app.js';

vi.mock('../../../src/app/services/operator/operator_pack_bindings.js', () => ({
  createPackBinding: vi.fn(async () => ({
    id: 'binding-1',
    pack_id: 'pack-1',
    operator_id: 'op-2',
    binding_type: 'member',
    status: 'active',
    created_at: 100n
  })),
  listPackBindings: vi.fn(async () => [
    { id: 'binding-1', pack_id: 'pack-1', operator_id: 'op-2', binding_type: 'member', status: 'active' }
  ]),
  listMyPackBindings: vi.fn(async () => [
    { pack_id: 'pack-1', binding_type: 'member', status: 'active' }
  ]),
  updatePackBinding: vi.fn(async () => ({
    id: 'binding-1',
    pack_id: 'pack-1',
    operator_id: 'op-2',
    binding_type: 'admin',
    status: 'active'
  })),
  removePackBinding: vi.fn(async () => ({ id: 'binding-1', status: 'removed' }))
}));

describe('operator pack binding routes', () => {
  describe('POST /api/packs/:packId/bindings', () => {
    it('creates pack binding', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      packBindingRoutes.register(app.express, ctx);

      const res = await app.post('/api/packs/pack-1/bindings', {
        operator_id: 'op-2',
        binding_type: 'member'
      });

      expect(res.status).toBe(200);
      await app.close();
    });

    it('rejects unauthenticated request', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx);
      packBindingRoutes.register(app.express, ctx);

      const res = await app.post('/api/packs/pack-1/bindings', {
        operator_id: 'op-2',
        binding_type: 'member'
      });

      expect(res.status).toBe(401);
      await app.close();
    });
  });

  describe('GET /api/packs/:packId/bindings', () => {
    it('lists pack bindings', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      packBindingRoutes.register(app.express, ctx);

      const res = await app.get('/api/packs/pack-1/bindings');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('PATCH /api/packs/:packId/bindings/:operatorId', () => {
    it('updates pack binding', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      packBindingRoutes.register(app.express, ctx);

      const res = await app.patch('/api/packs/pack-1/bindings/op-2', {
        binding_type: 'admin'
      });

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('DELETE /api/packs/:packId/bindings/:operatorId', () => {
    it('removes pack binding', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      packBindingRoutes.register(app.express, ctx);

      const res = await app.delete('/api/packs/pack-1/bindings/op-2');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/me/bindings', () => {
    it('lists current operator bindings', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'user', is_root: false }
      });
      packBindingRoutes.register(app.express, ctx);

      const res = await app.get('/api/me/bindings');

      expect(res.status).toBe(200);
      await app.close();
    });
  });
});
