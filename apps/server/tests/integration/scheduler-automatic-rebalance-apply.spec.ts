import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { runAgentScheduler } from '../../src/app/runtime/agent_scheduler.js';
import { listRecentSchedulerOwnershipMigrations } from '../../src/app/runtime/scheduler_ownership.js';
import { listRecentSchedulerRebalanceRecommendations } from '../../src/app/runtime/scheduler_rebalance.js';
import type { SchedulerStorageAdapter } from '../../src/packs/storage/SchedulerStorageAdapter.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';
import { MemSchedulerStorage } from '../helpers/scheduler_storage.js';

const TEST_PACK_ID = 'test-rebalance-apply';

describe('scheduler automatic rebalance apply integration', () => {
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

  it('applies a worker_unhealthy rebalance recommendation for the current worker during scheduler execution', async () => {
    adapter.createPartition(TEST_PACK_ID, {
      partition_id: 'p0', worker_id: 'worker-a', status: 'assigned', version: 1, source: 'bootstrap', updated_at: 1000n
    });
    adapter.createPartition(TEST_PACK_ID, {
      partition_id: 'p1', worker_id: 'worker-a', status: 'assigned', version: 1, source: 'bootstrap', updated_at: 1000n
    });
    adapter.createPartition(TEST_PACK_ID, {
      partition_id: 'p2', worker_id: 'worker-b', status: 'assigned', version: 1, source: 'bootstrap', updated_at: 1000n
    });

    adapter.upsertWorkerState(TEST_PACK_ID, {
      worker_id: 'worker-a', status: 'stale', last_heartbeat_at: 990n,
      owned_partition_count: 2, active_migration_count: 0, capacity_hint: 4, updated_at: 1000n
    });
    adapter.upsertWorkerState(TEST_PACK_ID, {
      worker_id: 'worker-b', status: 'active', last_heartbeat_at: 1000n,
      owned_partition_count: 1, active_migration_count: 0, capacity_hint: 4, updated_at: 1000n
    });

    const runResult = await runAgentScheduler({
      context,
      workerId: 'worker-b',
      partitionIds: [],
      limit: 5,
      packId: TEST_PACK_ID
    });

    expect(Array.isArray(runResult.partition_ids)).toBe(true);

    const migrations = await listRecentSchedulerOwnershipMigrations(context, 10, TEST_PACK_ID);
    expect(migrations.length).toBeGreaterThanOrEqual(1);
    expect(migrations[0]?.to_worker_id).toBe('worker-b');
    expect(migrations[0]?.reason).toBe('automatic_rebalance:worker_unhealthy');

    const recommendations = await listRecentSchedulerRebalanceRecommendations(context, 10, TEST_PACK_ID);
    expect(recommendations.some(item => item.status === 'applied')).toBe(true);
    expect(recommendations.some(item => item.reason === 'worker_unhealthy')).toBe(true);
  });
});
