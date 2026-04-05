import { PrismaClient } from '@prisma/client';

import type { AppContext, StartupHealth } from '../app/context.js';
import {
  assertDecisionJobLockOwnership,
  claimDecisionJob,
  createPendingDecisionJob,
  releaseDecisionJobLock,
  updateDecisionJobState
} from '../app/services/inference_workflow.js';
import { ChronosEngine } from '../clock/engine.js';
import type { SimulationManager } from '../core/simulation.js';
import { notifications } from '../utils/notifications.js';
import { DEFAULT_E2E_WORLD_PACK } from './config.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNotNull<T>(value: T, message: string): asserts value is NonNullable<T> {
  if (value === null || value === undefined) {
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

const createJob = async (context: AppContext, suffix: string) => {
  const idempotencyKey = `workflow-lock-test-${suffix}-${Date.now()}`;
  return createPendingDecisionJob(context, {
    idempotency_key: idempotencyKey,
    request_input: {
      agent_id: 'agent-001',
      strategy: 'mock',
      idempotency_key: idempotencyKey
    }
  });
};

const testSingleClaim = async (context: AppContext) => {
  const job = await createJob(context, 'single-claim');

  const claimed = await claimDecisionJob(context, {
    job_id: job.id,
    worker_id: 'worker-a',
    now: 2000n,
    lock_ticks: 5n
  });
  assertNotNull(claimed, 'first claim should succeed');

  assert(claimed.locked_by === 'worker-a', 'first claim should set locked_by');
  assert(claimed.status === 'running', 'first claim should set status=running');
  assert(claimed.attempt_count === 1, 'first claim should increment attempt_count from 0 to 1');

  const secondClaim = await claimDecisionJob(context, {
    job_id: job.id,
    worker_id: 'worker-b',
    now: 2001n,
    lock_ticks: 5n
  });
  assert(secondClaim === null, 'second claim while lock valid should fail');
};

const testExpiredLockReclaim = async (context: AppContext) => {
  const job = await createJob(context, 'expired-reclaim');

  const firstClaim = await claimDecisionJob(context, {
    job_id: job.id,
    worker_id: 'worker-a',
    now: 3000n,
    lock_ticks: 2n
  });
  assertNotNull(firstClaim, 'initial claim for expired-lock test should succeed');

  assert(firstClaim.lock_expires_at === 3002n, 'lock_expires_at should equal now + lock_ticks');

  const reclaimed = await claimDecisionJob(context, {
    job_id: job.id,
    worker_id: 'worker-b',
    now: 3003n,
    lock_ticks: 4n
  });
  assertNotNull(reclaimed, 'claim after lock expiry should succeed');

  assert(reclaimed.locked_by === 'worker-b', 'reclaimed job should belong to new worker');
  assert(reclaimed.attempt_count === 1, 'reclaiming expired running job should not increment attempt_count again');
};

const testReleaseAndOwnership = async (context: AppContext) => {
  const job = await createJob(context, 'release-ownership');

  const claimed = await claimDecisionJob(context, {
    job_id: job.id,
    worker_id: 'worker-a',
    now: 4000n,
    lock_ticks: 5n
  });
  assertNotNull(claimed, 'claim for release test should succeed');


  assertDecisionJobLockOwnership(claimed, 'worker-a', 4001n);

  let ownershipRejected = false;
  try {
    assertDecisionJobLockOwnership(claimed, 'worker-b', 4001n);
  } catch {
    ownershipRejected = true;
  }
  assert(ownershipRejected, 'ownership check should reject non-owner worker');

  const wrongRelease = await releaseDecisionJobLock(context, {
    job_id: job.id,
    worker_id: 'worker-b'
  });
  assert(wrongRelease.locked_by === 'worker-a', 'release by wrong worker should not clear lock');

  const released = await releaseDecisionJobLock(context, {
    job_id: job.id,
    worker_id: 'worker-a'
  });
  assert(released.locked_by === null, 'release by owner should clear locked_by');
  assert(released.locked_at === null, 'release by owner should clear locked_at');
  assert(released.lock_expires_at === null, 'release by owner should clear lock_expires_at');
};

const testRetryResetClearsLock = async (context: AppContext) => {
  const job = await createJob(context, 'retry-reset');

  const claimed = await claimDecisionJob(context, {
    job_id: job.id,
    worker_id: 'worker-a',
    now: 5000n,
    lock_ticks: 5n
  });
  assertNotNull(claimed, 'claim for retry-reset test should succeed');


  const failed = await updateDecisionJobState(context, {
    job_id: job.id,
    status: 'failed',
    last_error: 'test failure',
    locked_by: null,
    locked_at: null,
    lock_expires_at: null,
    next_retry_at: null
  });
  assert(failed.status === 'failed', 'job should transition to failed');
  assert(failed.locked_by === null, 'failed state update should clear locked_by');

  const reset = await updateDecisionJobState(context, {
    job_id: job.id,
    status: 'pending',
    last_error: null,
    last_error_code: null,
    last_error_stage: null,
    locked_by: null,
    locked_at: null,
    lock_expires_at: null,
    next_retry_at: 5001n,
    completed_at: null
  });
  assert(reset.status === 'pending', 'retry reset should set status back to pending');
  assert(reset.locked_by === null, 'retry reset should keep lock cleared');

  const reclaimed = await claimDecisionJob(context, {
    job_id: job.id,
    worker_id: 'worker-c',
    now: 5001n,
    lock_ticks: 5n
  });
  assertNotNull(reclaimed, 'job reset to pending should be claimable again');

  assert(reclaimed.locked_by === 'worker-c', 'reclaimed pending job should belong to new worker');
  assert(reclaimed.attempt_count === 2, 'claim after retry reset should increment attempt_count again');
};

const main = async () => {
  const prisma = new PrismaClient();
  const context = buildTestContext(prisma);

  try {
    await testSingleClaim(context);
    await testExpiredLockReclaim(context);
    await testReleaseAndOwnership(context);
    await testRetryResetClearsLock(context);

    console.log('[workflow_locking] PASS');
  } catch (error: unknown) {
    console.error('[workflow_locking] FAIL');
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
