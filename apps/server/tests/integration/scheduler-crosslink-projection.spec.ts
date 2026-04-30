import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import {
  getAgentSchedulerProjection,
  getLatestSchedulerRunReadModel,
  listSchedulerDecisions
} from '../../src/app/services/scheduler_observability.js';
import type { SchedulerStorageAdapter } from '../../src/packs/storage/SchedulerStorageAdapter.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';
import { MemSchedulerStorage } from '../helpers/scheduler_storage.js';

const TEST_PACK_ID = 'test-crosslink';

describe('scheduler cross-link projection integration', () => {
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

  it('enriches scheduler decisions with cross-linked workflow state from decision jobs', async () => {
    const prisma = context.prisma;
    const baseTick = context.sim.clock.getTicks();
    const runId = randomUUID();
    const jobId = randomUUID();
    const inferenceId = randomUUID();
    const actionIntentId = randomUUID();

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
        id: actionIntentId, source_inference_id: inferenceId, intent_type: 'post_message',
        actor_ref: { identity_id: 'agent-001', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null },
        target_ref: Prisma.JsonNull, payload: { content: 'test' }, status: 'pending',
        created_at: baseTick, updated_at: baseTick
      }
    });

    await prisma.decisionJob.create({
      data: {
        id: jobId, source_inference_id: inferenceId, action_intent_id: actionIntentId,
        job_type: 'inference_run', status: 'completed', pending_source_key: `sch-xlink:${jobId}`,
        intent_class: 'scheduler_event_followup', attempt_count: 1, max_attempts: 3,
        idempotency_key: `sch-xlink:${jobId}`, created_at: baseTick, updated_at: baseTick, completed_at: baseTick
      }
    });

    adapter.writeDetailedSnapshot(TEST_PACK_ID, {
      id: runId, worker_id: 'w1', partition_id: 'p5',
      lease_holder: 'w1', lease_expires_at_snapshot: Number(baseTick + 5n), tick: Number(baseTick),
      summary: { scanned_count: 2, eligible_count: 1, created_count: 1, skipped_pending_count: 1, skipped_cooldown_count: 0, created_periodic_count: 0, created_event_driven_count: 1, signals_detected_count: 1, scheduled_for_future_count: 0, skipped_existing_idempotency_count: 0, skipped_by_reason: { pending_workflow: 1, periodic_cooldown: 0, event_coalesced: 0, existing_same_idempotency: 0, replay_window_periodic_suppressed: 0, replay_window_event_suppressed: 0, retry_window_periodic_suppressed: 0, retry_window_event_suppressed: 0, limit_reached: 0 } },
      started_at: Number(baseTick), finished_at: Number(baseTick), created_at: Number(baseTick)
    });

    adapter.writeCandidateDecision(TEST_PACK_ID, runId, {
      id: randomUUID(), partition_id: 'p5', actor_id: 'agent-001', kind: 'event_driven',
      candidate_reasons: ['event_followup'], chosen_reason: 'event_followup',
      scheduled_for_tick: Number(baseTick), priority_score: 30, skipped_reason: null,
      created_job_id: jobId, created_at: Number(baseTick)
    });

    const latestRun = await getLatestSchedulerRunReadModel(context);
    expect(latestRun).not.toBeNull();
    expect(latestRun?.run.cross_link_summary?.linked_workflow_count).toBe(1);

    const decisions = await listSchedulerDecisions(context, { limit: 5 });
    expect(decisions.items.length).toBeGreaterThan(0);

    const projection = await getAgentSchedulerProjection(context, 'agent-001', { limit: 5 });
    expect(projection.timeline.length).toBeGreaterThan(0);
  });
});
