import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import {
  getLatestSchedulerRunReadModel,
  getSchedulerRunReadModelById
} from '../../src/app/services/scheduler_observability.js';
import type { SchedulerStorageAdapter } from '../../src/packs/storage/SchedulerStorageAdapter.js';
import { createTestAppContext } from '../fixtures/app-context.js';
import {
  createIsolatedRuntimeEnvironment,
  createPrismaClientForEnvironment,
  migrateIsolatedDatabase
} from '../helpers/runtime.js';

// ---------------------------------------------------------------------------
// In-memory SchedulerStorageAdapter for tests that need observable data
// ---------------------------------------------------------------------------

class MemSchedulerStorage implements SchedulerStorageAdapter {
  private runsByPack = new Map<string, Array<Record<string, unknown>>>();
  private decisionsByPack = new Map<string, Array<Record<string, unknown>>>();
  private openPacks = new Set<string>();

  open(packId: string): void { this.openPacks.add(packId); }
  close(packId: string): void { this.openPacks.delete(packId); }
  destroyPackSchedulerStorage(packId: string): void {
    this.runsByPack.delete(packId);
    this.decisionsByPack.delete(packId);
  }
  listOpenPackIds(): string[] { return Array.from(this.openPacks); }

  writeDetailedSnapshot(packId: string, input: Record<string, unknown>): Record<string, unknown> {
    if (!this.runsByPack.has(packId)) this.runsByPack.set(packId, []);
    const summary = typeof input.summary === 'object' && input.summary !== null
      ? JSON.stringify(input.summary)
      : String(input.summary ?? '{}');
    this.runsByPack.get(packId)!.push({ ...input, summary });
    return input;
  }

  writeCandidateDecision(packId: string, _schedulerRunId: string, input: Record<string, unknown>): Record<string, unknown> {
    if (!this.decisionsByPack.has(packId)) this.decisionsByPack.set(packId, []);
    const candidateReasons = Array.isArray(input.candidate_reasons)
      ? JSON.stringify(input.candidate_reasons)
      : String(input.candidate_reasons ?? '[]');
    this.decisionsByPack.get(packId)!.push({ ...input, candidate_reasons: candidateReasons });
    return input;
  }

  listRuns(packId: string, input: { where?: Record<string, unknown>; orderBy?: Record<string, unknown>; take?: number }): Record<string, unknown>[] {
    let items = [...(this.runsByPack.get(packId) ?? [])];
    if (input.where) {
      for (const [key, value] of Object.entries(input.where)) {
        items = items.filter(item => item[key] === value);
      }
    }
    if (input.orderBy) {
      for (const [key, dir] of Object.entries(input.orderBy)) {
        items.sort((a, b) => {
          const av = a[key] as number;
          const bv = b[key] as number;
          return dir === 'desc' ? bv - av : av - bv;
        });
      }
    } else {
      items.sort((a, b) => (b.created_at as number) - (a.created_at as number));
    }
    if (input.take !== undefined) items = items.slice(0, input.take);
    return items;
  }

  listCandidateDecisions(packId: string, input: { where?: Record<string, unknown>; orderBy?: Record<string, unknown> }): Record<string, unknown>[] {
    let items = [...(this.decisionsByPack.get(packId) ?? [])];
    if (input.where) {
      for (const [key, value] of Object.entries(input.where)) {
        items = items.filter(item => item[key] === value);
      }
    }
    if (input.orderBy) {
      for (const [key, dir] of Object.entries(input.orderBy)) {
        items.sort((a, b) => {
          const av = a[key] as number;
          const bv = b[key] as number;
          return dir === 'asc' ? av - bv : bv - av;
        });
      }
    }
    return items;
  }

  getAgentDecisions(packId: string, actorId: string, limit?: number): Record<string, unknown>[] {
    let items = (this.decisionsByPack.get(packId) ?? []).filter(d => d.actor_id === actorId);
    items.sort((a, b) => (b.created_at as number) - (a.created_at as number));
    if (limit !== undefined) items = items.slice(0, limit);
    return items;
  }

