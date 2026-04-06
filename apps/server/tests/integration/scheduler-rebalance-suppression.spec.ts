import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import {
  evaluateSchedulerAutomaticRebalance,
  listRecentSchedulerRebalanceRecommendations
} from '../../src/app/runtime/scheduler_rebalance.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

describe('scheduler rebalance suppression integration', () => {
  let cleanup: (() => Promise<void>) | null = null;
  let context: AppContext;

  beforeAll(async () => {
    const fixture = await createIsolatedAppContextFixture();
    cleanup = fixture.cleanup;
    context = fixture.context;
  });

  beforeEach(async () => {
    await context.prisma.schedulerRebalanceRecommendation.deleteMany();
    await context.prisma.schedulerWorkerRuntimeState.deleteMany();
    await context.prisma.schedulerOwnershipMigrationLog.deleteMany();
    await context.prisma.schedulerPartitionAssignment.deleteMany();
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it('suppresses rebalance recommendations when migration backlog exceeds the limit', async () => {
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

    await context.prisma.schedulerWorkerRuntimeState.create({
      data: {
        worker_id: 'worker-a',
        status: 'active',
        last_heartbeat_at: 1000n,
        owned_partition_count: 1,
        active_migration_count: 3,
        capacity_hint: 4,
        updated_at: 1000n
      }
    });

    await context.prisma.schedulerOwnershipMigrationLog.createMany({
      data: [
        {
          id: 'mig-1',
          partition_id: 'p1',
          from_worker_id: 'worker-a',
          to_worker_id: 'worker-b',
          status: 'requested',
          reason: 'backlog test',
          details: {},
          created_at: 1000n,
          updated_at: 1000n,
          completed_at: null
        },
        {
          id: 'mig-2',
          partition_id: 'p2',
          from_worker_id: 'worker-a',
          to_worker_id: 'worker-c',
          status: 'in_progress',
          reason: 'backlog test',
          details: {},
          created_at: 1000n,
          updated_at: 1000n,
          completed_at: null
        },
        {
          id: 'mig-3',
          partition_id: 'p3',
          from_worker_id: 'worker-b',
          to_worker_id: 'worker-c',
          status: 'requested',
          reason: 'backlog test',
          details: {},
          created_at: 1000n,
          updated_at: 1000n,
          completed_at: null
        }
      ]
    });

    const result = await evaluateSchedulerAutomaticRebalance(context, {
      now: 1000n,
      migrationBacklogLimit: 2
    });

    expect(result.created_recommendations).toHaveLength(0);
    expect(result.created_suppressions).toHaveLength(1);
    expect(result.created_suppressions[0]?.suppress_reason).toBe('migration_backlog_exceeded');
    expect(result.migration_backlog_count).toBe(3);

    const persistedRecommendations = await listRecentSchedulerRebalanceRecommendations(context, 10);
    expect(persistedRecommendations[0]?.status).toBe('suppressed');
    expect(persistedRecommendations[0]?.reason).toBe('automatic_rebalance_suppressed');
    expect(persistedRecommendations[0]?.suppress_reason).toBe('migration_backlog_exceeded');
  });
});
