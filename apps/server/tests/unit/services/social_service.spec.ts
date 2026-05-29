import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../../src/app/context.js';
import { listSocialFeed, createSocialPost } from '../../../src/app/services/social/social.js';
import { createMockAppContext } from '../../helpers/mock_context.js';

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

const mockIdentity = { id: 'identity-1', type: 'user' as const };

describe('social service', () => {
  let ctx: AppContext;

  beforeEach(() => {
    ctx = createMockAppContext();
  });

  describe('listSocialFeed', () => {
    it('returns posts with default limit', async () => {
      const posts = [makePost({ id: 'post-1' }), makePost({ id: 'post-2' })];
      ctx.repos.social.queryPosts = vi.fn().mockResolvedValue(posts);

      const result = await listSocialFeed(ctx, mockIdentity);

      expect(result.items).toHaveLength(2);
      expect(result.page_info.has_next_page).toBe(false);
      expect(result.page_info.next_cursor).toBeNull();
      expect(ctx.repos.social.queryPosts).toHaveBeenCalledOnce();
    });

    it('applies custom limit and truncates to MAX_SOCIAL_FEED_LIMIT', async () => {
      ctx.repos.social.queryPosts = vi.fn().mockResolvedValue([]);

      await listSocialFeed(ctx, mockIdentity, { limit: 50 });

      expect(ctx.repos.social.queryPosts).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.any(Object) })
      );
    });

    it('throws on invalid limit (zero)', async () => {
      await expect(
        listSocialFeed(ctx, mockIdentity, { limit: 0 })
      ).rejects.toMatchObject({ code: 'SOCIAL_FEED_QUERY_INVALID' });
    });

    it('throws on invalid limit (NaN string)', async () => {
      await expect(
        listSocialFeed(ctx, mockIdentity, { limit: 'abc' })
      ).rejects.toMatchObject({ code: 'SOCIAL_FEED_QUERY_INVALID' });
    });

    it('applies author_id filter', async () => {
      ctx.repos.social.queryPosts = vi.fn().mockResolvedValue([]);

      await listSocialFeed(ctx, mockIdentity, { author_id: 'agent-1' });

      expect(ctx.repos.social.queryPosts).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({ author_id: 'agent-1' })
            ])
          })
        })
      );
    });

    it('throws when author_id and agent_id conflict', async () => {
      await expect(
        listSocialFeed(ctx, mockIdentity, { author_id: 'agent-1', agent_id: 'agent-2' })
      ).rejects.toMatchObject({ code: 'SOCIAL_FEED_QUERY_INVALID' });
    });

    it('applies from_tick and to_tick filters', async () => {
      ctx.repos.social.queryPosts = vi.fn().mockResolvedValue([]);

      await listSocialFeed(ctx, mockIdentity, { from_tick: 100n, to_tick: 200n });

      expect(ctx.repos.social.queryPosts).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                created_at: expect.objectContaining({ gte: 100n, lte: 200n })
              })
            ])
          })
        })
      );
    });

    it('throws when from_tick > to_tick', async () => {
      await expect(
        listSocialFeed(ctx, mockIdentity, { from_tick: 300n, to_tick: 100n })
      ).rejects.toMatchObject({ code: 'SOCIAL_FEED_QUERY_INVALID' });
    });

    it('applies keyword filter', async () => {
      ctx.repos.social.queryPosts = vi.fn().mockResolvedValue([]);

      await listSocialFeed(ctx, mockIdentity, { keyword: 'search term' });

      expect(ctx.repos.social.queryPosts).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({ content: { contains: 'search term' } })
            ])
          })
        })
      );
    });

    it('applies signal_min and signal_max filters', async () => {
      ctx.repos.social.queryPosts = vi.fn().mockResolvedValue([]);

      await listSocialFeed(ctx, mockIdentity, { signal_min: 0.5, signal_max: 0.5 });

      const callArgs = (ctx.repos.social.queryPosts as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.where.noise_level).toBeDefined();
      expect(callArgs.where.noise_level.gte).toBeCloseTo(0.5);
      expect(callArgs.where.noise_level.lte).toBeCloseTo(0.5);
    });

    it('throws on invalid signal filter', async () => {
      await expect(
        listSocialFeed(ctx, mockIdentity, { signal_min: 1.5 })
      ).rejects.toMatchObject({ code: 'SOCIAL_FEED_QUERY_INVALID' });
    });

    it('applies circle_id filter', async () => {
      ctx.repos.social.queryPosts = vi.fn().mockResolvedValue([]);

      await listSocialFeed(ctx, mockIdentity, { circle_id: 'circle-1' });

      expect(ctx.repos.social.queryPosts).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                author: { circle_memberships: { some: { circle_id: 'circle-1' } } }
              })
            ])
          })
        })
      );
    });

    it('uses signal sort order', async () => {
      ctx.repos.social.queryPosts = vi.fn().mockResolvedValue([]);

      await listSocialFeed(ctx, mockIdentity, { sort: 'signal' });

      expect(ctx.repos.social.queryPosts).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { noise_level: 'asc' },
            { created_at: 'desc' },
            { id: 'desc' }
          ]
        })
      );
    });

    it('throws on invalid sort value', async () => {
      await expect(
        listSocialFeed(ctx, mockIdentity, { sort: 'invalid' })
      ).rejects.toMatchObject({ code: 'SOCIAL_FEED_QUERY_INVALID' });
    });

    it('detects has_next_page when posts exceed limit', async () => {
      const posts = Array.from({ length: 21 }, (_, i) => makePost({ id: `post-${i}`, created_at: BigInt(1000 + i) }));
      ctx.repos.social.queryPosts = vi.fn().mockResolvedValue(posts);

      const result = await listSocialFeed(ctx, mockIdentity, { limit: 20 });

      expect(result.items).toHaveLength(20);
      expect(result.page_info.has_next_page).toBe(true);
      expect(result.page_info.next_cursor).not.toBeNull();
    });

    it('handles empty result set', async () => {
      ctx.repos.social.queryPosts = vi.fn().mockResolvedValue([]);

      const result = await listSocialFeed(ctx, mockIdentity);

      expect(result.items).toHaveLength(0);
      expect(result.page_info.has_next_page).toBe(false);
    });
  });

  describe('createSocialPost', () => {
    it('creates a post with valid content', async () => {
      const createdPost = makePost({ id: 'new-post', content: 'Test content' });
      ctx.repos.social.createPostRecord = vi.fn().mockResolvedValue(createdPost);

      const result = await createSocialPost(ctx, mockIdentity, 'Test content');

      expect(result).toBeDefined();
      expect((result as Record<string, unknown>).id).toBe('new-post');
      expect(ctx.repos.social.createPostRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          author_id: 'identity-1',
          content: 'Test content'
        })
      );
    });

    it('throws when content is empty', async () => {
      await expect(
        createSocialPost(ctx, mockIdentity, '')
      ).rejects.toMatchObject({ code: 'SOCIAL_POST_INVALID' });
    });

    it('throws when content is only whitespace', async () => {
      await expect(
        createSocialPost(ctx, mockIdentity, '   ')
      ).rejects.toMatchObject({ code: 'SOCIAL_POST_INVALID' });
    });

    it('throws when content is undefined', async () => {
      await expect(
        createSocialPost(ctx, mockIdentity, undefined)
      ).rejects.toMatchObject({ code: 'SOCIAL_POST_INVALID' });
    });

    it('includes source_action_intent_id when provided', async () => {
      ctx.repos.social.createPostRecord = vi.fn().mockResolvedValue(makePost());

      await createSocialPost(ctx, mockIdentity, 'content', { source_action_intent_id: 'intent-1' });

      expect(ctx.repos.social.createPostRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          source_action_intent_id: 'intent-1'
        })
      );
    });

    it('defaults source_action_intent_id to null', async () => {
      ctx.repos.social.createPostRecord = vi.fn().mockResolvedValue(makePost());

      await createSocialPost(ctx, mockIdentity, 'content');

      expect(ctx.repos.social.createPostRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          source_action_intent_id: null
        })
      );
    });
  });
});