  // stubs
  upsertLease = () => ({ key: '', partition_id: '', holder: '', acquired_at: 0n, expires_at: 0n });
  getLease = () => null;
  updateLeaseIfClaimable = () => ({ count: 0 });
  deleteLeaseByHolder = () => ({ count: 0 });
  upsertCursor = () => ({ key: '', partition_id: '', last_scanned_tick: 0n, last_signal_tick: 0n, updated_at: 0n });
  getCursor = () => null;
  getPartition = () => null;
  listPartitions = () => [];
  createPartition = (_p: string, i: Record<string, unknown>) => i as never;
  updatePartition = (_p: string, i: Record<string, unknown>) => i as never;
  listMigrations = () => [];
  countMigrationsInProgress = () => 0;
  getMigrationById = () => null;
  findLatestActiveMigrationForPartition = () => null;
  createMigration = (_p: string, i: Record<string, unknown>) => ({ id: 'mock', ...i }) as never;
  updateMigration = (_p: string, i: Record<string, unknown>) => i as never;
  listWorkerStates = () => [];
  getWorkerState = () => null;
  upsertWorkerState = (_p: string, i: Record<string, unknown>) => i as never;
  updateWorkerStatus = (_p: string, wId: string, s: string, ua: bigint) => ({ worker_id: wId, status: s, updated_at: ua }) as never;
  findOpenRecommendation = () => null;
  createRecommendation = (_p: string, i: Record<string, unknown>) => ({ id: 'mock', ...i }) as never;
  listRecentRecommendations = () => [];
  getRecommendationById = () => null;
  updateRecommendation = (_p: string, i: Record<string, unknown>) => i as never;
  listPendingRecommendationsForWorker = () => [];
}

const TEST_PACK_ID = 'test-pack-runagg';

describe('scheduler run level aggregation integration', () => {
  let prisma: PrismaClient;
  let context: AppContext;
  let adapter: MemSchedulerStorage;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const env = await createIsolatedRuntimeEnvironment();
    await migrateIsolatedDatabase(env);
    prisma = createPrismaClientForEnvironment(env);

    adapter = new MemSchedulerStorage();
    adapter.open(TEST_PACK_ID);

    context = createTestAppContext(prisma, {
      schedulerStorage: adapter as unknown as SchedulerStorageAdapter,
      activePackId: TEST_PACK_ID
    });

    cleanup = async () => {
      await prisma.$disconnect();
      await env.cleanup();
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    await prisma.actionIntent.deleteMany();
    await prisma.decisionJob.deleteMany();
    await prisma.inferenceTrace.deleteMany();
    adapter.destroyPackSchedulerStorage(TEST_PACK_ID);
    adapter.open(TEST_PACK_ID);
  });

  it('aggregates cross-linked workflow state and audit summaries at scheduler run level', async () => {
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

    adapter.writeDetailedSnapshot(TEST_PACK_ID, {
      id: runId,
      worker_id: 'scheduler-runagg-worker',
      partition_id: 'p2',
      lease_holder: 'scheduler-runagg-worker',
      lease_expires_at_snapshot: Number(baseTick + 5n),
      tick: Number(baseTick),
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
      started_at: Number(baseTick),
      finished_at: Number(baseTick),
      created_at: Number(baseTick)
    });

    adapter.writeCandidateDecision(TEST_PACK_ID, runId, {
      id: randomUUID(),
      partition_id: 'p2',
      actor_id: 'agent-001',
      kind: 'event_driven',
      candidate_reasons: ['event_followup'],
      chosen_reason: 'event_followup',
      scheduled_for_tick: Number(baseTick),
      priority_score: 30,
      skipped_reason: null,
      created_job_id: createdJobId,
      created_at: Number(baseTick)
    });

    adapter.writeCandidateDecision(TEST_PACK_ID, runId, {
      id: randomUUID(),
      partition_id: 'p2',
      actor_id: 'agent-001',
      kind: 'periodic',
      candidate_reasons: ['periodic_tick'],
      chosen_reason: 'periodic_tick',
      scheduled_for_tick: Number(baseTick),
      priority_score: 1,
      skipped_reason: 'pending_workflow',
      created_job_id: null,
      created_at: Number(baseTick - 1n)
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
