import { describe, expect, it, vi, beforeEach } from 'vitest';

import { createMockAppContext } from '../../helpers/mock_context.js';
import type { AppContext } from '../../../src/app/context.js';
import {
  getActionIntentByInferenceId,
  getDecisionJobById,
  getDecisionJobByInferenceId,
  getDecisionJobByIdempotencyKey,
  getInferenceTraceById,
  listRunnableDecisionJobs,
  claimDecisionJob,
  releaseDecisionJobLock,
  updateDecisionJobState,
  createPendingDecisionJob,
  createPendingDecisionJobIdempotent,
  createReplayDecisionJob
} from '../../../src/app/services/inference_workflow/workflow_job_repository.js';

vi.mock('../../../src/app/services/pack/pack_runtime_resolution.js', () => ({
  resolvePackTick: vi.fn(() => 1000n)
}));

const makeJob = (overrides: Record<string, unknown> = {}) => ({
  id: 'job-1',
  status: 'pending',
  job_type: 'decision',
  pack_id: 'test-pack',
  source_inference_id: 'inf-1',
  idempotency_key: null,
  request_input: null,
  pending_source_key: 'psk-1',
  action_intent_id: null,
  attempt_count: 1,
  max_attempts: 3,
  intent_class: 'post_message',
  last_error: null,
  last_error_code: null,
  last_error_stage: null,
  completed_at: null,
  started_at: null,
  next_retry_at: null,
  locked_by: null,
  locked_at: null,
  lock_expires_at: null,
  scheduled_for_tick: null,
  replay_of_job_id: null,
  replay_source_trace_id: null,
  replay_reason: null,
  replay_override_snapshot: null,
  created_at: 1000n,
  updated_at: 1000n,
  ...overrides
});

