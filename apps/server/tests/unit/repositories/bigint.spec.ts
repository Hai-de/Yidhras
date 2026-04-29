import { describe, expect, it } from 'vitest';

import {
  fromBigInt,
  fromNullableBigInt,
  toBigInt,
  toNullableBigInt
} from '../../../src/app/services/repositories/bigint.js';

describe('BigInt helpers', () => {
  describe('toBigInt', () => {
    it('converts bigint to bigint (identity)', () => {
      expect(toBigInt(42n)).toBe(42n);
    });

    it('converts number to bigint', () => {
      expect(toBigInt(42)).toBe(42n);
    });

    it('converts string to bigint', () => {
      expect(toBigInt('42')).toBe(42n);
    });

    it('handles zero', () => {
      expect(toBigInt(0)).toBe(0n);
      expect(toBigInt('0')).toBe(0n);
    });

    it('handles MAX_SAFE_INTEGER boundary', () => {
      const value = BigInt(Number.MAX_SAFE_INTEGER);
      expect(toBigInt(value)).toBe(value);
    });

    it('handles values beyond MAX_SAFE_INTEGER', () => {
      const huge = '9007199254740999';
      expect(toBigInt(huge)).toBe(9007199254740999n);
    });

    it('handles negative values', () => {
      expect(toBigInt(-1)).toBe(-1n);
      expect(toBigInt('-100')).toBe(-100n);
    });
  });

  describe('toNullableBigInt', () => {
    it('converts non-null value', () => {
      expect(toNullableBigInt(42)).toBe(42n);
    });

    it('returns null for null', () => {
      expect(toNullableBigInt(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(toNullableBigInt(undefined)).toBeNull();
    });
  });

  describe('fromBigInt', () => {
    it('converts bigint to string', () => {
      expect(fromBigInt(42n)).toBe('42');
    });

    it('handles zero', () => {
      expect(fromBigInt(0n)).toBe('0');
    });

    it('handles large values', () => {
      expect(fromBigInt(9007199254740999n)).toBe('9007199254740999');
    });
  });

  describe('fromNullableBigInt', () => {
    it('converts non-null bigint to string', () => {
      expect(fromNullableBigInt(42n)).toBe('42');
    });

    it('returns null for null', () => {
      expect(fromNullableBigInt(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(fromNullableBigInt(undefined)).toBeNull();
    });
  });

  describe('roundtrip', () => {
    it('bigint → string → bigint preserves value', () => {
      const original = 1234567890123456789n;
      const roundtripped = toBigInt(fromBigInt(original));
      expect(roundtripped).toBe(original);
    });

    it('number → bigint → string → bigint preserves value', () => {
      const original = 42;
      const roundtripped = toBigInt(fromBigInt(toBigInt(original)));
      expect(roundtripped).toBe(BigInt(original));
    });

    it('nullable roundtrip preserves null', () => {
      const result = toNullableBigInt(fromNullableBigInt(null));
      expect(result).toBeNull();
    });

    it('nullable roundtrip preserves value', () => {
      const original = 999n;
      const result = toNullableBigInt(fromNullableBigInt(original));
      expect(result).toBe(original);
    });
  });
});
