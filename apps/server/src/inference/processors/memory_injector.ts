import { randomUUID } from 'node:crypto';

import type { PromptBlock } from '../prompt_block.js';
import type { PromptFragmentV2 } from '../prompt_fragment_v2.js';
import type { PromptTreeProcessor, PromptTreeProcessorInput } from '../prompt_processors.js';
import type { PromptTree } from '../prompt_tree.js';

const buildMemoryFragmentV2 = (
  slotId: string,
  priority: number,
  source: string,
  text: string,
  metadata?: Record<string, unknown>
): PromptFragmentV2 => {
  const block: PromptBlock = {
    id: randomUUID(),
    kind: 'text',
    content: { kind: 'text', text },
    rendered: text
  };

  return {
    id: randomUUID(),
    slot_id: slotId,
    priority,
    source,
    removable: true,
    replaceable: true,
    children: [block],
    metadata
  };
};

const toPlacementMeta = (metadata: Record<string, unknown> | undefined): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  if (metadata?.placement_anchor) result.placement_anchor = metadata.placement_anchor;
  if (metadata?.placement_mode) result.placement_mode = metadata.placement_mode;
  if (typeof metadata?.placement_depth === 'number') result.placement_depth = metadata.placement_depth;
  if (typeof metadata?.placement_order === 'number') result.placement_order = metadata.placement_order;
  return result;
};

const buildEntryMetadata = (entry: {
  id: string;
  source_ref?: unknown;
  tags?: string[];
  importance: number;
  salience: number;
  visibility?: unknown;
  metadata?: Record<string, unknown>;
}): Record<string, unknown> => ({
  memory_entry_id: entry.id,
  source_ref: entry.source_ref ?? null,
  policy_gate:
    entry.visibility && typeof entry.visibility === 'object'
      ? (entry.visibility as Record<string, unknown>).policy_gate ?? null
      : null,
  visibility_blocked:
    entry.visibility && typeof entry.visibility === 'object'
      ? (entry.visibility as Record<string, unknown>).policy_gate === 'deny'
      : false,
  tags: entry.tags,
  importance: entry.importance,
  salience: entry.salience,
  visibility: entry.visibility,
  ...(entry.metadata ?? {}),
  ...toPlacementMeta(entry.metadata)
});

const buildMemoryFragmentsV2 = (
  slotId: string,
  entries: Array<{
    id: string;
    source_kind: string;
    content: { text: string };
    source_ref?: unknown;
    tags?: string[];
    importance: number;
    salience: number;
    visibility?: unknown;
    metadata?: Record<string, unknown>;
  }>,
  basePriority: number,
  sourcePrefix: string
): PromptFragmentV2[] => {
  return entries.map((entry, index) =>
    buildMemoryFragmentV2(
      slotId,
      basePriority - index,
      `${sourcePrefix}.${entry.source_kind}`,
      entry.content.text,
      buildEntryMetadata(entry)
    )
  );
};

export const createMemoryInjectorTreeProcessor = (): PromptTreeProcessor => {
  return {
    name: 'memory-injector',
    async process(input: PromptTreeProcessorInput): Promise<PromptTree> {
      const ctx = input.context;

      const shortTermFragments = buildMemoryFragmentsV2(
        'memory_short_term',
        ctx.memory_context.short_term,
        100,
        'memory.short_term'
      );

      const longTermFragments = buildMemoryFragmentsV2(
        'memory_long_term',
        ctx.memory_context.long_term,
        80,
        'memory.long_term'
      );

      const summaryFragments = buildMemoryFragmentsV2(
        'memory_summary',
        ctx.memory_context.summaries,
        120,
        'memory.summary'
      );

      const nextBySlot: Record<string, PromptFragmentV2[]> = {};
      for (const [slotId, fragments] of Object.entries(input.tree.fragments_by_slot)) {
        if (slotId === 'memory_short_term' || slotId === 'memory_long_term' || slotId === 'memory_summary') {
          continue;
        }
        nextBySlot[slotId] = fragments;
      }

      // Filter out empty memory.summary fragments from existing tree
      const existingSummaryFragments = (input.tree.fragments_by_slot['memory_summary'] ?? []).filter(f => {
        if (f.source !== 'memory.summary') return true;
        const hasContent = f.children.some(
          c => 'kind' in c && c.kind === 'text' && c.content.kind === 'text' && c.content.text.length > 0
        );
        return hasContent;
      });

      nextBySlot['memory_summary'] = [...existingSummaryFragments, ...summaryFragments];
      nextBySlot['memory_short_term'] = shortTermFragments;
      nextBySlot['memory_long_term'] = longTermFragments;

      return { ...input.tree, fragments_by_slot: nextBySlot };
    }
  };
};
