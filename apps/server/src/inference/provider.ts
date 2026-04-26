import type { PromptBundleV2 } from './prompt_bundle_v2.js';
import type { InferenceContext, InferenceStrategy, ProviderDecisionRaw } from './types.js';

export interface InferenceProvider {
  readonly name: string;
  readonly strategies: InferenceStrategy[];
  run(context: InferenceContext, prompt: PromptBundleV2): Promise<ProviderDecisionRaw>;
}
