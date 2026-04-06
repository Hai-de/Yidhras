import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import {
  listSchedulerWorkerRuntimeStates,
  refreshSchedulerWorkerRuntimeLiveness,
  refreshSchedulerWorkerRuntimeState,
  resolveSchedulerOwnershipSnapshot
} from '../../src/app/runtime/scheduler_ownership.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

describe('scheduler worker runtime state integration', () => {
  let cleanup: (() => Promise<void>) | null = null;
  let context: AppContext;

  beforeAll(async () => {
    const fixture = await createIsolatedAppContextFixture();
    cleanup = fixture.cleanup;
    context = fixture.context;
  });

  beforeEach(async () => {
    await context.prisma.schedulerWorkerRuntimeState.deleteMany();
    await context.prisma.schedulerOwnershipMigrationLog.deleteMany();
    await context.prisma.schedulerPartitionAssignment.deleteMany();
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it('tracks worker heartbeats, derives stale/dead liveness and exposes the state through ownership snapshots', async () => {
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

    await refreshSchedulerWorkerRuntimeState(context, {
      workerId: 'worker-a',
      ownedPartitionIds: ['p0'],
      capacityHint: 4,
      now: 1000n
    });

    let states = await listSchedulerWorkerRuntimeStates(context);
    expect(states).toHaveLength(1);
    expect(states[0]?.status).toBe('active');
    expect(states[0]?.owned_partition_count).toBe(1);
    expect(states[0]?.capacity_hint).toBe(4);

    await refreshSchedulerWorkerRuntimeLiveness(context, 1006n);
    states = await listSchedulerWorkerRuntimeStates(context);
    expect(states[0]?.status).toBe('stale');

    await refreshSchedulerWorkerRuntimeLiveness(context, 1016n);
    states = await listSchedulerWorkerRuntimeStates(context);
    expect(states[0]?.status).toBe('suspected_dead');

    const snapshot = await resolveSchedulerOwnershipSnapshot(context, {
      workerId: 'worker-a',
      bootstrapPartitionIds: []
    });
    expect(snapshot.worker_runtime_status).toBe('suspected_dead');
    expect(snapshot.last_heartbeat_at).toBe(1000n);
    expect(snapshot.automatic_rebalance_enabled).toBe(true);
    expect(snapshot.owned_partition_ids).toContain('p0');
  });
});
