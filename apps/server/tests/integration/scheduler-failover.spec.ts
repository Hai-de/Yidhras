import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import {
  acquireSchedulerLease,
  getSchedulerCursor,
  updateSchedulerCursor
} from '../../src/app/runtime/scheduler_lease.js';
import type { SchedulerStorageAdapter } from '../../src/packs/storage/SchedulerStorageAdapter.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';
import { MemSchedulerStorage } from '../helpers/scheduler_storage.js';

const TEST_PACK_ID = 'test-failover';
const TEST_PARTITION_ID = 'p2';

describe('scheduler failover integration', () => {
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

  it('hands an expired partition lease to a new worker while preserving cursor progress', async () => {
    const firstAcquire = await acquireSchedulerLease(context, {
      workerId: 'failover-worker-a',
      partitionId: TEST_PARTITION_ID,
      now: 1000n,
      leaseTicks: 2n
    }, TEST_PACK_ID);
    expect(firstAcquire.acquired).toBe(true);
    expect(firstAcquire.holder).toBe('failover-worker-a');

    await updateSchedulerCursor(context, {
      partitionId: TEST_PARTITION_ID,
      lastScannedTick: 1000n,
      lastSignalTick: 999n,
      now: 1000n
    }, TEST_PACK_ID);

    const blockedAcquire = await acquireSchedulerLease(context, {
      workerId: 'failover-worker-b',
      partitionId: TEST_PARTITION_ID,
      now: 1001n,
      leaseTicks: 2n
    }, TEST_PACK_ID);
    expect(blockedAcquire.acquired).toBe(false);
    expect(blockedAcquire.holder).toBe('failover-worker-a');

    const failoverAcquire = await acquireSchedulerLease(context, {
      workerId: 'failover-worker-b',
      partitionId: TEST_PARTITION_ID,
      now: 1003n,
      leaseTicks: 3n
    }, TEST_PACK_ID);
    expect(failoverAcquire.acquired).toBe(true);
    expect(failoverAcquire.holder).toBe('failover-worker-b');

    await updateSchedulerCursor(context, {
      partitionId: TEST_PARTITION_ID,
      lastScannedTick: 1003n,
      lastSignalTick: 1002n,
      now: 1003n
    }, TEST_PACK_ID);

    const cursor = await getSchedulerCursor(context, TEST_PARTITION_ID, TEST_PACK_ID);
    expect(cursor).not.toBeNull();
    expect(cursor?.last_scanned_tick).toBe(1003n);
    expect(cursor?.last_signal_tick).toBe(1002n);
  });
});
