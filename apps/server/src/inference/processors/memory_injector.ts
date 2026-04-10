import { randomUUID } from 'node:crypto';

import type {
  PromptFragment,
  PromptFragmentAnchor,
  PromptFragmentPlacementMode
} from '../prompt_fragments.js';
import type { PromptProcessor } from '../prompt_processors.js';

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
