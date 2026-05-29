import { describe, expect, it, vi } from 'vitest';

import {
  createOperator,
  deleteOperator,
  getOperator,
  listOperators,
  updateOperator
} from '../../../src/app/services/operator/operators.js';
import { createMockAppContext } from '../../helpers/mock_context.js';

const mockOperator = {
  id: 'op-1',
  identity_id: 'id-1',
  username: 'alice',
  password_hash: '$2b$12$hashedpassword',
  is_root: false,
  status: 'active',
  display_name: 'Alice',
  created_at: 1000n,
  updated_at: 1000n
};

describe('operators service', () => {
  describe('createOperator', () => {
    it('creates operator when username is available', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operator.findUnique = vi.fn().mockResolvedValue(null);
      ctx.prisma.identity.create = vi.fn().mockResolvedValue({ id: 'id-new' } as any);
      ctx.prisma.operator.create = vi.fn().mockResolvedValue({
        id: 'op-new',
        username: 'bob',
        is_root: false,
        status: 'active',
        display_name: null
      } as any);

      const result = await createOperator(ctx, { username: 'bob', password: 'secret123' });

      expect(result.id).toBe('op-new');
      expect(ctx.prisma.identity.create).toHaveBeenCalledOnce();
      expect(ctx.prisma.operator.create).toHaveBeenCalledOnce();
    });

    it('throws 409 when username is taken', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operator.findUnique = vi.fn().mockResolvedValue(mockOperator as any);

      await expect(
        createOperator(ctx, { username: 'alice', password: 'secret' })
      ).rejects.toMatchObject({ status: 409, code: 'USERNAME_TAKEN' });
    });

    it('creates operator with is_root true', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operator.findUnique = vi.fn().mockResolvedValue(null);
      ctx.prisma.identity.create = vi.fn().mockResolvedValue({ id: 'id-root' } as any);
      ctx.prisma.operator.create = vi.fn().mockResolvedValue({
        id: 'op-root',
        username: 'root',
        is_root: true,
        status: 'active'
      } as any);

      const result = await createOperator(ctx, { username: 'root', password: 'rootpass', is_root: true });
      expect(result.id).toBe('op-root');
    });
  });

  describe('listOperators', () => {
    it('returns all operators', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operator.findMany = vi.fn().mockResolvedValue([mockOperator] as any);

      const result = await listOperators(ctx);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getOperator', () => {
    it('returns operator by id', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operator.findUnique = vi.fn().mockResolvedValue({
        ...mockOperator,
        pack_bindings: []
      } as any);

      const result = await getOperator(ctx, 'op-1');
      expect(result.id).toBe('op-1');
    });

    it('throws 404 when not found', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operator.findUnique = vi.fn().mockResolvedValue(null);

      await expect(getOperator(ctx, 'nonexistent')).rejects.toMatchObject({
        status: 404,
        code: 'OPERATOR_NOT_FOUND'
      });
    });
  });

  describe('updateOperator', () => {
    it('updates display_name', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operator.findUnique = vi.fn().mockResolvedValue(mockOperator as any);
      ctx.prisma.operator.update = vi.fn().mockResolvedValue({ ...mockOperator, display_name: 'New Name' } as any);

      const result = await updateOperator(ctx, 'op-1', { display_name: 'New Name' });
      expect(ctx.prisma.operator.update).toHaveBeenCalled();
    });

    it('throws 404 when operator not found', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operator.findUnique = vi.fn().mockResolvedValue(null);

      await expect(
        updateOperator(ctx, 'nonexistent', { display_name: 'X' })
      ).rejects.toMatchObject({ status: 404, code: 'OPERATOR_NOT_FOUND' });
    });

    it('throws 400 for invalid status', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operator.findUnique = vi.fn().mockResolvedValue(mockOperator as any);

      await expect(
        updateOperator(ctx, 'op-1', { status: 'invalid_status' })
      ).rejects.toMatchObject({ status: 400, code: 'OPERATOR_INVALID' });
    });
  });

  describe('deleteOperator', () => {
    it('sets operator status to disabled', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operator.findUnique = vi.fn().mockResolvedValue(mockOperator as any);
      ctx.prisma.operator.update = vi.fn().mockResolvedValue({ ...mockOperator, status: 'disabled' } as any);

      await deleteOperator(ctx, 'op-1', 'admin-1');

      expect(ctx.prisma.operator.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'op-1' },
          data: expect.objectContaining({ status: 'disabled' })
        })
      );
    });

    it('throws 404 when operator not found', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operator.findUnique = vi.fn().mockResolvedValue(null);

      await expect(deleteOperator(ctx, 'nonexistent')).rejects.toMatchObject({
        status: 404,
        code: 'OPERATOR_NOT_FOUND'
      });
    });
  });
});
