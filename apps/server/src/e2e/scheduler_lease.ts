import { PrismaClient } from '@prisma/client';

import type { AppContext, RuntimeLoopDiagnostics, StartupHealth } from '../app/context.js';
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

const createDefaultRuntimeLoopDiagnostics = (): RuntimeLoopDiagnostics => ({
  status: 'idle',
  in_flight: false,
  overlap_skipped_count: 0,
  iteration_count: 0,
  last_started_at: null,
  last_finished_at: null,
  last_duration_ms: null,
  last_error_message: null
});

const buildTestContext = (prisma: PrismaClient): AppContext => {
  let paused = false;
  let runtimeReady = true;
  let runtimeLoopDiagnostics = createDefaultRuntimeLoopDiagnostics();

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
    getSqliteRuntimePragmaSnapshot: () => null,
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
    getRuntimeLoopDiagnostics: () => runtimeLoopDiagnostics,
    setRuntimeLoopDiagnostics: next => {
      runtimeLoopDiagnostics = next;
    },
    getSqliteRuntimePragmas: () => null,
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
    assert(firstAcquire.partition_id === 'p0', 'first scheduler lease should expose partition_id');

    const secondAcquire = await acquireSchedulerLease(context, {
      workerId: 'scheduler-worker-b',
      now: 1002n,
      leaseTicks: 5n
    });
    assert(secondAcquire.acquired === false, 'second scheduler lease acquire while valid should fail');
    assert(secondAcquire.holder === 'scheduler-worker-a', 'second acquire should report current holder');

    const parallelPartitionAcquire = await acquireSchedulerLease(context, {
      workerId: 'scheduler-worker-b',
      partitionId: 'p1',
      now: 1002n,
      leaseTicks: 5n
    });
    assert(parallelPartitionAcquire.acquired === true, 'second partition lease acquire should succeed independently');
    assert(parallelPartitionAcquire.partition_id === 'p1', 'second partition lease should preserve requested partition id');

    await prisma.schedulerLease.deleteMany({ where: { partition_id: 'p2' } });
    const [raceAcquireA, raceAcquireB] = await Promise.all([
      acquireSchedulerLease(context, {
        workerId: 'scheduler-race-worker-a',
        partitionId: 'p2',
        now: 1002n,
        leaseTicks: 5n
      }),
      acquireSchedulerLease(context, {
        workerId: 'scheduler-race-worker-b',
        partitionId: 'p2',
        now: 1002n,
        leaseTicks: 5n
      })
    ]);
    const raceWinners = [raceAcquireA, raceAcquireB].filter(result => result.acquired);
    const raceLosers = [raceAcquireA, raceAcquireB].filter(result => !result.acquired);
    assert(raceWinners.length === 1, 'exactly one concurrent scheduler lease acquire should succeed');
    assert(raceLosers.length === 1, 'exactly one concurrent scheduler lease acquire should fail');
    assert(
      raceLosers[0]?.holder === raceWinners[0]?.holder,
      'failed concurrent scheduler lease acquire should report the winner as holder'
    );
    const persistedRaceLease = await prisma.schedulerLease.findUnique({
      where: {
        partition_id: 'p2'
      }
    });
    assert(persistedRaceLease !== null, 'concurrent scheduler lease acquire should persist a lease row');
    assert(
      persistedRaceLease?.holder === raceWinners[0]?.holder,
      'persisted concurrent scheduler lease holder should match the winning acquire result'
    );

    const renewed = await renewSchedulerLease(context, {
      workerId: 'scheduler-worker-a',
      now: 1002n,
      leaseTicks: 5n
    });
    assert(renewed.acquired === true, 'renew scheduler lease by owner should succeed');
    assert(renewed.expires_at === 1007n, 'renewed scheduler lease expiry should extend');

    const expiredAcquire = await acquireSchedulerLease(context, {
      workerId: 'scheduler-worker-c',
      now: 1008n,
      leaseTicks: 5n
    });
    assert(expiredAcquire.acquired === true, 'scheduler lease should be reclaimable after expiry');
    assert(expiredAcquire.holder === 'scheduler-worker-c', 'expired scheduler lease should transfer holder');

    const cursorBeforeCreate = await getSchedulerCursor(context);
    assert(cursorBeforeCreate === null, 'scheduler cursor should be null before first update');

    await updateSchedulerCursor(context, {
      lastScannedTick: 1005n,
      lastSignalTick: 1004n,
      now: 1005n
    });
    const cursorAfterCreate = await getSchedulerCursor(context);
    assert(cursorAfterCreate !== null, 'scheduler cursor should be created by first update');
    assert(cursorAfterCreate?.partition_id === 'p0', 'scheduler cursor should expose default partition id');
    assert(cursorAfterCreate?.last_scanned_tick === 1005n, 'scheduler cursor should persist last_scanned_tick');
    assert(cursorAfterCreate?.last_signal_tick === 1004n, 'scheduler cursor should persist last_signal_tick');

    await updateSchedulerCursor(context, {
      partitionId: 'p1',
      lastScannedTick: 1006n,
      lastSignalTick: 1005n,
      now: 1006n
    });
    const cursorP1 = await getSchedulerCursor(context, 'p1');
    assert(cursorP1 !== null, 'scheduler cursor should support multi-partition updates');
    assert(cursorP1?.last_scanned_tick === 1006n, 'partition cursor should persist last_scanned_tick');
    assert(cursorP1?.last_signal_tick === 1005n, 'partition cursor should persist last_signal_tick');

    const wrongRelease = await releaseSchedulerLease(context, 'scheduler-worker-a', 'p0');
    assert(wrongRelease === false, 'releasing scheduler lease by non-holder should fail');

    await prisma.schedulerLease.upsert({
      where: {
        partition_id: 'p3'
      },
      update: {
        key: 'agent_scheduler_main:p3',
        holder: 'scheduler-release-owner',
        acquired_at: 1010n,
        expires_at: 1015n,
        updated_at: 1010n
      },
      create: {
        key: 'agent_scheduler_main:p3',
        partition_id: 'p3',
        holder: 'scheduler-release-owner',
        acquired_at: 1010n,
        expires_at: 1015n,
        updated_at: 1010n
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
      console.error(error.stack ?? error.message);
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

void main();
