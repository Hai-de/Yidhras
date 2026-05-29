import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../src/utils/api_error.js';
import {
  createPackBinding,
  getOperatorPackIds,
  listPackBindings
} from '../../../src/app/services/operator/operator_pack_bindings.js';
import { createMockAppContext } from '../../helpers/mock_context.js';

describe('operator_pack_bindings', () => {
  describe('createPackBinding', () => {
    it('creates a new binding when none exists', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operatorPackBinding.findUnique.mockResolvedValue(null);
      ctx.prisma.operatorPackBinding.create.mockResolvedValue({
        id: 'binding-1',
        operator_id: 'op-1',
        pack_id: 'pack-1',
        binding_type: 'member',
        bound_at: 1000n,
        bound_by: 'admin-1',
        created_at: 1000n
      });

      const result = await createPackBinding(ctx, 'pack-1', 'op-1', 'member', 'admin-1', '127.0.0.1');

      expect(result.id).toBe('binding-1');
      expect(ctx.prisma.operatorPackBinding.findUnique).toHaveBeenCalledWith({
        where: { operator_id_pack_id: { operator_id: 'op-1', pack_id: 'pack-1' } }
      });
      expect(ctx.prisma.operatorPackBinding.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operator_id: 'op-1',
            pack_id: 'pack-1',
            binding_type: 'member',
            bound_by: 'admin-1'
          })
        })
      );
      // verify audit logging was triggered via repos
      expect(ctx.prisma.operatorAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operator_id: 'admin-1',
            pack_id: 'pack-1',
            action: 'bind_pack',
            target_id: 'op-1'
          })
        })
      );
    });

    it('throws 409 when binding already exists', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operatorPackBinding.findUnique.mockResolvedValue({
        id: 'existing',
        operator_id: 'op-1',
        pack_id: 'pack-1'
      });

      await expect(createPackBinding(ctx, 'pack-1', 'op-1', 'member'))
        .rejects.toThrow(ApiError);
      await expect(createPackBinding(ctx, 'pack-1', 'op-1', 'member'))
        .rejects.toMatchObject({ status: 409 });
    });
  });

  describe('listPackBindings', () => {
    it('returns bindings ordered by created_at with operator included', async () => {
      const ctx = createMockAppContext();
      const mockBindings = [
        { id: 'b1', operator_id: 'op-1', pack_id: 'pack-1', binding_type: 'owner', operator: { id: 'op-1', username: 'alice', is_root: true, display_name: 'Alice' } },
        { id: 'b2', operator_id: 'op-2', pack_id: 'pack-1', binding_type: 'member', operator: { id: 'op-2', username: 'bob', is_root: false, display_name: 'Bob' } }
      ];
      ctx.prisma.operatorPackBinding.findMany.mockResolvedValue(mockBindings);

      const result = await listPackBindings(ctx, 'pack-1');

      expect(result).toEqual(mockBindings);
      expect(ctx.prisma.operatorPackBinding.findMany).toHaveBeenCalledWith({
        where: { pack_id: 'pack-1' },
        include: {
          operator: { select: { id: true, username: true, is_root: true, display_name: true } }
        },
        orderBy: { created_at: 'asc' }
      });
    });
  });

  describe('getOperatorPackIds', () => {
    it('returns pack IDs for an operator', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operatorPackBinding.findMany.mockResolvedValue([
        { pack_id: 'pack-1' },
        { pack_id: 'pack-2' }
      ]);

      const result = await getOperatorPackIds(ctx, 'op-1');

      expect(result).toEqual(['pack-1', 'pack-2']);
      expect(ctx.prisma.operatorPackBinding.findMany).toHaveBeenCalledWith({
        where: { operator_id: 'op-1' },
        select: { pack_id: true }
      });
    });

    it('returns empty array when no bindings', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operatorPackBinding.findMany.mockResolvedValue([]);

      const result = await getOperatorPackIds(ctx, 'op-none');

      expect(result).toEqual([]);
    });
  });
});
