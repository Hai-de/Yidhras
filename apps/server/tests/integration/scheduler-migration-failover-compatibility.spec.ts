import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import {
  acquireSchedulerLease,
  getSchedulerCursor,
  updateSchedulerCursor
} from '../../src/app/runtime/scheduler_lease.js';
import {
  completeActiveSchedulerOwnershipMigration,
  createSchedulerOwnershipMigration,
  getSchedulerPartitionAssignment,
  isWorkerAllowedToOperateSchedulerPartition,
  listRecentSchedulerOwnershipMigrations,
  resolveSchedulerOwnershipSnapshot
} from '../../src/app/runtime/scheduler_ownership.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

describe('scheduler migration failover compatibility integration', () => {
  let cleanup: (() => Promise<void>) | null = null;
  let context: AppContext;

  beforeAll(async () => {
    const fixture = await createIsolatedAppContextFixture();
    cleanup = fixture.cleanup;
    context = fixture.context;
  });

  beforeEach(async () => {
    await context.prisma.schedulerLease.deleteMany();
    await context.prisma.schedulerCursor.deleteMany();
    await context.prisma.schedulerOwnershipMigrationLog.deleteMany();
    await context.prisma.schedulerPartitionAssignment.deleteMany();
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it('keeps lease expiry semantics compatible with ownership migration handoff', async () => {
    await context.prisma.schedulerPartitionAssignment.create({
      data: {
        partition_id: 'p2',
        worker_id: 'worker-a',
        status: 'assigned',
        version: 1,
        source: 'bootstrap',
        updated_at: 1000n
      }
    });

    const workerALease = await acquireSchedulerLease(context, {
      workerId: 'worker-a',
      partitionId: 'p2',
      now: 1000n,
      leaseTicks: 2n
    });
    expect(workerALease.acquired).toBe(true);

    await updateSchedulerCursor(context, {
      partitionId: 'p2',
      lastScannedTick: 1000n,
      lastSignalTick: 999n,
      now: 1000n
    });

    await createSchedulerOwnershipMigration(context, {
      partitionId: 'p2',
      toWorkerId: 'worker-b',
      reason: 'migration-failover compatibility'
    });

    const workerAStillAllowed = await isWorkerAllowedToOperateSchedulerPartition(context, {
      partitionId: 'p2',
      workerId: 'worker-a'
    });
    const workerBAllowed = await isWorkerAllowedToOperateSchedulerPartition(context, {
      partitionId: 'p2',
      workerId: 'worker-b'
    });
    expect(workerAStillAllowed).toBe(false);
    expect(workerBAllowed).toBe(true);

    const beforeExpiryWorkerBLease = await acquireSchedulerLease(context, {
      workerId: 'worker-b',
      partitionId: 'p2',
      now: 1001n,
      leaseTicks: 2n
    });
    expect(beforeExpiryWorkerBLease.acquired).toBe(false);

    const failoverToWorkerB = await acquireSchedulerLease(context, {
      workerId: 'worker-b',
      partitionId: 'p2',
      now: 1003n,
      leaseTicks: 3n
    });
    expect(failoverToWorkerB.acquired).toBe(true);

    await completeActiveSchedulerOwnershipMigration(context, {
      partitionId: 'p2',
      toWorkerId: 'worker-b'
    });

    await updateSchedulerCursor(context, {
      partitionId: 'p2',
      lastScannedTick: 1003n,
      lastSignalTick: 1002n,
      now: 1003n
    });

    const assignment = await getSchedulerPartitionAssignment(context, 'p2');
    expect(assignment?.worker_id).toBe('worker-b');
    expect(assignment?.status).toBe('assigned');

    const cursor = await getSchedulerCursor(context, 'p2');
    expect(cursor).not.toBeNull();
    expect(cursor?.last_scanned_tick).toBe(1003n);
    expect(cursor?.last_signal_tick).toBe(1002n);

    const workerASnapshot = await resolveSchedulerOwnershipSnapshot(context, {
      workerId: 'worker-a',
      bootstrapPartitionIds: []
    });
    const workerBSnapshot = await resolveSchedulerOwnershipSnapshot(context, {
      workerId: 'worker-b',
      bootstrapPartitionIds: []
    });
    expect(workerASnapshot.owned_partition_ids.includes('p2')).toBe(false);
    expect(workerBSnapshot.owned_partition_ids).toContain('p2');

    const migrations = await listRecentSchedulerOwnershipMigrations(context, 10);
    expect(migrations[0]?.status).toBe('completed');
    expect(migrations[0]?.completed_at).not.toBeNull();
  });
});
