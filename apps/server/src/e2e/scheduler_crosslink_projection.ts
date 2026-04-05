import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import type { AppContext } from '../app/context.js';
import {
  getAgentSchedulerProjection,
  getLatestSchedulerRunReadModel,
  listSchedulerDecisions
} from '../app/services/scheduler_observability.js';
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
        id: 'scheduler-crosslink-projection-e2e',
        level: 'info',
        content: 'scheduler-crosslink-projection-e2e',
        timestamp: Date.now(),
        code: 'SCHEDULER_CROSSLINK_PROJECTION_E2E'
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
      payload: { content: 'scheduler crosslink e2e' },
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
      pending_source_key: `scheduler-crosslink:${createdJobId}`,
      intent_class: 'scheduler_event_followup',
      attempt_count: 1,
      max_attempts: 3,
      idempotency_key: `scheduler-crosslink:${createdJobId}`,
      created_at: baseTick,
      updated_at: baseTick,
      completed_at: baseTick
    }
  });

  await prisma.schedulerRun.create({
    data: {
      id: runId,
      worker_id: 'scheduler-crosslink-worker',
      partition_id: 'p3',
      lease_holder: 'scheduler-crosslink-worker',
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
            partition_id: 'p3',
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
            partition_id: 'p3',
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
  const decisions = await listSchedulerDecisions(context, { actor_id: 'agent-001', limit: 10, partition_id: 'p3' });
  const projection = await getAgentSchedulerProjection(context, 'agent-001', { limit: 10 });

  assertCondition(Boolean(latestRun), 'latest run should exist');
  assertCondition((latestRun?.candidates.length ?? 0) >= 1, 'latest run should expose candidate decisions');
  const latestRunCreatedDecision = latestRun?.candidates.find(item => item.created_job_id === createdJobId) ?? null;
  const latestRunSkippedDecision = latestRun?.candidates.find(item => item.created_job_id === null) ?? null;
  assertCondition(latestRun?.run.partition_id === 'p3', 'latest run should expose partition_id');
  assertCondition(Boolean(latestRunCreatedDecision?.workflow_link), 'created decision should expose workflow_link on run read model');
  assertCondition(latestRunSkippedDecision?.workflow_link === null, 'skipped decision should expose null workflow_link on run read model');

  const createdDecision = decisions.items.find(item => item.created_job_id === createdJobId) ?? null;
  const skippedDecision = decisions.items.find(item => item.created_job_id === null) ?? null;
  assertCondition(Boolean(createdDecision), 'decisions list should include created decision');
  assertCondition(Boolean(skippedDecision), 'decisions list should include skipped decision');
  assertCondition(createdDecision?.partition_id === 'p3', 'decisions list should expose partition id');
  assertCondition(createdDecision?.workflow_link?.job_id === createdJobId, 'workflow_link should expose job_id');
  assertCondition(createdDecision?.workflow_link?.status === 'completed', 'workflow_link should expose job status');
  assertCondition(
    createdDecision?.workflow_link?.intent_class === 'scheduler_event_followup',
    'workflow_link should expose intent_class'
  );
  assertCondition(createdDecision?.workflow_link?.workflow_state === 'completed', 'workflow_link should expose workflow_state');
  assertCondition(createdDecision?.workflow_link?.action_intent_id === actionIntentId, 'workflow_link should expose action_intent_id');
  assertCondition(createdDecision?.workflow_link?.inference_id === inferenceId, 'workflow_link should expose inference_id');
  assertCondition(createdDecision?.workflow_link?.intent_type === 'inference_run', 'workflow_link should expose intent_type summary');
  assertCondition(createdDecision?.workflow_link?.dispatch_stage === 'completed', 'workflow_link should expose dispatch_stage summary');
  assertCondition(createdDecision?.workflow_link?.failure_stage === null, 'workflow_link should expose nullable failure_stage');
  assertCondition(createdDecision?.workflow_link?.failure_code === null, 'workflow_link should expose nullable failure_code');
  assertCondition(
    createdDecision?.workflow_link?.outcome_summary_excerpt?.attempt_count === 1,
    'workflow_link should expose outcome_summary_excerpt'
  );
  assertCondition(createdDecision?.workflow_link?.audit_entry?.summary === 'inference_run -> completed', 'workflow_link should expose audit summary');
  assertCondition(
    createdDecision?.workflow_link?.audit_entry?.kind === 'workflow' &&
      createdDecision.workflow_link.audit_entry.id === createdJobId,
    'workflow_link should expose workflow audit entry linkage'
  );
  assertCondition(skippedDecision?.workflow_link === null, 'skipped decision should not expose workflow_link');

  const projectionCreatedDecision = projection.timeline.find(item => item.created_job_id === createdJobId) ?? null;
  assertCondition(Boolean(projectionCreatedDecision?.workflow_link), 'agent projection timeline should expose workflow_link');
  assertCondition(
    projectionCreatedDecision?.partition_id === 'p3',
    'agent projection timeline workflow_link should keep partition linkage'
  );
  assertCondition(
    projectionCreatedDecision?.workflow_link?.audit_entry?.id === createdJobId,
    'agent projection timeline workflow_link should keep audit linkage'
  );

  console.log('[scheduler_crosslink_projection] PASS', {
    latest_run_candidate_count: latestRun?.candidates.length ?? 0,
    decisions_count: decisions.items.length,
    projection_timeline_count: projection.timeline.length,
    workflow_link: createdDecision?.workflow_link ?? null
  });
}

main()
  .catch(error => {
    console.error('[scheduler_crosslink_projection] FAIL', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await sim.prisma.$disconnect();
  });
