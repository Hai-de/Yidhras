import { describe, expect, it, vi } from 'vitest';

import { createPackListRoutes } from '../../../src/app/routes/packs.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp } from '../../helpers/test_app.js';

describe('packs routes', () => {
  describe('GET /api/packs', () => {
    it('returns empty packs list when no packs available', async () => {
      const ctx = createMockAppContext();
      const mockLoader = {
        listAvailablePacks: vi.fn().mockReturnValue([]),
        loadPack: vi.fn(),
        deriveInstanceId: vi.fn()
      };
      (ctx as Record<string, unknown>).packCatalog = {
        getLoader: vi.fn().mockReturnValue(mockLoader)
      };

      const app = createTestApp(ctx, { operator: { id: 'op-1', username: 'admin', is_root: true } });
      const routes = createPackListRoutes('/tmp/packs');
      routes.register(app.express, ctx);

      const res = await app.get('/api/packs');
      expect(res.status).toBe(200);
      await app.close();
    });
  });
});
