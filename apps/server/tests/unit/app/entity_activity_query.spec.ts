import { describe, expect, it } from 'vitest';

import { hasActiveWorkflowForActor, listActiveWorkflowActors } from '../../../src/app/runtime/entity_activity_query.js';
import { createMockAppContext } from '../../helpers/mock_context.js';

const buildContext = (input: {
  jobs?: Array<{ request_input: unknown }>;
  intents?: Array<{ actor_ref: unknown }>;
}) => {
  const ctx = createMockAppContext();
  ctx.prisma.decisionJob.findMany.mockResolvedValue(input.jobs ?? []);
  ctx.prisma.actionIntent.findMany.mockResolvedValue(input.intents ?? []);
  ctx.prisma.workflowStepRun.findMany.mockResolvedValue([]);
  return ctx;
};

describe('entity activity query', () => {
  it('collects active workflow actors from decision jobs and action intents', async () => {
    const context = buildContext({
      jobs: [
        { request_input: { agent_id: 'agent-001' } },
        { request_input: { agent_id: 'agent-999' } }
      ],
      intents: [
        { actor_ref: { agent_id: 'agent-002' } },
        { actor_ref: { identity_id: 'identity-only' } }
      ]
    });

    const activeActors = await listActiveWorkflowActors(context, ['agent-001', 'agent-002', 'agent-003']);

    expect(Array.from(activeActors).sort()).toEqual(['agent-001', 'agent-002']);
  });

  it('detects whether a single actor currently has an active workflow', async () => {
    const context = buildContext({
      jobs: [{ request_input: { agent_id: 'agent-123' } }],
      intents: []
    });

    await expect(hasActiveWorkflowForActor(context, 'agent-123')).resolves.toBe(true);
    await expect(hasActiveWorkflowForActor(context, 'agent-456')).resolves.toBe(false);
  });
});
