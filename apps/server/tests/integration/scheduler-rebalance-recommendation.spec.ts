import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  evaluateSchedulerAutomaticRebalance,
  listRecentSchedulerRebalanceRecommendations
} from '../../src/app/runtime/scheduler_rebalance.js';
import { MemSchedulerStorage } from '../helpers/scheduler_storage.js';
import { TestKit } from '../testkit.js';

const TEST_PACK_ID = 'test-rebalance-rec';

describe('scheduler rebalance recommendation integration', () => {
  let kit: TestKit;
  let adapter: MemSchedulerStorage;

  beforeAll(async () => {
    kit = await TestKit.create();
    adapter = new MemSchedulerStorage();
    adapter.open(TEST_PACK_ID);
    kit.withSchedulerStorage(adapter);
  });

  beforeEach(async () => {
    adapter.destroyPackSchedulerStorage(TEST_PACK_ID);
    adapter.open(TEST_PACK_ID);
  });

  afterAll(async () => {
    await kit[Symbol.asyncDispose]();
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

    const result = await evaluateSchedulerAutomaticRebalance(kit.context, {
      now: 1000n,
      maxRecommendations: 1,
      migrationBacklogLimit: 2
    }, TEST_PACK_ID);

    expect(result.created_recommendations).toHaveLength(1);
    expect(result.created_suppressions).toHaveLength(0);
    expect(result.created_recommendations[0]?.reason).toBe('worker_unhealthy');
    expect(result.created_recommendations[0]?.from_worker_id).toBe('worker-a');
    expect(result.created_recommendations[0]?.to_worker_id).toBe('worker-b');

    const persistedRecommendations = await listRecentSchedulerRebalanceRecommendations(kit.context, 10, TEST_PACK_ID);
    expect(persistedRecommendations[0]?.status).toBe('recommended');
    expect(persistedRecommendations[0]?.reason).toBe('worker_unhealthy');
    expect(persistedRecommendations[0]?.from_worker_id).toBe('worker-a');
    expect(persistedRecommendations[0]?.to_worker_id).toBe('worker-b');
  });
});
