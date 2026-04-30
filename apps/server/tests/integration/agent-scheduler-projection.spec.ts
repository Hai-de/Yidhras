import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { getAgentSchedulerProjection } from '../../src/app/services/scheduler_observability.js';
import type { SchedulerStorageAdapter } from '../../src/packs/storage/SchedulerStorageAdapter.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';
import { MemSchedulerStorage } from '../helpers/scheduler_storage.js';

const TEST_PACK_ID = 'test-agent-proj';

describe('agent scheduler projection integration', () => {
  let cleanup: (() => Promise<void>) | null = null;
  let context: AppContext;
  let adapter: MemSchedulerStorage;

  beforeAll(async () => {
    const fixture = await createIsolatedAppContextFixture();
    cleanup = fixture.cleanup;
    context = fixture.context;

    adapter = new MemSchedulerStorage();
    adapter.open(TEST_PACK_ID);
    (context as { schedulerStorage: SchedulerStorageAdapter }).schedulerStorage = adapter;
  });

  beforeEach(async () => {
    adapter.destroyPackSchedulerStorage(TEST_PACK_ID);
    adapter.open(TEST_PACK_ID);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it('builds a per-actor scheduler timeline with reason breakdowns', async () => {
    const baseTick = context.sim.clock.getTicks();
    const runId1 = randomUUID();
    const runId2 = randomUUID();
    const decisionId1 = randomUUID();
    const decisionId2 = randomUUID();

    adapter.writeDetailedSnapshot(TEST_PACK_ID, {
      id: runId1, worker_id: 'w1', partition_id: 'p1',
      lease_holder: 'w1', lease_expires_at_snapshot: Number(baseTick + 1n), tick: Number(baseTick),
      summary: { scanned_count: 1, eligible_count: 1, created_count: 1, skipped_pending_count: 0, skipped_cooldown_count: 0, created_periodic_count: 1, created_event_driven_count: 0, signals_detected_count: 0, scheduled_for_future_count: 0, skipped_existing_idempotency_count: 0, skipped_by_reason: {} },
      started_at: Number(baseTick), finished_at: Number(baseTick), created_at: Number(baseTick)
    });

    adapter.writeCandidateDecision(TEST_PACK_ID, runId1, {
      id: decisionId1, partition_id: 'p1', actor_id: 'agent-001', kind: 'periodic',
      candidate_reasons: ['periodic_tick'], chosen_reason: 'periodic_tick',
      scheduled_for_tick: Number(baseTick), priority_score: 1, skipped_reason: null,
      created_job_id: null, created_at: Number(baseTick)
    });

    adapter.writeDetailedSnapshot(TEST_PACK_ID, {
      id: runId2, worker_id: 'w1', partition_id: 'p1',
      lease_holder: 'w1', lease_expires_at_snapshot: Number(baseTick + 2n), tick: Number(baseTick + 1n),
      summary: { scanned_count: 1, eligible_count: 0, created_count: 0, skipped_pending_count: 1, skipped_cooldown_count: 0, created_periodic_count: 0, created_event_driven_count: 0, signals_detected_count: 0, scheduled_for_future_count: 0, skipped_existing_idempotency_count: 0, skipped_by_reason: { pending_workflow: 1 } },
      started_at: Number(baseTick + 1n), finished_at: Number(baseTick + 1n), created_at: Number(baseTick + 1n)
    });

    adapter.writeCandidateDecision(TEST_PACK_ID, runId2, {
      id: decisionId2, partition_id: 'p1', actor_id: 'agent-001', kind: 'periodic',
      candidate_reasons: ['periodic_tick'], chosen_reason: 'periodic_tick',
      scheduled_for_tick: Number(baseTick + 1n), priority_score: 1, skipped_reason: 'pending_workflow',
      created_job_id: null, created_at: Number(baseTick + 1n)
    });

    const projection = await getAgentSchedulerProjection(context, 'agent-001', { limit: 10 });
    expect(projection.actor_id).toBe('agent-001');
    expect(projection.timeline).toHaveLength(2);
    expect(projection.summary.created_count).toBe(1);
    expect(projection.summary.skipped_count).toBe(1);
    expect(projection.reason_breakdown.length).toBeGreaterThan(0);
    expect(projection.skipped_reason_breakdown.length).toBeGreaterThan(0);
  });
});
