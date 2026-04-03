import { PrismaClient } from '@prisma/client';

import type { AppContext, StartupHealth } from '../app/context.js';
import {
  acquireSchedulerLease,
  getSchedulerCursor,
  updateSchedulerCursor
} from '../app/runtime/scheduler_lease.js';
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

    const firstAcquire = await acquireSchedulerLease(context, {
      workerId: 'failover-worker-a',
      partitionId: 'p2',
      now: 1000n,
      leaseTicks: 2n
    });
    assert(firstAcquire.acquired === true, 'worker a should acquire p2 lease');

    await updateSchedulerCursor(context, {
      partitionId: 'p2',
      lastScannedTick: 1000n,
      lastSignalTick: 999n,
      now: 1000n
    });

    const blockedAcquire = await acquireSchedulerLease(context, {
      workerId: 'failover-worker-b',
      partitionId: 'p2',
      now: 1001n,
      leaseTicks: 2n
    });
    assert(blockedAcquire.acquired === false, 'worker b should be blocked before lease expiry');

    const failoverAcquire = await acquireSchedulerLease(context, {
      workerId: 'failover-worker-b',
      partitionId: 'p2',
      now: 1003n,
      leaseTicks: 3n
    });
    assert(failoverAcquire.acquired === true, 'worker b should acquire p2 lease after expiry');
    assert(failoverAcquire.holder === 'failover-worker-b', 'worker b should become new holder after failover');

    await updateSchedulerCursor(context, {
      partitionId: 'p2',
      lastScannedTick: 1003n,
      lastSignalTick: 1002n,
      now: 1003n
    });

    const cursor = await getSchedulerCursor(context, 'p2');
    assert(cursor !== null, 'cursor should still exist after failover');
    assert(cursor?.last_scanned_tick === 1003n, 'cursor should advance under new holder after failover');
    assert(cursor?.last_signal_tick === 1002n, 'cursor last_signal_tick should advance under new holder after failover');

    console.log('[scheduler_failover] PASS');
  } catch (error: unknown) {
    console.error('[scheduler_failover] FAIL');
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
