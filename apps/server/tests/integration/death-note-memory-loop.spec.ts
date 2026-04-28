import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { runActionDispatcher } from '../../src/app/runtime/action_dispatcher_runner.js';
import { runAgentScheduler } from '../../src/app/runtime/agent_scheduler.js';
import { createMemoryCompactionService } from '../../src/memory/recording/compaction_service.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

describe('death note memory loop integration', () => {
  let cleanup: (() => Promise<void>) | null = null;
  let context: AppContext;

  beforeAll(async () => {
    const fixture = await createIsolatedAppContextFixture();
    cleanup = fixture.cleanup;
    context = fixture.context;
    context.sim.getActivePack = () => ({
      metadata: { id: 'world-death-note', name: '死亡笔记', version: '0.5.0' },
      ai: {
        memory_loop: {
          summary_every_n_rounds: 999,
          compaction_every_n_rounds: 999
        }
      }
    }) as never;
    context.sim.resolvePackVariables = (value: string) => value;
  });

  beforeEach(async () => {
    await context.prisma.schedulerCandidateDecision.deleteMany();
    await context.prisma.schedulerRun.deleteMany();
    await context.prisma.schedulerCursor.deleteMany();
    await context.prisma.schedulerLease.deleteMany();
    await context.prisma.relationshipAdjustmentLog.deleteMany();
    await context.prisma.sNRAdjustmentLog.deleteMany();
    await context.prisma.event.deleteMany();
    await context.prisma.actionIntent.deleteMany();
    await context.prisma.decisionJob.deleteMany();
    await context.prisma.inferenceTrace.deleteMany();
    await context.prisma.contextOverlayEntry.deleteMany();
    await context.prisma.memoryBlock.deleteMany();
    await context.prisma.memoryCompactionState.deleteMany();

    const baseTick = context.sim.getCurrentTick();
    await context.prisma.agent.upsert({
      where: { id: 'agent-001' },
      update: {
        name: '夜神月',
        type: 'active',
        snr: 0.8,
        updated_at: baseTick
      },
      create: {
        id: 'agent-001',
        name: '夜神月',
        type: 'active',
        snr: 0.8,
        is_pinned: false,
        created_at: baseTick,
        updated_at: baseTick
      }
    });
    await context.prisma.identity.upsert({
      where: { id: 'agent-001' },
      update: {
        type: 'agent',
        name: '夜神月',
        provider: 'test',
        status: 'active',
        updated_at: baseTick
      },
      create: {
        id: 'agent-001',
        type: 'agent',
        name: '夜神月',
        provider: 'test',
        status: 'active',
        created_at: baseTick,
        updated_at: baseTick
      }
    });
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it('creates memory mutations after execution and lets scheduler detect them as follow-up signals', async () => {
    const now = context.sim.getCurrentTick();
    const inferenceId = `memory-loop-trace-${Date.now()}`;
    const intentId = `memory-loop-intent-${Date.now()}`;

    await context.prisma.inferenceTrace.create({
      data: {
        id: inferenceId,
        kind: 'final',
        strategy: 'rule_based',
        provider: 'rule_based',
        actor_ref: {
          identity_id: 'agent-001',
          identity_type: 'agent',
          role: 'active',
          agent_id: 'agent-001',
          atmosphere_node_id: null
        } as Prisma.InputJsonValue,
        input: { agent_id: 'agent-001', strategy: 'rule_based' } as Prisma.InputJsonValue,
        context_snapshot: {} as Prisma.InputJsonValue,
        prompt_bundle: {} as Prisma.InputJsonValue,
        trace_metadata: {
          memory_mutations: {
            records: [{ kind: 'overlay', action: 'created', source: 'decision_reflection' }]
          }
        } as Prisma.InputJsonValue,
        decision: {
          action_type: 'semantic_intent',
          target_ref: { entity_id: 'agent-002', kind: 'actor', agent_id: 'agent-002' },
          payload: { semantic_intent_kind: 'record_execution_postmortem' }
        } as Prisma.InputJsonValue,
        created_at: now,
        updated_at: now
      }
    });

    await context.prisma.actionIntent.create({
      data: {
        id: intentId,
        source_inference_id: inferenceId,
        intent_type: 'trigger_event',
        actor_ref: {
          identity_id: 'agent-001', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null
        } as Prisma.InputJsonValue,
        target_ref: { entity_id: 'agent-002', kind: 'actor', agent_id: 'agent-002' } as Prisma.InputJsonValue,
        payload: {
          event_type: 'history',
          title: '夜神月记录执行复盘',
          description: '夜神月把最近一次行动带来的风险与结果整理成内部复盘。',
          impact_data: { semantic_type: 'execution_postmortem_recorded' }
        } as Prisma.InputJsonValue,
        status: 'pending', scheduled_after_ticks: null, scheduled_for_tick: null, transmission_delay_ticks: null,
        transmission_policy: 'reliable', transmission_drop_chance: 0, drop_reason: null, dispatch_error_code: null,
        dispatch_error_message: null, locked_by: null, locked_at: null, lock_expires_at: null, created_at: now, updated_at: now
      }
    });

    const dispatchedCount = await runActionDispatcher({
      context,
      workerId: 'memory-loop-test-dispatcher',
      limit: 10
    });
    expect(dispatchedCount).toBeGreaterThanOrEqual(0);

    const overlaysAfterExecution = await context.prisma.contextOverlayEntry.findMany({
      where: { actor_id: 'agent-001' },
      orderBy: { updated_at_tick: 'desc' }
    });
    const memoryBlocksAfterExecution = await context.prisma.memoryBlock.findMany({
      where: { owner_agent_id: 'agent-001' },
      orderBy: { updated_at_tick: 'desc' }
    });
    expect(overlaysAfterExecution.length).toBeGreaterThan(0);
    expect(memoryBlocksAfterExecution.length).toBeGreaterThan(0);

    const trace = await context.prisma.inferenceTrace.findUnique({ where: { id: inferenceId } });
    expect(trace).not.toBeNull();
    const traceMetadata = trace && isRecord(trace.trace_metadata) ? trace.trace_metadata : null;
    const traceMemoryMutations = traceMetadata && isRecord(traceMetadata.memory_mutations) && Array.isArray(traceMetadata.memory_mutations.records)
      ? traceMetadata.memory_mutations.records
      : [];
    expect(traceMemoryMutations.length).toBeGreaterThan(0);

    const schedulerResult = await runAgentScheduler({
      context,
      workerId: 'memory-loop-test-scheduler',
      limit: 10
    });

    expect(schedulerResult.signals_detected_count).toBeGreaterThan(0);

    const compactionService = createMemoryCompactionService({
      context,
      aiTaskService: {
        async runTask() {
          return { task_id: 'mock-memory-loop-task', invocation: { invocation_id: inferenceId }, output: { summary: '压缩后的内部记忆摘要' } };
        }
      } as never
    });
    await context.prisma.memoryCompactionState.upsert({
      where: { agent_id: 'agent-001' },
      update: {
        inference_count_since_summary: 999,
        inference_count_since_compaction: 999
      },
      create: {
        agent_id: 'agent-001',
        inference_count_since_summary: 999,
        inference_count_since_compaction: 999,
        updated_at_tick: context.sim.getCurrentTick()
      }
    });
    const compactionResult = await compactionService.runForAgent({ agent_id: 'agent-001' });
    expect(compactionResult).not.toBeNull();
    expect(compactionResult?.triggered).toBeDefined();

    const compactionState = await context.prisma.memoryCompactionState.findUnique({
      where: { agent_id: 'agent-001' }
    });
    expect(compactionState).not.toBeNull();

    const latestRun = await context.prisma.schedulerRun.findFirst({
      orderBy: { created_at: 'desc' },
      include: { candidate_decisions: true }
    });
    expect(latestRun).not.toBeNull();
    const candidateReasons = latestRun?.candidate_decisions.flatMap(item =>
      Array.isArray(item.candidate_reasons) ? item.candidate_reasons : []
    ) ?? [];
    expect(Array.isArray(candidateReasons)).toBe(true);

    expect(
      schedulerResult.created_event_driven_count > 0 || schedulerResult.signals_detected_count > 0
    ).toBe(true);
  });

  it('records revise_judgement_plan as overlay and plan memory block during action dispatch', async () => {
    const now = context.sim.getCurrentTick();
    const inferenceId = `revise-plan-trace-${Date.now()}`;
    const intentId = `revise-plan-intent-${Date.now()}`;

    await context.prisma.inferenceTrace.create({
      data: {
        id: inferenceId,
        kind: 'final',
        strategy: 'rule_based',
        provider: 'rule_based',
        actor_ref: {
          identity_id: 'agent-001',
          identity_type: 'agent',
          role: 'active',
          agent_id: 'agent-001',
          atmosphere_node_id: null
        } as Prisma.InputJsonValue,
        input: { agent_id: 'agent-001', strategy: 'rule_based' } as Prisma.InputJsonValue,
        context_snapshot: {} as Prisma.InputJsonValue,
        prompt_bundle: {} as Prisma.InputJsonValue,
        trace_metadata: {
          memory_mutations: {
            records: [{ kind: 'overlay', action: 'created', source: 'judgement_plan' }]
          }
        } as Prisma.InputJsonValue,
        decision: {
          action_type: 'semantic_intent',
          target_ref: { entity_id: 'agent-002', kind: 'actor', agent_id: 'agent-002' },
          payload: { semantic_intent_kind: 'revise_judgement_plan' }
        } as Prisma.InputJsonValue,
        created_at: now,
        updated_at: now
      }
    });

    await context.prisma.actionIntent.create({
      data: {
        id: intentId,
        source_inference_id: inferenceId,
        intent_type: 'trigger_event',
        actor_ref: {
          identity_id: 'agent-001', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null
        } as Prisma.InputJsonValue,
        target_ref: { entity_id: 'agent-002', kind: 'actor', agent_id: 'agent-002' } as Prisma.InputJsonValue,
        payload: {
          event_type: 'history',
          title: '夜神月重新修订了当前计划',
          description: '夜神月对下一步行动顺序、风险和时机判断做了新的内部规划。',
          impact_data: { semantic_type: 'judgement_plan_revised' }
        } as Prisma.InputJsonValue,
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
      workerId: 'revise-plan-test-dispatcher',
      limit: 10
    });

    expect(dispatchedCount).toBeGreaterThanOrEqual(0);

    const overlays = await context.prisma.contextOverlayEntry.findMany({
      where: { actor_id: 'agent-001' },
      orderBy: { created_at_tick: 'desc' }
    });
    const memoryBlocks = await context.prisma.memoryBlock.findMany({
      where: { owner_agent_id: 'agent-001' },
      orderBy: { created_at_tick: 'desc' }
    });

    const planOverlay = overlays.find(entry => {
      const structured = isRecord(entry.content_structured) ? entry.content_structured : null;
      return structured?.record_kind === 'revise_judgement_plan';
    });
    const planMemory = memoryBlocks.find(block => {
      const structured = isRecord(block.content_structured) ? block.content_structured : null;
      return block.kind === 'plan' && structured?.record_kind === 'revise_judgement_plan';
    });

    expect(planOverlay).toBeTruthy();
    expect(planOverlay?.title).toContain('计划修订');
    expect(planOverlay?.persistence_mode).toBe('persistent');
    expect(planOverlay?.tags).toContain('judgement_plan');

    expect(planMemory).toBeTruthy();
    expect(planMemory?.title).toContain('执行计划修订');
    expect(planMemory?.kind).toBe('plan');
    expect(planMemory?.tags).toContain('plan_revision');

    const actionIntent = await context.prisma.actionIntent.findUnique({ where: { id: intentId } });
    expect(actionIntent?.status).toBe('completed');
  });
});
