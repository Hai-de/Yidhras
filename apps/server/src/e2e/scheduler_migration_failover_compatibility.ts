import { PrismaClient } from '@prisma/client';

import type { AppContext, StartupHealth } from '../app/context.js';
import {
  acquireSchedulerLease,
  getSchedulerCursor,
  updateSchedulerCursor
} from '../app/runtime/scheduler_lease.js';
import {
  completeActiveSchedulerOwnershipMigration,
  createSchedulerOwnershipMigration,
  getSchedulerPartitionAssignment,
  isWorkerAllowedToOperateSchedulerPartition,
  listRecentSchedulerOwnershipMigrations,
  resolveSchedulerOwnershipSnapshot
} from '../app/runtime/scheduler_ownership.js';
import { ChronosEngine } from '../clock/engine.js';
import type { SimulationManager } from '../core/simulation.js';
import { notifications } from '../utils/notifications.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const buildTestContext = (prisma: PrismaClient): AppContext => {
  let paused = false;
  let runtimeReady = true;

  const sim = {
    prisma,
    clock: new ChronosEngine([], 1000n),
    getStepTicks: () => 1n,
    step: async () => {},
    getActivePack: () => null,
    getRuntimeSpeedSnapshot: () => ({
      mode: 'fixed' as const,
      source: 'default' as const,
      configured_step_ticks: null,
      override_step_ticks: null,
      override_since: null,
      effective_step_ticks: '1'
    }),
    setRuntimeSpeedOverride: () => {},
    clearRuntimeSpeedOverride: () => {}
  } as unknown as SimulationManager;

  const startupHealth: StartupHealth = {
    level: 'ok',
    checks: {
      db: true,
      world_pack_dir: true,
      world_pack_available: true
    },
    available_world_packs: ['cyber_noir'],
    errors: []
  };

  return {
    prisma,
    sim,
    notifications,
    startupHealth,
    getRuntimeReady: () => runtimeReady,
    setRuntimeReady: ready => {
      runtimeReady = ready;
    },
    getPaused: () => paused,
    setPaused: next => {
      paused = next;
    },
    assertRuntimeReady: () => {}
  };
};

const main = async () => {
  const prisma = new PrismaClient();
  const context = buildTestContext(prisma);

  try {
    await prisma.schedulerLease.deleteMany();
    await prisma.schedulerCursor.deleteMany();
    await prisma.schedulerOwnershipMigrationLog.deleteMany();
    await prisma.schedulerPartitionAssignment.deleteMany();

    await prisma.schedulerPartitionAssignment.create({
      data: {
        partition_id: 'p2',
        worker_id: 'worker-a',
        status: 'assigned',
        version: 1,
        source: 'bootstrap',
        updated_at: 1000n
      }
    });

    const workerALease = await acquireSchedulerLease(context, {
      workerId: 'worker-a',
      partitionId: 'p2',
      now: 1000n,
      leaseTicks: 2n
    });
    assert(workerALease.acquired === true, 'worker-a should acquire initial lease on p2');

    await updateSchedulerCursor(context, {
      partitionId: 'p2',
      lastScannedTick: 1000n,
      lastSignalTick: 999n,
      now: 1000n
    });

    await createSchedulerOwnershipMigration(context, {
      partitionId: 'p2',
      toWorkerId: 'worker-b',
      reason: 'migration-failover compatibility'
    });

    const workerAStillAllowed = await isWorkerAllowedToOperateSchedulerPartition(context, {
      partitionId: 'p2',
      workerId: 'worker-a'
    });
    const workerBAllowed = await isWorkerAllowedToOperateSchedulerPartition(context, {
      partitionId: 'p2',
      workerId: 'worker-b'
    });
    assert(workerAStillAllowed === false, 'worker-a should no longer be allowed after migration request');
    assert(workerBAllowed === true, 'worker-b should be allowed after migration request');

    const beforeExpiryWorkerBLease = await acquireSchedulerLease(context, {
      workerId: 'worker-b',
      partitionId: 'p2',
      now: 1001n,
      leaseTicks: 2n
    });
    assert(beforeExpiryWorkerBLease.acquired === false, 'worker-b should still wait for active lease expiry');

    const failoverToWorkerB = await acquireSchedulerLease(context, {
      workerId: 'worker-b',
      partitionId: 'p2',
      now: 1003n,
      leaseTicks: 3n
    });
    assert(failoverToWorkerB.acquired === true, 'worker-b should acquire lease after old owner lease expiry');

    await completeActiveSchedulerOwnershipMigration(context, {
      partitionId: 'p2',
      toWorkerId: 'worker-b'
    });

    await updateSchedulerCursor(context, {
      partitionId: 'p2',
      lastScannedTick: 1003n,
      lastSignalTick: 1002n,
      now: 1003n
    });

    const assignment = await getSchedulerPartitionAssignment(context, 'p2');
    assert(assignment?.worker_id === 'worker-b', 'assignment should settle to worker-b after migration handoff');
    assert(assignment?.status === 'assigned', 'assignment should settle to assigned after migration handoff');

    const cursor = await getSchedulerCursor(context, 'p2');
    assert(cursor !== null, 'cursor should survive migration + failover handoff');
    assert(cursor?.last_scanned_tick === 1003n, 'cursor last_scanned_tick should advance under new owner after failover');
    assert(cursor?.last_signal_tick === 1002n, 'cursor last_signal_tick should advance under new owner after failover');

    const workerASnapshot = await resolveSchedulerOwnershipSnapshot(context, {
      workerId: 'worker-a',
      bootstrapPartitionIds: []
    });
    const workerBSnapshot = await resolveSchedulerOwnershipSnapshot(context, {
      workerId: 'worker-b',
      bootstrapPartitionIds: []
    });
    assert(!workerASnapshot.owned_partition_ids.includes('p2'), 'worker-a should not own p2 after compatibility handoff');
    assert(workerBSnapshot.owned_partition_ids.includes('p2'), 'worker-b should own p2 after compatibility handoff');

    const migrations = await listRecentSchedulerOwnershipMigrations(context, 10);
    assert(migrations[0]?.status === 'completed', 'migration log should complete after worker-b failover takeover');
    assert(migrations[0]?.completed_at !== null, 'migration log should include completed_at after compatibility handoff');

    console.log('[scheduler_migration_failover_compatibility] PASS');
  } catch (error: unknown) {
    console.error('[scheduler_migration_failover_compatibility] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

void main();
