import { describe, expect, it } from 'vitest';

import type { SlotBehaviorProfile } from '../../src/inference/slot_behavior.js';
import {
  resolveBudgetAllocation,
  resolveExclusiveGroup,
  resolvePriorityOrder,
  resolveSlotGroups
} from '../../src/inference/slot_group_resolver.js';

// ── helpers ──

function makeProfile(slotId: string, groupId?: string, weight?: number): SlotBehaviorProfile {
  return { slot_id: slotId, ...(groupId ? { group_id: groupId } : {}), ...(weight !== undefined ? { group_weight: weight } : {}) };
}

// ── resolveSlotGroups ──

describe('resolveSlotGroups', () => {
  it('groups profiles by group_id', () => {
    const profiles = [
      makeProfile('a', 'g1'),
      makeProfile('b', 'g1'),
      makeProfile('c', 'g2')
    ];
    const { groups, ungrouped } = resolveSlotGroups(profiles);
    expect(groups.get('g1')?.length).toBe(2);
    expect(groups.get('g2')?.length).toBe(1);
    expect(ungrouped).toEqual([]);
  });

  it('puts profiles without group_id into ungrouped', () => {
    const profiles = [
      makeProfile('a'),
      makeProfile('b', 'g1')
    ];
    const { groups, ungrouped } = resolveSlotGroups(profiles);
    expect(ungrouped).toHaveLength(1);
    expect(ungrouped[0].slot_id).toBe('a');
    expect(groups.get('g1')?.length).toBe(1);
  });

  it('returns empty groups and ungrouped for empty input', () => {
    const { groups, ungrouped } = resolveSlotGroups([]);
    expect(groups.size).toBe(0);
    expect(ungrouped).toEqual([]);
  });
});

// ── resolveExclusiveGroup ──

describe('resolveExclusiveGroup', () => {
  it('returns the only slot in a single-member group', () => {
    const profiles = [makeProfile('solo', undefined, 1)];
    const winner = resolveExclusiveGroup(profiles, 'seed');
    expect(winner).toBe('solo');
  });

  it('returns null for empty group', () => {
    const winner = resolveExclusiveGroup([], 'seed');
    expect(winner).toBeNull();
  });

  it('returns the same slot for same seed (deterministic)', () => {
    const profiles = [
      makeProfile('a', undefined, 1),
      makeProfile('b', undefined, 1),
      makeProfile('c', undefined, 1)
    ];
    const a = resolveExclusiveGroup(profiles, 'test_seed');
    const b = resolveExclusiveGroup(profiles, 'test_seed');
    expect(a).toBe(b);
  });

  it('returns different slots for different seeds', () => {
    const profiles = [
      makeProfile('a', undefined, 1),
      makeProfile('b', undefined, 1)
    ];
    const results = new Set<string>();
    for (let i = 0; i < 50; i++) {
      results.add(resolveExclusiveGroup(profiles, `seed_${i}`)!);
    }
    // With 50 different seeds for 2 equally-weighted slots, both should appear
    expect(results.size).toBe(2);
  });

  it('weight 0 slot is never selected', () => {
    const profiles = [
      makeProfile('a', undefined, 0),
      makeProfile('b', undefined, 1)
    ];
    // Try many seeds — slot a (weight 0) should never win
    for (let i = 0; i < 100; i++) {
      const winner = resolveExclusiveGroup(profiles, `seed_${i}`);
      expect(winner).toBe('b');
    }
  });

  it('high weight slot is selected more often', () => {
    const profiles = [
      makeProfile('a', undefined, 1),
      makeProfile('b', undefined, 9)
    ];
    let bWins = 0;
    const trials = 100;
    for (let i = 0; i < trials; i++) {
      if (resolveExclusiveGroup(profiles, `seed_${i}`) === 'b') {
        bWins++;
      }
    }
    // b has 90% weight — expect at least 75 wins in 100 trials
    expect(bWins).toBeGreaterThanOrEqual(75);
  });

  it('default weight is 1 when not specified', () => {
    const profiles = [
      { slot_id: 'a' } as SlotBehaviorProfile,
      { slot_id: 'b' } as SlotBehaviorProfile
    ];
    const results = new Set<string>();
    for (let i = 0; i < 50; i++) {
      results.add(resolveExclusiveGroup(profiles, `seed_${i}`)!);
    }
    expect(results.size).toBe(2);
  });

  it('returns null when all weights are 0', () => {
    const profiles = [
      makeProfile('a', undefined, 0),
      makeProfile('b', undefined, 0)
    ];
    const winner = resolveExclusiveGroup(profiles, 'seed');
    expect(winner).toBeNull();
  });
});

// ── resolvePriorityOrder ──

describe('resolvePriorityOrder', () => {
  it('sorts by weight descending', () => {
    const profiles = [
      makeProfile('a', undefined, 1),
      makeProfile('b', undefined, 5),
      makeProfile('c', undefined, 2)
    ];
    const ordered = resolvePriorityOrder(profiles);
    expect(ordered[0].slot_id).toBe('b');
    expect(ordered[1].slot_id).toBe('c');
    expect(ordered[2].slot_id).toBe('a');
  });

  it('default weight is 1', () => {
    const profiles = [
      { slot_id: 'a' } as SlotBehaviorProfile,
      { slot_id: 'b' } as SlotBehaviorProfile
    ];
    const ordered = resolvePriorityOrder(profiles);
    expect(ordered).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(resolvePriorityOrder([])).toEqual([]);
  });
});

// ── resolveBudgetAllocation ──

describe('resolveBudgetAllocation', () => {
  it('allocates tokens proportionally by weight', () => {
    const profiles = [
      makeProfile('a', undefined, 1),
      makeProfile('b', undefined, 1)
    ];
    const alloc = resolveBudgetAllocation(profiles, 1000);
    expect(alloc.get('a')).toBe(500);
    expect(alloc.get('b')).toBe(500);
  });

  it('allocates more to higher weight slots', () => {
    const profiles = [
      makeProfile('a', undefined, 1),
      makeProfile('b', undefined, 3)
    ];
    const alloc = resolveBudgetAllocation(profiles, 1000);
    expect(alloc.get('a')).toBe(250);
    expect(alloc.get('b')).toBe(750);
  });

  it('returns empty map for empty input', () => {
    const alloc = resolveBudgetAllocation([], 1000);
    expect(alloc.size).toBe(0);
  });

  it('returns empty map when total weight is 0', () => {
    const profiles = [
      makeProfile('a', undefined, 0),
      makeProfile('b', undefined, 0)
    ];
    const alloc = resolveBudgetAllocation(profiles, 1000);
    expect(alloc.size).toBe(0);
  });

  it('floors allocation to integers', () => {
    const profiles = [makeProfile('a', undefined, 1)];
    const alloc = resolveBudgetAllocation(profiles, 999);
    const value = alloc.get('a');
    expect(value).toBe(Math.floor(999));
    expect(Number.isInteger(value)).toBe(true);
  });
});
