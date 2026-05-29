import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/app/services/relational.js', () => ({
  getGraphView: vi.fn(async () => ({
    schema_version: 'graph',
    view: 'mesh',
    nodes: [{ id: 'node-1', kind: 'agent', label: 'Test Agent' }],
    edges: [],
    summary: { counts_by_kind: { agent: 1 }, active_root_ids: [], returned_node_count: 1, returned_edge_count: 0 }
  }))
}));

vi.mock('@yidhras/contracts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@yidhras/contracts')>();
  return {
    ...actual,
    graphViewQuerySchema: actual.graphViewQuerySchema ?? {
      parse: vi.fn((data: unknown) => data)
    }
  };
});

import { graphRoutes } from '../../../src/app/routes/graph.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp, unwrapData } from '../../helpers/test_app.js';

describe('graph routes', () => {
  describe('GET /api/graph/view', () => {
    it('returns graph view for authorized operator', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      graphRoutes.register(app.express, ctx);

      const res = await app.get('/api/graph/view');
      expect(res.status).toBe(200);
      const data = unwrapData<Record<string, unknown>>(res.body);
      expect(data.schema_version).toBe('graph');
      await app.close();
    });

    it('passes query params to service', async () => {
      const { getGraphView } = await import('../../../src/app/services/relational.js');
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      graphRoutes.register(app.express, ctx);

      await app.get('/api/graph/view?view=tree&depth=2&include_inactive=true&include_unresolved=false&search=test');
      expect(getGraphView).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ view: 'tree', search: 'test' })
      );
      await app.close();
    });
  });
});
