import { randomUUID } from 'node:crypto';

import type {
  PromptFragment,
  PromptFragmentAnchor,
  PromptFragmentPlacementMode
} from '../prompt_fragments.js';
import type { PromptProcessor, PromptTreeProcessor, PromptTreeProcessorInput } from '../prompt_processors.js';

const buildMemoryFragment = (
  slot: 'memory_short_term' | 'memory_long_term' | 'memory_summary',
  priority: number,
  source: string,
  content: string,
  metadata?: Record<string, unknown>,
  placement?: {
    anchor?: PromptFragmentAnchor | null;
    placement_mode?: PromptFragmentPlacementMode | null;
    depth?: number | null;
    order?: number | null;
  }
): PromptFragment => {
  return {
    id: randomUUID(),
    slot,
    priority,
    content,
    source,
    removable: true,
    replaceable: true,
    anchor: placement?.anchor ?? null,
    placement_mode: placement?.placement_mode ?? null,
    depth: placement?.depth ?? null,
    order: placement?.order ?? null,
    metadata
  };
};

const toOptionalNumber = (value: unknown): number | null => {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const toPlacement = (metadata: Record<string, unknown> | undefined): {
  anchor?: PromptFragmentAnchor | null;
  placement_mode?: PromptFragmentPlacementMode | null;
  depth?: number | null;
  order?: number | null;
} => {
  const anchorValue = metadata?.placement_anchor;
  const anchor =
    anchorValue && typeof anchorValue === 'object' && !Array.isArray(anchorValue)
      ? ({
          kind: (anchorValue as Record<string, unknown>).kind,
          value: (anchorValue as Record<string, unknown>).value
        } as PromptFragmentAnchor)
      : null;

  const placementMode =
    metadata?.placement_mode === 'prepend' ||
    metadata?.placement_mode === 'append' ||
    metadata?.placement_mode === 'before_anchor' ||
    metadata?.placement_mode === 'after_anchor'
      ? metadata.placement_mode
      : null;

  return {
    anchor,
    placement_mode: placementMode,
    depth: toOptionalNumber(metadata?.placement_depth),
    order: toOptionalNumber(metadata?.placement_order)
  };
};

export const createMemoryInjectorPromptProcessor = (): PromptProcessor => {
  return {
    name: 'memory-injector',
    async process({ context, fragments }) {
      const shortTermFragments = context.memory_context.short_term.map((entry, index) => {
        return buildMemoryFragment(
          'memory_short_term',
          100 - index,
          `memory.short_term.${entry.source_kind}`,
          entry.content.text,
          {
            memory_entry_id: entry.id,
            source_ref: entry.source_ref,
            policy_gate: entry.visibility?.policy_gate ?? null,
            visibility_blocked: entry.visibility?.policy_gate === 'deny',
            tags: entry.tags,
            importance: entry.importance,
            salience: entry.salience,
            visibility: entry.visibility,
            ...(entry.metadata ? entry.metadata : {})
          },
          toPlacement(entry.metadata)
        );
      });

      const longTermFragments = context.memory_context.long_term.map((entry, index) => {
        return buildMemoryFragment(
          'memory_long_term',
          80 - index,
          `memory.long_term.${entry.source_kind}`,
          entry.content.text,
          {
            memory_entry_id: entry.id,
            source_ref: entry.source_ref,
            policy_gate: entry.visibility?.policy_gate ?? null,
            visibility_blocked: entry.visibility?.policy_gate === 'deny',
            tags: entry.tags,
            importance: entry.importance,
            salience: entry.salience,
            visibility: entry.visibility,
            ...(entry.metadata ? entry.metadata : {})
          },
          toPlacement(entry.metadata)
        );
      });

      const summaryFragments = context.memory_context.summaries.map((entry, index) => {
        return buildMemoryFragment(
          'memory_summary',
          120 - index,
          `memory.summary.${entry.source_kind}`,
          entry.content.text,
          {
            memory_entry_id: entry.id,
            source_ref: entry.source_ref,
            policy_gate: entry.visibility?.policy_gate ?? null,
            visibility_blocked: entry.visibility?.policy_gate === 'deny',
            tags: entry.tags,
            importance: entry.importance,
            salience: entry.salience,
            visibility: entry.visibility,
            ...(entry.metadata ? entry.metadata : {})
          },
          toPlacement(entry.metadata)
        );
      });

      const preservedFragments = fragments.filter(fragment => {
        return !(
          fragment.source === 'memory.summary' &&
          fragment.content.length === 0 &&
          fragment.slot === 'memory_summary'
        );
      });

      return [
        ...preservedFragments,
        ...summaryFragments,
        ...shortTermFragments,
        ...longTermFragments
      ];
    }
  };
};

// ── Tree-aware adapter (V2) ──

import type { PromptBlock } from '../prompt_block.js';
import type { PromptFragmentV2 } from '../prompt_fragment_v2.js';
import type { PromptTree } from '../prompt_tree.js';

/**
 * Tree-native wrapper: flattens tree → old processor → rebuilds tree.
 * Temporary bridge until full tree-native implementation in later phase.
 */
export const createMemoryInjectorTreeProcessor = (): PromptTreeProcessor => {
  const flat = createMemoryInjectorPromptProcessor();
  return {
    name: 'memory-injector-tree',
    async process(input: PromptTreeProcessorInput): Promise<PromptTree> {
      const flatFragments = flattenTreeToPromptFragments(input.tree);
      const result = await flat.process({ context: input.context, fragments: flatFragments, workflow: input.workflow });
      return mergeFlatFragmentsIntoTree(input.tree, result);
    }
  };
};

export function flattenTreeToPromptFragments(tree: PromptTree): Array<import('../prompt_fragments.js').PromptFragment> {
  const result: Array<import('../prompt_fragments.js').PromptFragment> = [];
  for (const fragments of Object.values(tree.fragments_by_slot)) {
    for (const f of fragments) {
      const text = collectBlockText(f.children);
      result.push({
        id: f.id,
        slot: f.slot_id as import('../prompt_fragments.js').PromptFragmentSlot,
        priority: f.priority,
        content: text,
        source: f.source,
        removable: f.removable,
        replaceable: f.replaceable,
        anchor: f.anchor,
        placement_mode: f.placement_mode,
        depth: f.depth,
        order: f.order,
        metadata: f.metadata
      });
    }
  }
  return result;
}

function collectBlockText(nodes: PromptTree['fragments_by_slot'][string][number]['children']): string {
  const parts: string[] = [];
  for (const node of nodes) {
    if ('kind' in node && node.kind === 'text' && node.content.kind === 'text') {
      if (node.rendered) parts.push(node.rendered);
      else parts.push(node.content.text);
    }
  }
  return parts.join('\n');
}

export function mergeFlatFragmentsIntoTree(tree: PromptTree, fragments: Array<import('../prompt_fragments.js').PromptFragment>): PromptTree {
  const keptIds = new Set(fragments.map(f => f.id));
  const newById = new Map(fragments.map(f => [f.id, f]));

  const nextBySlot: Record<string, PromptFragmentV2[]> = {};
  for (const [slotId, existing] of Object.entries(tree.fragments_by_slot)) {
    nextBySlot[slotId] = [];
    for (const f of existing) {
      if (!keptIds.has(f.id)) continue;
      const updated = newById.get(f.id);
      if (updated && updated.content !== collectBlockText(f.children)) {
        // content changed: update the text block
        const block: PromptBlock = { id: f.id, kind: 'text', content: { kind: 'text', text: updated.content }, rendered: updated.content };
        nextBySlot[slotId]!.push({ ...f, children: [block] });
      } else {
        nextBySlot[slotId]!.push(f);
      }
    }
  }

  // Add new fragments that don't exist in tree
  for (const f of fragments) {
    const slotId = f.slot;
    if (!keptIds.has(f.id) || !tree.fragments_by_slot[slotId]?.some(existing => existing.id === f.id)) {
      if (!nextBySlot[slotId]) nextBySlot[slotId] = [];
      const block: PromptBlock = { id: f.id, kind: 'text', content: { kind: 'text', text: f.content }, rendered: f.content };
      nextBySlot[slotId]!.push({
        id: f.id,
        slot_id: f.slot,
        priority: f.priority,
        source: f.source,
        removable: f.removable ?? true,
        replaceable: f.replaceable ?? true,
        children: [block],
        anchor: f.anchor ?? null,
        placement_mode: f.placement_mode ?? null,
        depth: f.depth ?? null,
        order: f.order ?? null,
        metadata: f.metadata
      });
    }
  }

  return { ...tree, fragments_by_slot: nextBySlot };
}

