import { PrismaClient } from '@prisma/client';

import type { AppContext, StartupHealth } from '../app/context.js';
import { runAgentScheduler } from '../app/runtime/agent_scheduler.js';
import { acquireSchedulerLease, getSchedulerCursor, updateSchedulerCursor } from '../app/runtime/scheduler_lease.js';
import {
  getSchedulerPartitionAssignment,
  listRecentSchedulerOwnershipMigrations
} from '../app/runtime/scheduler_ownership.js';
import { listRecentSchedulerRebalanceRecommendations } from '../app/runtime/scheduler_rebalance.js';
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
    await prisma.schedulerCandidateDecision.deleteMany();
    await prisma.schedulerRun.deleteMany();
    await prisma.schedulerCursor.deleteMany();
    await prisma.schedulerLease.deleteMany();
    await prisma.schedulerRebalanceRecommendation.deleteMany();
    await prisma.schedulerWorkerRuntimeState.deleteMany();
    await prisma.schedulerOwnershipMigrationLog.deleteMany();
    await prisma.schedulerPartitionAssignment.deleteMany();

    await prisma.schedulerPartitionAssignment.create({
      data: {
        partition_id: 'p0',
        worker_id: 'worker-a',
        status: 'assigned',
        version: 1,
        source: 'bootstrap',
        updated_at: 1000n
      }
    });

    await prisma.schedulerWorkerRuntimeState.createMany({
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
    assert(initialLease.acquired === true, 'worker-a should hold the initial lease before automatic rebalance');

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

    assert(firstRun.partition_ids?.includes('p0') === true, 'automatic rebalance should refresh ownership so worker-b sees p0');
    assert((firstRun.scheduler_run_ids?.length ?? 0) === 0, 'worker-b should not preempt the active lease before expiry');

    const appliedRecommendation = (await listRecentSchedulerRebalanceRecommendations(context, 10)).find(
      item => item.partition_id === 'p0' && item.status === 'applied'
    );
    assert(appliedRecommendation, 'automatic rebalance should create and apply a recommendation for p0');
    assert(appliedRecommendation.reason === 'worker_unhealthy', 'automatic rebalance should use worker_unhealthy reason for stale owner');
    assert(appliedRecommendation.applied_migration_id !== null, 'applied recommendation should link to created migration');

    const requestedMigration = (await listRecentSchedulerOwnershipMigrations(context, 10)).find(
      item => item.partition_id === 'p0'
    );
    assert(requestedMigration, 'automatic rebalance should create a migration for p0');
    assert(requestedMigration.reason === 'automatic_rebalance:worker_unhealthy', 'migration should preserve automatic rebalance reason prefix');
    assert(requestedMigration.status === 'requested', 'migration should remain requested while the old lease is still active');

    const migratingAssignment = await getSchedulerPartitionAssignment(context, 'p0');
    assert(migratingAssignment?.worker_id === 'worker-b', 'assignment should point to worker-b during automatic migration');
    assert(migratingAssignment?.status === 'migrating', 'assignment should remain migrating before lease expiry handoff');

    const cursorBeforeTakeover = await getSchedulerCursor(context, 'p0');
    assert(cursorBeforeTakeover?.last_scanned_tick === 999n, 'cursor should remain unchanged before new owner takeover');
    assert(cursorBeforeTakeover?.last_signal_tick === 998n, 'cursor signal watermark should remain unchanged before takeover');

    context.sim.clock.tick(3n);

    const secondRun = await runAgentScheduler({
      context,
      workerId: 'worker-b',
      partitionIds: [],
      limit: 5
    });

    assert(secondRun.partition_ids?.includes('p0') === true, 'worker-b should continue owning p0 after lease expiry');
    assert((secondRun.scheduler_run_ids?.length ?? 0) === 1, 'worker-b should create a scheduler run after lease-expiry takeover');

    const completedMigration = (await listRecentSchedulerOwnershipMigrations(context, 10)).find(
      item => item.partition_id === 'p0'
    );
    assert(completedMigration?.status === 'completed', 'automatic rebalance migration should complete after lease-expiry takeover');
    assert(completedMigration?.completed_at !== null, 'completed migration should include completed_at after takeover');

    const finalAssignment = await getSchedulerPartitionAssignment(context, 'p0');
    assert(finalAssignment?.worker_id === 'worker-b', 'assignment should settle to worker-b after automatic rebalance takeover');
    assert(finalAssignment?.status === 'assigned', 'assignment should settle back to assigned after automatic rebalance takeover');

    const finalCursor = await getSchedulerCursor(context, 'p0');
    assert(finalCursor !== null, 'cursor should survive automatic rebalance failover compatibility handoff');
    assert(finalCursor?.last_scanned_tick === 1003n, 'cursor last_scanned_tick should advance under the new owner after lease expiry');
    assert(finalCursor?.last_signal_tick === 1003n, 'cursor last_signal_tick should advance under the new owner after lease expiry');

    console.log('[scheduler_automatic_rebalance_failover_compatibility] PASS');
  } catch (error: unknown) {
    console.error('[scheduler_automatic_rebalance_failover_compatibility] FAIL');
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
