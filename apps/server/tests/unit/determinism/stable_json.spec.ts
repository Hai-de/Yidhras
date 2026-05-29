import { describe, expect, it } from 'vitest';

import { normalizeForStableJson, stableJsonStringify } from '../../../src/determinism/stable_json.js';

describe('stable_json', () => {
  describe('normalizeForStableJson', () => {
    it('normalizes null', () => {
      expect(normalizeForStableJson(null)).toBeNull();
    });

    it('normalizes undefined to null', () => {
      expect(normalizeForStableJson(undefined)).toBeNull();
    });

    it('normalizes booleans', () => {
      expect(normalizeForStableJson(true)).toBe(true);
      expect(normalizeForStableJson(false)).toBe(false);
    });

    it('normalizes strings', () => {
      expect(normalizeForStableJson('hello')).toBe('hello');
      expect(normalizeForStableJson('')).toBe('');
    });

    it('normalizes numbers', () => {
      expect(normalizeForStableJson(42)).toBe(42);
      expect(normalizeForStableJson(0)).toBe(0);
      expect(normalizeForStableJson(-1)).toBe(-1);
      expect(normalizeForStableJson(3.14)).toBe(3.14);
    });

    it('normalizes -0 to 0', () => {
      expect(normalizeForStableJson(-0)).toBe(0);
    });

    it('normalizes non-finite numbers to string', () => {
      expect(normalizeForStableJson(Infinity)).toBe('Infinity');
      expect(normalizeForStableJson(-Infinity)).toBe('-Infinity');
      expect(normalizeForStableJson(NaN)).toBe('NaN');
    });

    it('normalizes bigint to string', () => {
      expect(normalizeForStableJson(123n)).toBe('123');
      expect(normalizeForStableJson(BigInt(999))).toBe('999');
    });

    it('normalizes Date to ISO string', () => {
      const date = new Date('2025-01-15T10:30:00Z');
      expect(normalizeForStableJson(date)).toBe('2025-01-15T10:30:00.000Z');
    });

    it('normalizes arrays recursively', () => {
      const input = [1, 'two', null, true];
      expect(normalizeForStableJson(input)).toEqual([1, 'two', null, true]);
    });

    it('normalizes nested arrays', () => {
      const input = [[1, 2], [3, 4]];
      expect(normalizeForStableJson(input)).toEqual([[1, 2], [3, 4]]);
    });

    it('sorts object keys alphabetically', () => {
      const input = { z: 1, a: 2, m: 3 };
      const result = normalizeForStableJson(input) as Record<string, unknown>;
      expect(Object.keys(result)).toEqual(['a', 'm', 'z']);
    });

    it('normalizes nested objects with sorted keys', () => {
      const input = { b: { z: 1, a: 2 }, a: 1 };
      const result = normalizeForStableJson(input) as Record<string, unknown>;
      expect(Object.keys(result)).toEqual(['a', 'b']);
      const nested = result.b as Record<string, unknown>;
      expect(Object.keys(nested)).toEqual(['a', 'z']);
    });

    it('removes ignored keys', () => {
      const input = { keep: 'yes', remove: 'no', also_keep: 'yes' };
      const result = normalizeForStableJson(input, { ignoredKeys: ['remove'] }) as Record<string, unknown>;
      expect(result.keep).toBe('yes');
      expect(result.also_keep).toBe('yes');
      expect(result.remove).toBeUndefined();
    });

    it('removes ignored keys in nested objects', () => {
      const input = { nested: { keep: 1, ignore: 2 }, top_ignore: 3 };
      const result = normalizeForStableJson(input, { ignoredKeys: ['ignore', 'top_ignore'] }) as Record<string, unknown>;
      expect(result.top_ignore).toBeUndefined();
      const nested = result.nested as Record<string, unknown>;
      expect(nested.keep).toBe(1);
      expect(nested.ignore).toBeUndefined();
    });

    it('normalizes mixed nested structures', () => {
      const input = {
        arr: [{ z: 1, a: 2 }],
        num: 42,
        nested: { str: 'hello', bigint: 999n }
      };
      const result = normalizeForStableJson(input) as Record<string, unknown>;
      expect(Object.keys(result)).toEqual(['arr', 'nested', 'num']);
      const arr = result.arr as Array<Record<string, unknown>>;
      expect(Object.keys(arr[0])).toEqual(['a', 'z']);
    });

    it('marks unstable types with prefix', () => {
      const result = normalizeForStableJson(Symbol('test'));
      expect(result).toBe('[unstable:symbol]');
    });

    it('handles empty object', () => {
      expect(normalizeForStableJson({})).toEqual({});
    });

    it('handles empty array', () => {
      expect(normalizeForStableJson([])).toEqual([]);
    });
  });

  describe('stableJsonStringify', () => {
    it('produces deterministic JSON for same input', () => {
      const input = { z: 1, a: 2 };
      const json1 = stableJsonStringify(input);
      const json2 = stableJsonStringify(input);
      expect(json1).toBe(json2);
    });

    it('produces same output regardless of key order', () => {
      const json1 = stableJsonStringify({ z: 1, a: 2 });
      const json2 = stableJsonStringify({ a: 2, z: 1 });
      expect(json1).toBe(json2);
    });

    it('produces valid JSON', () => {
      const input = { a: 1, b: [2, 3], c: { d: 'hello' } };
      const json = stableJsonStringify(input);
      const parsed = JSON.parse(json);
      expect(parsed).toEqual({ a: 1, b: [2, 3], c: { d: 'hello' } });
    });

    it('respects ignored keys option', () => {
      const input = { keep: 'yes', ignore: 'no' };
      const json = stableJsonStringify(input, { ignoredKeys: ['ignore'] });
      const parsed = JSON.parse(json);
      expect(parsed.keep).toBe('yes');
      expect(parsed.ignore).toBeUndefined();
    });
  });
});
