import { describe, expect, it } from 'vitest';

import { dataCleanerRegistry } from '../../src/plugins/extensions/data_cleaner_registry.js';

describe('DataCleanerRegistry', () => {
  it('registers and retrieves a cleaner', () => {
    const cleaner = {
      key: 'data_cleaner.test',
      version: '1.0.0',
      async clean(input: { text: string; options?: Record<string, unknown> }) {
        return { cleaned: input.text.trim() };
      }
    };

    dataCleanerRegistry.register(cleaner);
    expect(dataCleanerRegistry.get('data_cleaner.test')).toBe(cleaner);
  });

  it('returns undefined for unregistered key', () => {
    expect(dataCleanerRegistry.get('data_cleaner.nonexistent')).toBeUndefined();
  });

  it('lists all registered cleaners', () => {
    const count = dataCleanerRegistry.list().length;
    const cleaner = {
      key: 'data_cleaner.list_test',
      version: '1.0.0',
      async clean(input: { text: string; options?: Record<string, unknown> }) {
        return { cleaned: input.text };
      }
    };

    dataCleanerRegistry.register(cleaner);
    expect(dataCleanerRegistry.list().length).toBe(count + 1);
  });

  it('executes clean through registry', async () => {
    const cleaner = {
      key: 'data_cleaner.exec_test',
      version: '1.0.0',
      async clean(input: { text: string; options?: Record<string, unknown> }) {
        return { cleaned: input.text.toUpperCase(), metadata: { len: input.text.length } };
      }
    };

    dataCleanerRegistry.register(cleaner);
    const result = await dataCleanerRegistry.clean('data_cleaner.exec_test', { text: 'hello' });
    expect(result.cleaned).toBe('HELLO');
    expect(result.metadata).toEqual({ len: 5 });
  });

  it('throws when executing unregistered cleaner', async () => {
    await expect(
      dataCleanerRegistry.clean('data_cleaner.missing', { text: 'x' })
    ).rejects.toThrow('DataCleaner not found');
  });

  it('deduplicates by key — last registration wins', () => {
    const first = {
      key: 'data_cleaner.dedup',
      version: '1.0.0',
      async clean(_input: { text: string; options?: Record<string, unknown> }) {
        return { cleaned: 'first' };
      }
    };
    const second = {
      key: 'data_cleaner.dedup',
      version: '2.0.0',
      async clean(_input: { text: string; options?: Record<string, unknown> }) {
        return { cleaned: 'second' };
      }
    };

    dataCleanerRegistry.register(first);
    dataCleanerRegistry.register(second);
    expect(dataCleanerRegistry.get('data_cleaner.dedup')).toBe(second);
  });

  it('clears all registered cleaners', () => {
    dataCleanerRegistry.register({
      key: 'data_cleaner.clear_test',
      version: '1.0.0',
      async clean(input: { text: string; options?: Record<string, unknown> }) {
        return { cleaned: input.text };
      }
    });

    dataCleanerRegistry.clear();
    expect(dataCleanerRegistry.list().length).toBe(0);
  });

  it('listByPack returns only cleaners from the specified pack', () => {
    const cleanerA = { key: 'data_cleaner.pack_a', version: '1.0.0', async clean() { return { cleaned: 'a' }; } };
    const cleanerB = { key: 'data_cleaner.pack_b', version: '1.0.0', async clean() { return { cleaned: 'b' }; } };

    dataCleanerRegistry.register(cleanerA, { packId: 'pack-a', installationId: 'inst-a', pluginId: 'plugin-a' });
    dataCleanerRegistry.register(cleanerB, { packId: 'pack-b', installationId: 'inst-b', pluginId: 'plugin-b' });

    const packA = dataCleanerRegistry.listByPack('pack-a');
    expect(packA).toHaveLength(1);
    expect(packA[0]?.key).toBe('data_cleaner.pack_a');

    const packB = dataCleanerRegistry.listByPack('pack-b');
    expect(packB).toHaveLength(1);
    expect(packB[0]?.key).toBe('data_cleaner.pack_b');

    // Clean up
    dataCleanerRegistry.clearPack('pack-a');
    dataCleanerRegistry.clearPack('pack-b');
  });

  it('listByPack returns empty array for pack with no cleaners', () => {
    expect(dataCleanerRegistry.listByPack('nonexistent-pack')).toEqual([]);
  });

  it('clearPack removes only the specified pack, leaving other packs intact', () => {
    const cleanerA = { key: 'data_cleaner.cp_a', version: '1.0.0', async clean() { return { cleaned: 'a' }; } };
    const cleanerB = { key: 'data_cleaner.cp_b', version: '1.0.0', async clean() { return { cleaned: 'b' }; } };

    dataCleanerRegistry.register(cleanerA, { packId: 'pack-clear-a', installationId: 'inst-x', pluginId: 'plugin-x' });
    dataCleanerRegistry.register(cleanerB, { packId: 'pack-clear-b', installationId: 'inst-y', pluginId: 'plugin-y' });

    dataCleanerRegistry.clearPack('pack-clear-a');

    expect(dataCleanerRegistry.listByPack('pack-clear-a')).toEqual([]);
    expect(dataCleanerRegistry.listByPack('pack-clear-b')).toHaveLength(1);

    // Clean up remaining
    dataCleanerRegistry.clearPack('pack-clear-b');
  });
});
