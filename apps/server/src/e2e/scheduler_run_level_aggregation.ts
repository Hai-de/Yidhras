import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import type { AppContext } from '../app/context.js';
import {
  getLatestSchedulerRunReadModel,
  getSchedulerRunReadModelById
} from '../app/services/scheduler_observability.js';
import { sim } from '../core/simulation.js';
import type { SystemMessage } from '../utils/notifications.js';

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
        id: 'scheduler-runagg-e2e',
        level: 'info',
        content: 'scheduler-runagg-e2e',
        timestamp: Date.now(),
        code: 'SCHEDULER_RUNAGG_E2E'
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
  const worldPack = process.env.WORLD_PACK ?? 'cyber_noir';
  await sim.init(worldPack);

  const context = createTestContext(worldPack);
  const baseTick = context.sim.clock.getTicks();
  const runId = randomUUID();
  const createdJobId = randomUUID();
  const inferenceId = randomUUID();
  const actionIntentId = randomUUID();

  await prisma.schedulerCandidateDecision.deleteMany({});
  await prisma.schedulerRun.deleteMany({});
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
      payload: { content: 'scheduler run aggregation e2e' },
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
      pending_source_key: `scheduler-runagg:${createdJobId}`,
      intent_class: 'scheduler_event_followup',
      attempt_count: 1,
      max_attempts: 3,
      idempotency_key: `scheduler-runagg:${createdJobId}`,
      created_at: baseTick,
      updated_at: baseTick,
      completed_at: baseTick
    }
  });

  await prisma.schedulerRun.create({
    data: {
      id: runId,
      worker_id: 'scheduler-runagg-worker',
      partition_id: 'p2',
      lease_holder: 'scheduler-runagg-worker',
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

  const latestRun = await getLatestSchedulerRunReadModel(context);
  const runById = await getSchedulerRunReadModelById(context, runId);

  assertCondition(Boolean(latestRun?.run.cross_link_summary), 'latest run should expose cross_link_summary');
  assertCondition(Boolean(runById?.run.cross_link_summary), 'run by id should expose cross_link_summary');
  assertCondition(latestRun?.run.partition_id === 'p2', 'latest run should expose partition_id');
  assertCondition(runById?.run.partition_id === 'p2', 'run by id should expose partition_id');
  assertCondition(
    latestRun?.run.cross_link_summary?.linked_workflow_count === 1,
    'linked_workflow_count should match created workflow count'
  );
  assertCondition(
    latestRun?.run.cross_link_summary?.workflow_state_breakdown.some(item => item.workflow_state === 'completed' && item.count === 1),
    'workflow_state_breakdown should include completed state'
  );
  assertCondition(
    latestRun?.run.cross_link_summary?.linked_intent_type_breakdown.some(item => item.intent_type === 'inference_run' && item.count === 1),
    'linked_intent_type_breakdown should include inference_run'
  );
  assertCondition(
    latestRun?.run.cross_link_summary?.status_breakdown.some(item => item.status === 'completed' && item.count === 1),
    'status_breakdown should include completed status'
  );
  assertCondition(
    latestRun?.run.cross_link_summary?.recent_audit_summaries[0]?.job_id === createdJobId,
    'recent_audit_summaries should expose job linkage'
  );
  assertCondition(
    latestRun?.run.cross_link_summary?.recent_audit_summaries[0]?.summary === 'inference_run -> completed',
    'recent_audit_summaries should expose workflow summary'
  );
  assertCondition(
    runById?.run.cross_link_summary?.linked_workflow_count === latestRun?.run.cross_link_summary?.linked_workflow_count,
    'latest/byId run summary should stay consistent'
  );

  console.log('[scheduler_run_level_aggregation] PASS', {
    latest_run_cross_link_summary: latestRun?.run.cross_link_summary ?? null,
    run_by_id_cross_link_summary: runById?.run.cross_link_summary ?? null
  });
}

main()
  .catch(error => {
    console.error('[scheduler_run_level_aggregation] FAIL', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await sim.prisma.$disconnect();
  });
