import type { SlotTransformContext } from '@yidhras/contracts';

import { slotContentTransformRegistry } from '../../../plugins/extensions/slot_content_transformer.js';
import type { PromptWorkflowStepExecutor } from '../registry.js';
import type {
  PromptWorkflowState,
  PromptWorkflowStepTrace,
  StepSnapshotSummary
} from '../types.js';

function buildSummary(state: PromptWorkflowState): StepSnapshotSummary {
  const tree = state.tree;
  if (!tree) {
    return {
      section_drafts_count: 0,
      fragment_count: 0,
      total_estimated_tokens: 0,
      denied_fragment_count: 0,
      working_set_node_count: 0
    };
  }

  let fragmentCount = 0;
  let totalTokens = 0;
  let deniedCount = 0;
  for (const fragments of Object.values(tree.fragments_by_slot)) {
    for (const fragment of fragments) {
      fragmentCount++;
      if (fragment.permission_denied) {
        deniedCount++;
      } else {
        totalTokens += fragment.estimated_tokens ?? 0;
      }
    }
  }

  return {
    section_drafts_count: state.section_drafts.length,
    fragment_count: fragmentCount,
    total_estimated_tokens: totalTokens,
    denied_fragment_count: deniedCount,
    working_set_node_count: state.working_set.length
  };
}

export const createContentTransformExecutor = (): PromptWorkflowStepExecutor => ({
  kind: 'content_transform',
  async execute({ context, state, spec }) {
    const beforeSummary = buildSummary(state);

    if (!state.tree) {
      const trace: PromptWorkflowStepTrace = {
        key: spec.key,
        kind: 'content_transform',
        status: 'completed',
        before: beforeSummary,
        after: beforeSummary,
        notes: { skipped: true, reason: 'no tree' }
      };
      state.diagnostics.step_traces.push(trace);
      return state;
    }

    const packId = state.pack_id;
    const transformers = slotContentTransformRegistry.list(packId);

    if (transformers.length === 0) {
      const trace: PromptWorkflowStepTrace = {
        key: spec.key,
        kind: 'content_transform',
        status: 'completed',
        before: beforeSummary,
        after: buildSummary(state),
        notes: { skipped: true, reason: 'no content transformers registered' }
      };
      state.diagnostics.step_traces.push(trace);
      return state;
    }

    const activatedSlots = state.slot_behavior_diagnostics?.slots_activated ?? [];
    let transformedCount = 0;

    for (const [slotId, fragments] of Object.entries(state.tree.fragments_by_slot)) {
      if (!activatedSlots.includes(slotId)) {
        continue;
      }

      for (const fragment of fragments) {
        if (fragment.permission_denied) {
          continue;
        }

        // Extract rendered text from children blocks
        let originalContent = '';
        for (const child of fragment.children) {
          if ('kind' in child && child.kind === 'text') {
            originalContent += (child as { rendered?: string }).rendered ?? '';
          }
        }

        if (!originalContent) {
          continue;
        }

        const transformContext: SlotTransformContext = {
          slot_id: slotId,
          variables: {},
          conversation_meta: {
            turn_count: state.ai_messages?.length ?? 0
          },
          token_budget: { total: 8192, used: 0, remaining: 8192 },
          current_tick: Number(context.tick),
          last_user_message: '',
          original_content: originalContent,
          activation_decision: { active: true }
        };

        let currentContent = originalContent;
        for (const transformer of transformers) {
          try {
            const result = await transformer.transform(currentContent, transformContext);
            currentContent = result.transformed;
          } catch {
            // On transform error, keep original content
          }
        }

        // Write transformed content back to the first text block
        if (currentContent !== originalContent) {
          for (const child of fragment.children) {
            if ('kind' in child && child.kind === 'text') {
              (child as { rendered?: string }).rendered = currentContent;
              transformedCount++;
              break;
            }
          }
        }
      }
    }

    const trace: PromptWorkflowStepTrace = {
      key: spec.key,
      kind: 'content_transform',
      status: 'completed',
      before: beforeSummary,
      after: buildSummary(state),
      notes: {
        transformers_available: transformers.length,
        fragments_transformed: transformedCount
      }
    };
    state.diagnostics.step_traces.push(trace);

    return state;
  }
});
