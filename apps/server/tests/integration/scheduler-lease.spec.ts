import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import {
  acquireSchedulerLease,
  getSchedulerCursor,
  releaseSchedulerLease,
  renewSchedulerLease,
  updateSchedulerCursor
} from '../../src/app/runtime/scheduler_lease.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

const TEST_PARTITIONS = ['p0', 'p1', 'p2', 'p3'];

describe('scheduler lease integration', () => {
  let cleanup: (() => Promise<void>) | null = null;
  let context: AppContext;

  beforeAll(async () => {
    const fixture = await createIsolatedAppContextFixture();
    cleanup = fixture.cleanup;
    context = fixture.context;
  });

  beforeEach(async () => {
    await context.prisma.schedulerLease.deleteMany({
      where: {
        partition_id: {
          in: TEST_PARTITIONS
        }
      }
    });
    await context.prisma.schedulerCursor.deleteMany({
      where: {
        partition_id: {
          in: TEST_PARTITIONS
        }
      }
    });
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it('acquires, renews and reclaims leases across partitions', async () => {
    const firstAcquire = await acquireSchedulerLease(context, {
      workerId: 'scheduler-worker-a',
      now: 1000n,
      leaseTicks: 5n
    });
    expect(firstAcquire.acquired).toBe(true);
    expect(firstAcquire.holder).toBe('scheduler-worker-a');
    expect(firstAcquire.partition_id).toBe('p0');

    const secondAcquire = await acquireSchedulerLease(context, {
      workerId: 'scheduler-worker-b',
      now: 1002n,
      leaseTicks: 5n
    });
    expect(secondAcquire.acquired).toBe(false);
    expect(secondAcquire.holder).toBe('scheduler-worker-a');

    const parallelPartitionAcquire = await acquireSchedulerLease(context, {
      workerId: 'scheduler-worker-b',
      partitionId: 'p1',
      now: 1002n,
      leaseTicks: 5n
    });
    expect(parallelPartitionAcquire.acquired).toBe(true);
    expect(parallelPartitionAcquire.partition_id).toBe('p1');

    const renewed = await renewSchedulerLease(context, {
      workerId: 'scheduler-worker-a',
      now: 1002n,
      leaseTicks: 5n
    });
    expect(renewed.acquired).toBe(true);
    expect(renewed.expires_at).toBe(1007n);

    const expiredAcquire = await acquireSchedulerLease(context, {
      workerId: 'scheduler-worker-c',
      now: 1008n,
      leaseTicks: 5n
    });
    expect(expiredAcquire.acquired).toBe(true);
    expect(expiredAcquire.holder).toBe('scheduler-worker-c');
  });

  it('allows exactly one concurrent lease winner per partition', async () => {
    const [raceAcquireA, raceAcquireB] = await Promise.all([
      acquireSchedulerLease(context, {
        workerId: 'scheduler-race-worker-a',
        partitionId: 'p2',
        now: 1002n,
        leaseTicks: 5n
      }),
      acquireSchedulerLease(context, {
        workerId: 'scheduler-race-worker-b',
        partitionId: 'p2',
        now: 1002n,
        leaseTicks: 5n
      })
    ]);

    const raceWinners = [raceAcquireA, raceAcquireB].filter(result => result.acquired);
    const raceLosers = [raceAcquireA, raceAcquireB].filter(result => !result.acquired);

    expect(raceWinners).toHaveLength(1);
    expect(raceLosers).toHaveLength(1);
    expect(raceLosers[0]?.holder).toBe(raceWinners[0]?.holder);

    const persistedRaceLease = await context.prisma.schedulerLease.findUnique({
      where: {
        partition_id: 'p2'
      }
    });

    expect(persistedRaceLease).not.toBeNull();
    expect(persistedRaceLease?.holder).toBe(raceWinners[0]?.holder);
  });

  it('persists scheduler cursors per partition', async () => {
    const cursorBeforeCreate = await getSchedulerCursor(context);
    expect(cursorBeforeCreate).toBeNull();

    await updateSchedulerCursor(context, {
      lastScannedTick: 1005n,
      lastSignalTick: 1004n,
      now: 1005n
    });

    const cursorAfterCreate = await getSchedulerCursor(context);
    expect(cursorAfterCreate).not.toBeNull();
    expect(cursorAfterCreate?.partition_id).toBe('p0');
    expect(cursorAfterCreate?.last_scanned_tick).toBe(1005n);
    expect(cursorAfterCreate?.last_signal_tick).toBe(1004n);

    await updateSchedulerCursor(context, {
      partitionId: 'p1',
      lastScannedTick: 1006n,
      lastSignalTick: 1005n,
      now: 1006n
    });

    const cursorP1 = await getSchedulerCursor(context, 'p1');
    expect(cursorP1).not.toBeNull();
    expect(cursorP1?.last_scanned_tick).toBe(1006n);
    expect(cursorP1?.last_signal_tick).toBe(1005n);
  });

  it('only allows the current holder to release a lease', async () => {
    await acquireSchedulerLease(context, {
      workerId: 'scheduler-worker-c',
      now: 1000n,
      leaseTicks: 5n
    });
    await acquireSchedulerLease(context, {
      workerId: 'scheduler-worker-b',
      partitionId: 'p1',
      now: 1000n,
      leaseTicks: 5n
    });

    const wrongRelease = await releaseSchedulerLease(context, 'scheduler-worker-a', 'p0');
    expect(wrongRelease).toBe(false);

    await context.prisma.schedulerLease.upsert({
      where: {
        partition_id: 'p3'
      },
      update: {
        key: 'agent_scheduler_main:p3',
        holder: 'scheduler-release-owner',
        acquired_at: 1010n,
        expires_at: 1015n,
        updated_at: 1010n
      },
      create: {
        key: 'agent_scheduler_main:p3',
        partition_id: 'p3',
        holder: 'scheduler-release-owner',
        acquired_at: 1010n,
        expires_at: 1015n,
        updated_at: 1010n
      }
    });

    const staleRelease = await releaseSchedulerLease(context, 'scheduler-worker-a', 'p3');
    expect(staleRelease).toBe(false);

    const persistedP3Lease = await context.prisma.schedulerLease.findUnique({
      where: {
        partition_id: 'p3'
      }
    });
    expect(persistedP3Lease?.holder).toBe('scheduler-release-owner');

    const releasedP3 = await releaseSchedulerLease(context, 'scheduler-release-owner', 'p3');
    const releasedP0 = await releaseSchedulerLease(context, 'scheduler-worker-c', 'p0');
    const releasedP1 = await releaseSchedulerLease(context, 'scheduler-worker-b', 'p1');

    expect(releasedP3).toBe(true);
    expect(releasedP0).toBe(true);
    expect(releasedP1).toBe(true);
  });
});
