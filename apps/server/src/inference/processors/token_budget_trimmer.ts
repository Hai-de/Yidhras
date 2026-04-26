import type { PromptTreeProcessor, PromptTreeProcessorInput } from '../prompt_processors.js';
import type { PromptTokenCounter } from '../prompt_tokenizer.js';
import { getDefaultTokenCounter } from '../prompt_tokenizer.js';
import type { PromptTree } from '../prompt_tree.js';

// ── Tree-aware token budget trimmer (V2) ──


export function createTreeTokenBudgetTrimmer(
  counter: PromptTokenCounter = getDefaultTokenCounter()
): PromptTreeProcessor {
  return {
    name: 'token-budget-trimmer-tree',
    async process(input: PromptTreeProcessorInput): Promise<PromptTree> {
      const budget = input.workflow?.profile_defaults?.token_budget ?? 2200;
      const safetyMargin = input.workflow?.profile_defaults?.safety_margin_tokens ?? 80;
      const effectiveBudget = budget - safetyMargin;

      const estimate = await counter.estimateTree(input.tree, safetyMargin);
      if (estimate.total_tokens <= budget) {
        return input.tree;
      }

      // Simple trimming: remove removable fragments from lowest priority slots first
      const sortedSlots = Object.entries(input.tree.fragments_by_slot)
        .map(([slotId, frags]) => ({
          slotId,
          priority: input.tree.slot_registry[slotId]?.default_priority ?? 0,
          fragments: frags
        }))
        .sort((a, b) => a.priority - b.priority);

      let remaining = effectiveBudget;
      for (const { fragments } of sortedSlots) {
        for (const fragment of fragments) {
          if (remaining <= 0 && fragment.removable) {
            fragment.permission_denied = true;
            fragment.denied_reason = 'trimmed_by_token_budget';
          } else {
            remaining -= fragment.estimated_tokens ?? 0;
          }
        }
      }

      return input.tree;
    }
  };
}

