import { describe, expect, it, vi } from 'vitest';

import {
  createOperatorGrant,
  listOperatorGrants,
  revokeOperatorGrant
} from '../../../src/app/services/operator/operator_grants.js';
import { createMockAppContext } from '../../helpers/mock_context.js';

describe('operator_grants service', () => {
  describe('createOperatorGrant', () => {
    it('creates a grant with required fields', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operatorGrant.create = vi.fn().mockResolvedValue({
        id: 'grant-1',
        giver_operator_id: 'op-1',
        receiver_identity_id: 'id-1',
        pack_id: 'pack-1',
        capability_key: 'perceive.agent.context',
        scope_json: null,
        revocable: true,
        expires_at: null,
        created_at: 1000n
      } as Record<string, unknown>);

      const result = await createOperatorGrant(ctx, 'pack-1', 'op-1', 'id-1', 'perceive.agent.context');

      expect(result.id).toBe('grant-1');
      expect(ctx.prisma.operatorGrant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            giver_operator_id: 'op-1',
            receiver_identity_id: 'id-1',
            pack_id: 'pack-1',
            capability_key: 'perceive.agent.context',
            revocable: true
          })
        })
      );
    });

    it('throws when expires_at is in the past', async () => {
      const ctx = createMockAppContext();

      // packRuntime.getCurrentTick() returns 1000n by default from mock context
      await expect(
        createOperatorGrant(ctx, 'pack-1', 'op-1', 'id-1', 'perceive.agent.context', {
          expires_at: 500n // before current tick 1000n
        })
      ).rejects.toMatchObject({ status: 400, code: 'GRANT_INVALID' });
    });

    it('creates grant with scope_json and expires_at in future', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operatorGrant.create = vi.fn().mockResolvedValue({ id: 'grant-2' } as Record<string, unknown>);

      await createOperatorGrant(ctx, 'pack-1', 'op-1', 'id-1', 'perceive.agent.context', {
        scope_json: { pack_ids: ['pack-1'] },
        revocable: false,
        expires_at: 9999n
      });

      expect(ctx.prisma.operatorGrant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scope_json: { pack_ids: ['pack-1'] },
            revocable: false,
            expires_at: 9999n
          })
        })
      );
    });

    it('logs audit after creation', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operatorGrant.create = vi.fn().mockResolvedValue({ id: 'grant-3' } as Record<string, unknown>);

      await createOperatorGrant(ctx, 'pack-1', 'op-1', 'id-1', 'mutate.agent.snr', undefined, '10.0.0.1');

      expect(ctx.prisma.operatorAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operator_id: 'op-1',
            pack_id: 'pack-1',
            action: 'grant_capability',
            target_id: 'id-1'
          })
        })
      );
    });
  });

  describe('listOperatorGrants', () => {
    it('returns grants for operator in pack', async () => {
      const ctx = createMockAppContext();
      const mockGrants = [
        { id: 'g1', capability_key: 'perceive.agent.context' },
        { id: 'g2', capability_key: 'mutate.agent.snr' }
      ];
      ctx.prisma.operatorGrant.findMany = vi.fn().mockResolvedValue(mockGrants as Record<string, unknown>);

      const result = await listOperatorGrants(ctx, 'pack-1', 'op-1');

      expect(result).toEqual(mockGrants);
      expect(ctx.prisma.operatorGrant.findMany).toHaveBeenCalledWith({
        where: {
          giver_operator_id: 'op-1',
          pack_id: 'pack-1'
        },
        orderBy: { created_at: 'desc' }
      });
    });
  });

  describe('revokeOperatorGrant', () => {
    it('revokes grant when operator is the owner', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operatorGrant.findUnique = vi.fn().mockResolvedValue({
        id: 'grant-1',
        giver_operator_id: 'op-1',
        pack_id: 'pack-1',
        capability_key: 'perceive.agent.context'
      } as Record<string, unknown>);
      ctx.prisma.operatorGrant.delete = vi.fn().mockResolvedValue({} as Record<string, unknown>);

      const result = await revokeOperatorGrant(ctx, 'grant-1', 'op-1');

      expect(result).toEqual({ revoked: true });
      expect(ctx.prisma.operatorGrant.delete).toHaveBeenCalledWith({
        where: { id: 'grant-1' }
      });
    });

    it('throws 404 when grant not found', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operatorGrant.findUnique = vi.fn().mockResolvedValue(null);

      await expect(
        revokeOperatorGrant(ctx, 'nonexistent', 'op-1')
      ).rejects.toMatchObject({ status: 404, code: 'GRANT_NOT_FOUND' });
    });

    it('throws 403 when operator is not the grant owner', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operatorGrant.findUnique = vi.fn().mockResolvedValue({
        id: 'grant-1',
        giver_operator_id: 'op-other',
        pack_id: 'pack-1',
        capability_key: 'perceive.agent.context'
      } as Record<string, unknown>);

      await expect(
        revokeOperatorGrant(ctx, 'grant-1', 'op-1')
      ).rejects.toMatchObject({ status: 403, code: 'GRANT_INVALID' });
    });

    it('logs audit after revocation', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operatorGrant.findUnique = vi.fn().mockResolvedValue({
        id: 'grant-1',
        giver_operator_id: 'op-1',
        pack_id: 'pack-1',
        capability_key: 'mutate.agent.snr'
      } as Record<string, unknown>);
      ctx.prisma.operatorGrant.delete = vi.fn().mockResolvedValue({} as Record<string, unknown>);

      await revokeOperatorGrant(ctx, 'grant-1', 'op-1', '192.168.1.1');

      expect(ctx.prisma.operatorAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operator_id: 'op-1',
            pack_id: 'pack-1',
            action: 'revoke_grant',
            target_id: 'grant-1',
            client_ip: '192.168.1.1'
          })
        })
      );
    });
  });
});
