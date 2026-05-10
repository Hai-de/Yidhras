import { createOpenAiCompatibleAdapter } from './openai_compatible.js';
import { getEnv } from './shared.js';
import type { AiProviderAdapter } from './types.js';

export const createDeepSeekProviderAdapter = (): AiProviderAdapter => {
  return createOpenAiCompatibleAdapter({
    provider: 'deepseek',
    resolveApiKey(input) {
      return getEnv(input.provider_config.api_key_env);
    },
    resolveBaseUrl(input) {
      return input.model_entry.base_url
        ?? input.provider_config.base_url
        ?? 'https://api.deepseek.com/v1';
    },
    capabilityOverrides: {
      disallowTempWithTopP: true,
      maxTokensField: 'max_tokens',
      maxStructuredOutput: 'json_object'
    }
  });
};
