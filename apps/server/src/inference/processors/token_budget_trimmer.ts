import type { PromptFragment, PromptFragmentSlot } from '../prompt_fragments.js';
import type { PromptProcessor } from '../prompt_processors.js';

const DEFAULT_BUDGET = 2200;

const SLOT_PRIORITY: Record<PromptFragmentSlot, number> = {
  system_core: 1000,
  system_policy: 950,
  role_core: 900,
  world_context: 850,
  output_contract: 800,
  post_process: 700,
  memory_summary: 600,
  memory_short_term: 500,
  memory_long_term: 400
};

const estimateCost = (fragment: PromptFragment): number => {
  return fragment.content.length;
};

const scoreFragment = (fragment: PromptFragment): number => {
  const importance = typeof fragment.metadata?.importance === 'number' ? fragment.metadata.importance : 0;
  const salience = typeof fragment.metadata?.salience === 'number' ? fragment.metadata.salience : 0;
  return SLOT_PRIORITY[fragment.slot] + fragment.priority + importance * 100 + salience * 50;
};

const shouldAlwaysKeep = (fragment: PromptFragment): boolean => {
  return (
    fragment.slot === 'system_core' ||
    fragment.slot === 'role_core' ||
    fragment.slot === 'world_context' ||
    fragment.slot === 'output_contract'
  );
};

export const createTokenBudgetTrimmerPromptProcessor = (
  budget = DEFAULT_BUDGET
): PromptProcessor => {
  return {
    name: 'token-budget-trimmer',
    async process({ context, fragments }) {
      const kept: PromptFragment[] = [];
      const optional: PromptFragment[] = [];

      for (const fragment of fragments) {
        if (shouldAlwaysKeep(fragment)) {
          kept.push(fragment);
        } else {
          optional.push(fragment);
        }
      }

      let used = kept.reduce((sum, fragment) => sum + estimateCost(fragment), 0);
      const sortedOptional = [...optional].sort((left, right) => scoreFragment(right) - scoreFragment(left));
      const trimmedFragmentIds: string[] = [];

      for (const fragment of sortedOptional) {
        const nextCost = estimateCost(fragment);
        if (used + nextCost <= budget) {
          kept.push(fragment);
          used += nextCost;
        } else {
          trimmedFragmentIds.push(fragment.id);
        }
      }

      context.memory_context.diagnostics = {
        ...context.memory_context.diagnostics,
        token_budget: budget,
        prompt_processing_trace: {
          ...(typeof context.memory_context.diagnostics.prompt_processing_trace === 'object' &&
          context.memory_context.diagnostics.prompt_processing_trace !== null
            ? (context.memory_context.diagnostics.prompt_processing_trace as Record<string, unknown>)
            : {}),
          token_budget_trimming: {
            budget,
            used,
            trimmed_fragment_ids: trimmedFragmentIds
          }
        }
      };

      return kept;
    }
  };
};
