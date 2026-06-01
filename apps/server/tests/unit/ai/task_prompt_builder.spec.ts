import { describe, expect, it } from 'vitest';

import { resolvePromptWorkflowTaskTypeForAiTask } from '../../../src/ai/task_prompt_builder.js';
import type { AiTaskType } from '../../../src/ai/types.js';

describe('task_prompt_builder', () => {
  describe('resolvePromptWorkflowTaskTypeForAiTask', () => {
    it('returns agent_decision for agent_decision', () => {
      expect(resolvePromptWorkflowTaskTypeForAiTask('agent_decision')).toBe('agent_decision');
    });

    it('returns context_summary for context_summary', () => {
      expect(resolvePromptWorkflowTaskTypeForAiTask('context_summary')).toBe('context_summary');
    });

    it('returns memory_compaction for memory_compaction', () => {
      expect(resolvePromptWorkflowTaskTypeForAiTask('memory_compaction')).toBe('memory_compaction');
    });

    it('returns intent_grounding_assist for intent_grounding_assist', () => {
      expect(resolvePromptWorkflowTaskTypeForAiTask('intent_grounding_assist')).toBe('intent_grounding_assist');
    });

    it('falls back to agent_decision for unknown task type', () => {
      expect(resolvePromptWorkflowTaskTypeForAiTask('unknown_type' as AiTaskType)).toBe('agent_decision');
    });
  });
});
