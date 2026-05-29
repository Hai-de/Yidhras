import { describe, expect, it } from 'vitest';

import { buildJsonOkBody,toJsonSafe } from '../../../src/app/http/json.js';

describe('app/http/json', () => {
  describe('toJsonSafe', () => {
    it('converts bigint to string', () => {
      expect(toJsonSafe(123n)).toBe('123');
      expect(toJsonSafe(0n)).toBe('0');
      expect(toJsonSafe(BigInt(999))).toBe('999');
    });

    it('passes through null', () => {
      expect(toJsonSafe(null)).toBeNull();
    });

    it('passes through undefined', () => {
      expect(toJsonSafe(undefined)).toBeUndefined();
    });

    it('passes through strings', () => {
      expect(toJsonSafe('hello')).toBe('hello');
      expect(toJsonSafe('')).toBe('');
    });

    it('passes through numbers', () => {
      expect(toJsonSafe(42)).toBe(42);
      expect(toJsonSafe(0)).toBe(0);
      expect(toJsonSafe(-1.5)).toBe(-1.5);
    });

    it('passes through booleans', () => {
      expect(toJsonSafe(true)).toBe(true);
      expect(toJsonSafe(false)).toBe(false);
    });

    it('recursively converts bigint in arrays', () => {
      const result = toJsonSafe([1n, 2n, 'text']);
      expect(result).toEqual(['1', '2', 'text']);
    });

    it('recursively converts bigint in objects', () => {
      const result = toJsonSafe({ id: 100n, name: 'test' });
      expect(result).toEqual({ id: '100', name: 'test' });
    });

    it('recursively converts bigint in nested objects', () => {
      const result = toJsonSafe({
        outer: {
          inner: {
            deep_id: 42n
          }
        }
      });
      expect(result).toEqual({
        outer: {
          inner: {
            deep_id: '42'
          }
        }
      });
    });

    it('handles mixed types in arrays', () => {
      const result = toJsonSafe([1, 'text', true, null, 99n]);
      expect(result).toEqual([1, 'text', true, null, '99']);
    });

    it('handles empty object', () => {
      expect(toJsonSafe({})).toEqual({});
    });

    it('handles empty array', () => {
      expect(toJsonSafe([])).toEqual([]);
    });

    it('converts Date objects to plain object via recursive entries', () => {
      const date = new Date('2025-01-01T00:00:00Z');
      const result = toJsonSafe(date);
      // Date is typeof 'object', so toJsonSafe walks its entries via Object.entries
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });

  describe('buildJsonOkBody', () => {
    it('builds envelope with success and data', () => {
      const result = buildJsonOkBody({ id: 1, name: 'test' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 1, name: 'test' });
      expect(result.meta).toBeUndefined();
    });

    it('includes meta when provided', () => {
      const meta = { pagination: { has_next_page: true, next_cursor: 'abc' } };
      const result = buildJsonOkBody([], meta);
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
      expect(result.meta).toEqual(meta);
    });

    it('handles string data', () => {
      const result = buildJsonOkBody('hello');
      expect(result.success).toBe(true);
      expect(result.data).toBe('hello');
    });

    it('handles null data', () => {
      const result = buildJsonOkBody(null);
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it('includes schema_version meta', () => {
      const meta = { schema_version: 'graph' };
      const result = buildJsonOkBody({}, meta);
      expect(result.meta?.schema_version).toBe('graph');
    });

    it('includes warnings meta', () => {
      const meta = {
        warnings: [{ code: 'W1', message: 'warning 1' }]
      };
      const result = buildJsonOkBody({}, meta);
      expect(result.meta?.warnings).toHaveLength(1);
      expect(result.meta?.warnings?.[0].code).toBe('W1');
    });
  });
});
