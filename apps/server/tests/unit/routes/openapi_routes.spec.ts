import { describe, expect, it } from 'vitest';

import { openApiRoute } from '../../../src/app/routes/openapi.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp } from '../../helpers/test_app.js';

describe('openapi route', () => {
  describe('GET /api/openapi.json', () => {
    it('returns OpenAPI spec as JSON', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx);
      openApiRoute.register(app.express, ctx);

      const res = await app.get('/api/openapi.json');
      expect(res.status).toBe(200);
      const spec = res.body as Record<string, unknown>;
      expect(spec.openapi).toBe('3.0.3');
      expect(spec.info).toBeDefined();
      expect(spec.paths).toBeDefined();
      await app.close();
    });

    it('returns CORS header', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx);
      openApiRoute.register(app.express, ctx);

      const res = await app.get('/api/openapi.json');
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      await app.close();
    });
  });
});
