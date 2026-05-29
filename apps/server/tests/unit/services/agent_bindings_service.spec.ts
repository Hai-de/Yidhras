import { describe, expect, it, vi } from 'vitest';

import {
  createAgentBinding,
  listAgentOperators,
  unbindAgent
} from '../../../src/app/services/operator/operator_agent_bindings.js';
import { createMockAppContext } from '../../helpers/mock_context.js';

describe('operator_agent_bindings service', () => {
  describe('createAgentBinding', () => {
    it('creates binding when none exists', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.identityNodeBinding.findFirst = vi.fn().mockResolvedValue(null);
      ctx.prisma.identityNodeBinding.create = vi.fn().mockResolvedValue({
        id: 'binding-1',
        identity_id: 'id-1',
        agent_id: 'agent-1',
        role: 'active',
        status: 'active'
      } as any);

      const result = await createAgentBinding(ctx, 'agent-1', 'id-1', 'active', 'op-1');

      expect(result.id).toBe('binding-1');
      expect(ctx.prisma.identityNodeBinding.create).toHaveBeenCalled();
    });

    it('throws 409 when binding already exists', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.identityNodeBinding.findFirst = vi.fn().mockResolvedValue({ id: 'existing' } as any);

      await expect(
        createAgentBinding(ctx, 'agent-1', 'id-1', 'active')
      ).rejects.toMatchObject({ status: 409, code: 'BINDING_ALREADY_EXISTS' });
    });

    it('logs audit after creation', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.identityNodeBinding.findFirst = vi.fn().mockResolvedValue(null);
      ctx.prisma.identityNodeBinding.create = vi.fn().mockResolvedValue({ id: 'b-1' } as any);

      await createAgentBinding(ctx, 'agent-1', 'id-1', 'active', 'op-admin', '10.0.0.1');

      expect(ctx.prisma.operatorAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operator_id: 'op-admin',
            action: 'bind_agent',
            target_id: 'agent-1',
            client_ip: '10.0.0.1'
          })
        })
      );
    });
  });

  describe('unbindAgent', () => {
    it('sets binding status to inactive', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.identityNodeBinding.findFirst = vi.fn().mockResolvedValue({ id: 'b-1' } as any);
      ctx.prisma.identityNodeBinding.update = vi.fn().mockResolvedValue({ id: 'b-1', status: 'inactive' } as any);

      const result = await unbindAgent(ctx, 'agent-1', 'id-1', 'op-1');

      expect(result).toEqual({ unbound: true });
      expect(ctx.prisma.identityNodeBinding.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'b-1' },
          data: expect.objectContaining({ status: 'inactive' })
        })
      );
    });

    it('throws 404 when binding not found', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.identityNodeBinding.findFirst = vi.fn().mockResolvedValue(null);

      await expect(
        unbindAgent(ctx, 'agent-1', 'id-1')
      ).rejects.toMatchObject({ status: 404, code: 'BINDING_NOT_FOUND' });
    });

    it('logs audit after unbinding', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.identityNodeBinding.findFirst = vi.fn().mockResolvedValue({ id: 'b-1' } as any);
      ctx.prisma.identityNodeBinding.update = vi.fn().mockResolvedValue({} as any);

      await unbindAgent(ctx, 'agent-1', 'id-1', 'op-1', '192.168.1.1');

      expect(ctx.prisma.operatorAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operator_id: 'op-1',
            action: 'unbind_agent',
            target_id: 'agent-1',
            client_ip: '192.168.1.1'
          })
        })
      );
    });
  });

  describe('listAgentOperators', () => {
    it('returns filtered user-type operators', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.identityNodeBinding.findMany = vi.fn().mockResolvedValue([
        {
          id: 'b-1',
          identity_id: 'id-1',
          agent_id: 'agent-1',
          role: 'active',
          created_at: 1000n,
          identity: { type: 'user', name: 'Alice' }
        },
        {
          id: 'b-2',
          identity_id: 'id-2',
          agent_id: 'agent-1',
          role: 'active',
          created_at: 2000n,
          identity: { type: 'ai', name: 'Bot' }
        }
      ] as any);

      const result = await listAgentOperators(ctx, 'agent-1');

      // Only user type should be returned
      expect(result).toHaveLength(1);
      expect(result[0].identity_name).toBe('Alice');
    });

    it('returns empty array when no bindings exist', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.identityNodeBinding.findMany = vi.fn().mockResolvedValue([]);

      const result = await listAgentOperators(ctx, 'agent-1');
      expect(result).toEqual([]);
    });
  });
});
