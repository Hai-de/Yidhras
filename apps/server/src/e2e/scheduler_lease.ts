import { PrismaClient } from '@prisma/client';

import type { AppContext, StartupHealth } from '../app/context.js';
import {
  acquireSchedulerLease,
  getSchedulerCursor,
  releaseSchedulerLease,
  renewSchedulerLease,
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
      workerId: 'scheduler-worker-a',
      now: 1000n,
      leaseTicks: 5n
    });
    assert(firstAcquire.acquired === true, 'first scheduler lease acquire should succeed');
    assert(firstAcquire.holder === 'scheduler-worker-a', 'first scheduler lease holder should match worker-a');

    const secondAcquire = await acquireSchedulerLease(context, {
      workerId: 'scheduler-worker-b',
      now: 1001n,
      leaseTicks: 5n
    });
    assert(secondAcquire.acquired === false, 'second scheduler lease acquire while valid should fail');
    assert(secondAcquire.holder === 'scheduler-worker-a', 'second acquire should report current holder');

    const renewed = await renewSchedulerLease(context, {
      workerId: 'scheduler-worker-a',
      now: 1002n,
      leaseTicks: 5n
    });
    assert(renewed.acquired === true, 'renew scheduler lease by owner should succeed');
    assert(renewed.expires_at === 1007n, 'renewed scheduler lease expiry should extend');

    const expiredAcquire = await acquireSchedulerLease(context, {
      workerId: 'scheduler-worker-b',
      now: 1008n,
      leaseTicks: 3n
    });
    assert(expiredAcquire.acquired === true, 'scheduler lease should be reclaimable after expiry');
    assert(expiredAcquire.holder === 'scheduler-worker-b', 'expired scheduler lease should transfer holder');

    await updateSchedulerCursor(context, {
      lastScannedTick: 1008n,
      lastSignalTick: 1007n,
      now: 1008n
    });

    const cursor = await getSchedulerCursor(context);
    assert(cursor !== null, 'scheduler cursor should exist after update');
    assert(cursor?.last_scanned_tick === 1008n, 'scheduler cursor last_scanned_tick should match');
    assert(cursor?.last_signal_tick === 1007n, 'scheduler cursor last_signal_tick should match');

    const wrongRelease = await releaseSchedulerLease(context, 'scheduler-worker-a');
    assert(wrongRelease === false, 'releasing scheduler lease by non-holder should fail');

    const released = await releaseSchedulerLease(context, 'scheduler-worker-b');
    assert(released === true, 'releasing scheduler lease by holder should succeed');

    console.log('[scheduler_lease] PASS');
  } catch (error: unknown) {
    console.error('[scheduler_lease] FAIL');
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
