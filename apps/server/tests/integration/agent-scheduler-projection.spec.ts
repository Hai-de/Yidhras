import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { getAgentSchedulerProjection } from '../../src/app/services/scheduler_observability.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

describe('agent scheduler projection integration', () => {
  let cleanup: (() => Promise<void>) | null = null;
  let context: AppContext;

  beforeAll(async () => {
    const fixture = await createIsolatedAppContextFixture();
    cleanup = fixture.cleanup;
    context = fixture.context;
  });

  beforeEach(async () => {
    await context.prisma.schedulerCandidateDecision.deleteMany();
    await context.prisma.schedulerRun.deleteMany();
    await context.prisma.schedulerCursor.deleteMany();
    await context.prisma.schedulerLease.deleteMany();
    await context.prisma.decisionJob.deleteMany();
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it('aggregates timeline, breakdowns and run/job linkage for a single actor', async () => {
    const prisma = context.prisma;
    const baseTick = context.sim.clock.getTicks();
    const createdJobId = randomUUID();
    const runIdLatest = randomUUID();
    const runIdOlder = randomUUID();

    await prisma.decisionJob.create({
      data: {
        id: createdJobId,
        pending_source_key: `agent-projection:${createdJobId}`,
        job_type: 'inference_run',
        status: 'pending',
        idempotency_key: `agent-projection:${createdJobId}`,
        intent_class: 'scheduler_event_followup',
        attempt_count: 1,
        max_attempts: 3,
        request_input: {
          agent_id: 'agent-001',
          identity_id: 'agent-001',
          strategy: 'rule_based',
          idempotency_key: `agent-projection:${createdJobId}`,
          attributes: {
            scheduler_kind: 'event_driven',
            scheduler_reason: 'event_followup',
            scheduler_partition_id: 'p1'
          }
        },
        created_at: baseTick,
        updated_at: baseTick
      }
    });

    await prisma.schedulerRun.create({
      data: {
        id: runIdOlder,
        worker_id: 'scheduler-projection-worker-older',
        partition_id: 'p0',
        lease_holder: 'scheduler-projection-worker-older',
        lease_expires_at_snapshot: baseTick + 4n,
        tick: baseTick - 1n,
        summary: {
          scanned_count: 1,
          eligible_count: 1,
          created_count: 0,
          skipped_pending_count: 1,
          skipped_cooldown_count: 0,
          created_periodic_count: 0,
          created_event_driven_count: 0,
          signals_detected_count: 0,
          scheduled_for_future_count: 0,
          skipped_existing_idempotency_count: 0,
          skipped_by_reason: {
            pending_workflow: 1,
            periodic_cooldown: 0,
            event_coalesced: 0,
            existing_same_idempotency: 0,
            replay_window_periodic_suppressed: 0,
            replay_window_event_suppressed: 0,
            retry_window_periodic_suppressed: 0,
            retry_window_event_suppressed: 0,
            limit_reached: 0
          }
        },
        started_at: baseTick - 2n,
        finished_at: baseTick - 1n,
        created_at: baseTick - 1n
      }
    });

    await prisma.schedulerRun.create({
      data: {
        id: runIdLatest,
        worker_id: 'scheduler-projection-worker-latest',
        partition_id: 'p1',
        lease_holder: 'scheduler-projection-worker-latest',
        lease_expires_at_snapshot: baseTick + 5n,
        tick: baseTick,
        summary: {
          scanned_count: 1,
          eligible_count: 1,
          created_count: 1,
          skipped_pending_count: 0,
          skipped_cooldown_count: 0,
          created_periodic_count: 0,
          created_event_driven_count: 1,
          signals_detected_count: 1,
          scheduled_for_future_count: 1,
          skipped_existing_idempotency_count: 0,
          skipped_by_reason: {
            pending_workflow: 0,
            periodic_cooldown: 0,
            event_coalesced: 0,
            existing_same_idempotency: 0,
            replay_window_periodic_suppressed: 0,
            replay_window_event_suppressed: 0,
            retry_window_periodic_suppressed: 0,
            retry_window_event_suppressed: 0,
            limit_reached: 0
          }
        },
        started_at: baseTick - 1n,
        finished_at: baseTick,
        created_at: baseTick
      }
    });

    await prisma.schedulerCandidateDecision.createMany({
      data: [
        {
          id: randomUUID(),
          scheduler_run_id: runIdLatest,
          partition_id: 'p1',
          actor_id: 'agent-001',
          kind: 'event_driven',
          candidate_reasons: ['event_followup', 'relationship_change_followup'],
          chosen_reason: 'event_followup',
          scheduled_for_tick: baseTick + 1n,
          priority_score: 30,
          skipped_reason: null,
          created_job_id: createdJobId,
          created_at: baseTick
        },
        {
          id: randomUUID(),
          scheduler_run_id: runIdOlder,
          partition_id: 'p0',
          actor_id: 'agent-001',
          kind: 'periodic',
          candidate_reasons: ['periodic_tick'],
          chosen_reason: 'periodic_tick',
          scheduled_for_tick: baseTick - 1n,
          priority_score: 1,
          skipped_reason: 'pending_workflow',
          created_job_id: null,
          created_at: baseTick - 1n
        }
      ]
    });

    const projection = await getAgentSchedulerProjection(context, 'agent-001', { limit: 20 });

    expect(projection.actor_id).toBe('agent-001');
    expect(projection.summary.total_decisions).toBe(2);
    expect(projection.summary.created_count).toBe(1);
    expect(projection.summary.skipped_count).toBe(1);
    expect(projection.summary.periodic_count).toBe(1);
    expect(projection.summary.event_driven_count).toBe(1);
    expect(projection.summary.latest_run_id).toBe(runIdLatest);
    expect(projection.summary.latest_partition_id).toBe('p1');
    expect(projection.summary.latest_scheduled_tick).toBe((baseTick + 1n).toString());
    expect(projection.summary.top_reason?.reason).toBe('event_followup');
    expect(projection.summary.top_skipped_reason?.skipped_reason).toBe('pending_workflow');
    expect(
      projection.summary.created_count + projection.summary.skipped_count
    ).toBe(projection.summary.total_decisions);

    expect(projection.timeline).toHaveLength(2);
    expect(projection.timeline[0]?.scheduler_run_id).toBe(runIdLatest);
    expect(projection.timeline[0]?.partition_id).toBe('p1');
    expect(projection.timeline[0]?.created_job_id).toBe(createdJobId);
    expect(projection.timeline[1]?.skipped_reason).toBe('pending_workflow');
    expect(projection.timeline[0]?.coalesced_secondary_reason_count).toBe(1);
    expect(projection.timeline[0]?.has_coalesced_signals).toBe(true);
    expect(projection.timeline[1]?.coalesced_secondary_reason_count).toBe(0);
    expect(projection.timeline[1]?.has_coalesced_signals).toBe(false);

    expect(
      projection.reason_breakdown.some(item => item.reason === 'event_followup' && item.count === 1)
    ).toBe(true);
    expect(
      projection.reason_breakdown.some(item => item.reason === 'periodic_tick' && item.count === 1)
    ).toBe(true);
    expect(
      projection.skipped_reason_breakdown.some(
        item => item.skipped_reason === 'pending_workflow' && item.count === 1
      )
    ).toBe(true);

    expect(projection.linkage.recent_runs).toHaveLength(2);
    expect(projection.linkage.recent_runs[0]?.run_id).toBe(runIdLatest);
    expect(projection.linkage.recent_runs[0]?.partition_id).toBe('p1');
    expect(projection.linkage.recent_created_jobs).toHaveLength(1);
    expect(projection.linkage.recent_created_jobs[0]?.job_id).toBe(createdJobId);
    expect(projection.linkage.recent_created_jobs[0]?.partition_id).toBe('p1');
  });
});
