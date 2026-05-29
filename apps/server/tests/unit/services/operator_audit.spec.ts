import { describe, expect, it } from 'vitest';

import { queryAuditLogs } from '../../../src/app/services/operator/operator_audit.js';
import { createMockAppContext } from '../../helpers/mock_context.js';

const makeAuditLog = (overrides?: Partial<{ id: string; operator_id: string; pack_id: string; action: string; client_ip: string; created_at: bigint }>) => ({
  id: 'log-1',
  operator_id: 'op-1',
  pack_id: 'pack-1',
  action: 'login',
  client_ip: null,
  created_at: 1000n,
  ...overrides
});

describe('queryAuditLogs', () => {
  it('non-root operator only sees their own logs', async () => {
    const ctx = createMockAppContext();
    ctx.prisma.operatorAuditLog.findMany.mockResolvedValue([
      makeAuditLog({ operator_id: 'op-1' })
    ]);

    const result = await queryAuditLogs(
      ctx,
      { limit: 20 },
      false,
      'op-1'
    );

    expect(result.logs).toHaveLength(1);
    expect(ctx.prisma.operatorAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { operator_id: 'op-1' }
      })
    );
  });

  it('non-root operator returns empty when no currentOperatorId', async () => {
    const ctx = createMockAppContext();

    const result = await queryAuditLogs(
      ctx,
      { limit: 20 },
      false,
      undefined
    );

    expect(result).toEqual({ logs: [], next_cursor: null });
    expect(ctx.prisma.operatorAuditLog.findMany).not.toHaveBeenCalled();
  });

  it('root operator sees all logs, can filter by operator_id', async () => {
    const ctx = createMockAppContext();
    ctx.prisma.operatorAuditLog.findMany.mockResolvedValue([
      makeAuditLog({ operator_id: 'target-op', action: 'bind_pack' })
    ]);

    const result = await queryAuditLogs(
      ctx,
      { operator_id: 'target-op', limit: 20 },
      true
    );

    expect(result.logs).toHaveLength(1);
    expect(ctx.prisma.operatorAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { operator_id: 'target-op' }
      })
    );
  });

  it('filters by pack_id and action', async () => {
    const ctx = createMockAppContext();
    ctx.prisma.operatorAuditLog.findMany.mockResolvedValue([
      makeAuditLog({ pack_id: 'pack-1', action: 'login' })
    ]);

    await queryAuditLogs(
      ctx,
      { pack_id: 'pack-1', action: 'login', limit: 20 },
      true
    );

    expect(ctx.prisma.operatorAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pack_id: 'pack-1', action: 'login' }
      })
    );
  });

  it('filters by date range', async () => {
    const ctx = createMockAppContext();
    ctx.prisma.operatorAuditLog.findMany.mockResolvedValue([]);

    await queryAuditLogs(
      ctx,
      { from_date: '1000', to_date: '2000', limit: 20 },
      true
    );

    expect(ctx.prisma.operatorAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          created_at: { gte: 1000n, lte: 2000n }
        }
      })
    );
  });

  it('returns next_cursor when more results than limit', async () => {
    const ctx = createMockAppContext();
    const logs = Array.from({ length: 6 }, (_, i) =>
      makeAuditLog({ id: `log-${i}` }));
    ctx.prisma.operatorAuditLog.findMany.mockResolvedValue(logs);

    const result = await queryAuditLogs(ctx, { limit: 5 }, true);

    expect(result.logs).toHaveLength(5);
    expect(result.next_cursor).toBe('log-4');
  });

  it('includes cursor filter when cursor provided', async () => {
    const ctx = createMockAppContext();
    ctx.prisma.operatorAuditLog.findMany.mockResolvedValue([
      makeAuditLog({ id: 'log-3' })
    ]);

    await queryAuditLogs(ctx, { limit: 5, cursor: 'log-5' }, true);

    expect(ctx.prisma.operatorAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { lt: 'log-5' } }
      })
    );
  });
});
