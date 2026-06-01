import { describe, expect, it, vi } from 'vitest';

import { grantRoutes } from '../../../src/app/routes/operator_grants.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp } from '../../helpers/test_app.js';

vi.mock('../../../src/app/services/operator/operator_grants.js', () => ({
  createOperatorGrant: vi.fn(async () => ({
    id: 'grant-1',
    pack_id: 'pack-1',
    grantor_id: 'op-1',
    receiver_identity_id: 'id-2',
    capability_key: 'view',
    status: 'active',
    created_at: 100n
  })),
  listOperatorGrants: vi.fn(async () => [
    { id: 'grant-1', capability_key: 'view', status: 'active' }
  ]),
  revokeOperatorGrant: vi.fn(async () => ({ id: 'grant-1', status: 'revoked' }))
}));

describe('operator grant routes', () => {
  describe('POST /api/packs/:packId/grants', () => {
    it('creates operator grant', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      grantRoutes.register(app.express, ctx);

      const res = await app.post('/api/packs/pack-1/grants', {
        receiver_identity_id: 'id-2',
        capability_key: 'view'
      });

      expect(res.status).toBe(200);
      await app.close();
    });

    it('rejects unauthenticated request', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx);
      grantRoutes.register(app.express, ctx);

      const res = await app.post('/api/packs/pack-1/grants', {
        receiver_identity_id: 'id-2',
        capability_key: 'view'
      });

      expect(res.status).toBe(401);
      await app.close();
    });
  });

  describe('GET /api/packs/:packId/grants', () => {
    it('lists operator grants', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      grantRoutes.register(app.express, ctx);

      const res = await app.get('/api/packs/pack-1/grants');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('DELETE /api/packs/:packId/grants/:grantId', () => {
    it('revokes operator grant', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      grantRoutes.register(app.express, ctx);

      const res = await app.delete('/api/packs/pack-1/grants/grant-1');

      expect(res.status).toBe(200);
      await app.close();
    });
  });
});
