import type { PromptFragment } from '../prompt_fragments.js';
import type { PromptProcessor, PromptTreeProcessor, PromptTreeProcessorInput } from '../prompt_processors.js';
import type { PromptTree } from '../prompt_tree.js';
import { flattenTreeToPromptFragments, mergeFlatFragmentsIntoTree } from './memory_injector.js';

const isMemoryFragment = (fragment: PromptFragment): boolean => {
  return (
    fragment.slot === 'memory_short_term' ||
    fragment.slot === 'memory_long_term' ||
    fragment.slot === 'memory_summary'
  );
};

const isBlockedByVisibility = (metadata: Record<string, unknown> | undefined): boolean => {
  if (!metadata) {
    return false;
  }

  if (metadata.visibility_blocked === true) {
    return true;
  }

  if (typeof metadata.policy_gate === 'string' && metadata.policy_gate.trim().length > 0) {
    return metadata.policy_gate.trim() === 'deny';
  }

  return false;
};

const markPolicyFiltered = (fragment: PromptFragment, reason: string): PromptFragment => {
  return {
    ...fragment,
    content: '',
    metadata: {
      ...fragment.metadata,
      policy_filtered: true,
      policy_filter_reason: reason
    }
  };
};

export const createPolicyFilterPromptProcessor = (): PromptProcessor => {
  return {
    name: 'policy-filter',
    async process({ context, fragments }) {
      const blockedNodeIds = new Set(
        Array.isArray(context.context_run.diagnostics.blocked_nodes)
          ? context.context_run.diagnostics.blocked_nodes
              .map(entry => (entry && typeof entry === 'object' && typeof entry.node_id === 'string' ? entry.node_id : null))
              .filter((value): value is string => value !== null)
          : []
      );
      const filtered: Record<string, string> = {};
      const nextFragments = fragments
        .map(fragment => {
          if (!isMemoryFragment(fragment)) {
            return fragment;
          }

          const metadata = fragment.metadata;
          if (typeof metadata?.memory_entry_id === 'string' && blockedNodeIds.has(metadata.memory_entry_id)) {
            filtered[fragment.id] = 'context_policy_engine';
            return markPolicyFiltered(fragment, 'context_policy_engine');
          }

          if (isBlockedByVisibility(metadata)) {
            filtered[fragment.id] = 'visibility_or_policy_gate';
            return markPolicyFiltered(fragment, 'visibility_or_policy_gate');
          }

          return fragment;
        })
        .filter(fragment => {
          if (!isMemoryFragment(fragment)) {
            return true;
          }

          return fragment.content.length > 0;
        });

      context.memory_context.diagnostics = {
        ...context.memory_context.diagnostics,
        prompt_processing_trace: {
          ...(typeof context.memory_context.diagnostics.prompt_processing_trace === 'object' &&
          context.memory_context.diagnostics.prompt_processing_trace !== null
            ? (context.memory_context.diagnostics.prompt_processing_trace as Record<string, unknown>)
            : {}),
          policy_filtering: {
            filtered_fragment_ids: Object.keys(filtered),
            reasons: filtered
          }
        }
      };

      return nextFragments;
    }
  };
};

// ── Tree-aware adapter (V2) ──

export const createPolicyFilterTreeProcessor = (): PromptTreeProcessor => {
  const flat = createPolicyFilterPromptProcessor();
  return {
    name: 'policy-filter-tree',
    async process(input: PromptTreeProcessorInput): Promise<PromptTree> {
      const flatFragments = flattenTreeToPromptFragments(input.tree);
      const result = await flat.process({ context: input.context, fragments: flatFragments, workflow: input.workflow });
      return mergeFlatFragmentsIntoTree(input.tree, result);
    }
  };
};

