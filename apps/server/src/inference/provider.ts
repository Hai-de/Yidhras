import type { InferenceContext, InferenceStrategy, PromptBundle, ProviderDecisionRaw } from './types.js';

export interface InferenceProvider {
  readonly name: string;
  readonly strategies: InferenceStrategy[];
  run(context: InferenceContext, prompt: PromptBundle): Promise<ProviderDecisionRaw>;
}
