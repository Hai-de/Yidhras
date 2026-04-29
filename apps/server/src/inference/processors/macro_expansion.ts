import { renderNarrativeTemplate } from '../../narrative/resolver.js';
import type { PromptBlock } from '../prompt_block.js';
import type { PromptTreeProcessor, PromptTreeProcessorInput } from '../prompt_processors.js';
import type { PromptTree } from '../prompt_tree.js';

const TEMPLATE_TOKEN_PATTERN = /\{\{[^{}]+\}\}/;

/**
 * Expand {{ macro }} references in all text blocks across the PromptTree.
 * Mutates block.rendered in-place. Permissions and extraContext are wired
 * from the inference context.
 */
export const createMacroExpansionTreeProcessor = (): PromptTreeProcessor => {
  return {
    name: 'macro-expansion',
    process(input: PromptTreeProcessorInput): Promise<PromptTree> {
      const { context, tree } = input;
      const variableContext = context.variable_context;
      const extraContext: Record<string, unknown> = {
        actor_name: context.actor_display_name,
        actor_role: context.actor_ref.role,
        actor_agent_id: context.resolved_agent_id ?? 'none',
        current_tick: context.tick.toString(),
        strategy: context.strategy,
        identity_id: context.identity?.id ?? '',
        agent_id: context.resolved_agent_id ?? '',
        pack_actor_roles: context.pack_state.actor_roles.join(', ') || 'none',
        owned_artifacts: context.pack_state.owned_artifacts.map(a => a.id).join(', ') || 'none'
      };

      for (const fragments of Object.values(tree.fragments_by_slot)) {
        for (const fragment of fragments) {
          expandFragmentBlocks(fragment.children, variableContext, extraContext);
        }
      }

      return Promise.resolve(tree);
    }
  };
};

function expandFragmentBlocks(
  nodes: PromptTree['fragments_by_slot'][string][number]['children'],
  variableContext: Parameters<typeof renderNarrativeTemplate>[0]['variableContext'],
  extraContext: Record<string, unknown>
): void {
  for (const node of nodes) {
    if ('kind' in node) {
      // PromptBlock
      if (node.kind === 'text' && node.content.kind === 'text' && TEMPLATE_TOKEN_PATTERN.test(node.content.text)) {
        const result = renderNarrativeTemplate({
          template: node.content.text,
          variableContext,
          extraContext,
          templateSource: 'prompt_slot_template'
        });
        node.rendered = result.text;
      }
      // Recurse into conditional/loop children
      if (node.kind === 'conditional' || node.kind === 'loop') {
        const nested = (node.content as { children?: PromptBlock[] }).children;
        if (nested && nested.length > 0) {
          expandFragmentBlocks(nested, variableContext, extraContext);
        }
      }
    } else {
      // Nested PromptFragmentV2
      expandFragmentBlocks(node.children, variableContext, extraContext);
    }
  }
}
