import { createOpenAiCompatibleAdapter } from './openai_compatible.js';
import type { AiProviderAdapter } from './types.js';

export const createOllamaProviderAdapter = (): AiProviderAdapter => {
  return createOpenAiCompatibleAdapter({
    provider: 'ollama',
    resolveApiKey(_input) {
      return null; // 本地模型无需 API key
    },
    resolveBaseUrl(input) {
      return input.model_entry.base_url
        ?? input.provider_config.base_url
        ?? 'http://localhost:11434/v1';
    },
    capabilityOverrides: {
      maxTokensField: 'max_tokens',
      supportsSeed: false,
      maxStructuredOutput: 'none'
    }
  });
};
