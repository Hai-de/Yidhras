import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/app/services/runtime/experimental_projection_runtime.js', () => ({
  getExperimentalPackOverviewProjection: vi.fn(async () => ({
    pack_id: 'pack-1',
    entities: [],
    relationships: []
  })),
  getExperimentalPackNarrativeProjection: vi.fn(async () => ({
    pack_id: 'pack-1',
    events: []
  })),
  getExperimentalPackEntityProjection: vi.fn(async () => ({
    pack_id: 'pack-1',
    entities: []
  })),
  getExperimentalPackAgentOverview: vi.fn(async () => ({
    agent_id: 'agent-1',
    profile: { id: 'agent-1', name: 'Test' }
  })),
  getExperimentalPackPluginInstallations: vi.fn(async () => ({
    installations: []
  }))
}));

vi.mock('../../../src/operator/guard/pack_access.js', () => ({
  packAccessGuard: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next())
}));

vi.mock('../../../src/app/http/zod.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/app/http/zod.js')>();
  return {
    ...actual,
    parseParams: vi.fn((_schema: unknown, params: unknown) => params)
  };
});

import { experimentalPackProjectionRoutes } from '../../../src/app/routes/experimental_pack_projection.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp, unwrapData } from '../../helpers/test_app.js';

describe('experimental pack projection routes', () => {
  const setup = () => {
    const ctx = createMockAppContext();
    const app = createTestApp(ctx, {
      operator: { id: 'op-1', username: 'admin', is_root: true }
    });
    experimentalPackProjectionRoutes.register(app.express, ctx);
    return { ctx, app };
  };

  describe('GET /api/experimental/packs/overview', () => {
    it('returns pack overview projection', async () => {
      const { app } = setup();
      const res = await app.get('/api/experimental/packs/overview?packId=pack-1');
      expect(res.status).toBe(200);
      const data = unwrapData<Record<string, unknown>>(res.body);
      expect(data.pack_id).toBe('pack-1');
      await app.close();
    });
  });

  describe('GET /api/experimental/packs/projections/timeline', () => {
    it('returns narrative projection', async () => {
      const { app } = setup();
      const res = await app.get('/api/experimental/packs/projections/timeline?packId=pack-1');
      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/experimental/packs/projections/entities', () => {
    it('returns entity projection', async () => {
      const { app } = setup();
      const res = await app.get('/api/experimental/packs/projections/entities?packId=pack-1');
      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/experimental/packs/entities/:id/overview', () => {
    it('returns entity overview', async () => {
      const { app } = setup();
      const res = await app.get('/api/experimental/packs/entities/agent-1/overview?packId=pack-1');
      expect(res.status).toBe(200);
      const data = unwrapData<Record<string, unknown>>(res.body);
      expect(data.agent_id).toBe('agent-1');
      await app.close();
    });
  });

  describe('GET /api/experimental/packs/plugins', () => {
    it('returns plugin installations', async () => {
      const { app } = setup();
      const res = await app.get('/api/experimental/packs/plugins?packId=pack-1');
      expect(res.status).toBe(200);
      await app.close();
    });
  });
});
