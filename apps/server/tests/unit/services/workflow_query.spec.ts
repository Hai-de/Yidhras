import { describe, expect, it, vi } from 'vitest';

import {
  getWorkflowSnapshotByInferenceId,
  getWorkflowSnapshotByJobId,
  listInferenceJobs} from '../../../src/app/services/inference_workflow/workflow_query.js';
import { createMockAppContext } from '../../helpers/mock_context.js';

vi.mock('../../../src/app/services/pack/pack_runtime_resolution.js', () => ({
  resolvePackTick: vi.fn(() => 1000n)
}));



const makeTrace = (overrides: Record<string, unknown> = {}) => ({
  id: 'trace-1',
  inference_id: 'inf-1',
  strategy: 'single_pass',
  ...overrides
});



describe('workflow_query', () => {
  describe('listInferenceJobs', () => {
    it('returns empty list when no jobs exist', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.decisionJob.findMany = vi.fn().mockResolvedValue([]);
      ctx.prisma.decisionJob.count = vi.fn().mockResolvedValue(0);

      const result = await listInferenceJobs(ctx, {});
      expect(result.items).toEqual([]);
      expect(result.page_info.has_next_page).toBe(false);
    });

    it('returns summary counts', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.decisionJob.findMany = vi.fn().mockResolvedValue([]);
      ctx.prisma.decisionJob.count = vi.fn().mockResolvedValue(0);

      const result = await listInferenceJobs(ctx, {});
      expect(result.summary).toBeDefined();
      expect(result.summary.counts_by_status).toBeDefined();
      expect(result.summary.filters).toBeDefined();
      expect(result.summary.returned).toBe(0);
      expect(result.summary.limit).toBeDefined();
    });
  });

  describe('getWorkflowSnapshotByInferenceId', () => {
    it('throws 404 when inference trace not found', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.inferenceTrace.findUnique = vi.fn().mockResolvedValue(null);

      await expect(getWorkflowSnapshotByInferenceId(ctx, 'nonexistent')).rejects.toMatchObject({
        status: 404,
        code: 'INFERENCE_TRACE_NOT_FOUND'
      });
    });

    it('throws 404 when no matching job exists', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.inferenceTrace.findUnique = vi.fn().mockResolvedValue(makeTrace());
      ctx.prisma.decisionJob.findMany = vi.fn().mockResolvedValue([]);

      await expect(getWorkflowSnapshotByInferenceId(ctx, 'inf-1')).rejects.toMatchObject({
        status: 404
      });
    });
  });

  describe('getWorkflowSnapshotByJobId', () => {
    it('throws 404 when job not found', async () => {
      const ctx = createMockAppContext();
      ctx.prisma.decisionJob.findUnique = vi.fn().mockResolvedValue(null);

      await expect(getWorkflowSnapshotByJobId(ctx, 'nonexistent')).rejects.toMatchObject({
        status: 404,
        code: 'DECISION_JOB_NOT_FOUND'
      });
    });
  });
});
