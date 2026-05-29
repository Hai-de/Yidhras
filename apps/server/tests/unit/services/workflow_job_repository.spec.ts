import { describe, expect, it, vi } from 'vitest';

import {
  getActionIntentByInferenceId,
  getDecisionJobById,
  getDecisionJobByIdempotencyKey,
  getDecisionJobByInferenceId,
  getInferenceTraceById,
  listRunnableDecisionJobs
} from '../../../src/app/services/inference_workflow/workflow_job_repository.js';
import { createMockAppContext } from '../../helpers/mock_context.js';

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
  created_at: 1000n,
  updated_at: 1000n,
  ...overrides
});

describe('workflow_job_repository', () => {
  describe('getDecisionJobById', () => {
    it('returns job when found', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.decisionJob.findUnique = vi.fn().mockResolvedValue(makeJob());

      const result = await getDecisionJobById(ctx, 'job-1');
      expect(result.id).toBe('job-1');
      expect(ctx.prisma.decisionJob.findUnique).toHaveBeenCalledWith({ where: { id: 'job-1' } });
    });

    it('throws 404 when job not found', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.decisionJob.findUnique = vi.fn().mockResolvedValue(null);

      await expect(getDecisionJobById(ctx, 'nonexistent')).rejects.toMatchObject({
        status: 404,
        code: 'DECISION_JOB_NOT_FOUND'
      });
    });

    it('throws when job_id is empty', async () => {
      const ctx = createMockAppContext();
      await expect(getDecisionJobById(ctx, '')).rejects.toThrow();
    });
  });

  describe('getDecisionJobByInferenceId', () => {
    it('returns job when found', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.decisionJob.findUnique = vi.fn().mockResolvedValue(makeJob());

      const result = await getDecisionJobByInferenceId(ctx, 'inf-1');
      expect(result.id).toBe('job-1');
      expect(ctx.prisma.decisionJob.findUnique).toHaveBeenCalledWith({
        where: { source_inference_id: 'inf-1' }
      });
    });

    it('throws 404 when not found', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.decisionJob.findUnique = vi.fn().mockResolvedValue(null);

      await expect(getDecisionJobByInferenceId(ctx, 'nonexistent')).rejects.toMatchObject({
        status: 404
      });
    });
  });

  describe('getInferenceTraceById', () => {
    it('returns trace when found', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.inferenceTrace.findUnique = vi.fn().mockResolvedValue({ id: 'trace-1' });

      const result = await getInferenceTraceById(ctx, 'trace-1');
      expect(result.id).toBe('trace-1');
    });

    it('throws 404 when not found', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.inferenceTrace.findUnique = vi.fn().mockResolvedValue(null);

      await expect(getInferenceTraceById(ctx, 'nonexistent')).rejects.toMatchObject({
        status: 404,
        code: 'INFERENCE_TRACE_NOT_FOUND'
      });
    });
  });

  describe('getActionIntentByInferenceId', () => {
    it('returns intent when found', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.actionIntent.findUnique = vi.fn().mockResolvedValue({ id: 'intent-1' });

      const result = await getActionIntentByInferenceId(ctx, 'inf-1');
      expect(result.id).toBe('intent-1');
    });

    it('throws 404 when not found', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.actionIntent.findUnique = vi.fn().mockResolvedValue(null);

      await expect(getActionIntentByInferenceId(ctx, 'nonexistent')).rejects.toMatchObject({
        status: 404,
        code: 'ACTION_INTENT_NOT_FOUND'
      });
    });
  });

  describe('getDecisionJobByIdempotencyKey', () => {
    it('returns job when found', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.decisionJob.findUnique = vi.fn().mockResolvedValue(makeJob());

      const result = await getDecisionJobByIdempotencyKey(ctx, 'key-1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('job-1');
    });

    it('returns null when not found', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.decisionJob.findUnique = vi.fn().mockResolvedValue(null);

      const result = await getDecisionJobByIdempotencyKey(ctx, 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('listRunnableDecisionJobs', () => {
    it('returns runnable jobs', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.decisionJob.findMany = vi.fn().mockResolvedValue([makeJob(), makeJob({ id: 'job-2' })]);

      const result = await listRunnableDecisionJobs(ctx, 10);
      expect(result).toHaveLength(2);
      expect(ctx.prisma.decisionJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: expect.any(Object) }),
          orderBy: { updated_at: 'asc' },
          take: 10
        })
      );
    });

    it('uses custom limit', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.decisionJob.findMany = vi.fn().mockResolvedValue([]);

      await listRunnableDecisionJobs(ctx, 5);
      expect(ctx.prisma.decisionJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 })
      );
    });

    it('returns empty array when no runnable jobs', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.decisionJob.findMany = vi.fn().mockResolvedValue([]);

      const result = await listRunnableDecisionJobs(ctx);
      expect(result).toEqual([]);
    });
  });
});
