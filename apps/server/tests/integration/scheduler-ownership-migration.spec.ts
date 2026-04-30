import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import {
  completeSchedulerOwnershipMigration,
  createSchedulerOwnershipMigration,
  listRecentSchedulerOwnershipMigrations,
  listSchedulerPartitionAssignments,
  markSchedulerOwnershipMigrationInProgress,
  resolveSchedulerOwnershipSnapshot
} from '../../src/app/runtime/scheduler_ownership.js';
import type { SchedulerStorageAdapter } from '../../src/packs/storage/SchedulerStorageAdapter.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';
import { MemSchedulerStorage } from '../helpers/scheduler_storage.js';

const TEST_PACK_ID = 'test-ownership-migration';

describe('scheduler ownership migration integration', () => {
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

  it('moves persisted partition ownership to a new worker and records migration progress', async () => {
    adapter.createPartition(TEST_PACK_ID, {
      partition_id: 'p1',
      worker_id: 'worker-a',
      status: 'assigned',
      version: 1,
      source: 'bootstrap',
      updated_at: 1000n
    });

    const beforeSnapshot = await resolveSchedulerOwnershipSnapshot(context, {
      workerId: 'worker-a'
    }, TEST_PACK_ID);
    expect(beforeSnapshot.assignment_source).toBe('persisted');
    expect(beforeSnapshot.owned_partition_ids).toContain('p1');

    const migration = await createSchedulerOwnershipMigration(context, {
      partitionId: 'p1',
      toWorkerId: 'worker-b',
      reason: 'rebalance test'
    }, TEST_PACK_ID);
    expect(migration.status).toBe('requested');
    expect(migration.from_worker_id).toBe('worker-a');

    await markSchedulerOwnershipMigrationInProgress(context, migration.id, TEST_PACK_ID);
    const inProgressLogs = await listRecentSchedulerOwnershipMigrations(context, 10, TEST_PACK_ID);
    expect(inProgressLogs[0]?.status).toBe('in_progress');

    await completeSchedulerOwnershipMigration(context, migration.id, TEST_PACK_ID);

    const assignments = await listSchedulerPartitionAssignments(context, TEST_PACK_ID);
    const migratedAssignment = assignments.find(item => item.partition_id === 'p1') ?? null;
    expect(migratedAssignment).not.toBeNull();
    expect(migratedAssignment?.worker_id).toBe('worker-b');
    expect(migratedAssignment?.status).toBe('assigned');
    expect(migratedAssignment?.source).toBe('rebalance');

    const afterSnapshot = await resolveSchedulerOwnershipSnapshot(context, {
      workerId: 'worker-b'
    }, TEST_PACK_ID);
    expect(afterSnapshot.assignment_source).toBe('persisted');
    expect(afterSnapshot.owned_partition_ids).toContain('p1');

    const completedLogs = await listRecentSchedulerOwnershipMigrations(context, 10, TEST_PACK_ID);
    expect(completedLogs[0]?.status).toBe('completed');
    expect(completedLogs[0]?.completed_at).not.toBeNull();
  });
});
