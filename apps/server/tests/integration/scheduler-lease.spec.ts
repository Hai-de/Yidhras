import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  acquireSchedulerLease,
  releaseSchedulerLease,
  renewSchedulerLease
} from '../../src/app/runtime/scheduler_lease.js';
import { MemSchedulerStorage } from '../helpers/scheduler_storage.js';
import { TestKit } from '../testkit.js';

const TEST_PACK_ID = 'test-lease';

describe('scheduler lease integration', () => {
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

  it('acquires, renews and releases a lease for a partition', async () => {
    const result = await acquireSchedulerLease(kit.context, {
      workerId: 'worker-1',
      partitionId: 'p0',
      now: 1000n,
      leaseTicks: 5n
    }, TEST_PACK_ID);
    expect(result.acquired).toBe(true);
    expect(result.holder).not.toBeNull();

    const renewed = await renewSchedulerLease(kit.context, {
      workerId: 'worker-1',
      partitionId: 'p0',
      now: 1003n,
      leaseTicks: 5n
    }, TEST_PACK_ID);
    expect(renewed.acquired).toBe(true);

    const released = releaseSchedulerLease(kit.context, 'worker-1', 'p0', TEST_PACK_ID);
    expect(released).toBe(true);
  });

  it('does not release a lease held by another worker', async () => {
    adapter.upsertLease(TEST_PACK_ID, {
      key: 'p0', partition_id: 'p0', holder: 'worker-2', acquired_at: 1000n, expires_at: 1005n, updated_at: 1000n
    });

    const result = releaseSchedulerLease(kit.context, 'worker-1', 'p0', TEST_PACK_ID);
    expect(result).toBe(false);
  });
});
