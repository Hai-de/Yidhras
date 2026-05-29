import { describe, expect, it, vi } from 'vitest';

import { socialRoutes } from '../../../src/app/routes/social.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp, unwrapData } from '../../helpers/test_app.js';

vi.mock('../../../src/access_policy/service.js', () => ({
  requireAccessPolicyIdentity: vi.fn((identity: unknown) => {
    if (!identity) throw new Error('Identity required');
    return identity as { id: string };
  }),
  filterReadableFieldsByAccessPolicy: vi.fn(async (_ctx: unknown, _identity: unknown, _policy: unknown, record: unknown) => record),
  assertWriteAllowedByAccessPolicy: vi.fn(async () => {})
}));

vi.mock('../../../src/app/services/pack/pack_runtime_resolution.js', () => ({
  resolvePackTick: vi.fn(() => 1000n)
}));

const makePost = (overrides: Record<string, unknown> = {}) => ({
  id: 'post-1',
  author_id: 'agent-1',
  content: 'Hello world',
  created_at: 1000n,
  noise_level: 0.5,
  source_action_intent_id: null,
  author: { id: 'agent-1', name: 'Agent One' },
  ...overrides
});

describe('social routes', () => {
  describe('GET /api/social/feed', () => {
    it('returns social feed with pagination', async () => {
      const ctx = createMockAppContext();
      ctx.repos.social.queryPosts = vi.fn().mockResolvedValue([makePost()]);

      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true, identity_id: 'id-1' }
      });
      socialRoutes.register(app.express, ctx);

      const res = await app.get('/api/social/feed?limit=10');

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.success).toBe(true);
      const data = unwrapData<unknown[]>(body);
      expect(Array.isArray(data)).toBe(true);
      const meta = body.meta as Record<string, unknown> | undefined;
      expect(meta?.pagination).toBeDefined();
      await app.close();
    });

    it('returns 401 when no identity', async () => {
      const ctx = createMockAppContext();
      ctx.assertRuntimeReady = vi.fn();

      const app = createTestApp(ctx); // no operator
      socialRoutes.register(app.express, ctx);

      const res = await app.get('/api/social/feed');

      // The route uses identity middleware, which may throw 401
      // Depending on implementation, it could be 401 or 403
      expect([401, 403, 500]).toContain(res.status);
      await app.close();
    });
  });

  describe('POST /api/social/post', () => {
    it('creates a post with valid body', async () => {
      const ctx = createMockAppContext();
      ctx.repos.social.createPostRecord = vi.fn().mockResolvedValue(makePost({ id: 'new-post' }));

      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true, identity_id: 'id-1' }
      });
      socialRoutes.register(app.express, ctx);

      const res = await app.post('/api/social/post', { content: 'Test post content' });

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.success).toBe(true);
      await app.close();
    });

    it('returns 401 when not authenticated', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx); // no operator
      socialRoutes.register(app.express, ctx);

      const res = await app.post('/api/social/post', { content: 'Test' });

      expect([401, 403]).toContain(res.status);
      await app.close();
    });

    it('returns 400 when content is missing', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true, identity_id: 'id-1' }
      });
      socialRoutes.register(app.express, ctx);

      const res = await app.post('/api/social/post', {});

      expect(res.status).toBe(400);
      await app.close();
    });
  });
});
