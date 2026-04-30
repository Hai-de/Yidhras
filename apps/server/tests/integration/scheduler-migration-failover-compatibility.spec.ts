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
import type { SchedulerStorageAdapter } from '../../src/packs/storage/SchedulerStorageAdapter.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';
import { MemSchedulerStorage } from '../helpers/scheduler_storage.js';

const TEST_PACK_ID = 'test-migration-failover';

describe('scheduler migration failover compatibility integration', () => {
  let cleanup: (() => Promise<void>) | null = null;
  let context: AppContext;
  let adapter: MemSchedulerStorage;

  beforeAll(async () => {
    const fixture = await createIsolatedAppContextFixture();
    cleanup = fixture.cleanup;
    context = fixture.context;

    adapter = new MemSchedulerStorage();
    adapter.open(TEST_PACK_ID);
    (context as { schedulerStorage: SchedulerStorageAdapter }).schedulerStorage = adapter;
  });

  beforeEach(async () => {
    adapter.destroyPackSchedulerStorage(TEST_PACK_ID);
    adapter.open(TEST_PACK_ID);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it('keeps lease expiry semantics compatible with ownership migration handoff', async () => {
    adapter.createPartition(TEST_PACK_ID, {
      partition_id: 'p2',
      worker_id: 'worker-a',
      status: 'assigned',
      version: 1,
      source: 'bootstrap',
      updated_at: 1000n
    });

    const workerALease = await acquireSchedulerLease(context, {
      workerId: 'worker-a',
      partitionId: 'p2',
      now: 1000n,
      leaseTicks: 2n
    }, TEST_PACK_ID);
    expect(workerALease.acquired).toBe(true);

    await updateSchedulerCursor(context, {
      partitionId: 'p2',
      lastScannedTick: 1000n,
      lastSignalTick: 999n,
      now: 1000n
    }, TEST_PACK_ID);

    await createSchedulerOwnershipMigration(context, {
      partitionId: 'p2',
      toWorkerId: 'worker-b',
      reason: 'migration-failover compatibility'
    }, TEST_PACK_ID);

    const workerAStillAllowed = await isWorkerAllowedToOperateSchedulerPartition(context, {
      partitionId: 'p2',
      workerId: 'worker-a'
    }, TEST_PACK_ID);
    const workerBAllowed = await isWorkerAllowedToOperateSchedulerPartition(context, {
      partitionId: 'p2',
      workerId: 'worker-b'
    }, TEST_PACK_ID);
    expect(workerAStillAllowed).toBe(false);
    expect(workerBAllowed).toBe(true);

    const beforeExpiryWorkerBLease = await acquireSchedulerLease(context, {
      workerId: 'worker-b',
      partitionId: 'p2',
      now: 1001n,
      leaseTicks: 2n
    }, TEST_PACK_ID);
    expect(beforeExpiryWorkerBLease.acquired).toBe(false);

    const failoverToWorkerB = await acquireSchedulerLease(context, {
      workerId: 'worker-b',
      partitionId: 'p2',
      now: 1003n,
      leaseTicks: 3n
    }, TEST_PACK_ID);
    expect(failoverToWorkerB.acquired).toBe(true);

    await completeActiveSchedulerOwnershipMigration(context, {
      partitionId: 'p2',
      toWorkerId: 'worker-b'
    }, TEST_PACK_ID);

    await updateSchedulerCursor(context, {
      partitionId: 'p2',
      lastScannedTick: 1003n,
      lastSignalTick: 1002n,
      now: 1003n
    }, TEST_PACK_ID);

    const assignment = await getSchedulerPartitionAssignment(context, 'p2', TEST_PACK_ID);
    expect(assignment?.worker_id).toBe('worker-b');
    expect(assignment?.status).toBe('assigned');

    const cursor = await getSchedulerCursor(context, 'p2', TEST_PACK_ID);
    expect(cursor).not.toBeNull();
    expect(cursor?.last_scanned_tick).toBe(1003n);
    expect(cursor?.last_signal_tick).toBe(1002n);

    const workerASnapshot = await resolveSchedulerOwnershipSnapshot(context, {
      workerId: 'worker-a',
      bootstrapPartitionIds: []
    }, TEST_PACK_ID);
    const workerBSnapshot = await resolveSchedulerOwnershipSnapshot(context, {
      workerId: 'worker-b',
      bootstrapPartitionIds: []
    }, TEST_PACK_ID);
    expect(workerASnapshot.owned_partition_ids.includes('p2')).toBe(false);
    expect(workerBSnapshot.owned_partition_ids).toContain('p2');

    const migrations = await listRecentSchedulerOwnershipMigrations(context, 10, TEST_PACK_ID);
    expect(migrations[0]?.status).toBe('completed');
    expect(migrations[0]?.completed_at).not.toBeNull();
  });
});
