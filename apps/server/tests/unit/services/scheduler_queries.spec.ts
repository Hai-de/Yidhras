import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../../src/app/context.js';
import { getAgentSchedulerProjection, listAgentSchedulerDecisions } from '../../../src/app/services/scheduler/agent-queries.js';
import { listSchedulerDecisions } from '../../../src/app/services/scheduler/decision-queries.js';
import { listSchedulerOwnershipMigrations } from '../../../src/app/services/scheduler/ownership-queries.js';
import { listSchedulerRebalanceRecommendations } from '../../../src/app/services/scheduler/rebalance-queries.js';
import { getLatestSchedulerRunReadModel, getSchedulerRunReadModelById, listSchedulerRuns } from '../../../src/app/services/scheduler/run-queries.js';
import { createMockAppContext } from '../../helpers/mock_context.js';

vi.mock('../../../src/config/runtime_config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/config/runtime_config.js')>();
  return {
    ...actual,
    getSchedulerObservabilityConfig: vi.fn(() => ({
      default_query_limit: 10,
      max_query_limit: 50,
      summary: {
        default_sample_runs: 20,
        max_sample_runs: 100
      },
      trends: {
        default_sample_runs: 20,
        max_sample_runs: 100
      },
      operator_projection: {
        default_sample_runs: 20,
        max_sample_runs: 100,
        default_recent_limit: 5,
        max_recent_limit: 20
      },
      default_observation_sample_runs: 50,
      max_observation_sample_runs: 200,
      trends: {
        default_sample_runs: 50,
        max_sample_runs: 200
      }
    }))
  };
});

const TEST_PACK_ID = 'test-pack';

const makeRun = (overrides: Record<string, unknown> = {}) => ({
  id: 'run-1',
  worker_id: 'w-1',
  partition_id: 'p-0',
  lease_holder: null,
  lease_expires_at_snapshot: null,
  tick: 1000n,
  summary: '{}',
  started_at: 1000n,
  finished_at: 2000n,
  created_at: 900n,
  ...overrides
});

const makeDecision = (overrides: Record<string, unknown> = {}) => ({
  id: 'dec-1',
  scheduler_run_id: 'run-1',
  partition_id: 'p-0',
  actor_id: 'agent-1',
  kind: 'periodic',
  candidate_reasons: '["periodic_tick"]',
  chosen_reason: 'periodic_tick',
  scheduled_for_tick: 1000n,
  priority_score: 0.5,
  skipped_reason: null,
  created_job_id: null,
  created_at: 900n,
  ...overrides
});

const makeMockAdapter = () => ({
  open: vi.fn(),
  getRunById: vi.fn(() => null),
  listRuns: vi.fn((): unknown[] => []),
  listDecisionsForRun: vi.fn((): unknown[] => []),
  listCandidateDecisions: vi.fn((): unknown[] => []),
  getAgentDecisions: vi.fn((): unknown[] => []),
  listPartitions: vi.fn((): unknown[] => []),
  listMigrations: vi.fn((): unknown[] => []),
  listOpenPackIds: vi.fn(() => [TEST_PACK_ID])
});

