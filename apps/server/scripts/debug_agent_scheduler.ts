import { Prisma } from '@prisma/client';

import type { AppContext } from '../src/app/context.js';
import { runAgentScheduler } from '../src/app/runtime/agent_scheduler.js';
import { claimDecisionJob } from '../src/app/services/inference_workflow.js';
import { getSchedulerRunReadModelById } from '../src/app/services/scheduler_observability.js';
import { createIsolatedAppContextFixture } from '../tests/fixtures/isolated-db.js';

const main = async (): Promise<void> => {
  const fixture = await createIsolatedAppContextFixture();
  const context: AppContext = fixture.context;
  const prisma = context.prisma;

  try {
    await prisma.schedulerCandidateDecision.deleteMany();
    await prisma.schedulerRun.deleteMany();
    await prisma.schedulerCursor.deleteMany();
    await prisma.schedulerLease.deleteMany();
    await prisma.schedulerRebalanceRecommendation.deleteMany();
    await prisma.schedulerWorkerRuntimeState.deleteMany();
    await prisma.schedulerOwnershipMigrationLog.deleteMany();
    await prisma.schedulerPartitionAssignment.deleteMany();
    await prisma.relationshipAdjustmentLog.deleteMany();
    await prisma.sNRAdjustmentLog.deleteMany();
    await prisma.event.deleteMany();
    await prisma.actionIntent.deleteMany();
    await prisma.decisionJob.deleteMany();
    await prisma.inferenceTrace.deleteMany();
    await prisma.contextOverlayEntry.deleteMany();
    await prisma.memoryBlock.deleteMany();
    await prisma.memoryCompactionState.deleteMany();
    await prisma.relationship.deleteMany();

    const baseTick = context.sim.clock.getTicks();
    for (const [id, name, snr] of [['agent-001', 'Scheduler Agent 001', 0.7], ['agent-002', 'Scheduler Agent 002', 0.6]] as const) {
      await prisma.agent.upsert({
        where: { id },
        update: { name, type: 'active', snr, updated_at: baseTick },
        create: { id, name, type: 'active', snr, is_pinned: false, created_at: baseTick, updated_at: baseTick }
      });
    }

    console.log('tick-start', baseTick.toString());
    const firstRun = await runAgentScheduler({ context, limit: 10 });
    console.log('firstRun', JSON.stringify(firstRun, null, 2));
    const secondRun = await runAgentScheduler({ context, limit: 10 });
    console.log('secondRun', JSON.stringify(secondRun, null, 2));

    const futureBaseTick = context.sim.clock.getTicks();
    const futureTick = futureBaseTick + 10n;
    const futureIdempotencyKey = `sch:agent-001:${futureBaseTick.toString()}:event_driven:event_followup`;
    await prisma.decisionJob.deleteMany({ where: { idempotency_key: futureIdempotencyKey } });
    const futureJob = await prisma.decisionJob.create({
      data: {
        pending_source_key: futureIdempotencyKey,
        job_type: 'inference_run',
        status: 'pending',
        idempotency_key: futureIdempotencyKey,
        attempt_count: 0,
        max_attempts: 3,
        request_input: {
          agent_id: 'agent-001',
          identity_id: 'agent-001',
          strategy: 'rule_based',
          idempotency_key: futureIdempotencyKey,
          attributes: {
            scheduler_source: 'runtime_loop',
            scheduler_kind: 'event_driven',
            scheduler_reason: 'event_followup',
            scheduler_secondary_reasons: [],
            scheduler_priority_score: 30,
            scheduler_tick: futureBaseTick.toString(),
            scheduler_scheduled_for_tick: futureTick.toString()
          }
        },
        scheduled_for_tick: futureTick,
        created_at: futureBaseTick,
        updated_at: futureBaseTick
      }
    });
    await claimDecisionJob(context, {
      job_id: futureJob.id,
      worker_id: 'scheduler-integration-worker',
      now: futureBaseTick,
      lock_ticks: 5n
    });

    const followupTick = context.sim.clock.getTicks();
    const followupTraceId = `scheduler-e2e-trace-${Date.now()}`;
    const followupIntentId = `scheduler-e2e-intent-${Date.now()}`;
    const followupEventTitle = `scheduler-e2e-event-${Date.now()}`;
    const recoveryReplayKey = `scheduler-e2e-replay-${Date.now()}`;
    const recoveryRetryKey = `scheduler-e2e-retry-${Date.now()}`;
    const relationshipId = `scheduler-e2e-rel-${Date.now()}`;

    await prisma.relationship.upsert({
      where: {
        from_id_to_id_type: {
          from_id: 'agent-001',
          to_id: 'agent-002',
          type: 'friend'
        }
      },
      update: { weight: 0.8, updated_at: followupTick },
      create: {
        id: relationshipId,
        from_id: 'agent-001',
        to_id: 'agent-002',
        type: 'friend',
        weight: 0.8,
        created_at: followupTick,
        updated_at: followupTick
      }
    });

    await prisma.inferenceTrace.create({
      data: {
        id: followupTraceId,
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
          inference_id: followupTraceId,
          tick: followupTick.toString(),
          strategy: 'mock',
          provider: 'mock'
        },
        decision: {},
        created_at: followupTick,
        updated_at: followupTick
      }
    });

    await prisma.actionIntent.create({
      data: {
        id: followupIntentId,
        source_inference_id: followupTraceId,
        intent_type: 'trigger_event',
        actor_ref: {
          identity_id: 'agent-001',
          role: 'active',
          agent_id: 'agent-001',
          atmosphere_node_id: null
        },
        target_ref: Prisma.JsonNull,
        payload: {
          event_type: 'history',
          title: followupEventTitle,
          description: 'scheduler integration followup'
        },
        status: 'completed',
        created_at: followupTick,
        updated_at: followupTick,
        dispatched_at: followupTick
      }
    });

    await prisma.event.create({
      data: {
        title: followupEventTitle,
        description: 'scheduler integration followup',
        tick: followupTick,
        type: 'history',
        impact_data: JSON.stringify({
          semantic_type: 'suspicious_death_occurred',
          followup_actor_ids: ['agent-002']
        }),
        source_action_intent_id: followupIntentId,
        created_at: followupTick
      }
    });

    await prisma.relationshipAdjustmentLog.create({
      data: {
        id: `scheduler-e2e-rel-log-${Date.now()}`,
        action_intent_id: followupIntentId,
        relationship_id: relationshipId,
        from_id: 'agent-001',
        to_id: 'agent-002',
        type: 'friend',
        operation: 'set',
        old_weight: 0.2,
        new_weight: 0.8,
        reason: 'scheduler integration relationship followup',
        created_at: followupTick
      }
    });

    await prisma.sNRAdjustmentLog.create({
      data: {
        id: `scheduler-e2e-snr-log-${Date.now()}`,
        action_intent_id: followupIntentId,
        agent_id: 'agent-001',
        operation: 'set',
        requested_value: 0.7,
        baseline_value: 0.5,
        resolved_value: 0.7,
        reason: 'scheduler integration snr followup',
        created_at: followupTick
      }
    });

    await prisma.decisionJob.create({
      data: {
        pending_source_key: recoveryReplayKey,
        job_type: 'inference_run',
        status: 'completed',
        idempotency_key: recoveryReplayKey,
        intent_class: 'replay_recovery',
        attempt_count: 1,
        max_attempts: 3,
        request_input: {
          agent_id: 'agent-001',
          identity_id: 'agent-001',
          strategy: 'rule_based',
          idempotency_key: recoveryReplayKey,
          attributes: { job_intent_class: 'replay_recovery', job_source: 'replay' }
        },
        created_at: followupTick,
        updated_at: followupTick,
        completed_at: followupTick
      }
    });

    await prisma.decisionJob.create({
      data: {
        pending_source_key: recoveryRetryKey,
        job_type: 'inference_run',
        status: 'completed',
        idempotency_key: recoveryRetryKey,
        intent_class: 'retry_recovery',
        attempt_count: 1,
        max_attempts: 3,
        request_input: {
          agent_id: 'agent-002',
          identity_id: 'agent-002',
          strategy: 'rule_based',
          idempotency_key: recoveryRetryKey,
          attributes: { job_intent_class: 'retry_recovery', job_source: 'retry' }
        },
        created_at: followupTick,
        updated_at: followupTick,
        completed_at: followupTick
      }
    });

    await prisma.decisionJob.deleteMany({
      where: { status: 'pending', idempotency_key: { startsWith: 'sch:agent-001:' } }
    });
    await prisma.decisionJob.deleteMany({
      where: { status: 'pending', idempotency_key: { startsWith: 'sch:agent-002:' } }
    });

    const followupRun = await runAgentScheduler({ context, limit: 10 });
    console.log('followupRun', JSON.stringify(followupRun, null, 2));
    const readModels = Array.isArray(followupRun.scheduler_run_ids)
      ? await Promise.all(followupRun.scheduler_run_ids.map(runId => getSchedulerRunReadModelById(context, runId)))
      : [];
    console.log('followupReadModels', JSON.stringify(readModels, null, 2));
  } finally {
    await fixture.cleanup();
  }
};

void main();
