import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/app/middleware/capability.js', () => ({
  capabilityGuard: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  checkCapability: vi.fn(async () => true)
}));

vi.mock('../../../src/app/services/scheduler/queries.js', () => ({
  getLatestSchedulerRunReadModel: vi.fn(async () => ({
    run: { id: 'run-1', pack_id: 'test-pack', worker_id: 'w1', partition_id: 'p0', tick: 100n, started_at: 100n, finished_at: 200n, summary: {} },
    decisions: [],
    skip_breakdown: []
  })),
  getSchedulerRunReadModelById: vi.fn(async () => ({
    run: { id: 'run-1', pack_id: 'test-pack', worker_id: 'w1', partition_id: 'p0', tick: 100n, started_at: 100n, finished_at: 200n, summary: {} },
    decisions: [],
    skip_breakdown: []
  })),
  listSchedulerRuns: vi.fn(() => ({
    items: [],
    page_info: { has_next_page: false, next_cursor: null },
    summary: { total_count: 0 }
  })),
  getSchedulerTrendsSnapshot: vi.fn(async () => ({
    trend_points: [],
    aggregate: { avg_created: 0, avg_eligible: 0, avg_skipped: 0 }
  })),
  listSchedulerDecisions: vi.fn(() => ({ items: [], page_info: { has_next_page: false, next_cursor: null } })),
  listAgentSchedulerDecisions: vi.fn(async () => ({
    actor_id: 'agent-1',
    summary: { total_decisions: 0, created_count: 0 },
    reason_breakdown: [],
    skipped_reason_breakdown: [],
    timeline: [],
    linkage: { recent_runs: [], recent_created_jobs: [] }
  })),
  listSchedulerOwnershipMigrations: vi.fn(() => ({ items: [], page_info: { has_next_page: false, next_cursor: null } })),
  listSchedulerRebalanceRecommendations: vi.fn(() => ({ items: [], page_info: { has_next_page: false, next_cursor: null } }))
}));

vi.mock('../../../src/app/runtime/runtime_kernel_service.js', () => ({
  createRuntimeKernelService: vi.fn(() => ({
    getSchedulerSummary: vi.fn(async () => ({
      partition_count: 1,
      worker_count: 1,
      latest_run: null,
      ownership: { worker_id: 'w1', partition_count: 1, owned_partition_ids: ['p0'], assignment_source: 'bootstrap' }
    })),
    getSummary: vi.fn(async () => ({
      partition_count: 1,
      worker_count: 1,
      latest_run: null,
      ownership: { worker_id: 'w1', partition_count: 1, owned_partition_ids: ['p0'], assignment_source: 'bootstrap' }
    })),
    getOperatorProjection: vi.fn(async () => ({
      runtime: { ready: true, scheduler_ready: true },
      runtime_loop: { status: 'idle' },
      scheduler: { worker_id: 'w1', partition_count: 1 }
    })),
    getOwnershipAssignments: vi.fn(async () => ({
      items: [],
      page_info: { has_next_page: false, next_cursor: null }
    })),
    getWorkers: vi.fn(async () => []),
    listSchedulerWorkers: vi.fn(async () => []),
    getSchedulerWorkerDetail: vi.fn(async () => null)
  }))
}));

import { schedulerRoutes } from '../../../src/app/routes/scheduler.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp, unwrapData } from '../../helpers/test_app.js';

describe('scheduler routes', () => {
  describe('GET /api/runtime/scheduler/runs/latest', () => {
    it('returns latest run for authorized operator', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      schedulerRoutes.register(app.express, ctx);

      const res = await app.get('/api/runtime/scheduler/runs/latest?packId=test-pack');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/runtime/scheduler/runs', () => {
    it('returns scheduler runs list', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      schedulerRoutes.register(app.express, ctx);

      const res = await app.get('/api/runtime/scheduler/runs?packId=test-pack');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/runtime/scheduler/summary', () => {
    it('returns scheduler summary', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      schedulerRoutes.register(app.express, ctx);

      const res = await app.get('/api/runtime/scheduler/summary?packId=test-pack');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/runtime/scheduler/decisions', () => {
    it('returns scheduler decisions', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      schedulerRoutes.register(app.express, ctx);

      const res = await app.get('/api/runtime/scheduler/decisions?packId=test-pack');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/runtime/scheduler/trends', () => {
    it('returns scheduler trends', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      schedulerRoutes.register(app.express, ctx);

      const res = await app.get('/api/runtime/scheduler/trends?packId=test-pack');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/runtime/scheduler/workers', () => {
    it('returns scheduler workers', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      schedulerRoutes.register(app.express, ctx);

      const res = await app.get('/api/runtime/scheduler/workers?packId=test-pack');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/runtime/scheduler/migrations', () => {
    it('returns scheduler migrations', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      schedulerRoutes.register(app.express, ctx);

      const res = await app.get('/api/runtime/scheduler/migrations?packId=test-pack');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/runtime/scheduler/rebalance-recommendations', () => {
    it('returns rebalance recommendations', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      schedulerRoutes.register(app.express, ctx);

      const res = await app.get('/api/runtime/scheduler/rebalance/recommendations?packId=test-pack');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/runtime/scheduler/operator', () => {
    it('returns scheduler operator projection', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      schedulerRoutes.register(app.express, ctx);

      const res = await app.get('/api/runtime/scheduler/operator?packId=test-pack');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/runtime/scheduler/ownership', () => {
    it('returns scheduler ownership assignments', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      schedulerRoutes.register(app.express, ctx);

      const res = await app.get('/api/runtime/scheduler/ownership?packId=test-pack');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/runtime/scheduler/runs/:id', () => {
    it('returns scheduler run by id', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      schedulerRoutes.register(app.express, ctx);

      const res = await app.get('/api/runtime/scheduler/runs/run-1?packId=test-pack');

      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/runtime/scheduler/agent/:actorId', () => {
    it('returns agent scheduler decisions', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      schedulerRoutes.register(app.express, ctx);

      const res = await app.get('/api/agent/agent-1/scheduler?packId=test-pack');

      expect(res.status).toBe(200);
      await app.close();
    });
  });
});
