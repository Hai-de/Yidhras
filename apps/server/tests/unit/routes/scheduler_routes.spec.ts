import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/app/middleware/capability.js', () => ({
  capabilityGuard: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  checkCapability: vi.fn(async () => true)
}));

vi.mock('../../../src/app/services/scheduler/run-queries.js', () => ({
  getLatestSchedulerRunReadModel: vi.fn(async () => ({
    run: { id: 'run-1', worker_id: 'w1', partition_id: 'p0', tick: '100', started_at: '100', finished_at: '200', summary: {}, cross_link_summary: null, lease_holder: null, lease_expires_at_snapshot: null, created_at: '100' },
    candidates: []
  })),
  getSchedulerRunReadModelById: vi.fn(async () => ({
    run: { id: 'run-1', worker_id: 'w1', partition_id: 'p0', tick: '100', started_at: '100', finished_at: '200', summary: {}, cross_link_summary: null, lease_holder: null, lease_expires_at_snapshot: null, created_at: '100' },
    candidates: []
  })),
  listSchedulerRuns: vi.fn(() => ({
    items: [],
    page_info: { has_next_page: false, next_cursor: null },
    summary: { returned: 0, limit: 10, filters: {} }
  }))
}));

vi.mock('../../../src/app/services/scheduler/decision-queries.js', () => ({
  listSchedulerDecisions: vi.fn(() => ({ items: [], page_info: { has_next_page: false, next_cursor: null }, summary: { returned: 0, limit: 10, filters: {} } }))
}));

vi.mock('../../../src/app/services/scheduler/agent-queries.js', () => ({
  listAgentSchedulerDecisions: vi.fn(() => [])
}));

vi.mock('../../../src/app/services/scheduler/ownership-queries.js', () => ({
  listSchedulerOwnershipAssignments: vi.fn(() => ({ items: [], summary: { returned: 0, filters: {} } })),
  listSchedulerOwnershipMigrations: vi.fn(() => ({ items: [], summary: { returned: 0, limit: 10, in_progress_count: 0, filters: {} } }))
}));

vi.mock('../../../src/app/services/scheduler/rebalance-queries.js', () => ({
  listSchedulerRebalanceRecommendations: vi.fn(() => ({ items: [], summary: { returned: 0, limit: 10, status_breakdown: [], suppress_reason_breakdown: [], filters: {} } }))
}));

vi.mock('../../../src/app/services/scheduler/summary-queries.js', () => ({
  getSchedulerSummarySnapshot: vi.fn(async () => ({
    latest_run: null,
    run_totals: { sampled_runs: 0, created_total: 0, created_periodic_total: 0, created_event_driven_total: 0, skipped_pending_total: 0, skipped_cooldown_total: 0, signals_detected_total: 0 },
    top_reasons: [],
    top_skipped_reasons: [],
    top_actors: [],
    top_partitions: [],
    top_workers: [],
    intent_class_breakdown: []
  })),
  getSchedulerTrendsSnapshot: vi.fn(() => ({ points: [] })),
  getSchedulerOperatorProjection: vi.fn(async () => ({
    latest_run: null,
    summary: {},
    trends: {},
    recent_runs: [],
    recent_decisions: [],
    ownership: { assignments: [], recent_migrations: [], summary: {} },
    workers: { items: [], summary: {} },
    rebalance: { recommendations: [], summary: {} },
    highlights: {}
  }))
}));

vi.mock('../../../src/app/services/scheduler/worker-queries.js', () => ({
  listSchedulerWorkers: vi.fn(() => ({ items: [], summary: { returned: 0, active_count: 0, stale_count: 0, suspected_dead_count: 0, filters: {} } }))
}));

vi.mock('../../../src/app/runtime/runtime_kernel_service.js', () => ({
  createRuntimeKernelService: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    isRunning: vi.fn(() => true),
    getLoopDiagnostics: vi.fn(() => ({ status: 'idle' })),
    getHealthSnapshot: vi.fn(() => ({ runtime_ready: true, paused: false, loop_status: 'idle' })),
    getOwnershipSnapshot: vi.fn(async () => ({
      worker_id: 'w1',
      partition_count: 1,
      owned_partition_ids: ['p0'],
      assignment_source: 'bootstrap'
    })),
    reconcileBootstrapOwnership: vi.fn(async () => {})
  }))
}));

import { schedulerRoutes } from '../../../src/app/routes/scheduler.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp } from '../../helpers/test_app.js';

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
