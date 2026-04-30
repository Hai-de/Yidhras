import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { getSchedulerOperatorProjection } from '../../src/app/services/scheduler_observability.js';
import type { SchedulerStorageAdapter } from '../../src/packs/storage/SchedulerStorageAdapter.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';
import { MemSchedulerStorage } from '../helpers/scheduler_storage.js';

const TEST_PACK_ID = 'test-operator-proj';

describe('scheduler operator projection integration', () => {
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
    await context.prisma.actionIntent.deleteMany();
    await context.prisma.decisionJob.deleteMany();
    await context.prisma.inferenceTrace.deleteMany();
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it('builds the full operator projection covering runs, decisions, ownership, workers and rebalance', async () => {
    const prisma = context.prisma;
    const baseTick = context.sim.clock.getTicks();
    const runId = randomUUID();
    const jobId = randomUUID();
    const inferenceId = randomUUID();
    const intentId = randomUUID();

    // Set up ownership
    adapter.createPartition(TEST_PACK_ID, {
      partition_id: 'p0', worker_id: 'worker-main', status: 'assigned', version: 1, source: 'bootstrap', updated_at: baseTick
    });

    // Set up worker
    adapter.upsertWorkerState(TEST_PACK_ID, {
      worker_id: 'worker-main', status: 'active', last_heartbeat_at: baseTick,
      owned_partition_count: 1, active_migration_count: 0, capacity_hint: 4, updated_at: baseTick
    });

    // Set up inference workflow
    await prisma.inferenceTrace.create({
      data: {
        id: inferenceId, kind: 'run', strategy: 'mock', provider: 'mock',
        actor_ref: { identity_id: 'agent-001', identity_type: 'agent', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null },
        input: { agent_id: 'agent-001' }, context_snapshot: {}, prompt_bundle: {},
        trace_metadata: { inference_id: inferenceId, tick: baseTick.toString(), strategy: 'mock', provider: 'mock' },
        decision: {}, created_at: baseTick, updated_at: baseTick
      }
    });
    await prisma.actionIntent.create({
      data: {
        id: intentId, source_inference_id: inferenceId, intent_type: 'post_message',
        actor_ref: { identity_id: 'agent-001', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null },
        target_ref: Prisma.JsonNull, payload: { content: 'test' }, status: 'pending',
        created_at: baseTick, updated_at: baseTick
      }
    });
    await prisma.decisionJob.create({
      data: {
        id: jobId, source_inference_id: inferenceId, action_intent_id: intentId,
        job_type: 'inference_run', status: 'completed', pending_source_key: `sch-op-proj:${jobId}`,
        intent_class: 'scheduler_periodic', attempt_count: 1, max_attempts: 3,
        idempotency_key: `sch-op-proj:${jobId}`, created_at: baseTick, updated_at: baseTick, completed_at: baseTick
      }
    });

    // Set up a scheduler run with decisions
    adapter.writeDetailedSnapshot(TEST_PACK_ID, {
      id: runId, worker_id: 'worker-main', partition_id: 'p0',
      lease_holder: 'worker-main', lease_expires_at_snapshot: Number(baseTick + 5n), tick: Number(baseTick),
      summary: { scanned_count: 1, eligible_count: 1, created_count: 1, skipped_pending_count: 0, skipped_cooldown_count: 0, created_periodic_count: 1, created_event_driven_count: 0, signals_detected_count: 0, scheduled_for_future_count: 0, skipped_existing_idempotency_count: 0, skipped_by_reason: {} },
      started_at: Number(baseTick), finished_at: Number(baseTick), created_at: Number(baseTick)
    });
    adapter.writeCandidateDecision(TEST_PACK_ID, runId, {
      id: randomUUID(), partition_id: 'p0', actor_id: 'agent-001', kind: 'periodic',
      candidate_reasons: ['periodic_tick'], chosen_reason: 'periodic_tick',
      scheduled_for_tick: Number(baseTick), priority_score: 1, skipped_reason: null,
      created_job_id: jobId, created_at: Number(baseTick)
    });

    const projection = await getSchedulerOperatorProjection(context, { sampleRuns: 5, recentLimit: 5 });
    expect(projection.latest_run).not.toBeNull();
    expect(projection.summary.run_totals.sampled_runs).toBeGreaterThanOrEqual(1);
    expect(projection.ownership.assignments.length).toBeGreaterThan(0);
    expect(projection.workers.items.length).toBeGreaterThan(0);
  });
});
