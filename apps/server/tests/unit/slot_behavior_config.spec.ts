import { describe, expect, it } from 'vitest';

import type { SlotBehaviorConfig } from '../../src/config/domains/slot_behavior.js';
import { validateSlotBehaviorConfig } from '../../src/inference/slot_behavior.js';

describe('validateSlotBehaviorConfig', () => {
  it('returns empty array for empty config', () => {
    const errors = validateSlotBehaviorConfig({});
    expect(errors).toEqual([]);
  });

  it('returns empty array for valid config', () => {
    const config: SlotBehaviorConfig = {
      memory_summary: {
        slot_id: 'memory_summary',
        trigger_probability: 0.8,
        conditions: [{ type: 'conversation_turn', operator: 'gt', value: 3 }]
      },
      system_core: {
        slot_id: 'system_core',
        always_active: true,
        no_recursion: true
      }
    };
    const errors = validateSlotBehaviorConfig(config);
    expect(errors).toEqual([]);
  });

  it('rejects always_active + conditions combination', () => {
    const config: SlotBehaviorConfig = {
      bad_slot: {
        slot_id: 'bad_slot',
        always_active: true,
        conditions: [{ type: 'keyword_match', keywords: ['test'] }]
      }
    };
    const errors = validateSlotBehaviorConfig(config);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('always_active + conditions');
    expect(errors[0]).toContain('bad_slot');
  });

  it('rejects always_active + group_id combination', () => {
    const config: SlotBehaviorConfig = {
      bad_slot: {
        slot_id: 'bad_slot',
        always_active: true,
        group_id: 'group_a'
      }
    };
    const errors = validateSlotBehaviorConfig(config);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('always_active + group_id');
    expect(errors[0]).toContain('bad_slot');
  });

  it('reports multiple errors for multiple slots', () => {
    const config: SlotBehaviorConfig = {
      slot_a: {
        slot_id: 'slot_a',
        always_active: true,
        conditions: [{ type: 'keyword_match', keywords: ['x'] }]
      },
      slot_b: {
        slot_id: 'slot_b',
        always_active: true,
        group_id: 'group_x'
      }
    };
    const errors = validateSlotBehaviorConfig(config);
    expect(errors.length).toBe(2);
  });

  it('allows always_active without conditions or group', () => {
    const config: SlotBehaviorConfig = {
      ok_slot: {
        slot_id: 'ok_slot',
        always_active: true,
        no_recursion: true
      }
    };
    const errors = validateSlotBehaviorConfig(config);
    expect(errors).toEqual([]);
  });

  it('allows group_id without always_active', () => {
    const config: SlotBehaviorConfig = {
      ok_slot: {
        slot_id: 'ok_slot',
        group_id: 'my_group',
        group_weight: 2
      }
    };
    const errors = validateSlotBehaviorConfig(config);
    expect(errors).toEqual([]);
  });

  it('allows conditions without always_active', () => {
    const config: SlotBehaviorConfig = {
      ok_slot: {
        slot_id: 'ok_slot',
        conditions: [{ type: 'conversation_turn', operator: 'gt', value: 5 }]
      }
    };
    const errors = validateSlotBehaviorConfig(config);
    expect(errors).toEqual([]);
  });
});
