import { randomUUID } from 'node:crypto';

import type { PromptBlock } from '../prompt_block.js';
import type { PromptFragmentV2 } from '../prompt_fragment_v2.js';
import type { PromptTreeProcessor, PromptTreeProcessorInput } from '../prompt_processors.js';
import type { PromptTree } from '../prompt_tree.js';

const SHORT_TERM_SLOT = 'memory_short_term' as const;
const SUMMARY_SLOT = 'memory_summary' as const;

const collectFragmentText = (fragment: PromptFragmentV2): string => {
  return fragment.children
    .map(c => {
      if ('kind' in c && c.kind === 'text' && c.content.kind === 'text') {
        return c.rendered ?? c.content.text;
      }
      return '';
    })
    .join(' ')
    .trim();
};

const buildSummaryFragmentV2 = (sourceFragments: PromptFragmentV2[], content: string): PromptFragmentV2 => {
  const text = `Recent memory summary: ${content}`;
  const block: PromptBlock = {
    id: randomUUID(),
    kind: 'text',
    content: { kind: 'text', text },
    rendered: text
  };

  return {
    id: randomUUID(),
    slot_id: SUMMARY_SLOT,
    priority: 130,
    source: 'memory.summary.compaction',
    removable: true,
    replaceable: true,
    children: [block],
    metadata: {
      summarized_fragment_ids: sourceFragments.map(f => f.id),
      summarized_fragment_count: sourceFragments.length,
      summarized_sources: sourceFragments.map(f => f.source),
      summarized_tags: sourceFragments.flatMap(
        f => (Array.isArray(f.metadata?.tags) ? (f.metadata!.tags as string[]) : [])
      )
    }
  };
};

export const createMemorySummaryTreeProcessor = (): PromptTreeProcessor => {
  return {
    name: 'memory-summary',
    async process(input: PromptTreeProcessorInput): Promise<PromptTree> {
      const ctx = input.context;
      const shortTermFragments = input.tree.fragments_by_slot[SHORT_TERM_SLOT] ?? [];

      if (shortTermFragments.length < 4) {
        return input.tree;
      }

      const sorted = [...shortTermFragments].sort((a, b) => b.priority - a.priority);
      const summarySource = sorted.slice(0, 3);
      const compacted = sorted.slice(3);
      const summaryContent = summarySource
        .map(f => collectFragmentText(f))
        .filter(t => t.length > 0)
        .join(' | ');

      if (summaryContent.length === 0) {
        return input.tree;
      }

      const summaryFragment = buildSummaryFragmentV2(summarySource, summaryContent);

      ctx.memory_context.diagnostics = {
        ...ctx.memory_context.diagnostics,
        prompt_processing_trace: {
          ...(typeof ctx.memory_context.diagnostics.prompt_processing_trace === 'object' &&
          ctx.memory_context.diagnostics.prompt_processing_trace !== null
            ? (ctx.memory_context.diagnostics.prompt_processing_trace as Record<string, unknown>)
            : {}),
          summary_compaction: {
            summarized_fragment_ids: summarySource.map(f => f.id),
            summary_fragment_id: summaryFragment.id
          }
        }
      };

      const nextBySlot = { ...input.tree.fragments_by_slot };
      nextBySlot[SHORT_TERM_SLOT] = compacted;
      nextBySlot[SUMMARY_SLOT] = [...(nextBySlot[SUMMARY_SLOT] ?? []), summaryFragment];

      return { ...input.tree, fragments_by_slot: nextBySlot };
    }
  };
};
