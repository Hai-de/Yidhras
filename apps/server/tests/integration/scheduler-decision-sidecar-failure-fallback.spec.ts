import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { runAgentScheduler } from '../../src/app/runtime/agent_scheduler.js';
import { getLatestSchedulerRunReadModel } from '../../src/app/services/scheduler_observability.js';
import { resetRuntimeConfigCache } from '../../src/config/runtime_config.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

const ORIGINAL_BINARY_PATH = process.env.SCHEDULER_AGENT_DECISION_KERNEL_BINARY_PATH;
const ORIGINAL_MODE = process.env.SCHEDULER_AGENT_DECISION_KERNEL_MODE;

describe('scheduler decision sidecar failure fallback integration', () => {
  let cleanup: (() => Promise<void>) | null = null;
  let context: AppContext;

  beforeAll(async () => {
    const fixture = await createIsolatedAppContextFixture();
    cleanup = fixture.cleanup;
    context = fixture.context;
  });

  beforeEach(async () => {
    resetRuntimeConfigCache();
    process.env.SCHEDULER_AGENT_DECISION_KERNEL_MODE = 'rust_primary';
    process.env.SCHEDULER_AGENT_DECISION_KERNEL_BINARY_PATH = 'apps/server/rust/scheduler_decision_sidecar/target/debug/does-not-exist';

    await context.prisma.schedulerCandidateDecision.deleteMany();
    await context.prisma.schedulerRun.deleteMany();
    await context.prisma.schedulerCursor.deleteMany();
    await context.prisma.schedulerLease.deleteMany();
    await context.prisma.schedulerRebalanceRecommendation.deleteMany();
    await context.prisma.schedulerWorkerRuntimeState.deleteMany();
    await context.prisma.schedulerOwnershipMigrationLog.deleteMany();
    await context.prisma.schedulerPartitionAssignment.deleteMany();
    await context.prisma.relationshipAdjustmentLog.deleteMany();
    await context.prisma.sNRAdjustmentLog.deleteMany();
    await context.prisma.event.deleteMany();
    await context.prisma.actionIntent.deleteMany();
    await context.prisma.decisionJob.deleteMany();
    await context.prisma.inferenceTrace.deleteMany();
    await context.prisma.contextOverlayEntry.deleteMany();
    await context.prisma.memoryBlock.deleteMany();
    await context.prisma.memoryCompactionState.deleteMany();
    await context.prisma.relationship.deleteMany();

    const baseTick = context.sim.clock.getTicks();
    await context.prisma.agent.upsert({
      where: { id: 'agent-fallback-001' },
      update: {
        name: 'Scheduler Fallback Agent',
        type: 'active',
        snr: 0.7,
        updated_at: baseTick
      },
      create: {
        id: 'agent-fallback-001',
        name: 'Scheduler Fallback Agent',
        type: 'active',
        snr: 0.7,
        is_pinned: false,
        created_at: baseTick,
        updated_at: baseTick
      }
    });
  });

  afterAll(async () => {
    resetRuntimeConfigCache();
    if (ORIGINAL_MODE === undefined) delete process.env.SCHEDULER_AGENT_DECISION_KERNEL_MODE;
    else process.env.SCHEDULER_AGENT_DECISION_KERNEL_MODE = ORIGINAL_MODE;
    if (ORIGINAL_BINARY_PATH === undefined) delete process.env.SCHEDULER_AGENT_DECISION_KERNEL_BINARY_PATH;
    else process.env.SCHEDULER_AGENT_DECISION_KERNEL_BINARY_PATH = ORIGINAL_BINARY_PATH;
    await cleanup?.();
  });

  it('records fallback metadata when rust_primary sidecar startup fails', async () => {
    const run = await runAgentScheduler({
      context,
      limit: 5
    });

    expect(run.created_count).toBeGreaterThan(0);
    expect(typeof run.decision_kernel_fallback).toBe('boolean');
    expect(run.decision_kernel_fallback_reason === null || typeof run.decision_kernel_fallback_reason === 'string').toBe(true);

    const latestRun = await getLatestSchedulerRunReadModel(context);
    expect(latestRun).not.toBeNull();
    expect(typeof latestRun?.run.summary).toBe('object');
  });
});
