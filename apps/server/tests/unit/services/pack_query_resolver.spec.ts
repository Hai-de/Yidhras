import { describe, expect, it, vi } from 'vitest';

import { PackQueryHandlerRegistry } from '../../../src/app/services/action/pack_query_resolver.js';

describe('PackQueryHandlerRegistry', () => {
  const makeHandler = (key: string) => ({
    capability_key: key,
    resolve: vi.fn()
  });

  it('registers and retrieves a handler by capability key', () => {
    const registry = new PackQueryHandlerRegistry();
    const handler = makeHandler('test.capability');
    registry.register(handler);

    expect(registry.find('test.capability')).toBe(handler);
  });

  it('returns undefined for unknown capability key', () => {
    const registry = new PackQueryHandlerRegistry();
    expect(registry.find('unknown.key')).toBeUndefined();
  });

  it('overwrites a handler when registering with the same key', () => {
    const registry = new PackQueryHandlerRegistry();
    const first = makeHandler('duplicate.key');
    const second = makeHandler('duplicate.key');

    registry.register(first);
    registry.register(second);

    expect(registry.find('duplicate.key')).toBe(second);
  });

  it('lists all registered keys', () => {
    const registry = new PackQueryHandlerRegistry();
    registry.register(makeHandler('alpha'));
    registry.register(makeHandler('beta'));
    registry.register(makeHandler('gamma'));

    expect(registry.keys()).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('returns empty keys when no handlers are registered', () => {
    const registry = new PackQueryHandlerRegistry();
    expect(registry.keys()).toEqual([]);
  });

  it('keeps independent handler instances', () => {
    const registry = new PackQueryHandlerRegistry();
    const handlerA = makeHandler('key.a');
    const handlerB = makeHandler('key.b');

    registry.register(handlerA);
    registry.register(handlerB);

    expect(registry.find('key.a')).toBe(handlerA);
    expect(registry.find('key.b')).toBe(handlerB);
    expect(registry.find('key.a')).not.toBe(handlerB);
  });
});
