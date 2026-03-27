import { randomUUID } from 'node:crypto';

import type { PromptFragment } from '../prompt_fragments.js';
import type { PromptProcessor } from '../prompt_processors.js';
import type { PromptProcessingTrace } from '../types.js';

const SHORT_TERM_SLOT = 'memory_short_term' as const;
const SUMMARY_SLOT = 'memory_summary' as const;

const isShortTermFragment = (fragment: PromptFragment): boolean => {
  return fragment.slot === SHORT_TERM_SLOT;
};

const summarizeFragments = (fragments: PromptFragment[]): string => {
  const top = fragments.slice(0, 3).map(fragment => fragment.content.trim()).filter(content => content.length > 0);
  return top.join(' | ');
};

const buildSummaryFragment = (
  fragments: PromptFragment[],
  content: string
): PromptFragment => {
  return {
    id: randomUUID(),
    slot: SUMMARY_SLOT,
    priority: 130,
    content: `Recent memory summary: ${content}`,
    source: 'memory.summary.compaction',
    removable: true,
    replaceable: true,
    metadata: {
      summarized_fragment_ids: fragments.map(fragment => fragment.id),
      summarized_fragment_count: fragments.length,
      summarized_sources: fragments.map(fragment => fragment.source),
      summarized_tags: fragments.flatMap(fragment => Array.isArray(fragment.metadata?.tags) ? fragment.metadata.tags : [])
    }
  };
};

export const createMemorySummaryPromptProcessor = (): PromptProcessor => {
  return {
    name: 'memory-summary',
    async process({ context, fragments }) {
      const shortTermFragments = fragments.filter(isShortTermFragment);
      if (shortTermFragments.length < 4) {
        return fragments;
      }

      const sortedShortTerm = [...shortTermFragments].sort((left, right) => right.priority - left.priority);
      const summarySourceFragments = sortedShortTerm.slice(0, 3);
      const compactedFragments = sortedShortTerm.slice(3);
      const summaryContent = summarizeFragments(summarySourceFragments);
      if (summaryContent.length === 0) {
        return fragments;
      }

      const summaryFragment = buildSummaryFragment(summarySourceFragments, summaryContent);
      const preservedFragments = fragments.filter(fragment => !summarySourceFragments.some(source => source.id === fragment.id));

      context.memory_context.diagnostics = {
        ...context.memory_context.diagnostics,
        prompt_processing_trace: {
          ...((typeof context.memory_context.diagnostics.prompt_processing_trace === 'object' && context.memory_context.diagnostics.prompt_processing_trace !== null
            ? context.memory_context.diagnostics.prompt_processing_trace
            : {}) as PromptProcessingTrace),
          summary_compaction: {
            summarized_fragment_ids: summarySourceFragments.map(fragment => fragment.id),
            summary_fragment_id: summaryFragment.id
          }
        }
      };

      return [...preservedFragments, summaryFragment, ...compactedFragments];
    }
  };
};
