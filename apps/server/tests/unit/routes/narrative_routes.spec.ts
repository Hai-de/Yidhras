import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/app/services/narrative.js', () => ({
  getPackNarrativeTimelineProjection: vi.fn(async () => ({
    pack_id: 'pack-1',
    events: [
      { id: 'evt-1', type: 'narrative', title: 'Test Event', tick: '100', created_at: new Date().toISOString() }
    ]
  }))
}));

vi.mock('../../../src/operator/guard/pack_access.js', () => ({
  packAccessGuard: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next())
}));

vi.mock('../../../src/app/http/zod.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/app/http/zod.js')>();
  return {
    ...actual,
    parseParams: vi.fn(() => ({ packId: 'pack-1' }))
  };
});

vi.mock('@yidhras/contracts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@yidhras/contracts')>();
  return {
    ...actual,
    packNarrativeProjectionDataSchema: { parse: vi.fn((data: unknown) => data) }
  };
});

import { narrativeRoutes } from '../../../src/app/routes/narrative.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp, unwrapData } from '../../helpers/test_app.js';

describe('narrative routes', () => {
  describe('GET /api/packs/projections/timeline', () => {
    it('returns narrative timeline for authorized operator', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      narrativeRoutes.register(app.express, ctx);

      const res = await app.get('/api/packs/projections/timeline?packId=pack-1');
      expect(res.status).toBe(200);
      const data = unwrapData<Record<string, unknown>>(res.body);
      expect(data.pack_id).toBe('pack-1');
      await app.close();
    });
  });
});
