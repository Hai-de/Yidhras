import { PrismaClient } from '@prisma/client';

import type { AppContext, StartupHealth } from '../app/context.js';
import { runAgentScheduler } from '../app/runtime/agent_scheduler.js';
import {
  createSchedulerOwnershipMigration,
  getSchedulerPartitionAssignment,
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
    await prisma.schedulerCandidateDecision.deleteMany();
    await prisma.schedulerRun.deleteMany();
    await prisma.schedulerCursor.deleteMany();
    await prisma.schedulerLease.deleteMany();
    await prisma.schedulerOwnershipMigrationLog.deleteMany();
    await prisma.schedulerPartitionAssignment.deleteMany();
    await prisma.decisionJob.deleteMany({
      where: {
        idempotency_key: {
          startsWith: 'sch:'
        }
      }
    });

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

    const beforeWorkerA = await resolveSchedulerOwnershipSnapshot(context, { workerId: 'worker-a' });
    assert(beforeWorkerA.owned_partition_ids.includes('p1'), 'worker-a should own p1 before rebalance');

    const blockedWorkerBRun = await runAgentScheduler({
      context,
      workerId: 'worker-b',
      partitionIds: ['p1'],
      limit: 10
    });
    assert(blockedWorkerBRun.scanned_count === 0, 'worker-b should not scan p1 before migration');

    const migration = await createSchedulerOwnershipMigration(context, {
      partitionId: 'p1',
      toWorkerId: 'worker-b',
      reason: 'handoff test'
    });

    const handoffRun = await runAgentScheduler({
      context,
      workerId: 'worker-b',
      partitionIds: undefined,
      limit: 10
    });

    assert(handoffRun.partition_ids?.includes('p1') ?? false, 'worker-b handoff run should target p1');

    const assignmentAfterHandoff = await getSchedulerPartitionAssignment(context, 'p1');
    assert(assignmentAfterHandoff?.worker_id === 'worker-b', 'assignment should move to worker-b after handoff run');
    assert(assignmentAfterHandoff?.status === 'assigned', 'assignment should settle to assigned after handoff');

    const logs = await listRecentSchedulerOwnershipMigrations(context, 10);
    const latestLog = logs.find(item => item.id === migration.id) ?? null;
    assert(latestLog?.status === 'completed', 'migration log should complete after handoff run');

    const afterWorkerA = await resolveSchedulerOwnershipSnapshot(context, { workerId: 'worker-a', bootstrapPartitionIds: [] });
    const afterWorkerB = await resolveSchedulerOwnershipSnapshot(context, { workerId: 'worker-b', bootstrapPartitionIds: [] });
    assert(!afterWorkerA.owned_partition_ids.includes('p1'), 'worker-a should not own p1 after migration');
    assert(afterWorkerB.owned_partition_ids.includes('p1'), 'worker-b should own p1 after migration');

    console.log('[scheduler_rebalance_handoff] PASS');
  } catch (error: unknown) {
    console.error('[scheduler_rebalance_handoff] FAIL');
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
