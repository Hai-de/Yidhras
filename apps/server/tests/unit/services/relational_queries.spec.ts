import { describe, expect, it, vi } from 'vitest';

import {
  listAtmosphereNodes,
  listRelationalCircles,
  listRelationshipAdjustmentLogs
} from '../../../src/app/services/relational/queries.js';
import { createMockAppContext } from '../../helpers/mock_context.js';

describe('relational queries', () => {
  describe('listRelationalCircles', () => {
    it('delegates to repos.agent.listCircles', async () => {
      const ctx = createMockAppContext();
      (ctx.repos.agent.listCircles as any) = vi.fn().mockResolvedValue([
        { id: 'circle-1', name: 'Inner Circle' }
      ]);

      const result = await listRelationalCircles(ctx);
      expect(result).toEqual([{ id: 'circle-1', name: 'Inner Circle' }]);
      expect(ctx.repos.agent.listCircles).toHaveBeenCalled();
    });
  });

  describe('listAtmosphereNodes', () => {
    it('queries with owner_id filter', async () => {
      const ctx = createMockAppContext();
      (ctx.repos.agent.listAtmosphereNodes as any) = vi.fn().mockResolvedValue([
        { id: 'atmo-1', owner_id: 'agent-1' }
      ]);

      await listAtmosphereNodes(ctx, { owner_id: 'agent-1' });

      expect(ctx.repos.agent.listAtmosphereNodes).toHaveBeenCalledWith(
        expect.objectContaining({
          owner_id: 'agent-1'
        }),
        { created_at: 'desc' }
      );
    });

    it('queries without owner_id filter when empty', async () => {
      const ctx = createMockAppContext();
      (ctx.repos.agent.listAtmosphereNodes as any) = vi.fn().mockResolvedValue([]);

      await listAtmosphereNodes(ctx, {});

      expect(ctx.repos.agent.listAtmosphereNodes).toHaveBeenCalledWith(
        expect.not.objectContaining({ owner_id: expect.anything() }),
        { created_at: 'desc' }
      );
    });

    it('excludes expired nodes by default', async () => {
      const ctx = createMockAppContext();
      (ctx.repos.agent.listAtmosphereNodes as any) = vi.fn().mockResolvedValue([]);

      await listAtmosphereNodes(ctx, {});

      expect(ctx.repos.agent.listAtmosphereNodes).toHaveBeenCalledWith(
        expect.objectContaining({
          OR: expect.any(Array)
        }),
        { created_at: 'desc' }
      );
    });

    it('includes expired nodes when include_expired is true', async () => {
      const ctx = createMockAppContext();
      (ctx.repos.agent.listAtmosphereNodes as any) = vi.fn().mockResolvedValue([]);

      await listAtmosphereNodes(ctx, { include_expired: true });

      expect(ctx.repos.agent.listAtmosphereNodes).toHaveBeenCalledWith(
        expect.not.objectContaining({ OR: expect.anything() }),
        { created_at: 'desc' }
      );
    });
  });

  describe('listRelationshipAdjustmentLogs', () => {
    it('queries with required filters', async () => {
      const ctx = createMockAppContext();
      (ctx.repos.relationship.listRelationshipAdjustmentLogs as any) = vi.fn().mockResolvedValue([]);

      await listRelationshipAdjustmentLogs(ctx, {
        from_id: 'agent-1',
        to_id: 'agent-2',
        type: 'ally'
      });

      expect(ctx.repos.relationship.listRelationshipAdjustmentLogs).toHaveBeenCalledWith({
        where: { from_id: 'agent-1', to_id: 'agent-2', type: 'ally' },
        orderBy: { created_at: 'desc' },
        take: expect.any(Number)
      });
    });

    it('throws when from_id is missing', async () => {
      const ctx = createMockAppContext();

      await expect(
        listRelationshipAdjustmentLogs(ctx, { to_id: 'agent-2', type: 'ally' })
      ).rejects.toMatchObject({ status: 400, code: 'RELATIONSHIP_LOG_QUERY_INVALID' });
    });

    it('throws when to_id is missing', async () => {
      const ctx = createMockAppContext();

      await expect(
        listRelationshipAdjustmentLogs(ctx, { from_id: 'agent-1', type: 'ally' })
      ).rejects.toMatchObject({ status: 400, code: 'RELATIONSHIP_LOG_QUERY_INVALID' });
    });

    it('throws when type is missing', async () => {
      const ctx = createMockAppContext();

      await expect(
        listRelationshipAdjustmentLogs(ctx, { from_id: 'agent-1', to_id: 'agent-2' })
      ).rejects.toMatchObject({ status: 400, code: 'RELATIONSHIP_LOG_QUERY_INVALID' });
    });

    it('clamps limit to MAX', async () => {
      const ctx = createMockAppContext();
      (ctx.repos.relationship.listRelationshipAdjustmentLogs as any) = vi.fn().mockResolvedValue([]);

      await listRelationshipAdjustmentLogs(ctx, {
        from_id: 'agent-1',
        to_id: 'agent-2',
        type: 'ally',
        limit: 9999
      });

      expect(ctx.repos.relationship.listRelationshipAdjustmentLogs).toHaveBeenCalledWith(
        expect.objectContaining({ take: expect.any(Number) })
      );
    });

    it('throws for non-finite limit', async () => {
      const ctx = createMockAppContext();

      await expect(
        listRelationshipAdjustmentLogs(ctx, {
          from_id: 'a',
          to_id: 'b',
          type: 'c',
          limit: Number.NaN
        })
      ).rejects.toMatchObject({ status: 400 });
    });

    it('throws for zero limit', async () => {
      const ctx = createMockAppContext();

      await expect(
        listRelationshipAdjustmentLogs(ctx, {
          from_id: 'a',
          to_id: 'b',
          type: 'c',
          limit: 0
        })
      ).rejects.toMatchObject({ status: 400 });
    });
  });
});
