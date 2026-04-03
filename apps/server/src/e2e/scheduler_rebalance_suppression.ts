import { PrismaClient } from '@prisma/client';

import type { AppContext, StartupHealth } from '../app/context.js';
import { evaluateSchedulerAutomaticRebalance } from '../app/runtime/scheduler_rebalance.js';
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

    await prisma.schedulerWorkerRuntimeState.create({
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

    await prisma.schedulerOwnershipMigrationLog.createMany({
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

    assert(result.created_recommendations.length === 0, 'rebalance evaluation should not create recommendations when backlog is exceeded');
    assert(result.created_suppressions.length === 1, 'rebalance evaluation should create one suppression record when backlog is exceeded');
    assert(result.created_suppressions[0]?.suppress_reason === 'migration_backlog_exceeded', 'suppression should explain backlog limit');

    console.log('[scheduler_rebalance_suppression] PASS');
  } catch (error: unknown) {
    console.error('[scheduler_rebalance_suppression] FAIL');
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
