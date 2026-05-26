import { createOpenAiCompatibleAdapter } from './openai_compatible.js';
import { getEnv } from './shared.js';
import type { AiProviderAdapter } from './types.js';

const MIMO_BASE_URL = 'https://token-plan-sgp.xiaomimimo.com/v1';

export const createXiaomiMiMoProviderAdapter = (): AiProviderAdapter => {
  return createOpenAiCompatibleAdapter({
    provider: 'mimo',
    resolveApiKey(input) {
      return getEnv(input.provider_config.api_key_env);
    },
    resolveBaseUrl(input) {
      return input.model_entry.base_url
        ?? input.provider_config.base_url
        ?? MIMO_BASE_URL;
    },
    capabilityOverrides: {
      maxTokensField: 'max_tokens',
      maxStructuredOutput: 'json_object'
    }
  });
};
