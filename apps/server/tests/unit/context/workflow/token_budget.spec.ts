import { describe, expect, it } from 'vitest';

import { DEFAULT_PROMPT_SAFETY_MARGIN_TOKENS,DEFAULT_PROMPT_TOKEN_BUDGET, resolvePromptWorkflowBudget } from '../../../../src/context/workflow/token_budget.js';
import type { PromptWorkflowProfile, PromptWorkflowStepSpec } from '../../../../src/context/workflow/types.js';

const makeProfile = (overrides?: Partial<PromptWorkflowProfile['defaults']>): PromptWorkflowProfile => ({
  id: 'test-profile',
  version: 1,
  label: 'Test',
  task_type: 'agent_decision',
  defaults: overrides ?? null
} as unknown as PromptWorkflowProfile);

const makeSpec = (config?: Record<string, unknown>): PromptWorkflowStepSpec | undefined => {
  if (!config) return undefined;
  return {
    step_key: 'test-step',
    prompt_version: 'v1',
    profile_id: 'test-profile',
    config
  } as unknown as PromptWorkflowStepSpec;
};

describe('token_budget', () => {
  describe('resolvePromptWorkflowBudget', () => {
    it('uses defaults when no config provided', () => {
      const result = resolvePromptWorkflowBudget({ profile: makeProfile() });
      expect(result.tokenBudget).toBe(DEFAULT_PROMPT_TOKEN_BUDGET);
      expect(result.safetyMarginTokens).toBe(DEFAULT_PROMPT_SAFETY_MARGIN_TOKENS);
      expect(result.effectiveBudget).toBe(DEFAULT_PROMPT_TOKEN_BUDGET - DEFAULT_PROMPT_SAFETY_MARGIN_TOKENS);
      expect(result.sources.tokenBudget).toBe('default');
      expect(result.sources.safetyMarginTokens).toBe('default');
    });

    it('uses step config when provided', () => {
      const result = resolvePromptWorkflowBudget({
        profile: makeProfile(),
        spec: makeSpec({ token_budget: 4000, safety_margin_tokens: 100 })
      });
      expect(result.tokenBudget).toBe(4000);
      expect(result.safetyMarginTokens).toBe(100);
      expect(result.effectiveBudget).toBe(3900);
      expect(result.sources.tokenBudget).toBe('step_config');
      expect(result.sources.safetyMarginTokens).toBe('step_config');
    });

    it('uses profile defaults when step config is absent', () => {
      const result = resolvePromptWorkflowBudget({
        profile: makeProfile({ token_budget: 3000, safety_margin_tokens: 50 })
      });
      expect(result.tokenBudget).toBe(3000);
      expect(result.safetyMarginTokens).toBe(50);
      expect(result.sources.tokenBudget).toBe('profile_defaults');
      expect(result.sources.safetyMarginTokens).toBe('profile_defaults');
    });

    it('prefers step config over profile defaults', () => {
      const result = resolvePromptWorkflowBudget({
        profile: makeProfile({ token_budget: 3000 }),
        spec: makeSpec({ token_budget: 5000 })
      });
      expect(result.tokenBudget).toBe(5000);
      expect(result.sources.tokenBudget).toBe('step_config');
    });

    it('computes modelContextWindow from step config', () => {
      const result = resolvePromptWorkflowBudget({
        profile: makeProfile(),
        spec: makeSpec({ token_budget: 2000, model_context_window: 8000 })
      });
      expect(result.modelContextWindow).toBe(8000);
      expect(result.sources.modelContextWindow).toBe('step_config');
    });

    it('falls back modelContextWindow to tokenBudget', () => {
      const result = resolvePromptWorkflowBudget({ profile: makeProfile() });
      expect(result.modelContextWindow).toBe(result.tokenBudget);
      expect(result.sources.modelContextWindow).toBe('token_budget');
    });

    it('ignores non-positive token_budget', () => {
      const result = resolvePromptWorkflowBudget({
        profile: makeProfile(),
        spec: makeSpec({ token_budget: -1 })
      });
      expect(result.sources.tokenBudget).toBe('default');
      expect(result.tokenBudget).toBe(DEFAULT_PROMPT_TOKEN_BUDGET);
    });

    it('ignores non-integer token_budget', () => {
      const result = resolvePromptWorkflowBudget({
        profile: makeProfile(),
        spec: makeSpec({ token_budget: 2.5 })
      });
      expect(result.sources.tokenBudget).toBe('default');
    });

    it('clamps effective budget to 0 when margin exceeds budget', () => {
      const result = resolvePromptWorkflowBudget({
        profile: makeProfile(),
        spec: makeSpec({ token_budget: 50, safety_margin_tokens: 100 })
      });
      expect(result.effectiveBudget).toBe(0);
    });

    it('allows zero safety margin', () => {
      const result = resolvePromptWorkflowBudget({
        profile: makeProfile(),
        spec: makeSpec({ safety_margin_tokens: 0 })
      });
      expect(result.safetyMarginTokens).toBe(0);
      expect(result.sources.safetyMarginTokens).toBe('step_config');
    });

    it('ignores negative safety margin', () => {
      const result = resolvePromptWorkflowBudget({
        profile: makeProfile(),
        spec: makeSpec({ safety_margin_tokens: -5 })
      });
      expect(result.sources.safetyMarginTokens).toBe('default');
    });
  });
});
