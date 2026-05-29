import { describe, expect, it, vi } from 'vitest';

import { createIdentityRoutes } from '../../../src/app/routes/identity.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp, unwrapData } from '../../helpers/test_app.js';

describe('identity routes', () => {
  const parseOptionalTick = (value: unknown, _fieldName: string): bigint | null => {
    if (value === null || value === undefined) return null;
    return BigInt(value as number | string);
  };

  describe('POST /api/identity/register', () => {
    it('requires auth — returns 401 without operator', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx);
      const identityRoutes = createIdentityRoutes({ parseOptionalTick });
      identityRoutes.register(app.express, ctx);
      const res = await app.post('/api/identity/register', { id: 'id-1', type: 'human' });

      expect(res.status).toBe(401);
      await app.close();
    });

    it('registers identity with valid input', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.identity.create = vi.fn().mockResolvedValue({
        id: 'id-1',
        type: 'human',
        name: 'Alice',
        provider: 'm2',
        status: 'active',
        claims: null,
        metadata: null,
        pack_id: null,
        created_at: 0n,
        updated_at: 0n
      } as any);

      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      const identityRoutes = createIdentityRoutes({ parseOptionalTick });
      identityRoutes.register(app.express, ctx);
      const res = await app.post('/api/identity/register', {
        id: 'id-1',
        type: 'user',
        name: 'Alice'
      });

      expect(res.status).toBe(200);
      const data = unwrapData<{ id: string }>(res.body);
      expect(data.id).toBe('id-1');
      await app.close();
    });

    it('returns 400 for invalid body', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      const identityRoutes = createIdentityRoutes({ parseOptionalTick });
      identityRoutes.register(app.express, ctx);
      const res = await app.post('/api/identity/register', {});

      expect(res.status).toBe(400);
      await app.close();
    });
  });

  describe('POST /api/identity/bindings/query', () => {
    it('queries bindings with valid input', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.identityNodeBinding.findMany = vi.fn().mockResolvedValue([
        { id: 'b-1', identity_id: 'id-1', role: 'active', status: 'active' }
      ] as any);

      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      const identityRoutes = createIdentityRoutes({ parseOptionalTick });
      identityRoutes.register(app.express, ctx);
      const res = await app.post('/api/identity/bindings/query', {
        identity_id: 'id-1'
      });

      expect(res.status).toBe(200);
      await app.close();
    });

    it('returns 400 for missing identity_id', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      const identityRoutes = createIdentityRoutes({ parseOptionalTick });
      identityRoutes.register(app.express, ctx);
      const res = await app.post('/api/identity/bindings/query', {});

      expect(res.status).toBe(400);
      await app.close();
    });
  });
});
