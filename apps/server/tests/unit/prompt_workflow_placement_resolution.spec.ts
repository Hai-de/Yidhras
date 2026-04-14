import { describe, expect, it } from 'vitest';

import { resolvePromptFragmentPlacement, sortPromptFragmentsBase } from '../../src/context/workflow/placement_resolution.js';
import type { PromptFragment } from '../../src/inference/prompt_fragments.js';

const buildFragment = (input: Partial<PromptFragment> & Pick<PromptFragment, 'id' | 'slot' | 'priority' | 'content' | 'source'>): PromptFragment => ({
  removable: true,
  replaceable: true,
  ...input
});

describe('prompt workflow placement resolution', () => {
  it('resolves after_anchor against source fragments within the same slot', () => {
    const fragments: PromptFragment[] = [
      buildFragment({
        id: 'base-1',
        slot: 'memory_long_term',
        priority: 80,
        content: 'Base memory',
        source: 'memory.long_term.manual'
      }),
      buildFragment({
        id: 'anchored-1',
        slot: 'memory_long_term',
        priority: 60,
        content: 'Anchored memory',
        source: 'memory.long_term.block',
        anchor: {
          kind: 'source',
          value: 'memory.long_term.manual'
        },
        placement_mode: 'after_anchor',
        depth: 10,
        order: 1
      })
    ];

    const result = resolvePromptFragmentPlacement({ fragments });

    expect(result.fragments.map(fragment => fragment.id)).toEqual(['base-1', 'anchored-1']);
    expect(result.decisions).toContainEqual(
      expect.objectContaining({
        fragment_id: 'anchored-1',
        anchor_key: 'source:memory.long_term.manual',
        fallback_reason: null,
        matched_fragment_ids: ['base-1']
      })
    );
    expect(result.summary).toEqual({
      total_fragments: 2,
      resolved_with_anchor: 1,
      fallback_count: 0
    });
  });

  it('falls back when anchor target cannot be found', () => {
    const fragments: PromptFragment[] = [
      buildFragment({
        id: 'base-1',
        slot: 'memory_long_term',
        priority: 80,
        content: 'Base memory',
        source: 'memory.long_term.manual'
      }),
      buildFragment({
        id: 'fallback-1',
        slot: 'memory_long_term',
        priority: 60,
        content: 'Fallback memory',
        source: 'memory.long_term.block',
        anchor: {
          kind: 'fragment_id',
          value: 'missing-fragment'
        },
        placement_mode: 'before_anchor'
      })
    ];

    const result = resolvePromptFragmentPlacement({ fragments });

    expect(result.fragments.map(fragment => fragment.id)).toEqual(['fallback-1', 'base-1']);
    expect(result.decisions).toContainEqual(
      expect.objectContaining({
        fragment_id: 'fallback-1',
        anchor_key: 'fragment_id:missing-fragment',
        fallback_reason: 'anchor_not_found'
      })
    );
    expect(result.summary.fallback_count).toBe(1);
  });

  it('resolves prepend/append and slot boundary anchors deterministically', () => {
    const fragments: PromptFragment[] = [
      buildFragment({
        id: 'core',
        slot: 'system_core',
        priority: 100,
        content: 'Core',
        source: 'system.core'
      }),
      buildFragment({
        id: 'slot-prepend',
        slot: 'system_core',
        priority: 50,
        content: 'prepend',
        source: 'system.prepend',
        placement_mode: 'prepend'
      }),
      buildFragment({
        id: 'slot-start-after',
        slot: 'system_core',
        priority: 40,
        content: 'after start',
        source: 'system.after_start',
        anchor: {
          kind: 'slot_start',
          value: 'system_core'
        },
        placement_mode: 'after_anchor'
      }),
      buildFragment({
        id: 'slot-end-before',
        slot: 'system_core',
        priority: 30,
        content: 'before end',
        source: 'system.before_end',
        anchor: {
          kind: 'slot_end',
          value: 'system_core'
        },
        placement_mode: 'before_anchor'
      }),
      buildFragment({
        id: 'slot-append',
        slot: 'system_core',
        priority: 20,
        content: 'append',
        source: 'system.append',
        placement_mode: 'append'
      })
    ];

    const result = resolvePromptFragmentPlacement({ fragments, slotOrder: ['system_core'] });

    expect(result.fragments.map(fragment => fragment.id)).toEqual([
      'slot-prepend',
      'slot-start-after',
      'core',
      'slot-end-before',
      'slot-append'
    ]);
    expect(result.summary.total_fragments).toBe(5);
  });

  it('uses slot order when performing base fragment sorting', () => {
    const fragments: PromptFragment[] = [
      buildFragment({
        id: 'world',
        slot: 'world_context',
        priority: 80,
        content: 'World',
        source: 'world'
      }),
      buildFragment({
        id: 'system',
        slot: 'system_core',
        priority: 100,
        content: 'System',
        source: 'system'
      }),
      buildFragment({
        id: 'memory',
        slot: 'memory_long_term',
        priority: 60,
        content: 'Memory',
        source: 'memory'
      })
    ];

    const sorted = sortPromptFragmentsBase(fragments, ['system_core', 'world_context', 'memory_long_term']);
    expect(sorted.map(fragment => fragment.id)).toEqual(['system', 'world', 'memory']);
  });
});
