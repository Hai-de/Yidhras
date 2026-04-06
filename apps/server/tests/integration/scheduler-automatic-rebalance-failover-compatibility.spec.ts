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
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

describe('scheduler automatic rebalance failover compatibility integration', () => {
  let cleanup: (() => Promise<void>) | null = null;
  let context: AppContext;

  beforeAll(async () => {
    const fixture = await createIsolatedAppContextFixture();
    cleanup = fixture.cleanup;
    context = fixture.context;
  });

  beforeEach(async () => {
    await context.prisma.schedulerCandidateDecision.deleteMany();
    await context.prisma.schedulerRun.deleteMany();
    await context.prisma.schedulerCursor.deleteMany();
    await context.prisma.schedulerLease.deleteMany();
    await context.prisma.schedulerRebalanceRecommendation.deleteMany();
    await context.prisma.schedulerWorkerRuntimeState.deleteMany();
    await context.prisma.schedulerOwnershipMigrationLog.deleteMany();
    await context.prisma.schedulerPartitionAssignment.deleteMany();
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it('keeps cursor state intact until lease expiry, then completes automatic rebalance takeover', async () => {
    await context.prisma.schedulerPartitionAssignment.create({
      data: {
        partition_id: 'p0',
        worker_id: 'worker-a',
        status: 'assigned',
        version: 1,
        source: 'bootstrap',
        updated_at: 1000n
      }
    });

    await context.prisma.schedulerWorkerRuntimeState.createMany({
      data: [
        {
          worker_id: 'worker-a',
          status: 'stale',
          last_heartbeat_at: 990n,
          owned_partition_count: 1,
          active_migration_count: 0,
          capacity_hint: 4,
          updated_at: 1000n
        },
        {
          worker_id: 'worker-b',
          status: 'active',
          last_heartbeat_at: 1000n,
          owned_partition_count: 0,
          active_migration_count: 0,
          capacity_hint: 4,
          updated_at: 1000n
        }
      ]
    });

    const initialLease = await acquireSchedulerLease(context, {
      workerId: 'worker-a',
      partitionId: 'p0',
      now: 1000n,
      leaseTicks: 2n
    });
    expect(initialLease.acquired).toBe(true);

    await updateSchedulerCursor(context, {
      partitionId: 'p0',
      lastScannedTick: 999n,
      lastSignalTick: 998n,
      now: 1000n
    });

    const firstRun = await runAgentScheduler({
      context,
      workerId: 'worker-b',
      partitionIds: [],
      limit: 5
    });

    expect(firstRun.partition_ids?.includes('p0') ?? false).toBe(true);
    expect(firstRun.scheduler_run_ids?.length ?? 0).toBe(0);

    const appliedRecommendation = (await listRecentSchedulerRebalanceRecommendations(context, 10)).find(
      item => item.partition_id === 'p0' && item.status === 'applied'
    );
    expect(appliedRecommendation).toBeDefined();
    expect(appliedRecommendation?.reason).toBe('worker_unhealthy');
    expect(appliedRecommendation?.applied_migration_id).not.toBeNull();

    const requestedMigration = (await listRecentSchedulerOwnershipMigrations(context, 10)).find(
      item => item.partition_id === 'p0'
    );
    expect(requestedMigration).toBeDefined();
    expect(requestedMigration?.reason).toBe('automatic_rebalance:worker_unhealthy');
    expect(requestedMigration?.status).toBe('requested');

    const migratingAssignment = await getSchedulerPartitionAssignment(context, 'p0');
    expect(migratingAssignment?.worker_id).toBe('worker-b');
    expect(migratingAssignment?.status).toBe('migrating');

    const cursorBeforeTakeover = await getSchedulerCursor(context, 'p0');
    expect(cursorBeforeTakeover?.last_scanned_tick).toBe(999n);
    expect(cursorBeforeTakeover?.last_signal_tick).toBe(998n);

    context.sim.clock.tick(3n);

    const secondRun = await runAgentScheduler({
      context,
      workerId: 'worker-b',
      partitionIds: [],
      limit: 5
    });

    expect(secondRun.partition_ids?.includes('p0') ?? false).toBe(true);
    expect(secondRun.scheduler_run_ids?.length ?? 0).toBe(1);

    const completedMigration = (await listRecentSchedulerOwnershipMigrations(context, 10)).find(
      item => item.partition_id === 'p0'
    );
    expect(completedMigration?.status).toBe('completed');
    expect(completedMigration?.completed_at).not.toBeNull();

    const finalAssignment = await getSchedulerPartitionAssignment(context, 'p0');
    expect(finalAssignment?.worker_id).toBe('worker-b');
    expect(finalAssignment?.status).toBe('assigned');

    const finalCursor = await getSchedulerCursor(context, 'p0');
    expect(finalCursor).not.toBeNull();
    expect(finalCursor?.last_scanned_tick).toBe(1003n);
    expect(finalCursor?.last_signal_tick).toBe(998n);
  });
});
