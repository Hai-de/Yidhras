import { describe, expect, it, vi } from 'vitest';

import { createMockPrisma } from '../../helpers/prisma_mock.js';

// Test the PrismaWorkflowStepRunRepository class and its helper functions

describe('workflow_step_repository', () => {
  describe('PrismaWorkflowStepRunRepository', () => {
    it('can be instantiated with a PrismaClient', async () => {
      const { PrismaWorkflowStepRunRepository } = await import('../../../src/app/services/workflow/workflow_step_repository.js');
      const mockPrisma = createMockPrisma();
      const repo = new PrismaWorkflowStepRunRepository(mockPrisma as never);
      expect(repo).toBeDefined();
      expect(typeof repo.createStepRuns).toBe('function');
      expect(typeof repo.listStepRuns).toBe('function');
      expect(typeof repo.listRunnableSteps).toBe('function');
      expect(typeof repo.claimStep).toBe('function');
      expect(typeof repo.completeStep).toBe('function');
      expect(typeof repo.failStep).toBe('function');
      expect(typeof repo.narrativizeStep).toBe('function');
      expect(typeof repo.updateStepStatus).toBe('function');
      expect(typeof repo.releaseStepLock).toBe('function');
    });

    it('createStepRuns returns empty for empty input', async () => {
      const { PrismaWorkflowStepRunRepository } = await import('../../../src/app/services/workflow/workflow_step_repository.js');
      const mockPrisma = createMockPrisma();
      const repo = new PrismaWorkflowStepRunRepository(mockPrisma as never);

      const result = await repo.createStepRuns({ steps: [] });
      expect(result).toEqual([]);
    });

    it('listStepRuns returns records', async () => {
      const { PrismaWorkflowStepRunRepository } = await import('../../../src/app/services/workflow/workflow_step_repository.js');
      const mockPrisma = createMockPrisma();
      mockPrisma.workflowStepRun.findMany.mockResolvedValue([
        {
          id: 'step-1',
          workflow_run_id: 'run-1',
          step_id: 'step-a',
          agent_id: 'agent-1',
          partition_id: 0,
          status: 'pending',
          dependency_step_ids: '[]',
          input_step_ids: '[]',
          result_json: null,
          error_json: null,
          action_intent_ids: '[]',
          attempt: 1,
          started_tick: null,
          completed_tick: null,
          lock_worker_id: null,
          lock_expires_at: null,
          idempotency_key: 'key-1',
          created_at: 100n,
          updated_at: 100n
        }
      ] as never);

      const repo = new PrismaWorkflowStepRunRepository(mockPrisma as never);
      const result = await repo.listStepRuns('run-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('step-1');
      expect(result[0].step_id).toBe('step-a');
      expect(result[0].status).toBe('pending');
      expect(result[0].dependency_step_ids).toEqual([]);
    });

    it('listRunnableSteps queries with correct status filter', async () => {
      const { PrismaWorkflowStepRunRepository } = await import('../../../src/app/services/workflow/workflow_step_repository.js');
      const mockPrisma = createMockPrisma();
      mockPrisma.workflowStepRun.findMany.mockResolvedValue([]);

      const repo = new PrismaWorkflowStepRunRepository(mockPrisma as never);
      await repo.listRunnableSteps({ now: 1000n });

      expect(mockPrisma.workflowStepRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['ready', 'running'] }
          }),
          orderBy: { updated_at: 'asc' }
        })
      );
    });

    it('listRunnableSteps applies agent_ids filter', async () => {
      const { PrismaWorkflowStepRunRepository } = await import('../../../src/app/services/workflow/workflow_step_repository.js');
      const mockPrisma = createMockPrisma();
      mockPrisma.workflowStepRun.findMany.mockResolvedValue([]);

      const repo = new PrismaWorkflowStepRunRepository(mockPrisma as never);
      await repo.listRunnableSteps({ now: 1000n, agent_ids: ['agent-1', 'agent-2'], limit: 5 });

      expect(mockPrisma.workflowStepRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            agent_id: { in: ['agent-1', 'agent-2'] }
          }),
          take: 5
        })
      );
    });

    it('updateStepStatus updates status and timestamp', async () => {
      const { PrismaWorkflowStepRunRepository } = await import('../../../src/app/services/workflow/workflow_step_repository.js');
      const mockPrisma = createMockPrisma();
      mockPrisma.workflowStepRun.update.mockResolvedValue({} as never);

      const repo = new PrismaWorkflowStepRunRepository(mockPrisma as never);
      await repo.updateStepStatus({ step_run_id: 'step-1', status: 'running', now: 1000n });

      expect(mockPrisma.workflowStepRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'step-1' },
          data: expect.objectContaining({
            status: 'running',
            updated_at: 1000n
          })
        })
      );
    });

    it('releaseStepLock clears lock fields', async () => {
      const { PrismaWorkflowStepRunRepository } = await import('../../../src/app/services/workflow/workflow_step_repository.js');
      const mockPrisma = createMockPrisma();
      mockPrisma.workflowStepRun.update.mockResolvedValue({} as never);

      const repo = new PrismaWorkflowStepRunRepository(mockPrisma as never);
      await repo.releaseStepLock({ step_run_id: 'step-1', status: 'ready', now: 1000n });

      expect(mockPrisma.workflowStepRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'step-1' },
          data: expect.objectContaining({
            lock_worker_id: null,
            lock_expires_at: null
          })
        })
      );
    });
  });
});
