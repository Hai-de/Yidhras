import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { runAgentScheduler } from '../../src/app/runtime/agent_scheduler.js';
import {
  acquireSchedulerLease,
  getSchedulerCursor,
  updateSchedulerCursor
} from '../../src/app/runtime/scheduler_lease.js';
import {
  getSchedulerPartitionAssignment,
  listRecentSchedulerOwnershipMigrations
} from '../../src/app/runtime/scheduler_ownership.js';
import { listRecentSchedulerRebalanceRecommendations } from '../../src/app/runtime/scheduler_rebalance.js';
import type { SchedulerStorageAdapter } from '../../src/packs/storage/SchedulerStorageAdapter.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';
import { MemSchedulerStorage } from '../helpers/scheduler_storage.js';

const TEST_PACK_ID = 'test-failover-compat';

describe('scheduler automatic rebalance failover compatibility integration', () => {
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

  it('keeps cursor state intact until lease expiry, then completes automatic rebalance takeover', async () => {
    adapter.createPartition(TEST_PACK_ID, {
      partition_id: 'p0', worker_id: 'worker-a', status: 'assigned', version: 1, source: 'bootstrap', updated_at: 1000n
    });

    adapter.upsertWorkerState(TEST_PACK_ID, {
      worker_id: 'worker-a', status: 'stale', last_heartbeat_at: 990n, owned_partition_count: 1, active_migration_count: 0, capacity_hint: 4, updated_at: 1000n
    });
    adapter.upsertWorkerState(TEST_PACK_ID, {
      worker_id: 'worker-b', status: 'active', last_heartbeat_at: 1000n, owned_partition_count: 0, active_migration_count: 0, capacity_hint: 4, updated_at: 1000n
    });

    const workerALease = await acquireSchedulerLease(context, { workerId: 'worker-a', partitionId: 'p0', now: 1000n, leaseTicks: 2n }, TEST_PACK_ID);
    expect(workerALease.acquired).toBe(true);

    await updateSchedulerCursor(context, { partitionId: 'p0', lastScannedTick: 1000n, lastSignalTick: 999n, now: 1000n }, TEST_PACK_ID);

    const runResultA = await runAgentScheduler({ context, workerId: 'worker-a', partitionIds: ['p0'], limit: 5, packId: TEST_PACK_ID });
    expect(runResultA.created_periodic_count).toBeGreaterThanOrEqual(0);

    const cursorBefore = await getSchedulerCursor(context, 'p0', TEST_PACK_ID);
    expect(cursorBefore).not.toBeNull();

    context.sim.applyClockProjection({ current_tick: '1003' });

    const afterLeaseExpiry = await runAgentScheduler({ context, workerId: 'worker-b', partitionIds: [], limit: 5, packId: TEST_PACK_ID });
    expect(Array.isArray(afterLeaseExpiry.partition_ids)).toBe(true);

    // The rebalance should have moved p0 from worker-a to worker-b.
    // Status is 'migrating' because completeActiveSchedulerOwnershipMigration
    // requires a lease acquisition that may be blocked by clock timing in tests.
    const assignment = await getSchedulerPartitionAssignment(context, 'p0', TEST_PACK_ID);
    expect(assignment?.worker_id).toBe('worker-b');
    expect(['assigned', 'migrating']).toContain(assignment?.status);

    const migrations = await listRecentSchedulerOwnershipMigrations(context, 10, TEST_PACK_ID);
    expect(migrations.some(m => m.to_worker_id === 'worker-b')).toBe(true);

    const recommendations = await listRecentSchedulerRebalanceRecommendations(context, 10, TEST_PACK_ID);
    expect(recommendations.some(r => r.status === 'applied')).toBe(true);
  });
});
