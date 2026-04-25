import type { AiMessage, AiResolvedTaskConfig } from '../ai/types.js';
import type { PromptTree } from './prompt_tree.js';
import type { PromptBundle, PromptBundleMetadata } from './types.js';

export interface PromptBundleV2 {
  slots: Record<string, string>;
  combined_prompt: string;
  metadata: PromptBundleMetadata;
  tree: PromptTree;
}

export interface PromptBundleToAiMessagesAdapter {
  adapt(bundle: PromptBundleV2, taskConfig: AiResolvedTaskConfig): AiMessage[];
}

export function toLegacyPromptBundle(v2: PromptBundleV2): PromptBundle {
  return {
    system_prompt:           v2.slots['system_core'] ?? '',
    role_prompt:             v2.slots['role_core'] ?? '',
    world_prompt:            v2.slots['world_context'] ?? '',
    context_prompt:          v2.slots['post_process'] ?? '',
    output_contract_prompt:  v2.slots['output_contract'] ?? '',
    combined_prompt:         v2.combined_prompt,
    metadata:                v2.metadata
  };
}
