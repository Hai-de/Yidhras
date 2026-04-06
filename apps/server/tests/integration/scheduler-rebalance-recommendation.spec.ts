import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import {
  evaluateSchedulerAutomaticRebalance,
  listRecentSchedulerRebalanceRecommendations
} from '../../src/app/runtime/scheduler_rebalance.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

describe('scheduler rebalance recommendation integration', () => {
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

  it('creates a worker_unhealthy recommendation that moves a partition from a stale worker to an active worker', async () => {
    await context.prisma.schedulerPartitionAssignment.createMany({
      data: [
        {
          partition_id: 'p0',
          worker_id: 'worker-a',
          status: 'assigned',
          version: 1,
          source: 'bootstrap',
          updated_at: 1000n
        },
        {
          partition_id: 'p1',
          worker_id: 'worker-a',
          status: 'assigned',
          version: 1,
          source: 'bootstrap',
          updated_at: 1000n
        },
        {
          partition_id: 'p2',
          worker_id: 'worker-b',
          status: 'assigned',
          version: 1,
          source: 'bootstrap',
          updated_at: 1000n
        }
      ]
    });

    await context.prisma.schedulerWorkerRuntimeState.createMany({
      data: [
        {
          worker_id: 'worker-a',
          status: 'stale',
          last_heartbeat_at: 990n,
          owned_partition_count: 2,
          active_migration_count: 0,
          capacity_hint: 4,
          updated_at: 1000n
        },
        {
          worker_id: 'worker-b',
          status: 'active',
          last_heartbeat_at: 1000n,
          owned_partition_count: 1,
          active_migration_count: 0,
          capacity_hint: 4,
          updated_at: 1000n
        }
      ]
    });

    const result = await evaluateSchedulerAutomaticRebalance(context, {
      now: 1000n,
      maxRecommendations: 1,
      migrationBacklogLimit: 2
    });

    expect(result.created_recommendations).toHaveLength(1);
    expect(result.created_suppressions).toHaveLength(0);
    expect(result.created_recommendations[0]?.reason).toBe('worker_unhealthy');
    expect(result.created_recommendations[0]?.from_worker_id).toBe('worker-a');
    expect(result.created_recommendations[0]?.to_worker_id).toBe('worker-b');

    const persistedRecommendations = await listRecentSchedulerRebalanceRecommendations(context, 10);
    expect(persistedRecommendations[0]?.status).toBe('recommended');
    expect(persistedRecommendations[0]?.reason).toBe('worker_unhealthy');
    expect(persistedRecommendations[0]?.from_worker_id).toBe('worker-a');
    expect(persistedRecommendations[0]?.to_worker_id).toBe('worker-b');
  });
});
