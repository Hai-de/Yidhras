import { describe, expect, it, vi } from 'vitest';

import {
  hasActiveWorkflowForActor,
  listActiveWorkflowActors} from '../../../src/app/services/workflow/workflow_single_flight.js';

const makeMockContext = (overrides?: {
  jobs?: Array<{ id: string; request_input: unknown }>;
  intents?: Array<{ id: string; actor_ref: unknown }>;
  workflowSteps?: Array<{ agent_id: string }>;
}) => ({
  repos: {
    inference: {
      findDecisionJobs: vi.fn(async () => overrides?.jobs ?? []),
      listActionIntents: vi.fn(async () => overrides?.intents ?? [])
    },
    workflowSteps: {
      listRunningSteps: vi.fn(async () => overrides?.workflowSteps ?? [])
    }
  }
});

describe('workflow_single_flight', () => {
  describe('listActiveWorkflowActors', () => {
    it('returns empty set for empty actor ids', async () => {
      const ctx = makeMockContext();
      const result = await listActiveWorkflowActors(ctx as never, []);
      expect(result.size).toBe(0);
    });

    it('returns actor ids from active decision jobs', async () => {
      const ctx = makeMockContext({
        jobs: [
          { id: 'job-1', request_input: { agent_id: 'agent-1' } },
          { id: 'job-2', request_input: { agent_id: 'agent-2' } }
        ]
      });
      const result = await listActiveWorkflowActors(ctx as never, ['agent-1', 'agent-2', 'agent-3']);
      expect(result.has('agent-1')).toBe(true);
      expect(result.has('agent-2')).toBe(true);
      expect(result.has('agent-3')).toBe(false);
    });

    it('returns actor ids from active action intents', async () => {
      const ctx = makeMockContext({
        intents: [
          { id: 'intent-1', actor_ref: { agent_id: 'agent-1' } }
        ]
      });
      const result = await listActiveWorkflowActors(ctx as never, ['agent-1']);
      expect(result.has('agent-1')).toBe(true);
    });

    it('returns actor ids from running workflow steps', async () => {
      const ctx = makeMockContext({
        workflowSteps: [{ agent_id: 'agent-1' }]
      });
      const result = await listActiveWorkflowActors(ctx as never, ['agent-1']);
      expect(result.has('agent-1')).toBe(true);
    });

    it('deduplicates actor ids across sources', async () => {
      const ctx = makeMockContext({
        jobs: [{ id: 'job-1', request_input: { agent_id: 'agent-1' } }],
        intents: [{ id: 'intent-1', actor_ref: { agent_id: 'agent-1' } }],
        workflowSteps: [{ agent_id: 'agent-1' }]
      });
      const result = await listActiveWorkflowActors(ctx as never, ['agent-1']);
      expect(result.size).toBe(1);
      expect(result.has('agent-1')).toBe(true);
    });

    it('ignores actors not in the queried set', async () => {
      const ctx = makeMockContext({
        jobs: [{ id: 'job-1', request_input: { agent_id: 'other-agent' } }]
      });
      const result = await listActiveWorkflowActors(ctx as never, ['agent-1']);
      expect(result.has('other-agent')).toBe(false);
      expect(result.size).toBe(0);
    });

    it('ignores jobs with empty or missing agent_id in request_input', async () => {
      const ctx = makeMockContext({
        jobs: [
          { id: 'job-1', request_input: {} },
          { id: 'job-2', request_input: { agent_id: '' } }
        ]
      });
      const result = await listActiveWorkflowActors(ctx as never, ['agent-1']);
      expect(result.size).toBe(0);
    });

    it('ignores intents with non-object actor_ref', async () => {
      const ctx = makeMockContext({
        intents: [
          { id: 'intent-1', actor_ref: null },
          { id: 'intent-2', actor_ref: 'string' }
        ]
      });
      const result = await listActiveWorkflowActors(ctx as never, ['agent-1']);
      expect(result.size).toBe(0);
    });

    it('passes exclude options to queries', async () => {
      const ctx = makeMockContext();
      await listActiveWorkflowActors(ctx as never, ['agent-1'], {
        excludeDecisionJobIds: ['job-1'],
        excludeActionIntentIds: ['intent-1'],
        excludeWorkflowStepRunIds: ['step-1']
      });
      expect(ctx.repos.inference.findDecisionJobs).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { notIn: ['job-1'] }
          })
        })
      );
      expect(ctx.repos.inference.listActionIntents).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { notIn: ['intent-1'] }
          })
        })
      );
      expect(ctx.repos.workflowSteps.listRunningSteps).toHaveBeenCalledWith(
        expect.objectContaining({
          exclude_step_run_ids: ['step-1']
        })
      );
    });

    it('does not pass exclude filters when not provided', async () => {
      const ctx = makeMockContext();
      await listActiveWorkflowActors(ctx as never, ['agent-1']);
      expect(ctx.repos.inference.findDecisionJobs).toHaveBeenCalled();
      const call = (ctx.repos.inference.findDecisionJobs as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.where).not.toHaveProperty('id');
    });
  });

  describe('hasActiveWorkflowForActor', () => {
    it('returns true when actor has active workflow', async () => {
      const ctx = makeMockContext({
        jobs: [{ id: 'job-1', request_input: { agent_id: 'agent-1' } }]
      });
      const result = await hasActiveWorkflowForActor(ctx as never, 'agent-1');
      expect(result).toBe(true);
    });

    it('returns false when actor has no active workflow', async () => {
      const ctx = makeMockContext();
      const result = await hasActiveWorkflowForActor(ctx as never, 'agent-1');
      expect(result).toBe(false);
    });

    it('passes exclude options through', async () => {
      const ctx = makeMockContext({
        jobs: [{ id: 'job-1', request_input: { agent_id: 'agent-1' } }]
      });
      const result = await hasActiveWorkflowForActor(ctx as never, 'agent-1', {
        excludeDecisionJobIds: ['job-1']
      });
      expect(ctx.repos.inference.findDecisionJobs).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { notIn: ['job-1'] }
          })
        })
      );
    });
  });
});
