import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { getSchedulerOperatorProjection } from '../../src/app/services/scheduler_observability.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

describe('scheduler operator projection integration', () => {
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
    await context.prisma.schedulerOwnershipMigrationLog.deleteMany();
    await context.prisma.schedulerPartitionAssignment.deleteMany();
    await context.prisma.schedulerRebalanceRecommendation.deleteMany();
    await context.prisma.schedulerWorkerRuntimeState.deleteMany();
    await context.prisma.actionIntent.deleteMany();
    await context.prisma.decisionJob.deleteMany();
    await context.prisma.inferenceTrace.deleteMany();
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it('projects scheduler operator workspace aggregates, highlights and linked decision history', async () => {
    const prisma = context.prisma;
    const baseTick = context.sim.clock.getTicks();
    const runId = randomUUID();
    const createdJobId = randomUUID();
    const inferenceId = randomUUID();
    const actionIntentId = randomUUID();

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
          provider: 'mock'
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
        target_ref: Prisma.JsonNull,
        payload: { content: 'scheduler operator projection integration' },
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
        details: { source: 'integration' },
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

    expect(projection.latest_run).not.toBeNull();
    expect(Array.isArray(projection.trends.points)).toBe(true);
    expect(Array.isArray(projection.recent_runs)).toBe(true);
    expect(Array.isArray(projection.recent_decisions)).toBe(true);
    expect(Array.isArray(projection.summary.top_partitions)).toBe(true);
    expect(Array.isArray(projection.summary.top_workers)).toBe(true);
    expect(Array.isArray(projection.ownership.assignments)).toBe(true);
    expect(Array.isArray(projection.ownership.recent_migrations)).toBe(true);
    expect(Array.isArray(projection.ownership.summary.top_workers)).toBe(true);
    expect(Array.isArray(projection.ownership.summary.source_breakdown)).toBe(true);
    expect(Array.isArray(projection.workers.items)).toBe(true);
    expect(Array.isArray(projection.rebalance.recommendations)).toBe(true);
    expect(Array.isArray(projection.rebalance.summary.status_breakdown)).toBe(true);
    expect(Array.isArray(projection.rebalance.summary.suppress_reason_breakdown)).toBe(true);

    expect(projection.highlights.latest_partition_id).toBe('p2');
    expect(projection.highlights.latest_created_workflow_count).toBe(1);
    expect(projection.highlights.latest_skipped_count).toBe(1);
    expect(projection.highlights.latest_top_reason).toBe('event_followup');
    expect(projection.highlights.latest_top_intent_type).toBe('inference_run');
    expect(projection.highlights.latest_top_workflow_state).toBe('completed');
    expect(projection.highlights.latest_top_skipped_reason).toBe('pending_workflow');
    expect(projection.highlights.latest_top_failure_code).toBeNull();
    expect(projection.highlights.latest_failed_workflow_count).toBe(0);
    expect(projection.highlights.latest_pending_workflow_count).toBe(0);
    expect(projection.highlights.latest_completed_workflow_count).toBe(1);
    expect(projection.highlights.latest_top_actor).toBe('agent-001');
    expect(projection.highlights.migration_in_progress_count).toBe(0);
    expect(projection.highlights.latest_migration_partition_id).toBe('p2');
    expect(projection.highlights.latest_migration_to_worker_id).toBe('scheduler-operator-worker');
    expect(projection.highlights.top_owner_worker_id).toBe('scheduler-operator-worker');
    expect(projection.highlights.latest_rebalance_status).toBe('applied');
    expect(projection.highlights.latest_rebalance_partition_id).toBe('p2');
    expect(projection.highlights.latest_rebalance_suppress_reason).toBeNull();
    expect(projection.highlights.latest_stale_worker_id).toBe('scheduler-stale-worker');

    expect(projection.latest_run?.run.partition_id).toBe('p2');
    expect(projection.latest_run?.run.cross_link_summary?.linked_workflow_count).toBe(1);
    expect(
      projection.recent_decisions.some(
        item => item.partition_id === 'p2' && item.workflow_link?.job_id === createdJobId
      )
    ).toBe(true);
    expect(
      projection.trends.points.some(
        point => point.partition_id === 'p2' && point.worker_id === 'scheduler-operator-worker'
      )
    ).toBe(true);
    expect(
      projection.ownership.assignments.some(
        item => item.partition_id === 'p2' && item.worker_id === 'scheduler-operator-worker'
      )
    ).toBe(true);
    expect(
      projection.ownership.recent_migrations.some(
        item => item.partition_id === 'p2' && item.to_worker_id === 'scheduler-operator-worker'
      )
    ).toBe(true);
    expect(
      projection.workers.items.some(
        item => item.worker_id === 'scheduler-stale-worker' && item.status === 'stale'
      )
    ).toBe(true);
    expect(
      projection.rebalance.recommendations.some(
        item => item.partition_id === 'p2' && item.status === 'applied'
      )
    ).toBe(true);
  });
});
