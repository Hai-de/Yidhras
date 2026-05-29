import { describe, expect, it, vi } from 'vitest';

import {
  createIdentityBinding,
  expireIdentityBinding,
  queryIdentityBindings,
  unbindIdentityBinding
} from '../../../src/app/services/identity/identity.js';
import { createMockAppContext } from '../../helpers/mock_context.js';

const defaultDeps = {
  parseOptionalTick: (value: unknown, _field: string): bigint | null => {
    if (value === null || value === undefined) return null;
    return BigInt(value as number | string);
  }
};

describe('identity service', () => {
  describe('createIdentityBinding', () => {
    it('creates binding with agent_id', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.identityNodeBinding.findFirst = vi.fn().mockResolvedValue(null);
      ctx.prisma.identityNodeBinding.create = vi.fn().mockResolvedValue({
        id: 'binding-1',
        identity_id: 'id-1',
        agent_id: 'agent-1',
        role: 'active',
        status: 'active'
      } as any);

      const result = await createIdentityBinding(ctx, {
        identity_id: 'id-1',
        agent_id: 'agent-1',
        role: 'active'
      }, defaultDeps);

      expect(result).toBeDefined();
      expect(ctx.prisma.identityNodeBinding.create).toHaveBeenCalled();
    });

    it('throws when identity_id is missing', async () => {
      const ctx = createMockAppContext();

      await expect(
        createIdentityBinding(ctx, { role: 'active' }, defaultDeps)
      ).rejects.toMatchObject({ status: 400, code: 'IDENTITY_BINDING_INVALID' });
    });

    it('throws when role is invalid', async () => {
      const ctx = createMockAppContext();

      await expect(
        createIdentityBinding(ctx, { identity_id: 'id-1', role: 'invalid' }, defaultDeps)
      ).rejects.toMatchObject({ status: 400, code: 'IDENTITY_BINDING_INVALID' });
    });

    it('throws when both agent_id and atmosphere_node_id are provided', async () => {
      const ctx = createMockAppContext();

      await expect(
        createIdentityBinding(ctx, {
          identity_id: 'id-1',
          agent_id: 'a-1',
          atmosphere_node_id: 'atmo-1',
          role: 'active'
        }, defaultDeps)
      ).rejects.toMatchObject({ status: 400, code: 'IDENTITY_BINDING_INVALID' });
    });

    it('throws when neither agent_id nor atmosphere_node_id is provided', async () => {
      const ctx = createMockAppContext();

      await expect(
        createIdentityBinding(ctx, { identity_id: 'id-1', role: 'active' }, defaultDeps)
      ).rejects.toMatchObject({ status: 400, code: 'IDENTITY_BINDING_INVALID' });
    });

    it('throws 409 when active binding already exists', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.identityNodeBinding.findFirst = vi.fn().mockResolvedValue({
        id: 'existing-binding'
      } as any);

      await expect(
        createIdentityBinding(ctx, {
          identity_id: 'id-1',
          agent_id: 'agent-1',
          role: 'active'
        }, defaultDeps)
      ).rejects.toMatchObject({ status: 409, code: 'IDENTITY_BINDING_CONFLICT' });
    });
  });

  describe('queryIdentityBindings', () => {
    it('queries bindings by identity_id', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.identityNodeBinding.findMany = vi.fn().mockResolvedValue([
        { id: 'b1', identity_id: 'id-1', role: 'active' }
      ] as any);

      const result = await queryIdentityBindings(ctx, { identity_id: 'id-1' });

      expect(result).toHaveLength(1);
      expect(ctx.prisma.identityNodeBinding.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ identity_id: 'id-1' })
        })
      );
    });

    it('throws when identity_id is missing', async () => {
      const ctx = createMockAppContext();

      await expect(
        queryIdentityBindings(ctx, {})
      ).rejects.toMatchObject({ status: 400, code: 'IDENTITY_BINDING_INVALID' });
    });

    it('throws when both agent_id and atmosphere_node_id are provided', async () => {
      const ctx = createMockAppContext();

      await expect(
        queryIdentityBindings(ctx, {
          identity_id: 'id-1',
          agent_id: 'a-1',
          atmosphere_node_id: 'atmo-1'
        })
      ).rejects.toMatchObject({ status: 400, code: 'IDENTITY_BINDING_INVALID' });
    });

    it('excludes expired bindings by default', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.identityNodeBinding.findMany = vi.fn().mockResolvedValue([]);

      await queryIdentityBindings(ctx, { identity_id: 'id-1' });

      expect(ctx.prisma.identityNodeBinding.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { not: 'expired' } })
        })
      );
    });
  });

  describe('unbindIdentityBinding', () => {
    it('sets binding status to inactive by default', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.identityNodeBinding.findUnique = vi.fn().mockResolvedValue({ id: 'b-1' } as any);
      ctx.prisma.identityNodeBinding.update = vi.fn().mockResolvedValue({ id: 'b-1', status: 'inactive' } as any);

      await unbindIdentityBinding(ctx, { binding_id: 'b-1' });

      expect(ctx.prisma.identityNodeBinding.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'b-1' },
          data: expect.objectContaining({ status: 'inactive' })
        })
      );
    });

    it('throws when binding_id is missing', async () => {
      const ctx = createMockAppContext();

      await expect(
        unbindIdentityBinding(ctx, {})
      ).rejects.toMatchObject({ status: 400, code: 'IDENTITY_BINDING_INVALID' });
    });

    it('throws 404 when binding not found', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.identityNodeBinding.findUnique = vi.fn().mockResolvedValue(null);

      await expect(
        unbindIdentityBinding(ctx, { binding_id: 'nonexistent' })
      ).rejects.toMatchObject({ status: 404, code: 'IDENTITY_BINDING_NOT_FOUND' });
    });
  });

  describe('expireIdentityBinding', () => {
    it('sets binding status to expired', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.identityNodeBinding.findUnique = vi.fn().mockResolvedValue({ id: 'b-1' } as any);
      ctx.prisma.identityNodeBinding.update = vi.fn().mockResolvedValue({ id: 'b-1', status: 'expired' } as any);

      await expireIdentityBinding(ctx, { binding_id: 'b-1' });

      expect(ctx.prisma.identityNodeBinding.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'b-1' },
          data: expect.objectContaining({ status: 'expired' })
        })
      );
    });

    it('throws when binding_id is missing', async () => {
      const ctx = createMockAppContext();

      await expect(
        expireIdentityBinding(ctx, {})
      ).rejects.toMatchObject({ status: 400, code: 'IDENTITY_BINDING_INVALID' });
    });

    it('throws 404 when binding not found', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.identityNodeBinding.findUnique = vi.fn().mockResolvedValue(null);

      await expect(
        expireIdentityBinding(ctx, { binding_id: 'nonexistent' })
      ).rejects.toMatchObject({ status: 404, code: 'IDENTITY_BINDING_NOT_FOUND' });
    });
  });
});
