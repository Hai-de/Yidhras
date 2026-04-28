import type { PromptTree } from './prompt_tree.js';
import type { InferenceContext } from './types.js';

export interface PromptTreeProcessorInput {
  context: InferenceContext;
  tree: PromptTree;
  workflow?: {
    task_type: string;
    profile_id: string;
    profile_version: string;
    selected_step_keys: string[];
    profile_defaults?: {
      token_budget?: number;
      section_policy?: string;
      safety_margin_tokens?: number;
    };
  };
}

export interface PromptTreeProcessor {
  name: string;
  process(input: PromptTreeProcessorInput): Promise<PromptTree>;
}
