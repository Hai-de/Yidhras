import { describe, expect, it } from 'vitest';

import { boundaryCast, isRecord } from '../../src/utils/type_guards.js';

describe('isRecord', () => {
  it('returns true for plain objects', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1, b: 'two' })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isRecord(null)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2, 3])).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isRecord('string')).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });

  it('returns false for functions', () => {
    expect(isRecord(() => {})).toBe(false);
  });
});

describe('boundaryCast', () => {
  it('returns the same value reference (passthrough)', () => {
    const obj = { foo: 'bar' };
    const result = boundaryCast<{ foo: string }>(obj);
    expect(result).toBe(obj);
  });

  it('works with primitive values', () => {
    expect(boundaryCast<string>('hello')).toBe('hello');
    expect(boundaryCast<number>(42)).toBe(42);
  });

  it('works with null', () => {
    expect(boundaryCast<null>(null)).toBe(null);
  });
});
