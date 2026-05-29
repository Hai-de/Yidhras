import { describe, expect, it } from 'vitest';

import { resolveConfigValues } from '../../../src/inference/context_config_resolver.js';

describe('context_config_resolver', () => {
  describe('resolveConfigValues', () => {
    it('returns empty object for undefined config', () => {
      expect(resolveConfigValues(undefined, {})).toEqual({});
    });

    it('passes through primitive values', () => {
      const result = resolveConfigValues(
        { str: 'hello', num: 42, bool: true, nil: null },
        {}
      );
      expect(result.str).toBe('hello');
      expect(result.num).toBe(42);
      expect(result.bool).toBe(true);
      expect(result.nil).toBeNull();
    });

    it('resolves template expressions from runtime objects', () => {
      const result = resolveConfigValues(
        { name: '{{actor.name}}' },
        { actor: { name: 'Alice' } }
      );
      expect(result.name).toBe('Alice');
    });

    it('resolves deeply nested paths', () => {
      const result = resolveConfigValues(
        { val: '{{a.b.c.d}}' },
        { a: { b: { c: { d: 'deep' } } } }
      );
      expect(result.val).toBe('deep');
    });

    it('returns null for unresolved template without fallback', () => {
      const result = resolveConfigValues(
        { missing: '{{nonexistent.path}}' },
        {}
      );
      expect(result.missing).toBeNull();
    });

    it('uses fallback when primary path is undefined', () => {
      const result = resolveConfigValues(
        { val: '{{missing ?? fallback_val}}' },
        { fallback_val: 'default' }
      );
      expect(result.val).toBe('default');
    });

    it('uses fallback literal when both paths are undefined', () => {
      const result = resolveConfigValues(
        { val: '{{missing ?? "literal default"}}' },
        {}
      );
      expect(result.val).toBe('"literal default"');
    });

    it('prefers primary path over fallback when defined', () => {
      const result = resolveConfigValues(
        { val: '{{existing ?? fallback_val}}' },
        { existing: 'primary', fallback_val: 'secondary' }
      );
      expect(result.val).toBe('primary');
    });

    it('resolves nested objects recursively', () => {
      const result = resolveConfigValues(
        { nested: { a: '{{x}}', b: '{{y}}' } },
        { x: 1, y: 2 }
      );
      expect(result.nested).toEqual({ a: 1, b: 2 });
    });

    it('resolves arrays recursively', () => {
      const result = resolveConfigValues(
        { arr: ['{{a}}', '{{b}}', 'literal'] },
        { a: 'first', b: 'second' }
      );
      expect(result.arr).toEqual(['first', 'second', 'literal']);
    });

    it('handles mixed types in arrays', () => {
      const result = resolveConfigValues(
        { arr: [1, 'text', true, null, '{{val}}'] },
        { val: 'resolved' }
      );
      expect(result.arr).toEqual([1, 'text', true, null, 'resolved']);
    });

    it('serializes non-resolvable values', () => {
      const sym = Symbol('test');
      const result = resolveConfigValues(
        { val: sym as unknown },
        {}
      );
      expect(typeof result.val).toBe('string');
    });

    it('serializes objects to JSON string when not template', () => {
      const result = resolveConfigValues(
        { val: { nested: true } as unknown },
        {}
      );
      expect(result.val).toEqual({ nested: true });
    });

    it('handles whitespace in template expressions', () => {
      const result = resolveConfigValues(
        { val: '{{  actor.name  }}' },
        { actor: { name: 'Bob' } }
      );
      expect(result.val).toBe('Bob');
    });

    it('handles empty config values', () => {
      const result = resolveConfigValues({}, {});
      expect(result).toEqual({});
    });

    it('resolves multiple templates in same config', () => {
      const result = resolveConfigValues(
        { a: '{{x}}', b: '{{y}}', c: 'literal' },
        { x: 'X', y: 'Y' }
      );
      expect(result.a).toBe('X');
      expect(result.b).toBe('Y');
      expect(result.c).toBe('literal');
    });
  });
});
