import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import {
  evaluateSchedulerAutomaticRebalance,
  listRecentSchedulerRebalanceRecommendations
} from '../../src/app/runtime/scheduler_rebalance.js';
import type { SchedulerStorageAdapter } from '../../src/packs/storage/SchedulerStorageAdapter.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';
import { MemSchedulerStorage } from '../helpers/scheduler_storage.js';

const TEST_PACK_ID = 'test-rebalance-rec';

describe('scheduler rebalance recommendation integration', () => {
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

  it('creates a worker_unhealthy recommendation that moves a partition from a stale worker to an active worker', async () => {
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

    const result = await evaluateSchedulerAutomaticRebalance(context, {
      now: 1000n,
      maxRecommendations: 1,
      migrationBacklogLimit: 2
    }, TEST_PACK_ID);

    expect(result.created_recommendations).toHaveLength(1);
    expect(result.created_suppressions).toHaveLength(0);
    expect(result.created_recommendations[0]?.reason).toBe('worker_unhealthy');
    expect(result.created_recommendations[0]?.from_worker_id).toBe('worker-a');
    expect(result.created_recommendations[0]?.to_worker_id).toBe('worker-b');

    const persistedRecommendations = await listRecentSchedulerRebalanceRecommendations(context, 10, TEST_PACK_ID);
    expect(persistedRecommendations[0]?.status).toBe('recommended');
    expect(persistedRecommendations[0]?.reason).toBe('worker_unhealthy');
    expect(persistedRecommendations[0]?.from_worker_id).toBe('worker-a');
    expect(persistedRecommendations[0]?.to_worker_id).toBe('worker-b');
  });
});
