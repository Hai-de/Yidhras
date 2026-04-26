import type { AiMessage, AiResolvedTaskConfig } from '../ai/types.js';
import type { PromptTree } from './prompt_tree.js';
import type { PromptBundleMetadata } from './types.js';

export interface PromptBundleV2 {
  slots: Record<string, string>;
  combined_prompt: string;
  metadata: PromptBundleMetadata;
  tree: PromptTree;
}

export interface PromptBundleToAiMessagesAdapter {
  adapt(bundle: PromptBundleV2, taskConfig: AiResolvedTaskConfig): AiMessage[];
}
