import type { PromptFragment } from './prompt_fragments.js';
import type { InferenceContext, PromptWorkflowSnapshot } from './types.js';

/**
 * Legacy prompt processor contract.
 *
 * NOTE:
 * Current Context Module MVP now prefers the linear Context Orchestrator Lite
 * under `context/workflow/orchestrator.ts`. This interface remains as a
 * compatibility surface for existing processor implementations while the
 * orchestrator still delegates to them internally.
 */
export interface PromptProcessorInput {
  context: InferenceContext;
  fragments: PromptFragment[];
  workflow?: {
    task_type: string;
    profile_id: string;
    profile_version: string;
    selected_step_keys: string[];
    prompt_workflow?: PromptWorkflowSnapshot | null;
    section_drafts?: Array<{ id: string; slot: string; section_type: string; ranking_score: number }>;
    section_summary?: Record<string, unknown> | null;
  };
}

export interface PromptProcessor {
  name: string;
  process(input: PromptProcessorInput): Promise<PromptFragment[]>;
}
