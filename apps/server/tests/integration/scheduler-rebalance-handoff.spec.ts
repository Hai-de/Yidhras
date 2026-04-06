import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { runAgentScheduler } from '../../src/app/runtime/agent_scheduler.js';
import {
  createSchedulerOwnershipMigration,
  getSchedulerPartitionAssignment,
  listRecentSchedulerOwnershipMigrations,
  resolveSchedulerOwnershipSnapshot
} from '../../src/app/runtime/scheduler_ownership.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

describe('scheduler rebalance handoff integration', () => {
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
    await context.prisma.schedulerOwnershipMigrationLog.deleteMany();
    await context.prisma.schedulerPartitionAssignment.deleteMany();
    await context.prisma.schedulerWorkerRuntimeState.deleteMany();
    await context.prisma.decisionJob.deleteMany({
      where: {
        idempotency_key: {
          startsWith: 'sch:'
        }
      }
    });
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it('lets the target worker complete an ownership migration during a scheduler handoff run', async () => {
    await context.prisma.schedulerPartitionAssignment.create({
      data: {
        partition_id: 'p1',
        worker_id: 'worker-a',
        status: 'assigned',
        version: 1,
        source: 'bootstrap',
        updated_at: 1000n
      }
    });

    const beforeWorkerA = await resolveSchedulerOwnershipSnapshot(context, {
      workerId: 'worker-a'
    });
    expect(beforeWorkerA.owned_partition_ids).toContain('p1');

    const blockedWorkerBRun = await runAgentScheduler({
      context,
      workerId: 'worker-b',
      partitionIds: ['p1'],
      limit: 10
    });
    expect(blockedWorkerBRun.scanned_count).toBe(0);

    const migration = await createSchedulerOwnershipMigration(context, {
      partitionId: 'p1',
      toWorkerId: 'worker-b',
      reason: 'handoff test'
    });
    expect(migration.status).toBe('requested');

    const handoffRun = await runAgentScheduler({
      context,
      workerId: 'worker-b',
      partitionIds: undefined,
      limit: 10
    });

    expect(handoffRun.partition_ids?.includes('p1') ?? false).toBe(true);

    const assignmentAfterHandoff = await getSchedulerPartitionAssignment(context, 'p1');
    expect(assignmentAfterHandoff?.worker_id).toBe('worker-b');
    expect(assignmentAfterHandoff?.status).toBe('assigned');

    const logs = await listRecentSchedulerOwnershipMigrations(context, 10);
    const latestLog = logs.find(item => item.id === migration.id) ?? null;
    expect(latestLog?.status).toBe('completed');

    const afterWorkerA = await resolveSchedulerOwnershipSnapshot(context, {
      workerId: 'worker-a',
      bootstrapPartitionIds: []
    });
    const afterWorkerB = await resolveSchedulerOwnershipSnapshot(context, {
      workerId: 'worker-b',
      bootstrapPartitionIds: []
    });

    expect(afterWorkerA.owned_partition_ids.includes('p1')).toBe(false);
    expect(afterWorkerB.owned_partition_ids).toContain('p1');
  });
});
