import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import type { AppContext } from '../app/context.js';
import { getSchedulerOperatorProjection } from '../app/services/scheduler_observability.js';
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
        id: 'scheduler-operator-projection-e2e',
        level: 'info',
        content: 'scheduler-operator-projection-e2e',
        timestamp: Date.now(),
        code: 'SCHEDULER_OPERATOR_PROJECTION_E2E'
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
  const runId = randomUUID();
  const createdJobId = randomUUID();
  const inferenceId = randomUUID();
  const actionIntentId = randomUUID();

  await prisma.schedulerCandidateDecision.deleteMany({});
  await prisma.schedulerRun.deleteMany({});
  await prisma.schedulerOwnershipMigrationLog.deleteMany({});
  await prisma.schedulerPartitionAssignment.deleteMany({});
  await prisma.schedulerRebalanceRecommendation.deleteMany({});
  await prisma.schedulerWorkerRuntimeState.deleteMany({});
  await prisma.actionIntent.deleteMany({ where: { id: actionIntentId } });
  await prisma.decisionJob.deleteMany({ where: { id: createdJobId } });
  await prisma.inferenceTrace.deleteMany({ where: { id: inferenceId } });

  await prisma.inferenceTrace.create({
    data: {
      id: inferenceId,
      kind: 'run',
      strategy: 'mock',
      provider: 'mock',
      actor_ref: {
        identity_id: 'agent-001',
        identity_type: 'agent',
        role: 'active',
        agent_id: 'agent-001',
        atmosphere_node_id: null
      },
      input: { agent_id: 'agent-001', strategy: 'mock' },
      context_snapshot: {},
      prompt_bundle: {},
      trace_metadata: {
        inference_id: inferenceId,
        tick: baseTick.toString(),
        strategy: 'mock',
        provider: 'mock',
        world_pack_id: worldPack
      },
      decision: {},
      created_at: baseTick,
      updated_at: baseTick
    }
  });

  await prisma.actionIntent.create({
    data: {
      id: actionIntentId,
      source_inference_id: inferenceId,
      intent_type: 'post_message',
      actor_ref: {
        identity_id: 'agent-001',
        role: 'active',
        agent_id: 'agent-001',
        atmosphere_node_id: null
      },
      payload: { content: 'scheduler operator projection e2e' },
      status: 'pending',
      created_at: baseTick,
      updated_at: baseTick
    }
  });

  await prisma.decisionJob.create({
    data: {
      id: createdJobId,
      source_inference_id: inferenceId,
      action_intent_id: actionIntentId,
      job_type: 'inference_run',
      status: 'completed',
      pending_source_key: `scheduler-operator:${createdJobId}`,
      intent_class: 'scheduler_event_followup',
      attempt_count: 1,
      max_attempts: 3,
      idempotency_key: `scheduler-operator:${createdJobId}`,
      created_at: baseTick,
      updated_at: baseTick,
      completed_at: baseTick
    }
  });

  await prisma.schedulerPartitionAssignment.createMany({
    data: [
      {
        partition_id: 'p2',
        worker_id: 'scheduler-operator-worker',
        status: 'assigned',
        version: 2,
        source: 'rebalance',
        updated_at: baseTick
      },
      {
        partition_id: 'p3',
        worker_id: 'scheduler-helper-worker',
        status: 'assigned',
        version: 1,
        source: 'bootstrap',
        updated_at: baseTick - 1n
      }
    ]
  });

  await prisma.schedulerOwnershipMigrationLog.create({
    data: {
      partition_id: 'p2',
      from_worker_id: 'scheduler-old-worker',
      to_worker_id: 'scheduler-operator-worker',
      status: 'completed',
      reason: 'operator projection test',
      details: { source: 'e2e' },
      created_at: baseTick - 2n,
      updated_at: baseTick - 1n,
      completed_at: baseTick
    }
  });

  await prisma.schedulerWorkerRuntimeState.createMany({
    data: [
      {
        worker_id: 'scheduler-operator-worker',
        status: 'active',
        last_heartbeat_at: baseTick,
        owned_partition_count: 1,
        active_migration_count: 0,
        capacity_hint: 4,
        updated_at: baseTick
      },
      {
        worker_id: 'scheduler-stale-worker',
        status: 'stale',
        last_heartbeat_at: baseTick - 10n,
        owned_partition_count: 0,
        active_migration_count: 0,
        capacity_hint: 4,
        updated_at: baseTick
      }
    ]
  });

  await prisma.schedulerRebalanceRecommendation.create({
    data: {
      partition_id: 'p2',
      from_worker_id: 'scheduler-old-worker',
      to_worker_id: 'scheduler-operator-worker',
      status: 'applied',
      reason: 'worker_unhealthy',
      score: 80,
      suppress_reason: null,
      details: { automatic: true },
      created_at: baseTick - 1n,
      updated_at: baseTick,
      applied_migration_id: 'auto-mig-1'
    }
  });

  await prisma.schedulerRun.create({
    data: {
      id: runId,
      worker_id: 'scheduler-operator-worker',
      partition_id: 'p2',
      lease_holder: 'scheduler-operator-worker',
      lease_expires_at_snapshot: baseTick + 5n,
      tick: baseTick,
      summary: {
        scanned_count: 2,
        eligible_count: 1,
        created_count: 1,
        skipped_pending_count: 1,
        skipped_cooldown_count: 0,
        created_periodic_count: 0,
        created_event_driven_count: 1,
        signals_detected_count: 1,
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
      started_at: baseTick,
      finished_at: baseTick,
      created_at: baseTick,
      candidate_decisions: {
        create: [
          {
            id: randomUUID(),
            partition_id: 'p2',
            actor_id: 'agent-001',
            kind: 'event_driven',
            candidate_reasons: ['event_followup'],
            chosen_reason: 'event_followup',
            scheduled_for_tick: baseTick,
            priority_score: 30,
            skipped_reason: null,
            created_job_id: createdJobId,
            created_at: baseTick
          },
          {
            id: randomUUID(),
            partition_id: 'p2',
            actor_id: 'agent-001',
            kind: 'periodic',
            candidate_reasons: ['periodic_tick'],
            chosen_reason: 'periodic_tick',
            scheduled_for_tick: baseTick,
            priority_score: 1,
            skipped_reason: 'pending_workflow',
            created_job_id: null,
            created_at: baseTick - 1n
          }
        ]
      }
    }
  });

  const projection = await getSchedulerOperatorProjection(context, { sampleRuns: 5, recentLimit: 5 });

  assertCondition(Boolean(projection.latest_run), 'operator projection should expose latest_run');
  assertCondition(Array.isArray(projection.trends.points), 'operator projection should expose trends');
  assertCondition(Array.isArray(projection.recent_runs), 'operator projection should expose recent_runs');
  assertCondition(Array.isArray(projection.recent_decisions), 'operator projection should expose recent_decisions');
  assertCondition(Array.isArray(projection.summary.top_partitions), 'operator projection should expose top_partitions via summary');
  assertCondition(Array.isArray(projection.summary.top_workers), 'operator projection should expose top_workers via summary');
  assertCondition(Array.isArray(projection.ownership.assignments), 'operator projection should expose ownership assignments');
  assertCondition(Array.isArray(projection.ownership.recent_migrations), 'operator projection should expose recent migrations');
  assertCondition(Array.isArray(projection.ownership.summary.top_workers), 'operator projection should expose ownership top_workers');
  assertCondition(Array.isArray(projection.ownership.summary.source_breakdown), 'operator projection should expose ownership source breakdown');
  assertCondition(Array.isArray(projection.workers.items), 'operator projection should expose worker runtime items');
  assertCondition(Array.isArray(projection.rebalance.recommendations), 'operator projection should expose rebalance recommendations');
  assertCondition(Array.isArray(projection.rebalance.summary.status_breakdown), 'operator projection should expose rebalance status breakdown');
  assertCondition(Array.isArray(projection.rebalance.summary.suppress_reason_breakdown), 'operator projection should expose rebalance suppress breakdown');
  assertCondition(projection.highlights.latest_partition_id === 'p2', 'highlights should expose latest partition id');
  assertCondition(projection.highlights.latest_created_workflow_count === 1, 'highlights should expose latest created workflow count');
  assertCondition(projection.highlights.latest_skipped_count === 1, 'highlights should expose latest skipped count');
  assertCondition(projection.highlights.latest_top_reason === 'event_followup', 'highlights should expose latest top reason');
  assertCondition(projection.highlights.latest_top_intent_type === 'inference_run', 'highlights should expose latest top intent type');
  assertCondition(projection.highlights.latest_top_workflow_state === 'completed', 'highlights should expose latest top workflow state');
  assertCondition(projection.highlights.latest_top_skipped_reason === 'pending_workflow', 'highlights should expose latest top skipped reason');
  assertCondition(projection.highlights.latest_top_failure_code === null, 'highlights should expose nullable top failure code');
  assertCondition(projection.highlights.latest_failed_workflow_count === 0, 'highlights should expose failed workflow count');
  assertCondition(projection.highlights.latest_pending_workflow_count === 0, 'highlights should expose pending workflow count');
  assertCondition(projection.highlights.latest_completed_workflow_count === 1, 'highlights should expose completed workflow count');
  assertCondition(projection.highlights.latest_top_actor === 'agent-001', 'highlights should expose latest top actor');
  assertCondition(projection.highlights.migration_in_progress_count === 0, 'highlights should expose migration_in_progress_count');
  assertCondition(projection.highlights.latest_migration_partition_id === 'p2', 'highlights should expose latest migration partition');
  assertCondition(projection.highlights.latest_migration_to_worker_id === 'scheduler-operator-worker', 'highlights should expose latest migration target worker');
  assertCondition(projection.highlights.top_owner_worker_id === 'scheduler-operator-worker', 'highlights should expose top owner worker');
  assertCondition(projection.highlights.latest_rebalance_status === 'applied', 'highlights should expose latest rebalance status');
  assertCondition(projection.highlights.latest_rebalance_partition_id === 'p2', 'highlights should expose latest rebalance partition');
  assertCondition(projection.highlights.latest_rebalance_suppress_reason === null, 'highlights should expose latest rebalance suppress reason');
  assertCondition(projection.highlights.latest_stale_worker_id === 'scheduler-stale-worker', 'highlights should expose latest stale worker id');
  assertCondition(
    projection.latest_run?.run.partition_id === 'p2',
    'operator projection latest_run should expose partition id'
  );
  assertCondition(
    projection.latest_run?.run.cross_link_summary?.linked_workflow_count === 1,
    'operator projection latest_run should preserve run-level cross_link_summary'
  );
  assertCondition(
    projection.recent_decisions.some(item => item.partition_id === 'p2' && item.workflow_link?.job_id === createdJobId),
    'operator projection recent_decisions should preserve decision workflow_link and partition id'
  );
  assertCondition(
    projection.trends.points.some(point => point.partition_id === 'p2' && point.worker_id === 'scheduler-operator-worker'),
    'operator projection trends should preserve partition and worker context'
  );
  assertCondition(
    projection.ownership.assignments.some(item => item.partition_id === 'p2' && item.worker_id === 'scheduler-operator-worker'),
    'operator projection ownership assignments should preserve current owner'
  );
  assertCondition(
    projection.ownership.recent_migrations.some(item => item.partition_id === 'p2' && item.to_worker_id === 'scheduler-operator-worker'),
    'operator projection recent migrations should preserve migration history'
  );
  assertCondition(
    projection.workers.items.some(item => item.worker_id === 'scheduler-stale-worker' && item.status === 'stale'),
    'operator projection should preserve worker runtime health states'
  );
  assertCondition(
    projection.rebalance.recommendations.some(item => item.partition_id === 'p2' && item.status === 'applied'),
    'operator projection should preserve rebalance recommendation history'
  );

  console.log('[scheduler_operator_projection] PASS', {
    latest_run_id: projection.latest_run?.run.id ?? null,
    recent_runs_count: projection.recent_runs.length,
    recent_decisions_count: projection.recent_decisions.length,
    highlights: projection.highlights
  });
}

main()
  .catch(error => {
    console.error('[scheduler_operator_projection] FAIL', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await sim.prisma.$disconnect();
  });
