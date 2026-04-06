import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import {
  completeSchedulerOwnershipMigration,
  createSchedulerOwnershipMigration,
  listRecentSchedulerOwnershipMigrations,
  listSchedulerPartitionAssignments,
  markSchedulerOwnershipMigrationInProgress,
  resolveSchedulerOwnershipSnapshot
} from '../../src/app/runtime/scheduler_ownership.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

describe('scheduler ownership migration integration', () => {
  let cleanup: (() => Promise<void>) | null = null;
  let context: AppContext;

  beforeAll(async () => {
    const fixture = await createIsolatedAppContextFixture();
    cleanup = fixture.cleanup;
    context = fixture.context;
  });

  beforeEach(async () => {
    await context.prisma.schedulerOwnershipMigrationLog.deleteMany();
    await context.prisma.schedulerPartitionAssignment.deleteMany();
    await context.prisma.schedulerWorkerRuntimeState.deleteMany();
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it('moves persisted partition ownership to a new worker and records migration progress', async () => {
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

    const beforeSnapshot = await resolveSchedulerOwnershipSnapshot(context, {
      workerId: 'worker-a'
    });
    expect(beforeSnapshot.assignment_source).toBe('persisted');
    expect(beforeSnapshot.owned_partition_ids).toContain('p1');

    const migration = await createSchedulerOwnershipMigration(context, {
      partitionId: 'p1',
      toWorkerId: 'worker-b',
      reason: 'rebalance test'
    });
    expect(migration.status).toBe('requested');
    expect(migration.from_worker_id).toBe('worker-a');

    await markSchedulerOwnershipMigrationInProgress(context, migration.id);
    const inProgressLogs = await listRecentSchedulerOwnershipMigrations(context, 10);
    expect(inProgressLogs[0]?.status).toBe('in_progress');

    await completeSchedulerOwnershipMigration(context, migration.id);

    const assignments = await listSchedulerPartitionAssignments(context);
    const migratedAssignment = assignments.find(item => item.partition_id === 'p1') ?? null;
    expect(migratedAssignment).not.toBeNull();
    expect(migratedAssignment?.worker_id).toBe('worker-b');
    expect(migratedAssignment?.status).toBe('assigned');
    expect(migratedAssignment?.source).toBe('rebalance');

    const afterSnapshot = await resolveSchedulerOwnershipSnapshot(context, {
      workerId: 'worker-b'
    });
    expect(afterSnapshot.assignment_source).toBe('persisted');
    expect(afterSnapshot.owned_partition_ids).toContain('p1');

    const completedLogs = await listRecentSchedulerOwnershipMigrations(context, 10);
    expect(completedLogs[0]?.status).toBe('completed');
    expect(completedLogs[0]?.completed_at).not.toBeNull();
  });
});
