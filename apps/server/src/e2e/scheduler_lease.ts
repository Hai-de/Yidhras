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
    await prisma.schedulerLease.deleteMany();
    await prisma.schedulerCursor.deleteMany();

    const firstAcquire = await acquireSchedulerLease(context, {
      workerId: 'scheduler-worker-a',
      partitionId: 'p0',
      now: 1000n,
      leaseTicks: 5n
    });
    assert(firstAcquire.acquired === true, 'first scheduler lease acquire should succeed');
    assert(firstAcquire.holder === 'scheduler-worker-a', 'first scheduler lease holder should match worker-a');
    assert(firstAcquire.partition_id === 'p0', 'first scheduler lease should expose partition_id');

    const secondAcquire = await acquireSchedulerLease(context, {
      workerId: 'scheduler-worker-b',
      partitionId: 'p0',
      now: 1001n,
      leaseTicks: 5n
    });
    assert(secondAcquire.acquired === false, 'second scheduler lease acquire while valid should fail');
    assert(secondAcquire.holder === 'scheduler-worker-a', 'second acquire should report current holder');

    const parallelPartitionAcquire = await acquireSchedulerLease(context, {
      workerId: 'scheduler-worker-b',
      partitionId: 'p1',
      now: 1001n,
      leaseTicks: 5n
    });
    assert(parallelPartitionAcquire.acquired === true, 'different partition lease acquire should succeed in parallel');
    assert(parallelPartitionAcquire.partition_id === 'p1', 'parallel partition acquire should expose partition_id');

    await prisma.schedulerLease.deleteMany({ where: { partition_id: 'p2' } });
    const [raceAcquireA, raceAcquireB] = await Promise.all([
      acquireSchedulerLease(context, {
        workerId: 'scheduler-race-worker-a',
        partitionId: 'p2',
        now: 1010n,
        leaseTicks: 4n
      }),
      acquireSchedulerLease(context, {
        workerId: 'scheduler-race-worker-b',
        partitionId: 'p2',
        now: 1010n,
        leaseTicks: 4n
      })
    ]);
    assert(
      (raceAcquireA.acquired && !raceAcquireB.acquired) || (!raceAcquireA.acquired && raceAcquireB.acquired),
      'parallel same-partition lease acquire should elect exactly one holder without throwing'
    );
    const persistedRaceLease = await prisma.schedulerLease.findUnique({
      where: {
        partition_id: 'p2'
      }
    });
    assert(persistedRaceLease !== null, 'parallel same-partition lease acquire should persist a lease row');
    assert(
      persistedRaceLease?.holder === 'scheduler-race-worker-a' || persistedRaceLease?.holder === 'scheduler-race-worker-b',
      'parallel same-partition lease acquire should persist one of the competing holders'
    );


    const renewed = await renewSchedulerLease(context, {
      workerId: 'scheduler-worker-a',
      partitionId: 'p0',
      now: 1002n,
      leaseTicks: 5n
    });
    assert(renewed.acquired === true, 'renew scheduler lease by owner should succeed');
    assert(renewed.expires_at === 1007n, 'renewed scheduler lease expiry should extend');

    const expiredAcquire = await acquireSchedulerLease(context, {
      workerId: 'scheduler-worker-c',
      partitionId: 'p0',
      now: 1008n,
      leaseTicks: 3n
    });
    assert(expiredAcquire.acquired === true, 'scheduler lease should be reclaimable after expiry');
    assert(expiredAcquire.holder === 'scheduler-worker-c', 'expired scheduler lease should transfer holder');

    await updateSchedulerCursor(context, {
      partitionId: 'p0',
      lastScannedTick: 1008n,
      lastSignalTick: 1007n,
      now: 1008n
    });
    await updateSchedulerCursor(context, {
      partitionId: 'p1',
      lastScannedTick: 1005n,
      lastSignalTick: 1004n,
      now: 1005n
    });

    const cursorP0 = await getSchedulerCursor(context, 'p0');
    const cursorP1 = await getSchedulerCursor(context, 'p1');
    assert(cursorP0 !== null, 'scheduler cursor p0 should exist after update');
    assert(cursorP1 !== null, 'scheduler cursor p1 should exist after update');
    assert(cursorP0?.last_scanned_tick === 1008n, 'scheduler cursor p0 last_scanned_tick should match');
    assert(cursorP0?.last_signal_tick === 1007n, 'scheduler cursor p0 last_signal_tick should match');
    assert(cursorP1?.last_scanned_tick === 1005n, 'scheduler cursor p1 last_scanned_tick should match');
    assert(cursorP1?.last_signal_tick === 1004n, 'scheduler cursor p1 last_signal_tick should match');

    const wrongRelease = await releaseSchedulerLease(context, 'scheduler-worker-a', 'p0');
    assert(wrongRelease === false, 'releasing scheduler lease by non-holder should fail');

    await prisma.schedulerLease.upsert({
      where: {
        partition_id: 'p3'
      },
      update: {
        holder: 'scheduler-release-owner',
        acquired_at: 1012n,
        expires_at: 1017n,
        updated_at: 1012n
      },
      create: {
        key: 'agent_scheduler_main:p3',
        partition_id: 'p3',
        holder: 'scheduler-release-owner',
        acquired_at: 1012n,
        expires_at: 1017n,
        updated_at: 1012n
      }
    });
    const staleRelease = await releaseSchedulerLease(context, 'scheduler-worker-a', 'p3');
    assert(staleRelease === false, 'stale holder should not release lease after holder has changed');
    const persistedP3Lease = await prisma.schedulerLease.findUnique({
      where: {
        partition_id: 'p3'
      }
    });
    assert(persistedP3Lease?.holder === 'scheduler-release-owner', 'failed stale release should not delete the current holder lease');
    const releasedP3 = await releaseSchedulerLease(context, 'scheduler-release-owner', 'p3');
    assert(releasedP3 === true, 'current holder should still be able to release lease after stale release attempt');

    const releasedP0 = await releaseSchedulerLease(context, 'scheduler-worker-c', 'p0');
    assert(releasedP0 === true, 'releasing scheduler lease by holder should succeed');

    const releasedP1 = await releaseSchedulerLease(context, 'scheduler-worker-b', 'p1');
    assert(releasedP1 === true, 'releasing second partition lease by holder should succeed');

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
