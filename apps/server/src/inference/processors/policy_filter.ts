import type { PromptTreeProcessor, PromptTreeProcessorInput } from '../prompt_processors.js';
import type { PromptTree } from '../prompt_tree.js';

const MEMORY_SLOTS = new Set(['memory_short_term', 'memory_long_term', 'memory_summary']);

const isBlockedByVisibility = (metadata: Record<string, unknown> | undefined): boolean => {
  if (!metadata) return false;
  if (metadata.visibility_blocked === true) return true;
  if (typeof metadata.policy_gate === 'string' && metadata.policy_gate.trim().length > 0) {
    return metadata.policy_gate.trim() === 'deny';
  }
  return false;
};

export const createPolicyFilterTreeProcessor = (): PromptTreeProcessor => {
  return {
    name: 'policy-filter',
    process(input: PromptTreeProcessorInput): Promise<PromptTree> {
      const ctx = input.context;
      const blockedNodeIds = new Set(
        Array.isArray(ctx.context_run.diagnostics.blocked_nodes)
          ? ctx.context_run.diagnostics.blocked_nodes
              .map(entry => {
                const e = entry as unknown as Record<string, unknown> | null | undefined;
                return e && typeof e === 'object' && typeof e.node_id === 'string' ? e.node_id : null;
              })
              .filter((value): value is string => value !== null)
          : []
      );

      const filtered: Record<string, string> = {};

      for (const [slotId, fragments] of Object.entries(input.tree.fragments_by_slot)) {
        if (!MEMORY_SLOTS.has(slotId)) continue;

        for (const fragment of fragments) {
          const meta = fragment.metadata;
          if (typeof meta?.memory_entry_id === 'string' && blockedNodeIds.has(meta.memory_entry_id)) {
            fragment.permission_denied = true;
            fragment.denied_reason = 'context_policy_engine';
            filtered[fragment.id] = 'context_policy_engine';
          } else if (isBlockedByVisibility(meta)) {
            fragment.permission_denied = true;
            fragment.denied_reason = 'visibility_or_policy_gate';
            filtered[fragment.id] = 'visibility_or_policy_gate';
          }
        }
      }

      ctx.memory_context.diagnostics = {
        ...ctx.memory_context.diagnostics,
        prompt_processing_trace: {
          ...(typeof ctx.memory_context.diagnostics.prompt_processing_trace === 'object' &&
          ctx.memory_context.diagnostics.prompt_processing_trace !== null
            ? (ctx.memory_context.diagnostics.prompt_processing_trace as Record<string, unknown>)
            : {}),
          policy_filtering: {
            filtered_fragment_ids: Object.keys(filtered),
            reasons: filtered
          }
        }
      };

      return Promise.resolve(input.tree);
    }
  };
};
