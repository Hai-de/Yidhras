import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/app/middleware/capability.js', () => ({
  capabilityGuard: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  checkCapability: vi.fn(async () => true)
}));

vi.mock('../../../src/operator/constants.js', () => ({
  OPERATOR_CAPABILITY: {
    PERCEIVE_AGENT_CONTEXT: 'perceive:agent:context',
    PERCEIVE_ENTITY_OVERVIEW: 'perceive:entity:overview',
    PERCEIVE_AGENT_SCHEDULER: 'perceive:agent:scheduler',
    PERCEIVE_AGENT_LOGS: 'perceive:agent:logs'
  }
}));

vi.mock('../../../src/app/services/agent/agent.js', () => ({
  getAgentContextSnapshot: vi.fn(async () => ({
    agent_id: 'agent-1',
    identity: { id: 'id-1', type: 'agent', name: 'Test Agent' },
    variables: {}
  })),
  getEntityOverview: vi.fn(async () => ({
    profile: { id: 'agent-1', name: 'Test Agent', type: 'npc', snr: 0.7, is_pinned: false, created_at: '1000', updated_at: '1000' },
    binding_summary: { active: [], atmosphere: [], counts: { total: 0, active: 0, atmosphere: 0 } },
    relationship_summary: { incoming: [], outgoing: [], counts: { incoming: 0, outgoing: 0, total: 0 } },
    pack_projection: null,
    recent_activity: null,
    recent_events: [],
    recent_posts: [],
    recent_workflows: [],
    recent_inference_results: [],
    snr: { current: 0.7, recent_logs: [] },
    memory: { summary: { recent_trace_count: 0, latest_memory_context: null, latest_memory_selection: null, latest_prompt_processing_trace: null }, latest_blocks: { evaluated: [], inserted: [], retained: [], delayed: [], cooling: [], inactive: [], mutations: [] } },
    context_governance: { latest_policy: { policy_decisions: 0, blocked_nodes: 0, locked_nodes: 0, visibility_denials: 0 }, overlay: { count: 0, latest_items: [], latest_mutations: null }, memory_blocks: { evaluated: [], inserted: [], retained: [], delayed: [], cooling: [], inactive: [], mutations: [], latest_trace_memory_mutations: null, compaction_state: null } }
  })),
  listSnrAdjustmentLogs: vi.fn(async () => ({ logs: [], page_info: { has_next_page: false, next_cursor: null } }))
}));

vi.mock('../../../src/app/services/scheduler/queries.js', () => ({
  getAgentSchedulerProjection: vi.fn(async () => ({
    actor_id: 'agent-1',
    summary: { total_decisions: 0, created_count: 0, skipped_count: 0, periodic_count: 0, event_driven_count: 0, latest_scheduled_tick: null, latest_run_id: null, latest_partition_id: null, top_reason: null, top_skipped_reason: null },
    reason_breakdown: [],
    skipped_reason_breakdown: [],
    timeline: [],
    linkage: { recent_runs: [], recent_created_jobs: [] }
  }))
}));

vi.mock('@yidhras/contracts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@yidhras/contracts')>();
  return {
    ...actual,
    entityOverviewDataSchema: { parse: vi.fn((data: unknown) => data) }
  };
});

import { agentRoutes } from '../../../src/app/routes/agent.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp } from '../../helpers/test_app.js';

describe('agent routes', () => {
  describe('GET /api/agent/:id/context', () => {
    it('returns agent context snapshot', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      agentRoutes.register(app.express, ctx);

      const res = await app.get('/api/agent/agent-1/context');
      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/entities/:id/overview', () => {
    it('returns entity overview for authorized operator', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      agentRoutes.register(app.express, ctx);

      const res = await app.get('/api/entities/agent-1/overview');
      expect(res.status).toBe(200);
      await app.close();
    });

    it('returns entity overview with packId query param', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      agentRoutes.register(app.express, ctx);

      const res = await app.get('/api/entities/agent-1/overview?packId=pack-1&limit=10');
      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/agent/:id/scheduler/projection', () => {
    it('returns agent scheduler projection', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      agentRoutes.register(app.express, ctx);

      const res = await app.get('/api/agent/agent-1/scheduler/projection');
      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/agent/:id/snr/logs', () => {
    it('returns SNR adjustment logs', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      agentRoutes.register(app.express, ctx);

      const res = await app.get('/api/agent/agent-1/snr/logs');
      expect(res.status).toBe(200);
      await app.close();
    });
  });
});
