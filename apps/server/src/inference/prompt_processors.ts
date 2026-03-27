import type { PromptFragment } from './prompt_fragments.js';
import type { InferenceContext } from './types.js';

export interface PromptProcessorInput {
  context: InferenceContext;
  fragments: PromptFragment[];
}

export interface PromptProcessor {
  name: string;
  process(input: PromptProcessorInput): Promise<PromptFragment[]>;
}
