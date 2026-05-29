import { describe, expect, it } from 'vitest';

import { resolveSlotGroups, resolveExclusiveGroup, resolvePriorityOrder, resolveBudgetAllocation } from '../../../src/inference/slot_group_resolver.js';
import type { SlotBehaviorProfile } from '../../../src/inference/slot_behavior.js';

const makeProfile = (slotId: string, opts?: { groupId?: string; weight?: number }): SlotBehaviorProfile => ({
  slot_id: slotId,
  group_id: opts?.groupId ?? null,
  group_weight: opts?.weight,
  trigger_probability: 1.0,
  trigger_mode: 'always'
} as SlotBehaviorProfile);

describe('slot_group_resolver', () => {
  describe('resolveSlotGroups', () => {
    it('puts profiles with group_id into groups', () => {
      const profiles = [
        makeProfile('a', { groupId: 'g1' }),
        makeProfile('b', { groupId: 'g1' }),
        makeProfile('c', { groupId: 'g2' })
      ];
      const result = resolveSlotGroups(profiles);
      expect(result.groups.size).toBe(2);
      expect(result.groups.get('g1')).toHaveLength(2);
      expect(result.groups.get('g2')).toHaveLength(1);
      expect(result.ungrouped).toHaveLength(0);
    });

    it('puts profiles without group_id into ungrouped', () => {
      const profiles = [
        makeProfile('a'),
        makeProfile('b')
      ];
      const result = resolveSlotGroups(profiles);
      expect(result.groups.size).toBe(0);
      expect(result.ungrouped).toHaveLength(2);
    });

    it('handles mixed grouped and ungrouped profiles', () => {
      const profiles = [
        makeProfile('a', { groupId: 'g1' }),
        makeProfile('b'),
        makeProfile('c', { groupId: 'g1' }),
        makeProfile('d')
      ];
      const result = resolveSlotGroups(profiles);
      expect(result.groups.size).toBe(1);
      expect(result.groups.get('g1')).toHaveLength(2);
      expect(result.ungrouped).toHaveLength(2);
    });

    it('returns empty result for empty input', () => {
      const result = resolveSlotGroups([]);
      expect(result.groups.size).toBe(0);
      expect(result.ungrouped).toHaveLength(0);
    });
  });

  describe('resolveExclusiveGroup', () => {
    it('returns null for empty group', () => {
      expect(resolveExclusiveGroup([], 'seed')).toBeNull();
    });

    it('returns the only profile for single-element group', () => {
      const profiles = [makeProfile('only')];
      expect(resolveExclusiveGroup(profiles, 'seed')).toBe('only');
    });

    it('returns a slot_id for multi-element group', () => {
      const profiles = [
        makeProfile('a', { weight: 1 }),
        makeProfile('b', { weight: 1 })
      ];
      const result = resolveExclusiveGroup(profiles, 'test-seed');
      expect(result === 'a' || result === 'b').toBe(true);
    });

    it('is deterministic for same seed', () => {
      const profiles = [
        makeProfile('a', { weight: 1 }),
        makeProfile('b', { weight: 1 }),
        makeProfile('c', { weight: 1 })
      ];
      const r1 = resolveExclusiveGroup(profiles, 'fixed-seed');
      const r2 = resolveExclusiveGroup(profiles, 'fixed-seed');
      expect(r1).toBe(r2);
    });

    it('returns null when all weights are zero', () => {
      const profiles = [
        makeProfile('a', { weight: 0 }),
        makeProfile('b', { weight: 0 })
      ];
      expect(resolveExclusiveGroup(profiles, 'seed')).toBeNull();
    });

    it('selects high-weight profile more often', () => {
      const profiles = [
        makeProfile('rare', { weight: 1 }),
        makeProfile('common', { weight: 99 })
      ];
      const counts = { rare: 0, common: 0 };
      for (let i = 0; i < 1000; i++) {
        const result = resolveExclusiveGroup(profiles, `seed-${i}`);
        if (result === 'rare') counts.rare++;
        else if (result === 'common') counts.common++;
      }
      expect(counts.common).toBeGreaterThan(counts.rare);
    });

    it('uses default weight of 1 when not specified', () => {
      const profiles = [makeProfile('a'), makeProfile('b')];
      const result = resolveExclusiveGroup(profiles, 'seed');
      expect(result === 'a' || result === 'b').toBe(true);
    });
  });

  describe('resolvePriorityOrder', () => {
    it('sorts by group_weight descending', () => {
      const profiles = [
        makeProfile('low', { weight: 1 }),
        makeProfile('high', { weight: 10 }),
        makeProfile('mid', { weight: 5 })
      ];
      const sorted = resolvePriorityOrder(profiles);
      expect(sorted[0].slot_id).toBe('high');
      expect(sorted[1].slot_id).toBe('mid');
      expect(sorted[2].slot_id).toBe('low');
    });

    it('returns empty array for empty input', () => {
      expect(resolvePriorityOrder([])).toEqual([]);
    });

    it('does not mutate original array', () => {
      const profiles = [
        makeProfile('a', { weight: 3 }),
        makeProfile('b', { weight: 1 })
      ];
      const original = [...profiles];
      resolvePriorityOrder(profiles);
      expect(profiles[0].slot_id).toBe(original[0].slot_id);
    });

    it('uses default weight of 1 when not specified', () => {
      const profiles = [makeProfile('a'), makeProfile('b')];
      const sorted = resolvePriorityOrder(profiles);
      // Both have weight 1, so order is preserved
      expect(sorted).toHaveLength(2);
    });
  });

  describe('resolveBudgetAllocation', () => {
    it('allocates budget proportionally by weight', () => {
      const profiles = [
        makeProfile('a', { weight: 1 }),
        makeProfile('b', { weight: 3 })
      ];
      const allocations = resolveBudgetAllocation(profiles, 100);
      expect(allocations.get('a')).toBe(25);   // 1/4 * 100
      expect(allocations.get('b')).toBe(75);   // 3/4 * 100
    });

    it('returns empty map for empty input', () => {
      const allocations = resolveBudgetAllocation([], 100);
      expect(allocations.size).toBe(0);
    });

    it('returns empty map when total weight is zero', () => {
      const profiles = [
        makeProfile('a', { weight: 0 }),
        makeProfile('b', { weight: 0 })
      ];
      const allocations = resolveBudgetAllocation(profiles, 100);
      expect(allocations.size).toBe(0);
    });

    it('handles equal weights', () => {
      const profiles = [
        makeProfile('a', { weight: 1 }),
        makeProfile('b', { weight: 1 }),
        makeProfile('c', { weight: 1 })
      ];
      const allocations = resolveBudgetAllocation(profiles, 90);
      expect(allocations.get('a')).toBe(30);
      expect(allocations.get('b')).toBe(30);
      expect(allocations.get('c')).toBe(30);
    });

    it('uses default weight of 1 when not specified', () => {
      const profiles = [makeProfile('a'), makeProfile('b')];
      const allocations = resolveBudgetAllocation(profiles, 100);
      expect(allocations.get('a')).toBe(50);
      expect(allocations.get('b')).toBe(50);
    });

    it('handles zero budget', () => {
      const profiles = [makeProfile('a', { weight: 1 })];
      const allocations = resolveBudgetAllocation(profiles, 0);
      expect(allocations.get('a')).toBe(0);
    });

    it('floors fractional allocations', () => {
      const profiles = [
        makeProfile('a', { weight: 1 }),
        makeProfile('b', { weight: 2 })
      ];
      const allocations = resolveBudgetAllocation(profiles, 10);
      // 1/3 * 10 = 3.33 → 3;  2/3 * 10 = 6.66 → 6
      expect(allocations.get('a')).toBe(3);
      expect(allocations.get('b')).toBe(6);
    });
  });
});
