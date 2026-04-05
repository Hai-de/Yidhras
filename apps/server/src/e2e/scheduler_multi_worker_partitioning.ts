import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

import type { AppContext } from '../app/context.js';
import { runAgentScheduler } from '../app/runtime/agent_scheduler.js';
import { listSchedulerDecisions, listSchedulerRuns } from '../app/services/scheduler_observability.js';
import { sim } from '../core/simulation.js';
import type { SystemMessage } from '../utils/notifications.js';
import { DEFAULT_E2E_WORLD_PACK } from './config.js';

const assertCondition: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const prisma = new PrismaClient();

const createTestContext = (worldPack: string): AppContext => ({
  prisma: sim.prisma,
  sim,
  notifications: {
    push: () =>
      ({
        id: 'scheduler-partitioning-e2e',
        level: 'info',
        content: 'scheduler-partitioning-e2e',
        timestamp: Date.now(),
        code: 'SCHEDULER_PARTITIONING_E2E'
      }) satisfies SystemMessage,
    getMessages: () => [],
    clear: () => undefined
  },
  startupHealth: {
    level: 'ok',
    checks: { db: true, world_pack_dir: true, world_pack_available: true },
    available_world_packs: [worldPack],
    errors: []
  },
  getRuntimeReady: () => true,
  setRuntimeReady: () => undefined,
  getPaused: () => false,
  setPaused: () => undefined,
  assertRuntimeReady: () => undefined
});

async function main(): Promise<void> {
  const worldPack = process.env.WORLD_PACK ?? DEFAULT_E2E_WORLD_PACK;
  await sim.init(worldPack);

  const context = createTestContext(worldPack);

  await prisma.schedulerCandidateDecision.deleteMany({});
  await prisma.schedulerRun.deleteMany({});
  await prisma.schedulerCursor.deleteMany({});
  await prisma.schedulerLease.deleteMany({});
  await prisma.decisionJob.deleteMany({
    where: {
      idempotency_key: {
        startsWith: 'sch:'
      }
    }
  });

  const firstRun = await runAgentScheduler({
    context,
    workerId: 'multi-worker-a',
    partitionIds: ['p0', 'p2'],
    limit: 20
  });

  assertCondition((firstRun.partition_ids?.length ?? 0) === 2, 'first run should only own explicitly assigned partitions');
  assertCondition(firstRun.partition_ids?.includes('p0') ?? false, 'first run should include p0');
  assertCondition(firstRun.partition_ids?.includes('p2') ?? false, 'first run should include p2');
  assertCondition((firstRun.scheduler_run_ids?.length ?? 0) >= 1, 'first run should expose scheduler_run_ids');

  const secondRun = await runAgentScheduler({
    context,
    workerId: 'multi-worker-b',
    partitionIds: ['p1', 'p3'],
    limit: 20
  });

  assertCondition((secondRun.partition_ids?.length ?? 0) === 2, 'second run should only own explicitly assigned partitions');
  assertCondition(secondRun.partition_ids?.includes('p1') ?? false, 'second run should include p1');
  assertCondition(secondRun.partition_ids?.includes('p3') ?? false, 'second run should include p3');

  const runs = await listSchedulerRuns(context, { limit: 100 });
  const decisions = await listSchedulerDecisions(context, { limit: 200 });
  const uniquePartitions = new Set(runs.items.map(item => item.partition_id));

  assertCondition(uniquePartitions.size === 4, 'scheduler runs should cover exactly the explicitly assigned partitions');
  assertCondition(runs.items.every(item => typeof item.partition_id === 'string'), 'all scheduler runs should expose partition_id');
  assertCondition(decisions.items.every(item => typeof item.partition_id === 'string'), 'all scheduler decisions should expose partition_id');
  assertCondition(
    secondRun.created_count === 0 || secondRun.skipped_pending_count > 0 || secondRun.skipped_existing_idempotency_count > 0,
    'second worker run should not freely duplicate previously created jobs'
  );

  console.log('[scheduler_multi_worker_partitioning] PASS', {
    firstRun,
    secondRun,
    runCount: runs.items.length,
    decisionCount: decisions.items.length,
    partitionCount: uniquePartitions.size
  });
}

main()
  .catch(error => {
    console.error('[scheduler_multi_worker_partitioning] FAIL', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await sim.prisma.$disconnect();
  });
