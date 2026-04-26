import { createMacroExpansionTreeProcessor } from '../../inference/processors/macro_expansion.js';
import { createMemoryInjectorTreeProcessor } from '../../inference/processors/memory_injector.js';
import { createMemorySummaryTreeProcessor } from '../../inference/processors/memory_summary.js';
import { createPolicyFilterTreeProcessor } from '../../inference/processors/policy_filter.js';
import { createTreeTokenBudgetTrimmer } from '../../inference/processors/token_budget_trimmer.js';
import { applyPermissionFilter } from '../../inference/prompt_permissions.js';
import type { PromptTreeProcessor } from '../../inference/prompt_processors.js';
import type { PromptTree } from '../../inference/prompt_tree.js';
import type { InferenceContext } from '../../inference/types.js';

export interface RunPromptWorkflowV2Input {
  tree: PromptTree;
  context: InferenceContext;
  steps?: PromptTreeProcessor[];
}

export interface RunPromptWorkflowV2Result {
  tree: PromptTree;
}

const buildDefaultTreeSteps = (): PromptTreeProcessor[] => {
  return [
    createMacroExpansionTreeProcessor(),
    createMemoryInjectorTreeProcessor(),
    createPolicyFilterTreeProcessor(),
    createMemorySummaryTreeProcessor(),
    createTreeTokenBudgetTrimmer()
  ];
};

/**
 * Run the V2 tree-based prompt workflow pipeline.
 *
 * Pipeline: macro_expansion → memory_injection → policy_filter →
 *   summary_compaction → token_budget_trim → permission_filter
 */
export const runPromptWorkflowV2 = async (input: RunPromptWorkflowV2Input): Promise<RunPromptWorkflowV2Result> => {
  const steps = input.steps ?? buildDefaultTreeSteps();
  let tree = input.tree;

  for (const step of steps) {
    tree = await step.process({ context: input.context, tree });
  }

  applyPermissionFilter(tree, input.context);

  return { tree };
};
