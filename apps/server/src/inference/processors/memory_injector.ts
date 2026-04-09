import { randomUUID } from 'node:crypto';

import type { PromptFragment } from '../prompt_fragments.js';
import type { PromptProcessor } from '../prompt_processors.js';

const buildMemoryFragment = (
  slot: 'memory_short_term' | 'memory_long_term' | 'memory_summary',
  priority: number,
  source: string,
  content: string,
  metadata?: Record<string, unknown>
): PromptFragment => {
  return {
    id: randomUUID(),
    slot,
    priority,
    content,
    source,
    removable: true,
    replaceable: true,
    metadata
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
            visibility: entry.visibility
          }
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
            visibility: entry.visibility
          }
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
            visibility: entry.visibility
          }
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
