import type { PromptTokenCounter } from '../../../inference/prompt_tokenizer.js';
import { getDefaultTokenCounter } from '../../../inference/prompt_tokenizer.js';
import type { PromptWorkflowStepExecutor } from '../registry.js';
import type { PromptWorkflowState, PromptWorkflowStepTrace, StepSnapshotSummary } from '../types.js';

const DEFAULT_TOKEN_BUDGET = 2200;
const DEFAULT_SAFETY_MARGIN = 80;

const buildStepSummary = (state: PromptWorkflowState): StepSnapshotSummary => {
  const tree = state.tree;
  if (!tree) {
    return { section_drafts_count: 0, fragment_count: 0, total_estimated_tokens: 0, denied_fragment_count: 0, working_set_node_count: 0 };
  }

  let fragmentCount = 0;
  let totalEstimatedTokens = 0;
  let deniedFragmentCount = 0;
  for (const fragments of Object.values(tree.fragments_by_slot)) {
    for (const fragment of fragments) {
      fragmentCount++;
      if (fragment.permission_denied) {
        deniedFragmentCount++;
      } else {
        totalEstimatedTokens += fragment.estimated_tokens ?? 0;
      }
    }
  }

  return {
    section_drafts_count: state.section_drafts.length,
    fragment_count: fragmentCount,
    total_estimated_tokens: totalEstimatedTokens,
    denied_fragment_count: deniedFragmentCount,
    working_set_node_count: state.working_set.length
  };
};

export const createTokenBudgetTrimExecutor = (
  counter: PromptTokenCounter = getDefaultTokenCounter()
): PromptWorkflowStepExecutor => ({
  kind: 'token_budget_trim',
  async execute({ profile, spec, state }) {
    const budget =
      (spec.config?.token_budget as number | undefined) ??
      profile.defaults?.token_budget ??
      DEFAULT_TOKEN_BUDGET;
    const safetyMargin =
      (spec.config?.safety_margin_tokens as number | undefined) ??
      profile.defaults?.safety_margin_tokens ??
      DEFAULT_SAFETY_MARGIN;
    const effectiveBudget = budget - safetyMargin;

    if (!state.tree) {
      return state;
    }

    const beforeSummary = buildStepSummary(state);

    const estimate = await counter.estimateTree(state.tree, safetyMargin);
    if (estimate.total_tokens <= budget) {
      const trace: PromptWorkflowStepTrace = {
        key: spec.key,
        kind: 'token_budget_trim',
        status: 'completed',
        before: beforeSummary,
        after: buildStepSummary(state),
        notes: { budget, safetyMargin, effectiveBudget, trimmed: false }
      };
      state.diagnostics.step_traces.push(trace);
      return state;
    }

    const sortedSlots = Object.entries(state.tree.fragments_by_slot)
      .map(([slotId, frags]) => ({
        slotId,
// eslint-disable-next-line security/detect-object-injection
        priority: state.tree!.slot_registry[slotId]?.default_priority ?? 0,
        fragments: frags
      }))
      .sort((a, b) => a.priority - b.priority);

    // Reverse conversation_history fragment order within the slot so that
    // oldest entries (lowest turn_number, earliest in array) are trimmed first.
    // Design doc §6.6: "token_budget_trim 对 conversation_history slot 采用反转裁剪"
    for (const slot of sortedSlots) {
      if (slot.slotId === 'conversation_history') {
        slot.fragments = [...slot.fragments].reverse();
      }
    }

    let remaining = effectiveBudget;
    for (const { fragments } of sortedSlots) {
      for (const fragment of fragments) {
        if (remaining <= 0 && fragment.removable) {
          fragment.permission_denied = true;
          fragment.denial = fragment.denial ?? [];
          fragment.denial.push({
            source: 'token_budget_trim',
            reason: 'trimmed_by_token_budget'
          });
        } else {
          remaining -= fragment.estimated_tokens ?? 0;
        }
      }
    }

    const trace: PromptWorkflowStepTrace = {
      key: spec.key,
      kind: 'token_budget_trim',
      status: 'completed',
      before: beforeSummary,
      after: buildStepSummary(state),
      notes: { budget, safetyMargin, effectiveBudget, trimmed: true }
    };
    state.diagnostics.step_traces.push(trace);

    return state;
  }
});
