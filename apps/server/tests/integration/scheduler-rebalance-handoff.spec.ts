import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { runAgentScheduler } from '../../src/app/runtime/agent_scheduler.js';
import {
  createSchedulerOwnershipMigration,
  getSchedulerPartitionAssignment,
  listRecentSchedulerOwnershipMigrations,
  resolveSchedulerOwnershipSnapshot
} from '../../src/app/runtime/scheduler_ownership.js';
import type { SchedulerStorageAdapter } from '../../src/packs/storage/SchedulerStorageAdapter.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';
import { MemSchedulerStorage } from '../helpers/scheduler_storage.js';

const TEST_PACK_ID = 'test-handoff';

describe('scheduler rebalance handoff integration', () => {
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
    await context.prisma.decisionJob.deleteMany({
      where: { idempotency_key: { startsWith: 'sch:' } }
    });
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it('lets the target worker complete an ownership migration during a scheduler handoff run', async () => {
    adapter.createPartition(TEST_PACK_ID, {
      partition_id: 'p1',
      worker_id: 'worker-a',
      status: 'assigned',
      version: 1,
      source: 'bootstrap',
      updated_at: 1000n
    });

    const beforeWorkerA = await resolveSchedulerOwnershipSnapshot(context, {
      workerId: 'worker-a'
    }, TEST_PACK_ID);
    expect(beforeWorkerA.owned_partition_ids).toContain('p1');

    const blockedWorkerBRun = await runAgentScheduler({
      context,
      workerId: 'worker-b',
      partitionIds: ['p1'],
      limit: 10,
      packId: TEST_PACK_ID
    });
    expect(blockedWorkerBRun.scanned_count).toBe(0);

    const migration = await createSchedulerOwnershipMigration(context, {
      partitionId: 'p1',
      toWorkerId: 'worker-b',
      reason: 'handoff test'
    }, TEST_PACK_ID);
    expect(migration.status).toBe('requested');

    const handoffRun = await runAgentScheduler({
      context,
      workerId: 'worker-b',
      partitionIds: undefined,
      limit: 10,
      packId: TEST_PACK_ID
    });

    expect(handoffRun.partition_ids?.includes('p1') ?? false).toBe(true);

    const assignmentAfterHandoff = await getSchedulerPartitionAssignment(context, 'p1', TEST_PACK_ID);
    expect(assignmentAfterHandoff?.worker_id).toBe('worker-b');
    expect(assignmentAfterHandoff?.status).toBe('assigned');

    const logs = await listRecentSchedulerOwnershipMigrations(context, 10, TEST_PACK_ID);
    const latestLog = logs.find(item => item.id === migration.id) ?? null;
    expect(latestLog?.status).toBe('completed');

    const afterWorkerA = await resolveSchedulerOwnershipSnapshot(context, {
      workerId: 'worker-a',
      bootstrapPartitionIds: []
    }, TEST_PACK_ID);
    const afterWorkerB = await resolveSchedulerOwnershipSnapshot(context, {
      workerId: 'worker-b',
      bootstrapPartitionIds: []
    }, TEST_PACK_ID);

    expect(afterWorkerA.owned_partition_ids.includes('p1')).toBe(false);
    expect(afterWorkerB.owned_partition_ids).toContain('p1');
  });
});
