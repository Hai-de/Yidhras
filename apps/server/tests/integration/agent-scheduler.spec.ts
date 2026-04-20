import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { runAgentScheduler } from '../../src/app/runtime/agent_scheduler.js';
import { claimDecisionJob } from '../../src/app/services/inference_workflow.js';
import {
  getLatestSchedulerRunReadModel,
  getSchedulerRunReadModelById,
  getSchedulerSummarySnapshot
} from '../../src/app/services/scheduler_observability.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

describe('agent scheduler integration', () => {
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
    await context.prisma.schedulerRebalanceRecommendation.deleteMany();
    await context.prisma.schedulerWorkerRuntimeState.deleteMany();
    await context.prisma.schedulerOwnershipMigrationLog.deleteMany();
    await context.prisma.schedulerPartitionAssignment.deleteMany();
    await context.prisma.relationshipAdjustmentLog.deleteMany();
    await context.prisma.sNRAdjustmentLog.deleteMany();
    await context.prisma.event.deleteMany();
    await context.prisma.actionIntent.deleteMany();
    await context.prisma.decisionJob.deleteMany();
    await context.prisma.inferenceTrace.deleteMany();
    await context.prisma.contextOverlayEntry.deleteMany();
    await context.prisma.memoryBlock.deleteMany();
    await context.prisma.memoryCompactionState.deleteMany();
    await context.prisma.relationship.deleteMany();

    const baseTick = context.sim.clock.getTicks();
    await context.prisma.agent.upsert({
      where: { id: 'agent-001' },
      update: {
        name: 'Scheduler Agent 001',
        type: 'active',
        snr: 0.7,
        updated_at: baseTick
      },
      create: {
        id: 'agent-001',
        name: 'Scheduler Agent 001',
        type: 'active',
        snr: 0.7,
        is_pinned: false,
        created_at: baseTick,
        updated_at: baseTick
      }
    });

    await context.prisma.agent.upsert({
      where: { id: 'agent-002' },
      update: {
        name: 'Scheduler Agent 002',
        type: 'active',
        snr: 0.6,
        updated_at: baseTick
      },
      create: {
        id: 'agent-002',
        name: 'Scheduler Agent 002',
        type: 'active',
        snr: 0.6,
        is_pinned: false,
        created_at: baseTick,
        updated_at: baseTick
      }
    });
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it('creates periodic and event-driven jobs, preserves read models, and exposes fine-grained replay/retry suppression', async () => {
    const prisma = context.prisma;

    const beforeCount = await prisma.decisionJob.count({
      where: {
        idempotency_key: {
          startsWith: 'sch:'
        }
      }
    });

    const activeAgentCount = await prisma.agent.count({
      where: {
        type: 'active'
      }
    });
    expect(activeAgentCount).toBeGreaterThan(0);

    const pendingSchedulerBaseline = await prisma.decisionJob.count({
      where: {
        status: {
          in: ['pending', 'running']
        },
        idempotency_key: {
          startsWith: 'sch:'
        }
      }
    });
    expect(pendingSchedulerBaseline).toBe(0);

    const firstRun = await runAgentScheduler({
      context,
      limit: 10
    });

    const afterFirstCount = await prisma.decisionJob.count({
      where: {
        idempotency_key: {
          startsWith: 'sch:'
        }
      }
    });

    expect(firstRun.created_count).toBeGreaterThan(0);
    expect(afterFirstCount).toBeGreaterThan(beforeCount);
    expect(typeof firstRun.scheduler_run_id).toBe('string');

    const latestReadModel = await getLatestSchedulerRunReadModel(context);
    const firstRunReadModels = Array.isArray(firstRun.scheduler_run_ids)
      ? await Promise.all(
          firstRun.scheduler_run_ids.map(async runId => ({
            runId,
            readModel: await getSchedulerRunReadModelById(context, runId)
          }))
        )
      : [];
    expect(latestReadModel).not.toBeNull();
    expect(
      firstRunReadModels.some(item => Array.isArray(item.readModel?.candidates) && item.readModel.candidates.length > 0)
    ).toBe(true);

    const secondRun = await runAgentScheduler({
      context,
      limit: 10
    });

    const afterSecondCount = await prisma.decisionJob.count({
      where: {
        idempotency_key: {
          startsWith: 'sch:'
        }
      }
    });

    expect(secondRun.created_count).toBe(0);
    expect(afterSecondCount).toBe(afterFirstCount);
    expect(
      secondRun.skipped_by_reason.pending_workflow > 0 ||
        secondRun.skipped_by_reason.replay_window_periodic_suppressed > 0 ||
        secondRun.skipped_by_reason.retry_window_periodic_suppressed > 0
    ).toBe(true);

    const scheduledJobs = await prisma.decisionJob.findMany({
      where: {
        idempotency_key: {
          startsWith: 'sch:'
        }
      },
      orderBy: {
        created_at: 'desc'
      },
      take: 20
    });

    const periodicJobs = scheduledJobs.filter(job => {
      const requestInputRaw = job.request_input;
      if (!requestInputRaw || typeof requestInputRaw !== 'object' || Array.isArray(requestInputRaw)) {
        return false;
      }
      const attributesRaw = (requestInputRaw as Record<string, unknown>).attributes;
      return Boolean(
        attributesRaw &&
          typeof attributesRaw === 'object' &&
          !Array.isArray(attributesRaw) &&
          (attributesRaw as Record<string, unknown>).scheduler_kind === 'periodic'
      );
    });

    expect(periodicJobs.length).toBeGreaterThan(0);

    for (const job of periodicJobs) {
      const requestInputRaw = job.request_input;
      expect(requestInputRaw).not.toBeNull();
      expect(typeof requestInputRaw).toBe('object');
      expect(Array.isArray(requestInputRaw)).toBe(false);
      const requestInput = requestInputRaw as Record<string, unknown>;
      expect(typeof requestInput.agent_id).toBe('string');
      expect(typeof requestInput.idempotency_key).toBe('string');
      expect((requestInput.idempotency_key as string).startsWith('sch:')).toBe(true);

      const attributesRaw = requestInput.attributes;
      expect(attributesRaw).not.toBeNull();
      expect(typeof attributesRaw).toBe('object');
      expect(Array.isArray(attributesRaw)).toBe(false);
      const attributes = attributesRaw as Record<string, unknown>;
      expect(typeof job.scheduled_for_tick).toBe('bigint');
      expect(job.intent_class).toBe('scheduler_periodic');
      expect(attributes.scheduler_source).toBe('runtime_loop');
      expect(attributes.job_intent_class).toBe('scheduler_periodic');
      expect(attributes.job_source).toBe('scheduler');
      expect(attributes.scheduler_kind).toBe('periodic');
      expect(attributes.scheduler_reason).toBe('periodic_tick');
      expect(Array.isArray(attributes.scheduler_secondary_reasons)).toBe(true);
      expect((attributes.scheduler_secondary_reasons as unknown[]).length).toBe(0);
      expect(attributes.scheduler_priority_score).toBe(1);
      expect(attributes.scheduler_scheduled_for_tick).toBe(job.scheduled_for_tick?.toString());
    }

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

    const futureClaim = await claimDecisionJob(context, {
      job_id: futureJob.id,
      worker_id: 'scheduler-integration-worker',
      now: futureBaseTick,
      lock_ticks: 5n
    });
    expect(futureClaim).toBeNull();

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
      update: {
        weight: 0.8,
        updated_at: followupTick
      },
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
          attributes: {
            job_intent_class: 'replay_recovery',
            job_source: 'replay'
          }
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
          attributes: {
            job_intent_class: 'retry_recovery',
            job_source: 'retry'
          }
        },
        created_at: followupTick,
        updated_at: followupTick,
        completed_at: followupTick
      }
    });

    await prisma.decisionJob.deleteMany({
      where: {
        status: 'pending',
        idempotency_key: {
          startsWith: 'sch:agent-001:'
        }
      }
    });

    await prisma.decisionJob.deleteMany({
      where: {
        status: 'pending',
        idempotency_key: {
          startsWith: 'sch:agent-002:'
        }
      }
    });

    const followupRun = await runAgentScheduler({ context, limit: 10 });
    expect(
      followupRun.created_event_driven_count > 0 ||
        followupRun.skipped_by_reason.pending_workflow > 0 ||
        followupRun.skipped_by_reason.existing_same_idempotency > 0 ||
        followupRun.signals_detected_count > 0
    ).toBe(true);
    expect(
      followupRun.skipped_by_reason.event_coalesced > 0 ||
        followupRun.skipped_by_reason.pending_workflow > 0 ||
        followupRun.skipped_by_reason.existing_same_idempotency > 0 ||
        followupRun.signals_detected_count > 0
    ).toBe(true);
    expect(typeof followupRun.skipped_by_reason.replay_window_periodic_suppressed).toBe('number');
    expect(typeof followupRun.skipped_by_reason.retry_window_periodic_suppressed).toBe('number');
    expect(typeof followupRun.skipped_by_reason.replay_window_event_suppressed).toBe('number');
    expect(typeof followupRun.skipped_by_reason.retry_window_event_suppressed).toBe('number');

    const eventDrivenJobs = await prisma.decisionJob.findMany({
      where: {
        idempotency_key: {
          startsWith: 'sch:'
        }
      },
      orderBy: {
        created_at: 'desc'
      }
    });
    const followupJobsForAgent001 = eventDrivenJobs.filter(job => {
      const requestInputRaw = job.request_input;
      if (!requestInputRaw || typeof requestInputRaw !== 'object' || Array.isArray(requestInputRaw)) {
        return false;
      }
      const requestInput = requestInputRaw as Record<string, unknown>;
      if (requestInput.agent_id !== 'agent-001') {
        return false;
      }
      const attributesRaw = requestInput.attributes;
      if (!attributesRaw || typeof attributesRaw !== 'object' || Array.isArray(attributesRaw)) {
        return false;
      }
      const attributes = attributesRaw as Record<string, unknown>;
      return attributes.scheduler_kind === 'event_driven';
    });
    const followupJobAgent001 = followupJobsForAgent001[0];
    expect(followupJobAgent001).toBeDefined();
    expect(followupJobAgent001?.scheduled_for_tick).not.toBeNull();
    expect((followupJobAgent001?.scheduled_for_tick ?? 0n) > followupTick).toBe(true);

    const followupRequestInput = followupJobAgent001?.request_input as Record<string, unknown>;
    const followupAttributes = (followupRequestInput.attributes ?? null) as Record<string, unknown> | null;
    expect(followupJobAgent001?.intent_class).toBe('scheduler_event_followup');
    expect(followupAttributes?.job_intent_class).toBe('scheduler_event_followup');
    expect(followupAttributes?.job_source).toBe('scheduler');
    expect(followupAttributes?.scheduler_reason).toBe('event_followup');
    expect(Array.isArray(followupAttributes?.scheduler_secondary_reasons)).toBe(true);
    expect((followupAttributes?.scheduler_secondary_reasons as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect(
      (followupAttributes?.scheduler_secondary_reasons as string[]).every(
        reason => reason === 'relationship_change_followup' || reason === 'snr_change_followup'
      )
    ).toBe(true);
    expect(followupAttributes?.scheduler_priority_score).toBe(30);

    const followupJobsForAgent002 = eventDrivenJobs.filter(job => {
      const requestInputRaw = job.request_input;
      if (!requestInputRaw || typeof requestInputRaw !== 'object' || Array.isArray(requestInputRaw)) {
        return false;
      }
      const requestInput = requestInputRaw as Record<string, unknown>;
      if (requestInput.agent_id !== 'agent-002') {
        return false;
      }
      const attributesRaw = requestInput.attributes;
      if (!attributesRaw || typeof attributesRaw !== 'object' || Array.isArray(attributesRaw)) {
        return false;
      }
      const attributes = attributesRaw as Record<string, unknown>;
      return attributes.scheduler_kind === 'event_driven' && attributes.scheduler_reason === 'event_followup';
    });
    expect(followupJobsForAgent002.length).toBeGreaterThan(0);
    expect(typeof followupRun.scheduler_run_id).toBe('string');

    const followupReadModels = Array.isArray(followupRun.scheduler_run_ids)
      ? await Promise.all(followupRun.scheduler_run_ids.map(runId => getSchedulerRunReadModelById(context, runId)))
      : [];
    expect(followupReadModels.length).toBeGreaterThan(0);
    expect(
      followupReadModels.some(
        readModel =>
          readModel?.candidates.some(
            candidate => candidate.actor_id === 'agent-001' && candidate.kind === 'event_driven' && candidate.skipped_reason === null
          ) ?? false
      )
    ).toBe(true);
    expect(
      followupReadModels.some(
        readModel =>
          readModel?.candidates.some(
            candidate => candidate.actor_id === 'agent-002' && candidate.kind === 'event_driven'
          ) ?? false
      )
    ).toBe(true);
    expect(
      followupReadModels.some(
        readModel =>
          readModel?.candidates.some(
            candidate =>
              candidate.actor_id === 'agent-001' &&
              candidate.kind === 'event_driven' &&
              candidate.coalesced_secondary_reason_count > 0 &&
              candidate.has_coalesced_signals === true
          ) ?? false
      )
    ).toBe(true);
    const hasPeriodicRecoverySuppression = followupReadModels.some(
      readModel =>
        readModel?.candidates.some(
          candidate =>
            candidate.skipped_reason === 'replay_window_periodic_suppressed' ||
            candidate.skipped_reason === 'retry_window_periodic_suppressed'
        ) ?? false
    );
    const hasPeriodicBudgetFallback = followupReadModels.some(
      readModel =>
        readModel?.candidates.some(
          candidate => candidate.kind === 'periodic' && candidate.skipped_reason === 'limit_reached'
        ) ?? false
    );
    expect(
      hasPeriodicRecoverySuppression || hasPeriodicBudgetFallback
    ).toBe(true);

    await prisma.relationshipAdjustmentLog.deleteMany({
      where: {
        action_intent_id: {
          startsWith: 'scheduler-e2e-intent-rel-only-'
        }
      }
    });
    await prisma.event.deleteMany({
      where: {
        source_action_intent_id: followupIntentId
      }
    });
    await prisma.decisionJob.deleteMany({
      where: {
        OR: [
          { idempotency_key: { startsWith: 'scheduler-e2e-replay-' } },
          { idempotency_key: { startsWith: 'scheduler-e2e-retry-' } }
        ]
      }
    });
    await prisma.decisionJob.deleteMany({
      where: {
        status: {
          in: ['pending', 'running']
        },
        idempotency_key: {
          startsWith: 'sch:agent-002:'
        }
      }
    });

    context.sim.clock.tick(1n);
    const lowPriorityReplayTick = context.sim.clock.getTicks();
    const lowPriorityRelationshipIntentId = `scheduler-e2e-intent-rel-only-${Date.now()}`;
    const lowPriorityRelationshipTraceId = `scheduler-e2e-trace-rel-only-${Date.now()}`;
    const lowPriorityReplayPendingKey = `scheduler-e2e-replay-low-priority-${Date.now()}`;
    const lowPriorityReplayRequestKey = `scheduler-e2e-replay-low-priority-request-${Date.now()}`;
    const lowPriorityRelationship = await prisma.relationship.upsert({
      where: {
        from_id_to_id_type: {
          from_id: 'agent-002',
          to_id: 'agent-001',
          type: 'ally'
        }
      },
      update: {
        weight: 0.9,
        updated_at: lowPriorityReplayTick
      },
      create: {
        id: `scheduler-e2e-rel-only-${Date.now()}`,
        from_id: 'agent-002',
        to_id: 'agent-001',
        type: 'ally',
        weight: 0.9,
        created_at: lowPriorityReplayTick,
        updated_at: lowPriorityReplayTick
      }
    });

    await prisma.inferenceTrace.create({
      data: {
        id: lowPriorityRelationshipTraceId,
        kind: 'run',
        strategy: 'mock',
        provider: 'mock',
        actor_ref: {
          identity_id: 'agent-002',
          identity_type: 'agent',
          role: 'active',
          agent_id: 'agent-002',
          atmosphere_node_id: null
        },
        input: { agent_id: 'agent-002', strategy: 'mock' },
        context_snapshot: {},
        prompt_bundle: {},
        trace_metadata: {
          inference_id: lowPriorityRelationshipTraceId,
          tick: lowPriorityReplayTick.toString(),
          strategy: 'mock',
          provider: 'mock'
        },
        decision: {},
        created_at: lowPriorityReplayTick,
        updated_at: lowPriorityReplayTick
      }
    });
    await prisma.actionIntent.create({
      data: {
        id: lowPriorityRelationshipIntentId,
        source_inference_id: lowPriorityRelationshipTraceId,
        intent_type: 'adjust_relationship',
        actor_ref: {
          identity_id: 'agent-002',
          role: 'active',
          agent_id: 'agent-002',
          atmosphere_node_id: null
        },
        target_ref: Prisma.JsonNull,
        payload: {
          target_agent_id: 'agent-001',
          relationship_type: 'ally',
          new_weight: 0.9
        },
        status: 'completed',
        created_at: lowPriorityReplayTick,
        updated_at: lowPriorityReplayTick,
        dispatched_at: lowPriorityReplayTick
      }
    });
    await prisma.relationshipAdjustmentLog.create({
      data: {
        id: `scheduler-e2e-rel-log-only-${Date.now()}`,
        action_intent_id: lowPriorityRelationshipIntentId,
        relationship_id: lowPriorityRelationship.id,
        from_id: 'agent-002',
        to_id: 'agent-001',
        type: 'ally',
        operation: 'set',
        old_weight: 0.1,
        new_weight: 0.9,
        reason: 'scheduler integration low-priority replay suppression',
        created_at: lowPriorityReplayTick
      }
    });
    await prisma.decisionJob.create({
      data: {
        pending_source_key: lowPriorityReplayPendingKey,
        job_type: 'inference_run',
        status: 'completed',
        idempotency_key: lowPriorityReplayPendingKey,
        intent_class: 'replay_recovery',
        attempt_count: 1,
        max_attempts: 3,
        request_input: {
          agent_id: 'agent-002',
          identity_id: 'agent-002',
          strategy: 'rule_based',
          idempotency_key: lowPriorityReplayRequestKey,
          attributes: {
            job_intent_class: 'replay_recovery',
            job_source: 'replay'
          }
        },
        created_at: lowPriorityReplayTick,
        updated_at: lowPriorityReplayTick,
        completed_at: lowPriorityReplayTick
      }
    });

    const replaySuppressedRun = await runAgentScheduler({ context, limit: 10 });
    const replaySuppressedReadModels = Array.isArray(replaySuppressedRun.scheduler_run_ids)
      ? await Promise.all(replaySuppressedRun.scheduler_run_ids.map(runId => getSchedulerRunReadModelById(context, runId)))
      : [];
    expect(
      replaySuppressedRun.skipped_by_reason.replay_window_event_suppressed > 0 ||
        replaySuppressedReadModels.some(
          readModel =>
            readModel?.candidates.some(
              candidate =>
                candidate.actor_id === 'agent-002' &&
                candidate.kind === 'event_driven' &&
                candidate.skipped_reason === 'replay_window_event_suppressed'
            ) ?? false
        )
    ).toBe(true);

    await prisma.relationshipAdjustmentLog.deleteMany({
      where: {
        action_intent_id: lowPriorityRelationshipIntentId
      }
    });
    await prisma.decisionJob.deleteMany({
      where: {
        OR: [
          { idempotency_key: { startsWith: 'scheduler-e2e-replay-' } },
          { idempotency_key: { startsWith: 'scheduler-e2e-retry-' } }
        ]
      }
    });
    await prisma.decisionJob.deleteMany({
      where: {
        status: {
          in: ['pending', 'running']
        },
        idempotency_key: {
          startsWith: 'sch:agent-002:'
        }
      }
    });

    context.sim.clock.tick(1n);
    const lowPriorityRetryTick = context.sim.clock.getTicks();
    const lowPrioritySnrTraceId = `scheduler-e2e-trace-snr-only-${Date.now()}`;
    const lowPrioritySnrIntentId = `scheduler-e2e-intent-snr-only-${Date.now()}`;
    const lowPriorityRetryPendingKey = `scheduler-e2e-retry-low-priority-${Date.now()}`;
    const lowPriorityRetryRequestKey = `scheduler-e2e-retry-low-priority-request-${Date.now()}`;

    await prisma.inferenceTrace.create({
      data: {
        id: lowPrioritySnrTraceId,
        kind: 'run',
        strategy: 'mock',
        provider: 'mock',
        actor_ref: {
          identity_id: 'agent-002',
          identity_type: 'agent',
          role: 'active',
          agent_id: 'agent-002',
          atmosphere_node_id: null
        },
        input: { agent_id: 'agent-002', strategy: 'mock' },
        context_snapshot: {},
        prompt_bundle: {},
        trace_metadata: {
          inference_id: lowPrioritySnrTraceId,
          tick: lowPriorityRetryTick.toString(),
          strategy: 'mock',
          provider: 'mock'
        },
        decision: {},
        created_at: lowPriorityRetryTick,
        updated_at: lowPriorityRetryTick
      }
    });
    await prisma.actionIntent.create({
      data: {
        id: lowPrioritySnrIntentId,
        source_inference_id: lowPrioritySnrTraceId,
        intent_type: 'adjust_snr',
        actor_ref: {
          identity_id: 'agent-002',
          role: 'active',
          agent_id: 'agent-002',
          atmosphere_node_id: null
        },
        target_ref: Prisma.JsonNull,
        payload: {
          requested_value: 0.4
        },
        status: 'completed',
        created_at: lowPriorityRetryTick,
        updated_at: lowPriorityRetryTick,
        dispatched_at: lowPriorityRetryTick
      }
    });
    await prisma.sNRAdjustmentLog.create({
      data: {
        id: `scheduler-e2e-snr-only-${Date.now()}`,
        action_intent_id: lowPrioritySnrIntentId,
        agent_id: 'agent-002',
        operation: 'set',
        requested_value: 0.4,
        baseline_value: 0.2,
        resolved_value: 0.4,
        reason: 'scheduler integration low-priority retry suppression',
        created_at: lowPriorityRetryTick
      }
    });
    await prisma.decisionJob.create({
      data: {
        pending_source_key: lowPriorityRetryPendingKey,
        job_type: 'inference_run',
        status: 'completed',
        idempotency_key: lowPriorityRetryPendingKey,
        intent_class: 'retry_recovery',
        attempt_count: 1,
        max_attempts: 3,
        request_input: {
          agent_id: 'agent-002',
          identity_id: 'agent-002',
          strategy: 'rule_based',
          idempotency_key: lowPriorityRetryRequestKey,
          attributes: {
            job_intent_class: 'retry_recovery',
            job_source: 'retry'
          }
        },
        created_at: lowPriorityRetryTick,
        updated_at: lowPriorityRetryTick,
        completed_at: lowPriorityRetryTick
      }
    });

    const retrySuppressedRun = await runAgentScheduler({ context, limit: 10 });
    const retrySuppressedReadModels = Array.isArray(retrySuppressedRun.scheduler_run_ids)
      ? await Promise.all(retrySuppressedRun.scheduler_run_ids.map(runId => getSchedulerRunReadModelById(context, runId)))
      : [];
    expect(
      retrySuppressedRun.skipped_by_reason.retry_window_event_suppressed > 0 ||
        retrySuppressedReadModels.some(
          readModel =>
            readModel?.candidates.some(
              candidate =>
                candidate.actor_id === 'agent-002' &&
                candidate.kind === 'event_driven' &&
                candidate.skipped_reason === 'retry_window_event_suppressed'
            ) ?? false
        )
    ).toBe(true);

    const summarySnapshot = await getSchedulerSummarySnapshot(context, { sampleRuns: 10 });
    expect(Array.isArray(summarySnapshot.top_skipped_reasons)).toBe(true);
    expect(
      summarySnapshot.top_skipped_reasons.some(
        item =>
          item.skipped_reason === 'pending_workflow' ||
          item.skipped_reason === 'replay_window_periodic_suppressed' ||
          item.skipped_reason === 'retry_window_periodic_suppressed' ||
          item.skipped_reason === 'replay_window_event_suppressed' ||
          item.skipped_reason === 'retry_window_event_suppressed'
      )
    ).toBe(true);
  });
});
