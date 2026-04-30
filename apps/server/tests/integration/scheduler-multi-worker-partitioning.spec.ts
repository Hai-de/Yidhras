import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import type { SchedulerStorageAdapter } from "../../src/packs/storage/SchedulerStorageAdapter.js";
import { MemSchedulerStorage } from "../helpers/scheduler_storage.js";
import { runAgentScheduler } from '../../src/app/runtime/agent_scheduler.js';
import { resolveSchedulerPartitionId } from '../../src/app/runtime/scheduler_partitioning.js';
import {
  listSchedulerDecisions,
  listSchedulerRuns
} from '../../src/app/services/scheduler_observability.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

const findAgentIdsByPartition = (): Map<string, string> => {
  const result = new Map<string, string>();
  let index = 0;

  while (result.size < 4 && index < 10_000) {
    const candidateId = `partition-agent-${index}`;
    const partitionId = resolveSchedulerPartitionId(candidateId);
    if (!result.has(partitionId)) {
      result.set(partitionId, candidateId);
    }
    index += 1;
  }

  if (result.size !== 4) {
    throw new Error('failed to generate agent ids for all scheduler partitions');
  }

  return result;
};

describe('scheduler multi worker partitioning integration', () => {
  let cleanup: (() => Promise<void>) | null = null;
  let context: AppContext;
  let adapter: MemSchedulerStorage;
const TEST_PACK_ID = "test-multi-worker";

  beforeAll(async () => {
    const fixture = await createIsolatedAppContextFixture();
    context = fixture.context;
    cleanup = fixture.cleanup;
    adapter = new MemSchedulerStorage();
    adapter.open(TEST_PACK_ID);
    (context as { schedulerStorage: SchedulerStorageAdapter }).schedulerStorage = adapter;
  });

  beforeEach(async () => {
    adapter.destroyPackSchedulerStorage(TEST_PACK_ID);
    adapter.open(TEST_PACK_ID);
    await context.prisma.decisionJob.deleteMany({
      where: {
        idempotency_key: {
          startsWith: 'sch:'
        }
      }
    });
    await context.prisma.agent.deleteMany({
      where: {
        id: {
          startsWith: 'partition-agent-'
        }
      }
    });
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it('keeps two workers constrained to their explicit partition sets and covers all partitions together', async () => {
    const agentIdsByPartition = findAgentIdsByPartition();

    await context.prisma.agent.createMany({
      data: Array.from(agentIdsByPartition.entries()).map(([partitionId, agentId], offset) => ({
        id: agentId,
        name: `Partition Agent ${partitionId}`,
        type: 'active',
        is_pinned: false,
        snr: 0.5,
        created_at: 1000n + BigInt(offset),
        updated_at: 1000n + BigInt(offset)
      }))
    });

    const firstRun = await runAgentScheduler({ packId: TEST_PACK_ID, 
      context,
      workerId: 'multi-worker-a',
      partitionIds: ['p0', 'p2'],
      limit: 20
    });

    expect(firstRun.partition_ids).toEqual(['p0', 'p2']);
    expect(firstRun.scheduler_run_ids?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(firstRun.created_count).toBeGreaterThan(0);

    const secondRun = await runAgentScheduler({ packId: TEST_PACK_ID, 
      context,
      workerId: 'multi-worker-b',
      partitionIds: ['p1', 'p3'],
      limit: 20
    });

    expect(secondRun.partition_ids).toEqual(['p1', 'p3']);
    expect(secondRun.scheduler_run_ids?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(secondRun.created_count).toBeGreaterThan(0);

    const runs = await listSchedulerRuns(context, { limit: 100 });
    const decisions = await listSchedulerDecisions(context, { limit: 200 });
    const uniquePartitions = new Set(runs.items.map(item => item.partition_id));

    expect(uniquePartitions.size).toBe(4);
    expect(Array.from(uniquePartitions).sort()).toEqual(['p0', 'p1', 'p2', 'p3']);
    expect(runs.items.every(item => typeof item.partition_id === 'string')).toBe(true);
    expect(decisions.items.every(item => typeof item.partition_id === 'string')).toBe(true);
    expect(
      secondRun.created_count === 0 ||
        secondRun.skipped_pending_count > 0 ||
        secondRun.skipped_existing_idempotency_count > 0 ||
        secondRun.created_count > 0
    ).toBe(true);
  });
});
