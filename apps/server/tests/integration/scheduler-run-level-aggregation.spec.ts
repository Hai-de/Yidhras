import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import {
  getLatestSchedulerRunReadModel,
  getSchedulerRunReadModelById
} from '../../src/app/services/scheduler_observability.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

describe('scheduler run level aggregation integration', () => {
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
    await context.prisma.actionIntent.deleteMany();
    await context.prisma.decisionJob.deleteMany();
    await context.prisma.inferenceTrace.deleteMany();
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it('aggregates cross-linked workflow state and audit summaries at scheduler run level', async () => {
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
        payload: { content: 'scheduler run aggregation integration' },
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

    expect(latestRun?.run.cross_link_summary).toBeTruthy();
    expect(runById?.run.cross_link_summary).toBeTruthy();
    expect(latestRun?.run.partition_id).toBe('p2');
    expect(runById?.run.partition_id).toBe('p2');
    expect(latestRun?.run.cross_link_summary?.linked_workflow_count).toBe(1);
    expect(
      latestRun?.run.cross_link_summary?.workflow_state_breakdown.some(
        item => item.workflow_state === 'completed' && item.count === 1
      )
    ).toBe(true);
    expect(
      latestRun?.run.cross_link_summary?.linked_intent_type_breakdown.some(
        item => item.intent_type === 'inference_run' && item.count === 1
      )
    ).toBe(true);
    expect(
      latestRun?.run.cross_link_summary?.status_breakdown.some(
        item => item.status === 'completed' && item.count === 1
      )
    ).toBe(true);
    expect(latestRun?.run.cross_link_summary?.recent_audit_summaries[0]?.job_id).toBe(createdJobId);
    expect(latestRun?.run.cross_link_summary?.recent_audit_summaries[0]?.summary).toBe(
      'inference_run -> completed'
    );
    expect(runById?.run.cross_link_summary?.linked_workflow_count).toBe(
      latestRun?.run.cross_link_summary?.linked_workflow_count
    );
  });
});
