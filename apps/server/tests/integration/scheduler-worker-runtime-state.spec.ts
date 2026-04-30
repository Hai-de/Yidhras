import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import {
  listSchedulerWorkerRuntimeStates,
  refreshSchedulerWorkerRuntimeLiveness,
  refreshSchedulerWorkerRuntimeState,
  resolveSchedulerOwnershipSnapshot
} from '../../src/app/runtime/scheduler_ownership.js';
import type { SchedulerStorageAdapter } from '../../src/packs/storage/SchedulerStorageAdapter.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';
import { MemSchedulerStorage } from '../helpers/scheduler_storage.js';

const TEST_PACK_ID = 'test-worker-state';

describe('scheduler worker runtime state integration', () => {
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

  it('tracks worker heartbeats, derives stale/dead liveness and exposes the state through ownership snapshots', async () => {
    adapter.createPartition(TEST_PACK_ID, {
      partition_id: 'p0',
      worker_id: 'worker-a',
      status: 'assigned',
      version: 1,
      source: 'bootstrap',
      updated_at: 1000n
    });

    await refreshSchedulerWorkerRuntimeState(context, {
      workerId: 'worker-a',
      ownedPartitionIds: ['p0'],
      capacityHint: 4,
      now: 1000n
    }, TEST_PACK_ID);

    let states = await listSchedulerWorkerRuntimeStates(context, TEST_PACK_ID);
    expect(states).toHaveLength(1);
    expect(states[0]?.status).toBe('active');
    expect(states[0]?.owned_partition_count).toBe(1);
    expect(states[0]?.capacity_hint).toBe(4);

    await refreshSchedulerWorkerRuntimeLiveness(context, 1006n, TEST_PACK_ID);
    states = await listSchedulerWorkerRuntimeStates(context, TEST_PACK_ID);
    expect(states[0]?.status).toBe('stale');

    await refreshSchedulerWorkerRuntimeLiveness(context, 1016n, TEST_PACK_ID);
    states = await listSchedulerWorkerRuntimeStates(context, TEST_PACK_ID);
    expect(states[0]?.status).toBe('suspected_dead');

    const snapshot = await resolveSchedulerOwnershipSnapshot(context, {
      workerId: 'worker-a',
      bootstrapPartitionIds: []
    }, TEST_PACK_ID);
    expect(snapshot.worker_runtime_status).toBe('suspected_dead');
    expect(Number(snapshot.last_heartbeat_at)).toBe(1000);
    expect(snapshot.automatic_rebalance_enabled).toBe(true);
    expect(snapshot.owned_partition_ids).toContain('p0');
  });
});
