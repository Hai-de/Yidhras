import { describe, expect, it } from 'vitest';

import type { SlotConditionEvaluator } from '../../src/plugins/extensions/slot_condition_registry.js';
import { slotConditionRegistry } from '../../src/plugins/extensions/slot_condition_registry.js';

function makeEval(key: string, version = '1.0.0', alwaysActive = true): SlotConditionEvaluator {
  return {
    key,
    version,
    evaluate: async (ctx) => ({ active: alwaysActive, reason: `mock: ${key}` })
  };
}

const ctx = {
  slot_id: 'test',
  variables: {},
  conversation_meta: { turn_count: 0 },
  token_budget: { total: 8192, used: 0, remaining: 8192 },
  current_tick: 1,
  last_user_message: ''
};

describe('SlotConditionRegistry — per-pack isolation', () => {
  it('registers and retrieves evaluator for a pack', () => {
    const evaluator = makeEval('slot_condition.test');
    slotConditionRegistry.register('pack-a', evaluator);

    const retrieved = slotConditionRegistry.get('pack-a', 'slot_condition.test');
    expect(retrieved).toBeDefined();
    expect(retrieved!.key).toBe('slot_condition.test');
  });

  it('allows same key in different packs', () => {
    const e1 = makeEval('slot_condition.shared', '1.0.0');
    const e2 = makeEval('slot_condition.shared', '1.0.0');

    slotConditionRegistry.register('pack-a', e1);
    slotConditionRegistry.register('pack-b', e2);

    expect(slotConditionRegistry.get('pack-a', 'slot_condition.shared')).toBeDefined();
    expect(slotConditionRegistry.get('pack-b', 'slot_condition.shared')).toBeDefined();
  });

  it('throws on same key + same pack with different version', () => {
    const e1 = makeEval('slot_condition.dup', '1.0.0');
    const e2 = makeEval('slot_condition.dup', '2.0.0');

    slotConditionRegistry.register('pack-x', e1);
    expect(() => slotConditionRegistry.register('pack-x', e2)).toThrow(
      /key conflict in pack 'pack-x'/
    );
  });

  it('silently skips same key + same pack + same version', () => {
    const e1 = makeEval('slot_condition.same', '1.0.0');
    const e2 = makeEval('slot_condition.same', '1.0.0');

    slotConditionRegistry.register('pack-x', e1);
    expect(() => slotConditionRegistry.register('pack-x', e2)).not.toThrow();
  });

  it('returns undefined for unknown pack', () => {
    const result = slotConditionRegistry.get('nonexistent', 'any');
    expect(result).toBeUndefined();
  });

  it('returns undefined for unknown key in known pack', () => {
    slotConditionRegistry.register('pack-a', makeEval('slot_condition.known'));
    const result = slotConditionRegistry.get('pack-a', 'slot_condition.unknown');
    expect(result).toBeUndefined();
  });

  it('lists all evaluators for a pack', () => {
    slotConditionRegistry.register('pack-list', makeEval('slot_condition.a'));
    slotConditionRegistry.register('pack-list', makeEval('slot_condition.b'));

    const list = slotConditionRegistry.list('pack-list');
    expect(list).toHaveLength(2);
    expect(list.map((e) => e.key).sort()).toEqual(['slot_condition.a', 'slot_condition.b']);
  });

  it('returns empty list for unknown pack', () => {
    expect(slotConditionRegistry.list('no-pack')).toEqual([]);
  });

  it('lists keys for a pack', () => {
    slotConditionRegistry.register('pack-keys', makeEval('slot_condition.x'));
    expect(slotConditionRegistry.keys('pack-keys')).toEqual(['slot_condition.x']);
  });
});

describe('SlotConditionRegistry — builtin registration', () => {
  it('registerBuiltin adds evaluator when key does not exist', () => {
    const builtin = makeEval('slot_condition.builtin_new');
    slotConditionRegistry.registerBuiltin('pack-b', builtin);

    expect(slotConditionRegistry.get('pack-b', 'slot_condition.builtin_new')).toBeDefined();
  });

  it('registerBuiltin does not override existing key', () => {
    const existing = makeEval('slot_condition.override', '1.0.0', true);
    const builtin = makeEval('slot_condition.override', '1.0.0', false);

    slotConditionRegistry.register('pack-c', existing);
    slotConditionRegistry.registerBuiltin('pack-c', builtin);

    const retrieved = slotConditionRegistry.get('pack-c', 'slot_condition.override');
    // Should still be the original (alwaysActive=true), not the builtin (false)
    expect(retrieved).toBe(existing);
  });
});

describe('SlotConditionRegistry — evaluate shortcut', () => {
  it('evaluates via shortcut method', async () => {
    const evaluator = makeEval('slot_condition.eval_test');
    slotConditionRegistry.register('pack-e', evaluator);

    const result = await slotConditionRegistry.evaluate('pack-e', 'slot_condition.eval_test', ctx);
    expect(result.active).toBe(true);
    expect(result.reason).toContain('mock');
  });

  it('returns inactive when evaluator not found', async () => {
    const result = await slotConditionRegistry.evaluate('pack-e', 'slot_condition.missing', ctx);
    expect(result.active).toBe(false);
    expect(result.reason).toContain('not found');
  });
});

describe('SlotConditionRegistry — clear', () => {
  it('clearPack removes only the specified pack', () => {
    slotConditionRegistry.register('pack-keep', makeEval('slot_condition.keep'));
    slotConditionRegistry.register('pack-drop', makeEval('slot_condition.drop'));

    slotConditionRegistry.clearPack('pack-drop');

    expect(slotConditionRegistry.get('pack-keep', 'slot_condition.keep')).toBeDefined();
    expect(slotConditionRegistry.get('pack-drop', 'slot_condition.drop')).toBeUndefined();
  });

  it('clear removes all packs', () => {
    slotConditionRegistry.register('pack-1', makeEval('slot_condition.a'));
    slotConditionRegistry.register('pack-2', makeEval('slot_condition.b'));

    slotConditionRegistry.clear();

    expect(slotConditionRegistry.list('pack-1')).toEqual([]);
    expect(slotConditionRegistry.list('pack-2')).toEqual([]);
  });
});
