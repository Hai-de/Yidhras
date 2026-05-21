import type { PromptWorkflowProfile, PromptWorkflowStepSpec } from './types.js';

export const DEFAULT_PROMPT_TOKEN_BUDGET = 2200;
export const DEFAULT_PROMPT_SAFETY_MARGIN_TOKENS = 80;

export interface PromptWorkflowBudgetResolution {
  tokenBudget: number;
  safetyMarginTokens: number;
  effectiveBudget: number;
  modelContextWindow: number;
  sources: {
    tokenBudget: 'step_config' | 'profile_defaults' | 'default';
    safetyMarginTokens: 'step_config' | 'profile_defaults' | 'default';
    modelContextWindow: 'step_config' | 'token_budget';
  };
}

const readPositiveInteger = (value: unknown): number | null => {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
};

const readNonNegativeInteger = (value: unknown): number | null => {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
};

export const resolvePromptWorkflowBudget = (input: {
  profile: PromptWorkflowProfile;
  spec?: PromptWorkflowStepSpec;
}): PromptWorkflowBudgetResolution => {
  const stepTokenBudget = readPositiveInteger(input.spec?.config?.token_budget);
  const profileTokenBudget = readPositiveInteger(input.profile.defaults?.token_budget);
  const tokenBudget = stepTokenBudget ?? profileTokenBudget ?? DEFAULT_PROMPT_TOKEN_BUDGET;

  const stepSafetyMargin = readNonNegativeInteger(input.spec?.config?.safety_margin_tokens);
  const profileSafetyMargin = readNonNegativeInteger(input.profile.defaults?.safety_margin_tokens);
  const safetyMarginTokens = stepSafetyMargin ?? profileSafetyMargin ?? DEFAULT_PROMPT_SAFETY_MARGIN_TOKENS;

  const stepContextWindow = readPositiveInteger(input.spec?.config?.model_context_window);
  const modelContextWindow = stepContextWindow ?? tokenBudget;

  return {
    tokenBudget,
    safetyMarginTokens,
    effectiveBudget: Math.max(0, tokenBudget - safetyMarginTokens),
    modelContextWindow,
    sources: {
      tokenBudget: stepTokenBudget !== null ? 'step_config' : profileTokenBudget !== null ? 'profile_defaults' : 'default',
      safetyMarginTokens: stepSafetyMargin !== null ? 'step_config' : profileSafetyMargin !== null ? 'profile_defaults' : 'default',
      modelContextWindow: stepContextWindow !== null ? 'step_config' : 'token_budget'
    }
  };
};
