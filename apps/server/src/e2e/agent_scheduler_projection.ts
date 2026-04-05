import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import type { AppContext } from '../app/context.js';
import { getAgentSchedulerProjection } from '../app/services/scheduler_observability.js';
import { sim } from '../core/simulation.js';
import type { SystemMessage } from '../utils/notifications.js';
import { DEFAULT_E2E_WORLD_PACK } from './config.js';

const assertCondition: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const prisma = new PrismaClient();

const createTestContext = (worldPack: string): AppContext => ({
  prisma: sim.prisma,
  sim,
  notifications: {
    push: () =>
      ({
        id: 'agent-scheduler-projection-e2e',
        level: 'info',
        content: 'agent-scheduler-projection-e2e',
        timestamp: Date.now(),
        code: 'AGENT_SCHEDULER_PROJECTION_E2E'
      }) satisfies SystemMessage,
    getMessages: () => [],
    clear: () => undefined
  },
  startupHealth: {
    level: 'ok',
    checks: { db: true, world_pack_dir: true, world_pack_available: true },
    available_world_packs: [worldPack],
    errors: []
  },
  getRuntimeReady: () => true,
  setRuntimeReady: () => undefined,
  getPaused: () => false,
  setPaused: () => undefined,
  assertRuntimeReady: () => undefined
});

async function main(): Promise<void> {
  const worldPack = process.env.WORLD_PACK ?? DEFAULT_E2E_WORLD_PACK;
  await sim.init(worldPack);

  const context = createTestContext(worldPack);
  const baseTick = context.sim.clock.getTicks();
  const createdJobId = randomUUID();
  const runIdLatest = randomUUID();
  const runIdOlder = randomUUID();

  await prisma.schedulerCandidateDecision.deleteMany({});
  await prisma.schedulerRun.deleteMany({});
  await prisma.schedulerCursor.deleteMany();
  await prisma.schedulerLease.deleteMany();
  await prisma.decisionJob.deleteMany({
    where: {
      id: createdJobId
    }
  });

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

  assertCondition(projection.actor_id === 'agent-001', 'projection should expose requested actor_id');
  assertCondition(projection.summary.total_decisions === 2, 'projection should aggregate two decisions');
  assertCondition(projection.summary.created_count === 1, 'projection should count one created decision');
  assertCondition(projection.summary.skipped_count === 1, 'projection should count one skipped decision');
  assertCondition(projection.summary.periodic_count === 1, 'projection should count one periodic decision');
  assertCondition(projection.summary.event_driven_count === 1, 'projection should count one event-driven decision');
  assertCondition(projection.summary.latest_run_id === runIdLatest, 'latest_run_id should point to the newest run');
  assertCondition(projection.summary.latest_partition_id === 'p1', 'latest_partition_id should point to the newest partition');
  assertCondition(
    projection.summary.latest_scheduled_tick === (baseTick + 1n).toString(),
    'latest_scheduled_tick should point to the newest scheduled tick'
  );
  assertCondition(projection.summary.top_reason?.reason === 'event_followup', 'top_reason should reflect newest chosen reason');
  assertCondition(
    projection.summary.top_skipped_reason?.skipped_reason === 'pending_workflow',
    'top_skipped_reason should reflect skipped decision reason'
  );
  assertCondition(
    projection.summary.created_count + projection.summary.skipped_count === projection.summary.total_decisions,
    'created_count + skipped_count should equal total_decisions'
  );

  assertCondition(projection.timeline.length === 2, 'projection timeline should return two decisions');
  assertCondition(projection.timeline[0]?.scheduler_run_id === runIdLatest, 'timeline should be ordered newest-first');
  assertCondition(projection.timeline[0]?.partition_id === 'p1', 'newest timeline item should expose partition_id');
  assertCondition(
    projection.timeline[0]?.created_job_id === createdJobId,
    'latest timeline item should expose created_job_id linkage'
  );
  assertCondition(
    projection.timeline[1]?.skipped_reason === 'pending_workflow',
    'older timeline item should preserve skipped_reason'
  );
  assertCondition(
    projection.timeline[0]?.coalesced_secondary_reason_count === 1 && projection.timeline[0]?.has_coalesced_signals === true,
    'newest timeline item should expose coalesced signal explainability'
  );
  assertCondition(
    projection.timeline[1]?.coalesced_secondary_reason_count === 0 && projection.timeline[1]?.has_coalesced_signals === false,
    'older timeline item should preserve non-coalesced explainability flags'
  );

  assertCondition(
    projection.reason_breakdown.some(item => item.reason === 'event_followup' && item.count === 1),
    'reason_breakdown should include event_followup'
  );
  assertCondition(
    projection.reason_breakdown.some(item => item.reason === 'periodic_tick' && item.count === 1),
    'reason_breakdown should include periodic_tick'
  );
  assertCondition(
    projection.skipped_reason_breakdown.some(item => item.skipped_reason === 'pending_workflow' && item.count === 1),
    'skipped_reason_breakdown should include pending_workflow'
  );

  assertCondition(projection.linkage.recent_runs.length === 2, 'recent_runs should expose both related runs');
  assertCondition(
    projection.linkage.recent_runs[0]?.run_id === runIdLatest,
    'recent_runs should be ordered newest-first'
  );
  assertCondition(
    projection.linkage.recent_runs[0]?.partition_id === 'p1',
    'recent_runs should expose partition linkage'
  );
  assertCondition(
    projection.linkage.recent_created_jobs.length === 1 &&
      projection.linkage.recent_created_jobs[0]?.job_id === createdJobId &&
      projection.linkage.recent_created_jobs[0]?.partition_id === 'p1',
    'recent_created_jobs should expose created job linkage with partition id'
  );

  console.log('[agent_scheduler_projection] PASS', {
    summary: projection.summary,
    timeline_count: projection.timeline.length,
    recent_runs_count: projection.linkage.recent_runs.length,
    recent_created_jobs_count: projection.linkage.recent_created_jobs.length
  });
}

main()
  .catch(error => {
    console.error('[agent_scheduler_projection] FAIL', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await sim.prisma.$disconnect();
  });
