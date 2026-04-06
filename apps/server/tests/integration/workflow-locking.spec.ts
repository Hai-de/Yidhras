import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import {
  assertDecisionJobLockOwnership,
  claimDecisionJob,
  createPendingDecisionJob,
  releaseDecisionJobLock,
  updateDecisionJobState
} from '../../src/app/services/inference_workflow.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

describe('workflow locking integration', () => {
  let cleanup: (() => Promise<void>) | null = null;
  let context: AppContext;

  beforeAll(async () => {
    const fixture = await createIsolatedAppContextFixture();
    cleanup = fixture.cleanup;
    context = fixture.context;
  });

  afterAll(async () => {
    await cleanup?.();
  });

  const createJob = async (suffix: string) => {
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

  it('claims a pending job only once while its lock is valid', async () => {
    const job = await createJob('single-claim');

    const claimed = await claimDecisionJob(context, {
      job_id: job.id,
      worker_id: 'worker-a',
      now: 2000n,
      lock_ticks: 5n
    });
    expect(claimed).not.toBeNull();
    expect(claimed?.locked_by).toBe('worker-a');
    expect(claimed?.status).toBe('running');
    expect(claimed?.attempt_count).toBe(1);

    const secondClaim = await claimDecisionJob(context, {
      job_id: job.id,
      worker_id: 'worker-b',
      now: 2001n,
      lock_ticks: 5n
    });
    expect(secondClaim).toBeNull();
  });

  it('reclaims an expired running job without incrementing attempt_count again', async () => {
    const job = await createJob('expired-reclaim');

    const firstClaim = await claimDecisionJob(context, {
      job_id: job.id,
      worker_id: 'worker-a',
      now: 3000n,
      lock_ticks: 2n
    });
    expect(firstClaim).not.toBeNull();
    expect(firstClaim?.lock_expires_at).toBe(3002n);

    const reclaimed = await claimDecisionJob(context, {
      job_id: job.id,
      worker_id: 'worker-b',
      now: 3003n,
      lock_ticks: 4n
    });
    expect(reclaimed).not.toBeNull();
    expect(reclaimed?.locked_by).toBe('worker-b');
    expect(reclaimed?.attempt_count).toBe(1);
  });

  it('enforces ownership checks and only allows the holder to release the lock', async () => {
    const job = await createJob('release-ownership');

    const claimed = await claimDecisionJob(context, {
      job_id: job.id,
      worker_id: 'worker-a',
      now: 4000n,
      lock_ticks: 5n
    });
    expect(claimed).not.toBeNull();
    if (!claimed) {
      return;
    }

    expect(() => assertDecisionJobLockOwnership(claimed, 'worker-a', 4001n)).not.toThrow();
    expect(() => assertDecisionJobLockOwnership(claimed, 'worker-b', 4001n)).toThrow();

    const wrongRelease = await releaseDecisionJobLock(context, {
      job_id: job.id,
      worker_id: 'worker-b'
    });
    expect(wrongRelease.locked_by).toBe('worker-a');

    const released = await releaseDecisionJobLock(context, {
      job_id: job.id,
      worker_id: 'worker-a'
    });
    expect(released.locked_by).toBeNull();
    expect(released.locked_at).toBeNull();
    expect(released.lock_expires_at).toBeNull();
  });

  it('clears locks on retry reset and increments attempt_count on the next claim', async () => {
    const job = await createJob('retry-reset');

    const claimed = await claimDecisionJob(context, {
      job_id: job.id,
      worker_id: 'worker-a',
      now: 5000n,
      lock_ticks: 5n
    });
    expect(claimed).not.toBeNull();

    const failed = await updateDecisionJobState(context, {
      job_id: job.id,
      status: 'failed',
      last_error: 'test failure',
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
      next_retry_at: null
    });
    expect(failed.status).toBe('failed');
    expect(failed.locked_by).toBeNull();

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
    expect(reset.status).toBe('pending');
    expect(reset.locked_by).toBeNull();

    const reclaimed = await claimDecisionJob(context, {
      job_id: job.id,
      worker_id: 'worker-c',
      now: 5001n,
      lock_ticks: 5n
    });
    expect(reclaimed).not.toBeNull();
    expect(reclaimed?.locked_by).toBe('worker-c');
    expect(reclaimed?.attempt_count).toBe(2);
  });
});