describe('scheduler queries', () => {
  let ctx: AppContext;
  let adapter: ReturnType<typeof makeMockAdapter>;

  beforeEach(() => {
    adapter = makeMockAdapter();
    ctx = createMockAppContext({ overrides: { schedulerStorage: adapter as never } });
  });

  describe('listSchedulerRuns', () => {
    it('returns empty result when no adapter', () => {
      ctx = createMockAppContext();
      const result = listSchedulerRuns(ctx, TEST_PACK_ID, {});
      expect(result.items).toEqual([]);
      expect(result.page_info.has_next_page).toBe(false);
    });

    it('returns summary with filter info', () => {
      adapter.listRuns.mockReturnValue([]);

      const result = listSchedulerRuns(ctx, TEST_PACK_ID, {
        worker_id: 'w-1',
        from_tick: '100',
        to_tick: '200'
      });
      expect(result.summary.filters.worker_id).toBe('w-1');
      expect(result.summary.filters.from_tick).toBe('100');
      expect(result.summary.filters.to_tick).toBe('200');
    });
  });

  describe('listSchedulerDecisions', () => {
    it('returns empty result when no adapter', async () => {
      ctx = createMockAppContext();
      const result = await listSchedulerDecisions(ctx, TEST_PACK_ID, {});
      expect(result.items).toEqual([]);
    });

    it('returns decisions from adapter', async () => {
      adapter.listCandidateDecisions.mockReturnValue([makeDecision()]);

      const result = await listSchedulerDecisions(ctx, TEST_PACK_ID, {});
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('dec-1');
    });
  });

  describe('getLatestSchedulerRunReadModel', () => {
    it('returns null when no adapter', async () => {
      ctx = createMockAppContext();
      const result = await getLatestSchedulerRunReadModel(ctx, TEST_PACK_ID);
      expect(result).toBeNull();
    });

    it('returns null when no runs exist', async () => {
      adapter.listRuns.mockReturnValue([]);

      const result = await getLatestSchedulerRunReadModel(ctx, TEST_PACK_ID);
      expect(result).toBeNull();
    });

    it('returns latest run with candidates', async () => {
      adapter.listRuns.mockReturnValue([makeRun()]);
      adapter.listDecisionsForRun.mockReturnValue([makeDecision()]);

      const result = await getLatestSchedulerRunReadModel(ctx, TEST_PACK_ID);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.run.id).toBe('run-1');
        expect(result.candidates).toHaveLength(1);
      }
    });
  });

  describe('getSchedulerRunReadModelById', () => {
    it('returns null when no adapter', async () => {
      ctx = createMockAppContext();
      const result = await getSchedulerRunReadModelById(ctx, TEST_PACK_ID, 'run-1');
      expect(result).toBeNull();
    });

    it('returns null when run not found', async () => {
      adapter.getRunById.mockReturnValue(null);

      const result = await getSchedulerRunReadModelById(ctx, TEST_PACK_ID, 'nonexistent');
      expect(result).toBeNull();
    });

    it('returns run when found', async () => {
      adapter.getRunById.mockReturnValue(makeRun());
      adapter.listDecisionsForRun.mockReturnValue([]);

      const result = await getSchedulerRunReadModelById(ctx, TEST_PACK_ID, 'run-1');
      expect(result).not.toBeNull();
      if (result) {
        expect(result.run.id).toBe('run-1');
      }
    });
  });

  describe('listSchedulerOwnershipMigrations', () => {
    it('returns empty result when no adapter', () => {
      ctx = createMockAppContext();
      const result = listSchedulerOwnershipMigrations(ctx, TEST_PACK_ID, {});
      expect(result.items).toEqual([]);
    });

    it('returns migrations from adapter', () => {
      adapter.listMigrations.mockReturnValue([
        {
          id: 'mig-1',
          partition_id: 'p-0',
          from_worker_id: 'w-1',
          to_worker_id: 'w-2',
          status: 'completed',
          reason: null,
          details: null,
          created_at: 1000n,
          updated_at: 1000n,
          completed_at: 2000n
        }
      ]);

      const result = listSchedulerOwnershipMigrations(ctx, TEST_PACK_ID, {});
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('mig-1');
    });
  });

  describe('listSchedulerRebalanceRecommendations', () => {
    it('returns empty result when no adapter', () => {
      ctx = createMockAppContext();
      const result = listSchedulerRebalanceRecommendations(ctx, TEST_PACK_ID, {});
      expect(result.items).toEqual([]);
    });
  });

  describe('getAgentSchedulerProjection', () => {
    it('returns empty projection when no adapter', async () => {
      ctx = createMockAppContext();
      const result = await getAgentSchedulerProjection(ctx, TEST_PACK_ID, 'agent-1');
      expect(result.actor_id).toBe('agent-1');
      expect(result.summary.total_decisions).toBe(0);
    });

    it('returns projection with decisions from adapter', async () => {
      adapter.getAgentDecisions.mockReturnValue([makeDecision()]);
      adapter.getRunById.mockReturnValue(makeRun());

      const result = await getAgentSchedulerProjection(ctx, TEST_PACK_ID, 'agent-1');
      expect(result.actor_id).toBe('agent-1');
      expect(result.summary.total_decisions).toBe(1);
      expect(result.timeline).toHaveLength(1);
    });
  });

  describe('listAgentSchedulerDecisions', () => {
    it('returns empty array when no adapter', () => {
      ctx = createMockAppContext();
      const result = listAgentSchedulerDecisions(ctx, TEST_PACK_ID, 'agent-1');
      expect(result).toEqual([]);
    });

    it('returns decisions from adapter', () => {
      adapter.getAgentDecisions.mockReturnValue([makeDecision()]);

      const result = listAgentSchedulerDecisions(ctx, TEST_PACK_ID, 'agent-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('dec-1');
    });
  });
});