describe('workflow_job_repository (extended)', () => {
  let ctx: AppContext;

  beforeEach(() => {
    ctx = createMockAppContext();
  });

  describe('getDecisionJobById', () => {
    it('returns job when found', async () => {
      ctx.prisma.decisionJob.findUnique = vi.fn().mockResolvedValue(makeJob());

      const result = await getDecisionJobById(ctx, 'job-1');
      expect(result.id).toBe('job-1');
    });

    it('throws 404 when not found', async () => {
      ctx.prisma.decisionJob.findUnique = vi.fn().mockResolvedValue(null);

      await expect(getDecisionJobById(ctx, 'nonexistent')).rejects.toMatchObject({
        status: 404,
        code: 'DECISION_JOB_NOT_FOUND'
      });
    });
  });

  describe('getDecisionJobByInferenceId', () => {
    it('returns job by inference id', async () => {
      ctx.prisma.decisionJob.findUnique = vi.fn().mockResolvedValue(makeJob());

      const result = await getDecisionJobByInferenceId(ctx, 'inf-1');
      expect(result.id).toBe('job-1');
    });

    it('throws 404 when not found', async () => {
      ctx.prisma.decisionJob.findUnique = vi.fn().mockResolvedValue(null);

      await expect(getDecisionJobByInferenceId(ctx, 'nonexistent')).rejects.toMatchObject({
        status: 404
      });
    });
  });

  describe('getInferenceTraceById', () => {
    it('returns trace when found', async () => {
      ctx.prisma.inferenceTrace.findUnique = vi.fn().mockResolvedValue({ id: 'trace-1', inference_id: 'inf-1' });

      const result = await getInferenceTraceById(ctx, 'trace-1');
      expect(result.id).toBe('trace-1');
    });

    it('throws 404 when not found', async () => {
      ctx.prisma.inferenceTrace.findUnique = vi.fn().mockResolvedValue(null);

      await expect(getInferenceTraceById(ctx, 'nonexistent')).rejects.toMatchObject({
        status: 404,
        code: 'INFERENCE_TRACE_NOT_FOUND'
      });
    });
  });

  describe('getActionIntentByInferenceId', () => {
    it('returns intent when found', async () => {
      ctx.prisma.actionIntent.findUnique = vi.fn().mockResolvedValue({ id: 'intent-1' });

      const result = await getActionIntentByInferenceId(ctx, 'inf-1');
      expect(result.id).toBe('intent-1');
    });

    it('throws 404 when not found', async () => {
      ctx.prisma.actionIntent.findUnique = vi.fn().mockResolvedValue(null);

      await expect(getActionIntentByInferenceId(ctx, 'nonexistent')).rejects.toMatchObject({
        status: 404,
        code: 'ACTION_INTENT_NOT_FOUND'
      });
    });
  });

  describe('getDecisionJobByIdempotencyKey', () => {
    it('returns job when found', async () => {
      ctx.prisma.decisionJob.findUnique = vi.fn().mockResolvedValue(makeJob());

      const result = await getDecisionJobByIdempotencyKey(ctx, 'key-1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('job-1');
    });

    it('returns null when not found', async () => {
      ctx.prisma.decisionJob.findUnique = vi.fn().mockResolvedValue(null);

      const result = await getDecisionJobByIdempotencyKey(ctx, 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('listRunnableDecisionJobs', () => {
    it('returns runnable jobs with correct query', async () => {
      ctx.prisma.decisionJob.findMany = vi.fn().mockResolvedValue([makeJob(), makeJob({ id: 'job-2' })]);

      const result = await listRunnableDecisionJobs(ctx, 10);
      expect(result).toHaveLength(2);
      expect(ctx.prisma.decisionJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: expect.objectContaining({ in: expect.any(Array) })
          }),
          orderBy: { updated_at: 'asc' },
          take: 10
        })
      );
    });

    it('returns empty when no jobs', async () => {
      ctx.prisma.decisionJob.findMany = vi.fn().mockResolvedValue([]);

      const result = await listRunnableDecisionJobs(ctx);
      expect(result).toEqual([]);
    });
  });

  describe('claimDecisionJob', () => {
    it('claims a pending job', async () => {
      const job = makeJob();
      ctx.prisma.decisionJob.findUnique = vi.fn().mockResolvedValue(job);
      ctx.prisma.decisionJob.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      // Second findUnique call after successful claim
      ctx.prisma.decisionJob.findUnique = vi.fn()
        .mockResolvedValueOnce(job)
        .mockResolvedValueOnce({ ...job, status: 'running', locked_by: 'worker-1' });

      const result = await claimDecisionJob(ctx, {
        job_id: 'job-1',
        worker_id: 'worker-1',
        now: 1000n,
        lock_ticks: 1000n
      });

      expect(result).not.toBeNull();
      expect(ctx.prisma.decisionJob.updateMany).toHaveBeenCalled();
    });
  });

  describe('releaseDecisionJobLock', () => {
    it('releases lock on a job', async () => {
      ctx.prisma.decisionJob.findUnique = vi.fn().mockResolvedValue(makeJob({ locked_by: 'worker-1' }));
      ctx.prisma.decisionJob.update = vi.fn().mockResolvedValue(makeJob());

      await releaseDecisionJobLock(ctx, {
        job_id: 'job-1',
        worker_id: 'worker-1'
      });

      expect(ctx.prisma.decisionJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            locked_by: null,
            lock_expires_at: null
          })
        })
      );
    });
  });

  describe('updateDecisionJobState', () => {
    it('updates job status to completed', async () => {
      ctx.prisma.decisionJob.findUnique = vi.fn().mockResolvedValue(makeJob({ locked_by: 'worker-1' }));
      ctx.prisma.decisionJob.update = vi.fn().mockResolvedValue(makeJob({ status: 'completed' }));

      await updateDecisionJobState(ctx, {
        job_id: 'job-1',
        status: 'completed',
        completed_at: 2000n
      });

      expect(ctx.prisma.decisionJob.update).toHaveBeenCalled();
    });
  });

  describe('createPendingDecisionJob', () => {
    it('creates a new pending job', async () => {
      ctx.prisma.decisionJob.create = vi.fn().mockResolvedValue(makeJob({ id: 'job-new' }));

      const result = await createPendingDecisionJob(ctx, {
        request_input: { agent_id: 'agent-1' },
        idempotency_key: 'key-new',
        intent_class: 'direct_inference',
        max_attempts: 3
      });

      expect(result.id).toBe('job-new');
      expect(ctx.prisma.decisionJob.create).toHaveBeenCalled();
    });
  });

  describe('createPendingDecisionJobIdempotent', () => {
    it('creates new job when no idempotency match', async () => {
      ctx.prisma.decisionJob.create = vi.fn().mockResolvedValue(makeJob({ id: 'new-job' }));

      const result = await createPendingDecisionJobIdempotent(ctx, {
        request_input: { agent_id: 'agent-1' },
        idempotency_key: 'new-key',
        intent_class: 'direct_inference',
        max_attempts: 3
      });

      expect(result.job.id).toBe('new-job');
      expect(result.created).toBe(true);
    });
  });


});
