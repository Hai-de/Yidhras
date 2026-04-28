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
      update: { name: 'Scheduler Agent 001', type: 'active', snr: 0.7, updated_at: baseTick },
      create: { id: 'agent-001', name: 'Scheduler Agent 001', type: 'active', snr: 0.7, is_pinned: false, created_at: baseTick, updated_at: baseTick }
    });
    await context.prisma.agent.upsert({
      where: { id: 'agent-002' },
      update: { name: 'Scheduler Agent 002', type: 'active', snr: 0.6, updated_at: baseTick },
      create: { id: 'agent-002', name: 'Scheduler Agent 002', type: 'active', snr: 0.6, is_pinned: false, created_at: baseTick, updated_at: baseTick }
    });
  });

  afterAll(async () => {
    await cleanup?.();
  });

  describe('periodic scheduling', () => {
    it('creates periodic decision jobs for active agents on first run', async () => {
      const prisma = context.prisma;
      const beforeCount = await prisma.decisionJob.count({ where: { idempotency_key: { startsWith: 'sch:' } } });
      const activeAgentCount = await prisma.agent.count({ where: { type: 'active' } });
      expect(activeAgentCount).toBeGreaterThan(0);

      const firstRun = await runAgentScheduler({ context, limit: 10 });
      const afterCount = await prisma.decisionJob.count({ where: { idempotency_key: { startsWith: 'sch:' } } });

      expect(firstRun.created_count).toBeGreaterThan(0);
      expect(afterCount).toBeGreaterThan(beforeCount);
      expect(typeof firstRun.scheduler_run_id).toBe('string');
    });

    it('suppresses duplicate jobs on second run due to pending workflow', async () => {
      const prisma = context.prisma;
      await runAgentScheduler({ context, limit: 10 });
      const afterFirst = await prisma.decisionJob.count({ where: { idempotency_key: { startsWith: 'sch:' } } });

      const secondRun = await runAgentScheduler({ context, limit: 10 });
      const afterSecond = await prisma.decisionJob.count({ where: { idempotency_key: { startsWith: 'sch:' } } });

      expect(secondRun.created_count).toBe(0);
      expect(afterSecond).toBe(afterFirst);
      expect(
        secondRun.skipped_by_reason.pending_workflow > 0 ||
        secondRun.skipped_by_reason.replay_window_periodic_suppressed > 0 ||
        secondRun.skipped_by_reason.retry_window_periodic_suppressed > 0
      ).toBe(true);
    });

    it('produces valid periodic job structure with scheduler attributes', async () => {
      const prisma = context.prisma;
      await runAgentScheduler({ context, limit: 10 });

      const jobs = await prisma.decisionJob.findMany({
        where: { idempotency_key: { startsWith: 'sch:' } },
        orderBy: { created_at: 'desc' },
        take: 20
      });

      const periodicJobs = jobs.filter(job => {
        const raw = job.request_input;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
        const attrs = (raw as Record<string, unknown>).attributes;
        return Boolean(attrs && typeof attrs === 'object' && !Array.isArray(attrs) && (attrs as Record<string, unknown>).scheduler_kind === 'periodic');
      });

      expect(periodicJobs.length).toBeGreaterThan(0);
      for (const job of periodicJobs) {
        const input = job.request_input as Record<string, unknown>;
        expect(typeof input.agent_id).toBe('string');
        expect(typeof input.idempotency_key).toBe('string');
        expect((input.idempotency_key as string).startsWith('sch:')).toBe(true);

        const attrs = input.attributes as Record<string, unknown>;
        expect(typeof job.scheduled_for_tick).toBe('bigint');
        expect(job.intent_class).toBe('scheduler_periodic');
        expect(attrs.scheduler_source).toBe('runtime_loop');
        expect(attrs.scheduler_kind).toBe('periodic');
        expect(attrs.scheduler_reason).toBe('periodic_tick');
        expect(Array.isArray(attrs.scheduler_secondary_reasons)).toBe(true);
        expect(attrs.scheduler_priority_score).toBe(1);
      }
    });
  });

  describe('read models', () => {
    it('exposes latest scheduler run read model', async () => {
      await runAgentScheduler({ context, limit: 10 });
      const latest = await getLatestSchedulerRunReadModel(context);
      expect(latest).not.toBeNull();
    });

    it('returns candidates in run read model by id', async () => {
      const firstRun = await runAgentScheduler({ context, limit: 10 });
      if (Array.isArray(firstRun.scheduler_run_ids)) {
        const models = await Promise.all(
          firstRun.scheduler_run_ids.map(runId => getSchedulerRunReadModelById(context, runId))
        );
        expect(models.some(m => Array.isArray(m?.candidates) && m.candidates.length > 0)).toBe(true);
      }
    });
  });

  describe('future-dated jobs', () => {
    it('rejects claims on jobs scheduled for a future tick', async () => {
      await runAgentScheduler({ context, limit: 10 });
      const baseTick = context.sim.clock.getTicks();
      const futureTick = baseTick + 10n;
      const key = `sch:agent-001:${baseTick.toString()}:event_driven:event_followup`;

      await context.prisma.decisionJob.deleteMany({ where: { idempotency_key: key } });
      const futureJob = await context.prisma.decisionJob.create({
        data: {
          pending_source_key: key, job_type: 'inference_run', status: 'pending',
          idempotency_key: key, attempt_count: 0, max_attempts: 3,
          request_input: {
            agent_id: 'agent-001', identity_id: 'agent-001', strategy: 'rule_based', idempotency_key: key,
            attributes: { scheduler_source: 'runtime_loop', scheduler_kind: 'event_driven', scheduler_reason: 'event_followup', scheduler_secondary_reasons: [], scheduler_priority_score: 30, scheduler_tick: baseTick.toString(), scheduler_scheduled_for_tick: futureTick.toString() }
          },
          scheduled_for_tick: futureTick, created_at: baseTick, updated_at: baseTick
        }
      });

      const claim = await claimDecisionJob(context, { job_id: futureJob.id, worker_id: 'worker', now: baseTick, lock_ticks: 5n });
      expect(claim).toBeNull();
    });
  });

  describe('event-driven followup', () => {
    it('detects relationship and SNR changes and creates event-driven jobs', async () => {
      const prisma = context.prisma;
      await runAgentScheduler({ context, limit: 10 });

      const tick = context.sim.clock.getTicks();
      const traceId = `sched-int-trace-${Date.now()}`;
      const intentId = `sched-int-intent-${Date.now()}`;
      const eventTitle = `sched-int-event-${Date.now()}`;
      const relId = `sched-int-rel-${Date.now()}`;

      await prisma.relationship.upsert({
        where: { from_id_to_id_type: { from_id: 'agent-001', to_id: 'agent-002', type: 'friend' } },
        update: { weight: 0.8, updated_at: tick },
        create: { id: relId, from_id: 'agent-001', to_id: 'agent-002', type: 'friend', weight: 0.8, created_at: tick, updated_at: tick }
      });
      await prisma.inferenceTrace.create({
        data: { id: traceId, kind: 'run', strategy: 'mock', provider: 'mock', actor_ref: { identity_id: 'agent-001', identity_type: 'agent', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null }, input: { agent_id: 'agent-001', strategy: 'mock' }, context_snapshot: {}, prompt_bundle: {}, trace_metadata: { inference_id: traceId, tick: tick.toString() }, decision: {}, created_at: tick, updated_at: tick }
      });
      await prisma.actionIntent.create({
        data: { id: intentId, source_inference_id: traceId, intent_type: 'trigger_event', actor_ref: { identity_id: 'agent-001', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null }, target_ref: Prisma.JsonNull, payload: { event_type: 'history', title: eventTitle, description: 'followup' }, status: 'completed', created_at: tick, updated_at: tick, dispatched_at: tick }
      });
      await prisma.event.create({
        data: { title: eventTitle, description: 'followup', tick, type: 'history', impact_data: JSON.stringify({ semantic_type: 'suspicious_death_occurred', followup_actor_ids: ['agent-002'] }), source_action_intent_id: intentId, created_at: tick }
      });
      await prisma.relationshipAdjustmentLog.create({
        data: { id: `sched-int-rel-log-${Date.now()}`, action_intent_id: intentId, relationship_id: relId, from_id: 'agent-001', to_id: 'agent-002', type: 'friend', operation: 'set', old_weight: 0.2, new_weight: 0.8, reason: 'followup', created_at: tick }
      });
      await prisma.sNRAdjustmentLog.create({
        data: { id: `sched-int-snr-log-${Date.now()}`, action_intent_id: intentId, agent_id: 'agent-001', operation: 'set', requested_value: 0.7, baseline_value: 0.5, resolved_value: 0.7, reason: 'followup', created_at: tick }
      });

      await prisma.decisionJob.deleteMany({ where: { status: 'pending', idempotency_key: { startsWith: 'sch:agent-001:' } } });
      await prisma.decisionJob.deleteMany({ where: { status: 'pending', idempotency_key: { startsWith: 'sch:agent-002:' } } });

      const followupRun = await runAgentScheduler({ context, limit: 10 });

      expect(typeof followupRun.skipped_by_reason.replay_window_periodic_suppressed).toBe('number');
      expect(typeof followupRun.skipped_by_reason.retry_window_periodic_suppressed).toBe('number');
      expect(typeof followupRun.skipped_by_reason.replay_window_event_suppressed).toBe('number');
      expect(typeof followupRun.skipped_by_reason.retry_window_event_suppressed).toBe('number');
      expect(typeof followupRun.scheduler_run_id).toBe('string');

      const eventDriven = await prisma.decisionJob.findMany({
        where: { idempotency_key: { startsWith: 'sch:' } },
        orderBy: { created_at: 'desc' }
      });

      const agent001Jobs = eventDriven.filter(j => {
        const raw = j.request_input;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
        const inp = raw as Record<string, unknown>;
        if (inp.agent_id !== 'agent-001') return false;
        const attrs = inp.attributes;
        return Boolean(attrs && typeof attrs === 'object' && !Array.isArray(attrs) && (attrs as Record<string, unknown>).scheduler_kind === 'event_driven');
      });
      expect(agent001Jobs.length).toBeGreaterThan(0);
      expect(agent001Jobs[0]?.intent_class).toBe('scheduler_event_followup');
    });
  });

  describe('replay window suppression', () => {
    it('suppresses event-driven jobs when a recent replay recovery exists', async () => {
      const prisma = context.prisma;
      await runAgentScheduler({ context, limit: 10 });

      const tick = context.sim.clock.getTicks();
      const intentId = `sched-replay-intent-${Date.now()}`;
      const traceId = `sched-replay-trace-${Date.now()}`;
      const replayKey = `sched-replay-key-${Date.now()}`;
      const reqKey = `sched-replay-req-${Date.now()}`;
      const relId = `sched-replay-rel-${Date.now()}`;

      await prisma.relationship.upsert({
        where: { from_id_to_id_type: { from_id: 'agent-002', to_id: 'agent-001', type: 'ally' } },
        update: { weight: 0.9, updated_at: tick },
        create: { id: relId, from_id: 'agent-002', to_id: 'agent-001', type: 'ally', weight: 0.9, created_at: tick, updated_at: tick }
      });
      await prisma.inferenceTrace.create({
        data: { id: traceId, kind: 'run', strategy: 'mock', provider: 'mock', actor_ref: { identity_id: 'agent-002', identity_type: 'agent', role: 'active', agent_id: 'agent-002', atmosphere_node_id: null }, input: { agent_id: 'agent-002' }, context_snapshot: {}, prompt_bundle: {}, trace_metadata: { inference_id: traceId, tick: tick.toString() }, decision: {}, created_at: tick, updated_at: tick }
      });
      await prisma.actionIntent.create({
        data: { id: intentId, source_inference_id: traceId, intent_type: 'adjust_relationship', actor_ref: { identity_id: 'agent-002', role: 'active', agent_id: 'agent-002', atmosphere_node_id: null }, target_ref: Prisma.JsonNull, payload: { target_agent_id: 'agent-001', relationship_type: 'ally', new_weight: 0.9 }, status: 'completed', created_at: tick, updated_at: tick, dispatched_at: tick }
      });
      await prisma.relationshipAdjustmentLog.create({
        data: { id: `sched-replay-rel-log-${Date.now()}`, action_intent_id: intentId, relationship_id: relId, from_id: 'agent-002', to_id: 'agent-001', type: 'ally', operation: 'set', old_weight: 0.1, new_weight: 0.9, reason: 'replay test', created_at: tick }
      });
      await prisma.decisionJob.create({
        data: { pending_source_key: replayKey, job_type: 'inference_run', status: 'completed', idempotency_key: replayKey, intent_class: 'replay_recovery', attempt_count: 1, max_attempts: 3, request_input: { agent_id: 'agent-002', identity_id: 'agent-002', strategy: 'rule_based', idempotency_key: reqKey, attributes: { job_intent_class: 'replay_recovery', job_source: 'replay' } }, created_at: tick, updated_at: tick, completed_at: tick }
      });

      await prisma.decisionJob.deleteMany({ where: { status: 'pending', idempotency_key: { startsWith: 'sch:agent-002:' } } });

      const run = await runAgentScheduler({ context, limit: 10 });
      const models = Array.isArray(run.scheduler_run_ids)
        ? await Promise.all(run.scheduler_run_ids.map(id => getSchedulerRunReadModelById(context, id)))
        : [];

      expect(
        run.skipped_by_reason.replay_window_event_suppressed > 0 ||
        models.some(m => m?.candidates.some(c => c.actor_id === 'agent-002' && c.kind === 'event_driven' && c.skipped_reason === 'replay_window_event_suppressed') ?? false)
      ).toBe(true);
    });
  });

  describe('retry window suppression', () => {
    it('suppresses event-driven jobs when a recent retry recovery exists', async () => {
      const prisma = context.prisma;
      await runAgentScheduler({ context, limit: 10 });

      const tick = context.sim.clock.getTicks();
      const traceId = `sched-retry-trace-${Date.now()}`;
      const intentId = `sched-retry-intent-${Date.now()}`;
      const retryKey = `sched-retry-key-${Date.now()}`;
      const reqKey = `sched-retry-req-${Date.now()}`;

      await prisma.inferenceTrace.create({
        data: { id: traceId, kind: 'run', strategy: 'mock', provider: 'mock', actor_ref: { identity_id: 'agent-002', identity_type: 'agent', role: 'active', agent_id: 'agent-002', atmosphere_node_id: null }, input: { agent_id: 'agent-002' }, context_snapshot: {}, prompt_bundle: {}, trace_metadata: { inference_id: traceId, tick: tick.toString() }, decision: {}, created_at: tick, updated_at: tick }
      });
      await prisma.actionIntent.create({
        data: { id: intentId, source_inference_id: traceId, intent_type: 'adjust_snr', actor_ref: { identity_id: 'agent-002', role: 'active', agent_id: 'agent-002', atmosphere_node_id: null }, target_ref: Prisma.JsonNull, payload: { requested_value: 0.4 }, status: 'completed', created_at: tick, updated_at: tick, dispatched_at: tick }
      });
      await prisma.sNRAdjustmentLog.create({
        data: { id: `sched-retry-snr-${Date.now()}`, action_intent_id: intentId, agent_id: 'agent-002', operation: 'set', requested_value: 0.4, baseline_value: 0.2, resolved_value: 0.4, reason: 'retry test', created_at: tick }
      });
      await prisma.decisionJob.create({
        data: { pending_source_key: retryKey, job_type: 'inference_run', status: 'completed', idempotency_key: retryKey, intent_class: 'retry_recovery', attempt_count: 1, max_attempts: 3, request_input: { agent_id: 'agent-002', identity_id: 'agent-002', strategy: 'rule_based', idempotency_key: reqKey, attributes: { job_intent_class: 'retry_recovery', job_source: 'retry' } }, created_at: tick, updated_at: tick, completed_at: tick }
      });

      await prisma.decisionJob.deleteMany({ where: { status: 'pending', idempotency_key: { startsWith: 'sch:agent-002:' } } });

      const run = await runAgentScheduler({ context, limit: 10 });
      const models = Array.isArray(run.scheduler_run_ids)
        ? await Promise.all(run.scheduler_run_ids.map(id => getSchedulerRunReadModelById(context, id)))
        : [];

      expect(
        run.skipped_by_reason.retry_window_event_suppressed > 0 ||
        models.some(m => m?.candidates.some(c => c.actor_id === 'agent-002' && c.kind === 'event_driven' && c.skipped_reason === 'retry_window_event_suppressed') ?? false)
      ).toBe(true);
    });
  });

  describe('summary snapshot', () => {
    it('returns top skipped reasons covering all suppression types', async () => {
      // First run creates jobs; second run produces pending_workflow skips.
      await runAgentScheduler({ context, limit: 10 });
      await runAgentScheduler({ context, limit: 10 });
      const snapshot = await getSchedulerSummarySnapshot(context, { sampleRuns: 10 });

      expect(Array.isArray(snapshot.top_skipped_reasons)).toBe(true);
      expect(
        snapshot.top_skipped_reasons.some(item =>
          ['pending_workflow', 'replay_window_periodic_suppressed', 'retry_window_periodic_suppressed', 'replay_window_event_suppressed', 'retry_window_event_suppressed'].includes(item.skipped_reason)
        )
      ).toBe(true);
    });
  });
});
