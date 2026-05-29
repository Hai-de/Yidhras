import { describe, expect, it } from 'vitest';

import { operatorAuditRoutes } from '../../../src/app/routes/operator_audit.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp, unwrapData } from '../../helpers/test_app.js';

describe('operator audit routes', () => {
  describe('GET /api/audit/logs', () => {
    it('returns logs when operator is authenticated', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operatorAuditLog.findMany.mockResolvedValue([
        { id: 'log-1', operator_id: 'op-1', pack_id: 'pack-1', action: 'login', client_ip: null, created_at: 1000n }
      ]);

      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      operatorAuditRoutes.register(app.express, ctx);

      const res = await app.get('/api/audit/logs?limit=10');

      expect(res.status).toBe(200);
      const data = unwrapData<{ logs: unknown[]; next_cursor: string | null }>(res.body);
      expect(data.logs).toHaveLength(1);
      expect(data.next_cursor).toBeNull();
      expect(ctx.prisma.operatorAuditLog.findMany).toHaveBeenCalled();
      await app.close();
    });

    it('returns 401 when no operator on request', async () => {
      const ctx = createMockAppContext();

      const app = createTestApp(ctx); // no operator injected
      operatorAuditRoutes.register(app.express, ctx);

      const res = await app.get('/api/audit/logs');

      expect(res.status).toBe(401);
      const err = (res.body as Record<string, unknown>).error as Record<string, unknown>;
      expect(err.code).toBe('OPERATOR_REQUIRED');
      await app.close();
    });
  });

  describe('GET /api/audit/logs/me', () => {
    it('auto-filters to the current operator', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.operatorAuditLog.findMany.mockResolvedValue([
        { id: 'log-2', operator_id: 'op-1', pack_id: null, action: 'logout', client_ip: null, created_at: 2000n }
      ]);

      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'user', is_root: false }
      });
      operatorAuditRoutes.register(app.express, ctx);

      const res = await app.get('/api/audit/logs/me');

      expect(res.status).toBe(200);
      const data = unwrapData<{ logs: unknown[] }>(res.body);
      expect(data.logs).toHaveLength(1);
      // Should have been called with the operator's own id
      expect(ctx.prisma.operatorAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { operator_id: 'op-1' }
        })
      );
      await app.close();
    });
  });
});
