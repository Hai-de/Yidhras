import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import {
  buildPackScopedSchedulerPartitionId,
  parsePackScopedSchedulerPartitionId
} from '../../src/app/runtime/multi_pack_scheduler_scope.js';
import {
  acquireSchedulerLease,
  getSchedulerCursor,
  releaseSchedulerLease,
  updateSchedulerCursor
} from '../../src/app/runtime/scheduler_lease.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

const PACK_A_P0 = buildPackScopedSchedulerPartitionId('pack-a', 'p0');
const PACK_B_P0 = buildPackScopedSchedulerPartitionId('pack-b', 'p0');

describe('scheduler pack-scoped lease and cursor integration', () => {
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
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it('allows different packs to own the same partition id independently', async () => {
    const leaseA = await acquireSchedulerLease(context, {
      workerId: 'worker-a',
      partitionId: PACK_A_P0,
      now: 1000n,
      leaseTicks: 5n
    });
    const leaseB = await acquireSchedulerLease(context, {
      workerId: 'worker-b',
      partitionId: PACK_B_P0,
      now: 1000n,
      leaseTicks: 5n
    });

    expect(leaseA.acquired).toBe(true);
    expect(leaseB.acquired).toBe(true);
    expect(leaseA.partition_id).toBe(PACK_A_P0);
    expect(leaseB.partition_id).toBe(PACK_B_P0);

    const persisted = await context.prisma.schedulerLease.findMany({
      orderBy: [{ partition_id: 'asc' }]
    });
    expect(persisted.map(item => item.partition_id)).toEqual([PACK_A_P0, PACK_B_P0]);
    expect(parsePackScopedSchedulerPartitionId(persisted[0]!.partition_id).partition_id).toBe('p0');
    expect(parsePackScopedSchedulerPartitionId(persisted[1]!.partition_id).partition_id).toBe('p0');
  });

  it('persists scheduler cursors independently for pack-scoped partitions', async () => {
    await updateSchedulerCursor(context, {
      partitionId: PACK_A_P0,
      lastScannedTick: 1005n,
      lastSignalTick: 1004n,
      now: 1005n
    });
    await updateSchedulerCursor(context, {
      partitionId: PACK_B_P0,
      lastScannedTick: 2005n,
      lastSignalTick: 2004n,
      now: 2005n
    });

    const cursorA = await getSchedulerCursor(context, PACK_A_P0);
    const cursorB = await getSchedulerCursor(context, PACK_B_P0);

    expect(cursorA).not.toBeNull();
    expect(cursorB).not.toBeNull();
    expect(cursorA?.partition_id).toBe(PACK_A_P0);
    expect(cursorB?.partition_id).toBe(PACK_B_P0);
    expect(cursorA?.last_scanned_tick).toBe(1005n);
    expect(cursorB?.last_scanned_tick).toBe(2005n);
  });

  it('releases only the scoped partition owned by the releasing worker', async () => {
    await acquireSchedulerLease(context, {
      workerId: 'worker-a',
      partitionId: PACK_A_P0,
      now: 1000n,
      leaseTicks: 5n
    });
    await acquireSchedulerLease(context, {
      workerId: 'worker-a',
      partitionId: PACK_B_P0,
      now: 1000n,
      leaseTicks: 5n
    });

    const released = await releaseSchedulerLease(context, 'worker-a', PACK_A_P0);
    expect(released).toBe(true);

    const remaining = await context.prisma.schedulerLease.findMany({
      orderBy: [{ partition_id: 'asc' }]
    });
    expect(remaining.map(item => item.partition_id)).toEqual([PACK_B_P0]);
  });
});
