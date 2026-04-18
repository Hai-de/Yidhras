import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { runActionDispatcher } from '../../src/app/runtime/action_dispatcher_runner.js';
import { runDecisionJobRunner } from '../../src/app/runtime/job_runner.js';
import { createPendingDecisionJob } from '../../src/app/services/inference_workflow.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

describe('runner single-flight integration', () => {
  let cleanup: (() => Promise<void>) | null = null;
  let context: AppContext;

  beforeAll(async () => {
    const fixture = await createIsolatedAppContextFixture();
    cleanup = fixture.cleanup;
    context = fixture.context;
  });

  beforeEach(async () => {
    await context.prisma.actionIntent.deleteMany();
    await context.prisma.decisionJob.deleteMany();
    await context.prisma.inferenceTrace.deleteMany();
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it('does not execute a decision job when another active workflow already exists for the same actor', async () => {
    await createPendingDecisionJob(context, {
      idempotency_key: `single-flight-existing-${Date.now()}`,
      request_input: {
        agent_id: 'agent-001',
        identity_id: 'agent-001',
        strategy: 'mock'
      },
      intent_class: 'direct_inference'
    });
    const candidateJob = await createPendingDecisionJob(context, {
      idempotency_key: `single-flight-candidate-${Date.now()}`,
      request_input: {
        agent_id: 'agent-001',
        identity_id: 'agent-001',
        strategy: 'mock'
      },
      intent_class: 'direct_inference'
    });

    const inferenceService = {
      executeDecisionJob: async () => ({
        inference_id: 'should-not-run',
        actor_ref: {
          identity_id: 'agent-001',
          identity_type: 'agent',
          role: 'active',
          agent_id: 'agent-001',
          atmosphere_node_id: null
        }
      })
    } as never;

    const executedCount = await runDecisionJobRunner({
      context,
      inferenceService,
      workerId: 'single-flight-worker',
      limit: 10,
      concurrency: 4,
      lockTicks: 5n
    });

    expect(executedCount).toBe(0);

    const refreshedCandidate = await context.prisma.decisionJob.findUnique({ where: { id: candidateJob.id } });
    expect(refreshedCandidate?.status).toBe('running');
    expect(refreshedCandidate?.locked_by).toBe('single-flight-worker');
  });

  it('does not dispatch an action intent when another active workflow already exists for the same actor', async () => {
    const now = context.sim.getCurrentTick();
    const traceExisting = `runner-single-flight-existing-${Date.now()}`;
    const traceCandidate = `runner-single-flight-candidate-${Date.now()}`;

    await context.prisma.inferenceTrace.create({
      data: {
        id: traceExisting,
        kind: 'run',
        strategy: 'mock',
        provider: 'mock',
        actor_ref: {
          identity_id: 'agent-001',
          identity_type: 'agent',
          role: 'active',
          agent_id: 'agent-001',
          atmosphere_node_id: null
        } as Prisma.InputJsonValue,
        input: { agent_id: 'agent-001', strategy: 'mock' } as Prisma.InputJsonValue,
        context_snapshot: {} as Prisma.InputJsonValue,
        prompt_bundle: {} as Prisma.InputJsonValue,
        trace_metadata: {} as Prisma.InputJsonValue,
        created_at: now,
        updated_at: now
      }
    });
    await context.prisma.inferenceTrace.create({
      data: {
        id: traceCandidate,
        kind: 'run',
        strategy: 'mock',
        provider: 'mock',
        actor_ref: {
          identity_id: 'agent-001',
          identity_type: 'agent',
          role: 'active',
          agent_id: 'agent-001',
          atmosphere_node_id: null
        } as Prisma.InputJsonValue,
        input: { agent_id: 'agent-001', strategy: 'mock' } as Prisma.InputJsonValue,
        context_snapshot: {} as Prisma.InputJsonValue,
        prompt_bundle: {} as Prisma.InputJsonValue,
        trace_metadata: {} as Prisma.InputJsonValue,
        created_at: now,
        updated_at: now
      }
    });

    await context.prisma.actionIntent.create({
      data: {
        source_inference_id: traceExisting,
        intent_type: 'post_message',
        actor_ref: {
          identity_id: 'agent-001',
          role: 'active',
          agent_id: 'agent-001',
          atmosphere_node_id: null
        } as Prisma.InputJsonValue,
        target_ref: Prisma.JsonNull,
        payload: { content: 'existing-active-intent' } as Prisma.InputJsonValue,
        status: 'pending',
        scheduled_after_ticks: null,
        scheduled_for_tick: null,
        transmission_delay_ticks: null,
        transmission_policy: 'reliable',
        transmission_drop_chance: 0,
        drop_reason: null,
        dispatch_error_code: null,
        dispatch_error_message: null,
        locked_by: null,
        locked_at: null,
        lock_expires_at: null,
        created_at: now,
        updated_at: now
      }
    });

    const candidateIntent = await context.prisma.actionIntent.create({
      data: {
        source_inference_id: traceCandidate,
        intent_type: 'post_message',
        actor_ref: {
          identity_id: 'agent-001',
          role: 'active',
          agent_id: 'agent-001',
          atmosphere_node_id: null
        } as Prisma.InputJsonValue,
        target_ref: Prisma.JsonNull,
        payload: { content: 'candidate-intent' } as Prisma.InputJsonValue,
        status: 'pending',
        scheduled_after_ticks: null,
        scheduled_for_tick: null,
        transmission_delay_ticks: null,
        transmission_policy: 'reliable',
        transmission_drop_chance: 0,
        drop_reason: null,
        dispatch_error_code: null,
        dispatch_error_message: null,
        locked_by: null,
        locked_at: null,
        lock_expires_at: null,
        created_at: now,
        updated_at: now
      }
    });

    const dispatchedCount = await runActionDispatcher({
      context,
      workerId: 'single-flight-dispatcher',
      limit: 10,
      concurrency: 4,
      lockTicks: 5n
    });

    expect(dispatchedCount).toBe(0);

    const refreshedCandidate = await context.prisma.actionIntent.findUnique({ where: { id: candidateIntent.id } });
    expect(refreshedCandidate?.status).toBe('dispatching');
    expect(refreshedCandidate?.locked_by).toBe('single-flight-dispatcher');
  });
});
