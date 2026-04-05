import { PrismaClient } from '@prisma/client';

import type { AppContext, StartupHealth } from '../app/context.js';
import {
  completeSchedulerOwnershipMigration,
  createSchedulerOwnershipMigration,
  listRecentSchedulerOwnershipMigrations,
  listSchedulerPartitionAssignments,
  markSchedulerOwnershipMigrationInProgress,
  resolveSchedulerOwnershipSnapshot
} from '../app/runtime/scheduler_ownership.js';
import { ChronosEngine } from '../clock/engine.js';
import type { SimulationManager } from '../core/simulation.js';
import { notifications } from '../utils/notifications.js';
import { DEFAULT_E2E_WORLD_PACK } from './config.js';

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
    available_world_packs: [DEFAULT_E2E_WORLD_PACK],
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
    await prisma.schedulerOwnershipMigrationLog.deleteMany();
    await prisma.schedulerPartitionAssignment.deleteMany();

    await prisma.schedulerPartitionAssignment.create({
      data: {
        partition_id: 'p1',
        worker_id: 'worker-a',
        status: 'assigned',
        version: 1,
        source: 'bootstrap',
        updated_at: 1000n
      }
    });

    const beforeSnapshot = await resolveSchedulerOwnershipSnapshot(context, {
      workerId: 'worker-a'
    });
    assert(beforeSnapshot.assignment_source === 'persisted', 'before snapshot should resolve from persisted assignment');
    assert(beforeSnapshot.owned_partition_ids.includes('p1'), 'worker-a should own p1 before migration');

    const migration = await createSchedulerOwnershipMigration(context, {
      partitionId: 'p1',
      toWorkerId: 'worker-b',
      reason: 'rebalance test'
    });
    assert(migration.status === 'requested', 'migration should start as requested');

    await markSchedulerOwnershipMigrationInProgress(context, migration.id);
    const inProgressLogs = await listRecentSchedulerOwnershipMigrations(context, 10);
    assert(inProgressLogs[0]?.status === 'in_progress', 'migration should become in_progress');

    await completeSchedulerOwnershipMigration(context, migration.id);

    const assignments = await listSchedulerPartitionAssignments(context);
    const migratedAssignment = assignments.find(item => item.partition_id === 'p1') ?? null;
    assert(migratedAssignment !== null, 'assignment should still exist after migration');
    assert(migratedAssignment?.worker_id === 'worker-b', 'assignment should move to worker-b after migration');
    assert(migratedAssignment?.status === 'assigned', 'assignment should settle to assigned after migration');
    assert(migratedAssignment?.source === 'rebalance', 'assignment should expose rebalance source after migration');

    const afterSnapshot = await resolveSchedulerOwnershipSnapshot(context, {
      workerId: 'worker-b'
    });
    assert(afterSnapshot.assignment_source === 'persisted', 'after snapshot should resolve from persisted assignment');
    assert(afterSnapshot.owned_partition_ids.includes('p1'), 'worker-b should own p1 after migration');

    const completedLogs = await listRecentSchedulerOwnershipMigrations(context, 10);
    assert(completedLogs[0]?.status === 'completed', 'migration log should complete');
    assert(completedLogs[0]?.completed_at !== null, 'migration log should expose completed_at');

    console.log('[scheduler_ownership_migration] PASS');
  } catch (error: unknown) {
    console.error('[scheduler_ownership_migration] FAIL');
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
