import { describe, expect, it } from 'vitest';

import type { SlotContentTransformer } from '../../src/plugins/extensions/slot_content_transformer.js';
import { slotContentTransformRegistry } from '../../src/plugins/extensions/slot_content_transformer.js';
import { expectDefined } from '../helpers/assertions.js';

function makeXfm(key: string, version = '1.0.0', append = '_xfm'): SlotContentTransformer {
  return {
    key,
    version,
    transform: async (content) => ({ transformed: content + append })
  };
}

const transformCtx = {
  slot_id: 'test',
  variables: {},
  conversation_meta: { turn_count: 0 },
  token_budget: { total: 8192, used: 0, remaining: 8192 },
  current_tick: 1,
  last_user_message: '',
  original_content: 'hello',
  activation_decision: { active: true }
};

describe('SlotContentTransformRegistry — per-pack isolation', () => {
  it('registers and retrieves transformer for a pack', () => {
    const xfm = makeXfm('slot_transform.test');
    slotContentTransformRegistry.register('pack-a', xfm);

    const retrieved = slotContentTransformRegistry.get('pack-a', 'slot_transform.test');
    expect(expectDefined(retrieved, 'slot content transformer').key).toBe('slot_transform.test');
  });

  it('allows same key in different packs', () => {
    slotContentTransformRegistry.register('pack-a', makeXfm('slot_transform.shared'));
    slotContentTransformRegistry.register('pack-b', makeXfm('slot_transform.shared'));

    expect(slotContentTransformRegistry.get('pack-a', 'slot_transform.shared')).toBeDefined();
    expect(slotContentTransformRegistry.get('pack-b', 'slot_transform.shared')).toBeDefined();
  });

  it('throws on same key + same pack with different version', () => {
    slotContentTransformRegistry.register('pack-x', makeXfm('slot_transform.dup', '1.0.0'));
    expect(() =>
      slotContentTransformRegistry.register('pack-x', makeXfm('slot_transform.dup', '2.0.0'))
    ).toThrow(/key conflict in pack 'pack-x'/);
  });

  it('silently skips same key + same pack + same version', () => {
    slotContentTransformRegistry.register('pack-x', makeXfm('slot_transform.same', '1.0.0'));
    expect(() =>
      slotContentTransformRegistry.register('pack-x', makeXfm('slot_transform.same', '1.0.0'))
    ).not.toThrow();
  });

  it('returns undefined for unknown pack or key', () => {
    expect(slotContentTransformRegistry.get('no-pack', 'any')).toBeUndefined();
    slotContentTransformRegistry.register('pack-a', makeXfm('slot_transform.a'));
    expect(slotContentTransformRegistry.get('pack-a', 'slot_transform.unknown')).toBeUndefined();
  });

  it('lists transformers for a pack', () => {
    slotContentTransformRegistry.register('pack-list', makeXfm('slot_transform.a'));
    slotContentTransformRegistry.register('pack-list', makeXfm('slot_transform.b'));
    expect(slotContentTransformRegistry.list('pack-list')).toHaveLength(2);
  });
});

describe('SlotContentTransformRegistry — transform shortcut', () => {
  it('transforms content via shortcut', async () => {
    slotContentTransformRegistry.register('pack-t', makeXfm('slot_transform.append', '1.0.0', '!'));
    const result = await slotContentTransformRegistry.transform(
      'pack-t',
      'slot_transform.append',
      'hello',
      transformCtx
    );
    expect(result.transformed).toBe('hello!');
  });

  it('returns original content when transformer not found', async () => {
    const result = await slotContentTransformRegistry.transform(
      'pack-t',
      'slot_transform.missing',
      'original',
      transformCtx
    );
    expect(result.transformed).toBe('original');
    expect(result.metadata?.error).toContain('not found');
  });
});

describe('SlotContentTransformRegistry — clear', () => {
  it('clearPack removes only the specified pack', () => {
    slotContentTransformRegistry.register('pack-keep', makeXfm('slot_transform.keep'));
    slotContentTransformRegistry.register('pack-drop', makeXfm('slot_transform.drop'));

    slotContentTransformRegistry.clearPack('pack-drop');

    expect(slotContentTransformRegistry.get('pack-keep', 'slot_transform.keep')).toBeDefined();
    expect(slotContentTransformRegistry.get('pack-drop', 'slot_transform.drop')).toBeUndefined();
  });
});
