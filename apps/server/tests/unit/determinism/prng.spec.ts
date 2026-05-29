import { describe, expect, it } from 'vitest';

import { createDeterministicRandom, createPRNG } from '../../../src/determinism/prng.js';

describe('prng', () => {
  describe('createDeterministicRandom', () => {
    it('returns deterministic random with expected methods', () => {
      const rng = createDeterministicRandom('test-seed');
      expect(typeof rng.next).toBe('function');
      expect(typeof rng.nextFloat).toBe('function');
      expect(typeof rng.nextInt).toBe('function');
      expect(typeof rng.nextBoolean).toBe('function');
      expect(typeof rng.nextId).toBe('function');
      expect(typeof rng.pick).toBe('function');
      expect(typeof rng.getSeed).toBe('function');
    });

    it('getSeed returns the seed string', () => {
      const rng = createDeterministicRandom('my-seed');
      expect(rng.getSeed()).toBe('my-seed');
    });

    it('getSeed returns <empty-seed> for empty string', () => {
      const rng = createDeterministicRandom('');
      expect(rng.getSeed()).toBe('<empty-seed>');
    });

    it('next returns values in [0, 1)', () => {
      const rng = createDeterministicRandom('test');
      for (let i = 0; i < 100; i++) {
        const v = rng.next();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });

    it('nextFloat returns values in [0, 1)', () => {
      const rng = createDeterministicRandom('test');
      for (let i = 0; i < 100; i++) {
        const v = rng.nextFloat();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });

    it('produces same sequence for same seed', () => {
      const rng1 = createDeterministicRandom('fixed-seed');
      const rng2 = createDeterministicRandom('fixed-seed');
      for (let i = 0; i < 50; i++) {
        expect(rng1.next()).toBe(rng2.next());
      }
    });

    it('produces different sequence for different seed', () => {
      const rng1 = createDeterministicRandom('seed-a');
      const rng2 = createDeterministicRandom('seed-b');
      const values1 = Array.from({ length: 10 }, () => rng1.next());
      const values2 = Array.from({ length: 10 }, () => rng2.next());
      // At least some values should differ
      const hasDiff = values1.some((v, i) => v !== values2[i]);
      expect(hasDiff).toBe(true);
    });

    describe('nextInt', () => {
      it('returns integer in range [min, max]', () => {
        const rng = createDeterministicRandom('test');
        for (let i = 0; i < 100; i++) {
          const v = rng.nextInt(5, 10);
          expect(v).toBeGreaterThanOrEqual(5);
          expect(v).toBeLessThanOrEqual(10);
          expect(Number.isInteger(v)).toBe(true);
        }
      });

      it('returns min when min equals max', () => {
        const rng = createDeterministicRandom('test');
        expect(rng.nextInt(7, 7)).toBe(7);
      });

      it('throws for non-integer min', () => {
        const rng = createDeterministicRandom('test');
        expect(() => rng.nextInt(1.5, 5)).toThrow('minInclusive must be an integer');
      });

      it('throws for non-integer max', () => {
        const rng = createDeterministicRandom('test');
        expect(() => rng.nextInt(1, 5.5)).toThrow('maxInclusive must be an integer');
      });

      it('throws when max < min', () => {
        const rng = createDeterministicRandom('test');
        expect(() => rng.nextInt(10, 5)).toThrow('maxInclusive must be greater than or equal to minInclusive');
      });
    });

    describe('nextBoolean', () => {
      it('returns boolean', () => {
        const rng = createDeterministicRandom('test');
        const v = rng.nextBoolean();
        expect(typeof v).toBe('boolean');
      });

      it('with probability 0 always returns false', () => {
        const rng = createDeterministicRandom('test');
        for (let i = 0; i < 20; i++) {
          expect(rng.nextBoolean(0)).toBe(false);
        }
      });

      it('with probability 1 always returns true', () => {
        const rng = createDeterministicRandom('test');
        for (let i = 0; i < 20; i++) {
          expect(rng.nextBoolean(1)).toBe(true);
        }
      });

      it('throws for probability < 0', () => {
        const rng = createDeterministicRandom('test');
        expect(() => rng.nextBoolean(-0.1)).toThrow('probability must be a finite number in [0, 1]');
      });

      it('throws for probability > 1', () => {
        const rng = createDeterministicRandom('test');
        expect(() => rng.nextBoolean(1.1)).toThrow('probability must be a finite number in [0, 1]');
      });

      it('throws for NaN probability', () => {
        const rng = createDeterministicRandom('test');
        expect(() => rng.nextBoolean(NaN)).toThrow('probability must be a finite number in [0, 1]');
      });
    });

    describe('nextId', () => {
      it('generates id with default prefix and bytes', () => {
        const rng = createDeterministicRandom('test');
        const id = rng.nextId();
        expect(id).toMatch(/^id_[0-9a-f]{16}$/);
      });

      it('generates id with custom prefix', () => {
        const rng = createDeterministicRandom('test');
        const id = rng.nextId('agent');
        expect(id).toMatch(/^agent_[0-9a-f]{16}$/);
      });

      it('generates id with custom bytes', () => {
        const rng = createDeterministicRandom('test');
        const id = rng.nextId('x', 4);
        expect(id).toMatch(/^x_[0-9a-f]{8}$/);
      });

      it('throws for non-integer bytes', () => {
        const rng = createDeterministicRandom('test');
        expect(() => rng.nextId('x', 1.5)).toThrow('bytes must be an integer');
      });

      it('throws for zero bytes', () => {
        const rng = createDeterministicRandom('test');
        expect(() => rng.nextId('x', 0)).toThrow('bytes must be positive');
      });

      it('throws for negative bytes', () => {
        const rng = createDeterministicRandom('test');
        expect(() => rng.nextId('x', -1)).toThrow('bytes must be positive');
      });

      it('produces same id for same seed', () => {
        const rng1 = createDeterministicRandom('fixed');
        const rng2 = createDeterministicRandom('fixed');
        expect(rng1.nextId()).toBe(rng2.nextId());
      });
    });

    describe('pick', () => {
      it('picks element from array', () => {
        const rng = createDeterministicRandom('test');
        const items = ['a', 'b', 'c', 'd', 'e'];
        const picked = rng.pick(items);
        expect(items).toContain(picked);
      });

      it('throws for empty array', () => {
        const rng = createDeterministicRandom('test');
        expect(() => rng.pick([])).toThrow('cannot pick from an empty array');
      });

      it('picks single element deterministically', () => {
        const rng = createDeterministicRandom('test');
        expect(rng.pick(['only'])).toBe('only');
      });

      it('produces same pick for same seed', () => {
        const items = ['a', 'b', 'c', 'd', 'e'];
        const rng1 = createDeterministicRandom('fixed');
        const rng2 = createDeterministicRandom('fixed');
        expect(rng1.pick(items)).toBe(rng2.pick(items));
      });
    });
  });

  describe('createPRNG', () => {
    it('returns a PRNG with next and getSeed', () => {
      const prng = createPRNG('seed');
      expect(typeof prng.next).toBe('function');
      expect(typeof prng.getSeed).toBe('function');
    });

    it('getSeed returns the seed', () => {
      const prng = createPRNG('my-seed');
      expect(prng.getSeed()).toBe('my-seed');
    });

    it('next returns values in [0, 1)', () => {
      const prng = createPRNG('test');
      const v = prng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    });
  });
});
