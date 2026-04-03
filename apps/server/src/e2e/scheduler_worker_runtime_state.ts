import { PrismaClient } from '@prisma/client';

import type { AppContext, StartupHealth } from '../app/context.js';
import {
  listSchedulerWorkerRuntimeStates,
  refreshSchedulerWorkerRuntimeLiveness,
  refreshSchedulerWorkerRuntimeState,
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

    await refreshSchedulerWorkerRuntimeState(context, {
      workerId: 'worker-a',
      ownedPartitionIds: ['p0'],
      capacityHint: 4,
      now: 1000n
    });

    let states = await listSchedulerWorkerRuntimeStates(context);
    assert(states.length === 1, 'worker runtime state should be created');
    assert(states[0]?.status === 'active', 'worker runtime state should start active');
    assert(states[0]?.owned_partition_count === 1, 'worker runtime state should track owned partitions');
    assert(states[0]?.capacity_hint === 4, 'worker runtime state should preserve capacity hint');

    await refreshSchedulerWorkerRuntimeLiveness(context, 1006n);
    states = await listSchedulerWorkerRuntimeStates(context);
    assert(states[0]?.status === 'stale', 'worker runtime state should become stale after stale threshold');

    await refreshSchedulerWorkerRuntimeLiveness(context, 1016n);
    states = await listSchedulerWorkerRuntimeStates(context);
    assert(states[0]?.status === 'suspected_dead', 'worker runtime state should become suspected_dead after dead threshold');

    const snapshot = await resolveSchedulerOwnershipSnapshot(context, {
      workerId: 'worker-a',
      bootstrapPartitionIds: []
    });
    assert(snapshot.worker_runtime_status === 'suspected_dead', 'ownership snapshot should expose worker runtime status');
    assert(snapshot.last_heartbeat_at === 1000n, 'ownership snapshot should expose last heartbeat');
    assert(snapshot.automatic_rebalance_enabled === true, 'ownership snapshot should expose automatic rebalance flag');

    console.log('[scheduler_worker_runtime_state] PASS');
  } catch (error: unknown) {
    console.error('[scheduler_worker_runtime_state] FAIL');
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
