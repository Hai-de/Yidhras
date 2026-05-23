import { describe, expect, it } from 'vitest';

import type { AppContext } from '../../../src/app/context.js';
import {
  hasActiveWorkflowForActor,
  listActiveWorkflowActors
} from '../../../src/app/services/workflow/workflow_single_flight.js';

const createContext = (input: {
  decisionJobs?: Array<{ id: string; request_input: unknown }>;
  actionIntents?: Array<{ id: string; actor_ref: unknown }>;
  workflowSteps?: Array<{ id: string; agent_id: string }>;
}): AppContext => ({
  repos: {
    inference: {
      findDecisionJobs: async (query: { where?: { id?: { notIn?: string[] } } }) => {
        const excluded = new Set(query.where?.id?.notIn ?? []);
        return (input.decisionJobs ?? []).filter(job => !excluded.has(job.id));
      },
      listActionIntents: async (query: { where?: { id?: { notIn?: string[] } } }) => {
        const excluded = new Set(query.where?.id?.notIn ?? []);
        return (input.actionIntents ?? []).filter(intent => !excluded.has(intent.id));
      }
    },
    workflowSteps: {
      listRunningSteps: async (query: { agent_ids?: string[]; exclude_step_run_ids?: string[] }) => {
        const actorIds = new Set(query.agent_ids ?? []);
        const excluded = new Set(query.exclude_step_run_ids ?? []);
        return (input.workflowSteps ?? [])
          .filter(step => actorIds.has(step.agent_id))
          .filter(step => !excluded.has(step.id));
      }
    }
  }
} as unknown as AppContext);

describe('workflow single-flight actor activity query', () => {
  it('detects active actors from decision jobs, action intents, and running workflow steps', async () => {
    const context = createContext({
      decisionJobs: [{ id: 'job-1', request_input: { agent_id: 'agent-job' } }],
      actionIntents: [{ id: 'intent-1', actor_ref: { agent_id: 'agent-intent' } }],
      workflowSteps: [{ id: 'step-1', agent_id: 'agent-step' }]
    });

    await expect(listActiveWorkflowActors(context, [
      'agent-job',
      'agent-intent',
      'agent-step',
      'agent-idle'
    ])).resolves.toEqual(new Set(['agent-job', 'agent-intent', 'agent-step']));
  });

  it('honors self-exclusion for workflow steps', async () => {
    const context = createContext({
      workflowSteps: [{ id: 'step-1', agent_id: 'agent-step' }]
    });

    await expect(hasActiveWorkflowForActor(context, 'agent-step')).resolves.toBe(true);
    await expect(hasActiveWorkflowForActor(context, 'agent-step', {
      excludeWorkflowStepRunIds: ['step-1']
    })).resolves.toBe(false);
  });
});
