import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  evaluateSchedulerAutomaticRebalance,
  listRecentSchedulerRebalanceRecommendations
} from '../../src/app/runtime/scheduler_rebalance.js';
import { MemSchedulerStorage } from '../helpers/scheduler_storage.js';
import { TestKit } from '../testkit.js';

const TEST_PACK_ID = 'test-suppression';

describe('scheduler rebalance suppression integration', () => {
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

  it('suppresses rebalance when migration backlog exceeds limit', async () => {
    adapter.createPartition(TEST_PACK_ID, {
      partition_id: 'p0', worker_id: 'worker-a', status: 'assigned', version: 1, source: 'bootstrap', updated_at: 1000n
    });

    adapter.upsertWorkerState(TEST_PACK_ID, {
      worker_id: 'worker-a', status: 'stale', last_heartbeat_at: 990n, owned_partition_count: 1, active_migration_count: 0, capacity_hint: 4, updated_at: 1000n
    });

    adapter.createMigration(TEST_PACK_ID, {
      partition_id: 'p0', from_worker_id: 'worker-a', to_worker_id: 'worker-b', status: 'in_progress',
      reason: 'test', details: {}, created_at: 1001n, updated_at: 1001n, completed_at: null
    });
    adapter.createMigration(TEST_PACK_ID, {
      partition_id: 'p0', from_worker_id: 'worker-a', to_worker_id: 'worker-b', status: 'in_progress',
      reason: 'test', details: {}, created_at: 1002n, updated_at: 1002n, completed_at: null
    });
    adapter.createMigration(TEST_PACK_ID, {
      partition_id: 'p0', from_worker_id: 'worker-a', to_worker_id: 'worker-b', status: 'in_progress',
      reason: 'test', details: {}, created_at: 1003n, updated_at: 1003n, completed_at: null
    });

    const result = await evaluateSchedulerAutomaticRebalance(kit.context, {
      now: 1004n,
      maxRecommendations: 2,
      migrationBacklogLimit: 1
    }, TEST_PACK_ID);

    expect(result.created_recommendations).toHaveLength(0);
    expect(result.created_suppressions.length).toBeGreaterThanOrEqual(1);

    const recommendations = await listRecentSchedulerRebalanceRecommendations(kit.context, 10, TEST_PACK_ID);
    expect(recommendations.some(r => r.status === 'suppressed')).toBe(true);
  });
});
