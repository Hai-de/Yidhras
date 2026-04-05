import { PrismaClient } from '@prisma/client';

import type { AppContext, StartupHealth } from '../app/context.js';
import { runAgentScheduler } from '../app/runtime/agent_scheduler.js';
import { listRecentSchedulerOwnershipMigrations } from '../app/runtime/scheduler_ownership.js';
import { listRecentSchedulerRebalanceRecommendations } from '../app/runtime/scheduler_rebalance.js';
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
    await prisma.schedulerCandidateDecision.deleteMany();
    await prisma.schedulerRun.deleteMany();
    await prisma.schedulerCursor.deleteMany();
    await prisma.schedulerLease.deleteMany();
    await prisma.schedulerRebalanceRecommendation.deleteMany();
    await prisma.schedulerWorkerRuntimeState.deleteMany();
    await prisma.schedulerOwnershipMigrationLog.deleteMany();
    await prisma.schedulerPartitionAssignment.deleteMany();

    await prisma.schedulerPartitionAssignment.createMany({
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

    await prisma.schedulerWorkerRuntimeState.createMany({
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

    const runResult = await runAgentScheduler({
      context,
      workerId: 'worker-b',
      partitionIds: [],
      limit: 5
    });

    assert(Array.isArray(runResult.partition_ids), 'automatic rebalance apply should still return partition_ids array');

    const migrations = await listRecentSchedulerOwnershipMigrations(context, 10);
    assert(migrations.length >= 1, 'automatic rebalance apply should create migration');
    assert(migrations[0]?.to_worker_id === 'worker-b', 'automatic rebalance apply should target current worker');
    assert(migrations[0]?.reason === 'automatic_rebalance:worker_unhealthy', 'automatic rebalance apply should create automatic migration reason');

    const recommendations = await listRecentSchedulerRebalanceRecommendations(context, 10);
    assert(recommendations.some(item => item.status === 'applied'), 'automatic rebalance apply should mark recommendation as applied');

    console.log('[scheduler_automatic_rebalance_apply] PASS');
  } catch (error: unknown) {
    console.error('[scheduler_automatic_rebalance_apply] FAIL');
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
