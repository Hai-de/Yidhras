import { describe, expect, it } from 'vitest';

import {
  PromptWorkflowProfileNotFoundError,
  PromptWorkflowProfileSelectionError
} from '../../../src/context/workflow/errors.js';
import { selectPromptWorkflowProfile } from '../../../src/context/workflow/profiles.js';

describe('prompt workflow profile selection', () => {
  it.each([
    ['agent_decision', 'agent-decision-default'],
    ['context_summary', 'context-summary-default'],
    ['memory_compaction', 'memory-compaction-default'],
    ['intent_grounding_assist', 'intent-grounding-assist-default']
  ] as const)('selects explicit task profile for %s', (taskType, expectedProfileId) => {
    const profile = selectPromptWorkflowProfile({
      task_type: taskType,
      strategy: 'model_routed',
      pack_id: 'test-pack'
    });

    expect(profile.id).toBe(expectedProfileId);
  });

  it('selects explicit chat profile id without fallback ambiguity', () => {
    const profile = selectPromptWorkflowProfile({
      task_type: 'agent_decision',
      strategy: 'model_routed',
      pack_id: 'test-pack',
      profile_id: 'chat-follow-up'
    });

    expect(profile.id).toBe('chat-follow-up');
  });

  it('throws when explicit profile id does not exist', () => {
    expect(() => selectPromptWorkflowProfile({
      task_type: 'agent_decision',
      strategy: 'model_routed',
      pack_id: 'test-pack',
      profile_id: 'missing-profile'
    })).toThrow(PromptWorkflowProfileNotFoundError);
  });

  it('throws instead of silently falling back when no profile matches', () => {
    expect(() => selectPromptWorkflowProfile({
      task_type: 'unknown_task_type_for_test',
      strategy: 'model_routed',
      pack_id: 'test-pack'
    })).toThrow(PromptWorkflowProfileSelectionError);
  });
});
