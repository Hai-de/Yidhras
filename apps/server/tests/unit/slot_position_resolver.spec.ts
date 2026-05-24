import { describe, expect, it } from 'vitest';

import type { PromptSlotConfig } from '../../src/inference/prompt_slot_config.js';
import { allocatePosition, resolveSlotPositions } from '../../src/inference/slot_position_resolver.js';

const mkSlot = (
  id: string,
  overrides: Partial<PromptSlotConfig> = {}
): PromptSlotConfig => ({
  id,
  display_name: id,
  default_priority: 50,
  include_in_combined: true,
  enabled: true,
  ...overrides
});

const ids = (results: ReturnType<typeof resolveSlotPositions>['resolved_positions']) =>
  results.map(r => r.slot_id);

const resolved = (
  results: ReturnType<typeof resolveSlotPositions>['resolved_positions'],
  slotId: string
) => results.find(r => r.slot_id === slotId);

// ═══════════════════════════════════════════════════════════════
// 1. Pure numeric sorting
// ═══════════════════════════════════════════════════════════════
describe('pure numeric position sorting', () => {
  it('orders slots by position descending', () => {
    const configs: Record<string, PromptSlotConfig> = {
      a: mkSlot('a', { position: 30 }),
      b: mkSlot('b', { position: 100 }),
      c: mkSlot('c', { position: 70 })
    };

    const { resolved_positions } = resolveSlotPositions(configs);

    expect(ids(resolved_positions)).toEqual(['b', 'c', 'a']);
    expect(resolved_positions[0].resolved_position).toBe(100);
    expect(resolved_positions[2].resolved_position).toBe(30);
  });

  it('marks resolution_source as explicit when position is set', () => {
    const configs: Record<string, PromptSlotConfig> = {
      a: mkSlot('a', { position: 50 })
    };

    const { resolved_positions } = resolveSlotPositions(configs);

    expect(resolved_positions[0].resolution_source).toBe('explicit');
  });

  it('falls back to default_priority when position is undefined', () => {
    const configs: Record<string, PromptSlotConfig> = {
      a: mkSlot('a', { position: undefined, default_priority: 80 }),
      b: mkSlot('b', { position: 30, default_priority: 50 })
    };

    const { resolved_positions } = resolveSlotPositions(configs);

    expect(ids(resolved_positions)).toEqual(['a', 'b']);
    expect(resolved(resolved_positions, 'a')!.resolution_source).toBe('default');
    expect(resolved(resolved_positions, 'a')!.resolved_position).toBe(80);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Pure anchor sorting
// ═══════════════════════════════════════════════════════════════
describe('pure anchor sorting', () => {
  it('resolves after anchor between ref and next lower position', () => {
    const configs: Record<string, PromptSlotConfig> = {
      core: mkSlot('core', { position: 100 }),
      world: mkSlot('world', { position: 70 }),
      custom: mkSlot('custom', { anchor: { ref: 'core', relation: 'after' } })
    };

    const { resolved_positions } = resolveSlotPositions(configs);

    // core=100, world=70, custom after core → between 100 and 70 → 85
    const customPos = resolved(resolved_positions, 'custom')!.resolved_position;
    expect(customPos).toBeLessThan(100);
    expect(customPos).toBeGreaterThan(70);
    expect(ids(resolved_positions)).toEqual(['core', 'custom', 'world']);
  });

  it('resolves before anchor between ref and next higher position', () => {
    const configs: Record<string, PromptSlotConfig> = {
      core: mkSlot('core', { position: 100 }),
      world: mkSlot('world', { position: 70 }),
      custom: mkSlot('custom', { anchor: { ref: 'world', relation: 'before' } })
    };

    const { resolved_positions } = resolveSlotPositions(configs);

    // world=70, core=100, custom before world → between 70 and 100 → 85
    const customPos = resolved(resolved_positions, 'custom')!.resolved_position;
    expect(customPos).toBeGreaterThan(70);
    expect(customPos).toBeLessThan(100);
    expect(ids(resolved_positions)).toEqual(['core', 'custom', 'world']);
  });

  it('handles after anchor at the last position', () => {
    const configs: Record<string, PromptSlotConfig> = {
      last: mkSlot('last', { position: 30 }),
      afterLast: mkSlot('afterLast', { anchor: { ref: 'last', relation: 'after' } })
    };

    const { resolved_positions } = resolveSlotPositions(configs);

    // last=30, afterLast after last → between 30 and 0 → 15
    expect(ids(resolved_positions)).toEqual(['last', 'afterLast']);
    expect(resolved(resolved_positions, 'afterLast')!.resolved_position).toBeLessThan(30);
  });

  it('handles before anchor at the first (highest) position', () => {
    const configs: Record<string, PromptSlotConfig> = {
      first: mkSlot('first', { position: 100 }),
      beforeFirst: mkSlot('beforeFirst', { anchor: { ref: 'first', relation: 'before' } })
    };

    const { resolved_positions } = resolveSlotPositions(configs);

    // first=100, beforeFirst before first → between 100 and 110 → 105
    expect(ids(resolved_positions)).toEqual(['beforeFirst', 'first']);
    expect(resolved(resolved_positions, 'beforeFirst')!.resolved_position).toBeGreaterThan(100);
  });

  it('marks resolution_source as anchor for resolved anchors', () => {
    const configs: Record<string, PromptSlotConfig> = {
      core: mkSlot('core', { position: 100 }),
      custom: mkSlot('custom', { anchor: { ref: 'core', relation: 'after' } })
    };

    const { resolved_positions } = resolveSlotPositions(configs);

    expect(resolved(resolved_positions, 'custom')!.resolution_source).toBe('anchor');
  });

  it('resolves transitive anchor chains', () => {
    const configs: Record<string, PromptSlotConfig> = {
      core: mkSlot('core', { position: 100 }),
      a: mkSlot('a', { anchor: { ref: 'core', relation: 'after' } }),
      b: mkSlot('b', { anchor: { ref: 'a', relation: 'after' } })
    };

    const { resolved_positions, diagnostics } = resolveSlotPositions(configs);

    expect(diagnostics.warnings).toHaveLength(0);
    // core=100, a after core, b after a — b < a < core
    expect(ids(resolved_positions)).toEqual(['core', 'a', 'b']);
    const aPos = resolved(resolved_positions, 'a')!.resolved_position;
    const bPos = resolved(resolved_positions, 'b')!.resolved_position;
    expect(bPos).toBeLessThan(aPos);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Mixed position + anchor
// ═══════════════════════════════════════════════════════════════
describe('mixed position and anchor', () => {
  it('anchor overrides position when both are set', () => {
    const configs: Record<string, PromptSlotConfig> = {
      core: mkSlot('core', { position: 100 }),
      world: mkSlot('world', { position: 70 }),
      // position=999 should be ignored because anchor is set
      custom: mkSlot('custom', { position: 999, anchor: { ref: 'core', relation: 'after' } })
    };

    const { resolved_positions } = resolveSlotPositions(configs);

    // custom is after core, not at 999
    expect(ids(resolved_positions)).toEqual(['core', 'custom', 'world']);
    expect(resolved(resolved_positions, 'custom')!.resolution_source).toBe('anchor');
  });

  it('positions resolve relative to each other with mixed strategies', () => {
    const configs: Record<string, PromptSlotConfig> = {
      first: mkSlot('first', { position: 100 }),
      second: mkSlot('second', { position: 80 }),
      third: mkSlot('third', { position: 60 }),
      betweenFirst: mkSlot('betweenFirst', { anchor: { ref: 'first', relation: 'after' } }),
      betweenSecond: mkSlot('betweenSecond', { anchor: { ref: 'second', relation: 'before' } })
    };

    const { resolved_positions } = resolveSlotPositions(configs);

    expect(ids(resolved_positions)).toEqual([
      'first',
      'betweenFirst',
      'betweenSecond',
      'second',
      'third'
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Disabled slot as anchor target
// ═══════════════════════════════════════════════════════════════
describe('disabled slot as anchor target', () => {
  it('resolves anchor pointing to a disabled slot', () => {
    const configs: Record<string, PromptSlotConfig> = {
      core: mkSlot('core', { position: 100, enabled: false }),
      world: mkSlot('world', { position: 70 }),
      custom: mkSlot('custom', { anchor: { ref: 'core', relation: 'after' } })
    };

    const { resolved_positions, diagnostics } = resolveSlotPositions(configs);

    expect(diagnostics.warnings).toHaveLength(0);
    expect(ids(resolved_positions)).toEqual(['core', 'custom', 'world']);
    // disabled slot is still in results
    expect(resolved(resolved_positions, 'core')!.enabled).toBe(false);
  });

  it('disabled slots remain in resolved_positions', () => {
    const configs: Record<string, PromptSlotConfig> = {
      a: mkSlot('a', { position: 100, enabled: false }),
      b: mkSlot('b', { position: 50 })
    };

    const { resolved_positions } = resolveSlotPositions(configs);

    expect(resolved_positions).toHaveLength(2);
    expect(resolved(resolved_positions, 'a')).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Cycle detection
// ═══════════════════════════════════════════════════════════════
describe('cycle detection', () => {
  it('detects A → B → C → A cycle and falls back', () => {
    const configs: Record<string, PromptSlotConfig> = {
      a: mkSlot('a', { position: 50, anchor: { ref: 'b', relation: 'after' } }),
      b: mkSlot('b', { position: 50, anchor: { ref: 'c', relation: 'after' } }),
      c: mkSlot('c', { position: 50, anchor: { ref: 'a', relation: 'after' } })
    };

    const { resolved_positions, diagnostics } = resolveSlotPositions(configs);

    expect(diagnostics.warnings.filter(w => w.code === 'anchor_cycle_detected')).toHaveLength(3);
    // All fall back to position (50), sorted by id alphabetically
    expect(ids(resolved_positions)).toEqual(['a', 'b', 'c']);
  });

  it('detects self-loop', () => {
    const configs: Record<string, PromptSlotConfig> = {
      self: mkSlot('self', { position: 30, anchor: { ref: 'self', relation: 'after' } })
    };

    const { diagnostics } = resolveSlotPositions(configs);

    expect(diagnostics.warnings.some(w => w.code === 'anchor_cycle_detected')).toBe(true);
  });

  it('detects two-node cycle', () => {
    const configs: Record<string, PromptSlotConfig> = {
      a: mkSlot('a', { position: 50, anchor: { ref: 'b', relation: 'after' } }),
      b: mkSlot('b', { position: 50, anchor: { ref: 'a', relation: 'before' } })
    };

    const { diagnostics } = resolveSlotPositions(configs);

    expect(diagnostics.warnings.filter(w => w.code === 'anchor_cycle_detected')).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Missing ref
// ═══════════════════════════════════════════════════════════════
describe('missing anchor ref', () => {
  it('falls back when ref does not exist in configs', () => {
    const configs: Record<string, PromptSlotConfig> = {
      core: mkSlot('core', { position: 100 }),
      orphan: mkSlot('orphan', {
        position: 60,
        anchor: { ref: 'nonexistent', relation: 'after' }
      })
    };

    const { resolved_positions, diagnostics } = resolveSlotPositions(configs);

    const orphanWarnings = diagnostics.warnings.filter(w => w.slot_id === 'orphan');
    expect(orphanWarnings).toHaveLength(1);
    expect(orphanWarnings[0].code).toBe('anchor_ref_not_found');
    expect(orphanWarnings[0].fallback_position).toBe(60);
    // orphan falls back to its position
    expect(resolved(resolved_positions, 'orphan')!.resolution_source).toBe('default');
    expect(resolved(resolved_positions, 'orphan')!.resolved_position).toBe(60);
  });

  it('falls back to default_priority when position is not set and ref is missing', () => {
    const configs: Record<string, PromptSlotConfig> = {
      core: mkSlot('core', { position: 100 }),
      orphan: mkSlot('orphan', {
        default_priority: 40,
        anchor: { ref: 'nonexistent', relation: 'before' }
      })
    };

    const { diagnostics } = resolveSlotPositions(configs);

    const orphanWarnings = diagnostics.warnings.filter(w => w.slot_id === 'orphan');
    expect(orphanWarnings[0].fallback_position).toBe(40);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Position collision handling
// ═══════════════════════════════════════════════════════════════
describe('position collision handling', () => {
  it('stable-sorts by slot_id when positions are equal', () => {
    const configs: Record<string, PromptSlotConfig> = {
      zebra: mkSlot('zebra', { position: 50 }),
      alpha: mkSlot('alpha', { position: 50 }),
      beta: mkSlot('beta', { position: 50 })
    };

    const { resolved_positions, diagnostics } = resolveSlotPositions(configs);

    // Same position → alphabetically sorted
    expect(ids(resolved_positions)).toEqual(['alpha', 'beta', 'zebra']);
    // Collision warnings emitted
    expect(diagnostics.warnings.filter(w => w.code === 'position_collision')).toHaveLength(3);
  });

  it('emits collision diagnostics for each colliding slot', () => {
    const configs: Record<string, PromptSlotConfig> = {
      a: mkSlot('a', { position: 10 }),
      b: mkSlot('b', { position: 10 })
    };

    const { diagnostics } = resolveSlotPositions(configs);

    const collisions = diagnostics.warnings.filter(w => w.code === 'position_collision');
    expect(collisions).toHaveLength(2);
    expect(collisions[0].message).toContain('b');
    expect(collisions[1].message).toContain('a');
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. Deep subdivision limit (linear probing fallback)
// ═══════════════════════════════════════════════════════════════
describe('deep subdivision limit', () => {
  it('handles many anchors inserting into the same interval', () => {
    const configs: Record<string, PromptSlotConfig> = {
      top: mkSlot('top', { position: 100 }),
      bottom: mkSlot('bottom', { position: 90 })
    };

    // Insert 10 slots "after top" — all want the (90, 100) interval
    for (let i = 0; i < 10; i++) {
      configs[`s${i}`] = mkSlot(`s${i}`, { anchor: { ref: 'top', relation: 'after' } });
    }

    const { resolved_positions, diagnostics } = resolveSlotPositions(configs);

    // Should not throw, all slots resolved
    expect(resolved_positions).toHaveLength(12);
    // No anchor errors
    expect(diagnostics.warnings.filter(w => w.code === 'anchor_cycle_detected')).toHaveLength(0);

    // All inserted slots should be between 90 and 100
    for (let i = 0; i < 10; i++) {
      const pos = resolved(resolved_positions, `s${i}`)!.resolved_position;
      expect(pos).toBeLessThan(100);
      expect(pos).toBeGreaterThanOrEqual(90 - 0.01); // linear probing may go slightly below
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. Backward compatibility
// ═══════════════════════════════════════════════════════════════
describe('backward compatibility', () => {
  it('treats missing position and anchor as default', () => {
    const configs: Record<string, PromptSlotConfig> = {
      old: mkSlot('old', { default_priority: 75 })
    };

    const { resolved_positions } = resolveSlotPositions(configs);

    expect(resolved_positions).toHaveLength(1);
    expect(resolved_positions[0].resolved_position).toBe(75);
    expect(resolved_positions[0].resolution_source).toBe('default');
  });

  it('handles mixed old and new configs', () => {
    const configs: Record<string, PromptSlotConfig> = {
      modern: mkSlot('modern', { position: 100 }),
      legacy: mkSlot('legacy', { default_priority: 50 }),
      anchored: mkSlot('anchored', { anchor: { ref: 'modern', relation: 'after' } })
    };

    const { resolved_positions } = resolveSlotPositions(configs);

    expect(resolved_positions).toHaveLength(3);
    expect(ids(resolved_positions)[0]).toBe('modern');
    expect(ids(resolved_positions)[2]).toBe('legacy');
  });

  it('position: null is treated as unset', () => {
    const configs: Record<string, PromptSlotConfig> = {
      a: mkSlot('a', { position: null as unknown as undefined, default_priority: 80 })
    };

    const { resolved_positions } = resolveSlotPositions(configs);

    expect(resolved_positions[0].resolved_position).toBe(80);
    expect(resolved_positions[0].resolution_source).toBe('default');
  });
});

// ═══════════════════════════════════════════════════════════════
// allocatePosition unit tests
// ═══════════════════════════════════════════════════════════════
describe('allocatePosition', () => {
  it('computes midpoint for after relation', () => {
    const occupied = new Set([100, 80]);
    const sorted = [100, 80];
    const pos = allocatePosition(occupied, 100, 'after', sorted);
    expect(pos).toBe(90); // midpoint of 80 and 100
  });

  it('computes midpoint for before relation', () => {
    const occupied = new Set([100, 80]);
    const sorted = [100, 80];
    const pos = allocatePosition(occupied, 80, 'before', sorted);
    expect(pos).toBe(90); // midpoint of 80 and 100
  });

  it('uses linear probing when gap < 1', () => {
    const occupied = new Set([100, 99.5]);
    const sorted = [100, 99.5];
    const pos = allocatePosition(occupied, 100, 'after', sorted);
    // gap = 0.5 < 1, so linear probing from 99.51 upward
    expect(pos).toBeGreaterThan(99.5);
    expect(pos).toBeLessThan(100);
  });
});
