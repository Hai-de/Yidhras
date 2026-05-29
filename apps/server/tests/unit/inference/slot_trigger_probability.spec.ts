import { describe, expect, it } from 'vitest';

import { computeTriggerProbabilitySample, evaluateTriggerProbability,fnv1a64 } from '../../../src/inference/slot_trigger_probability.js';

describe('slot_trigger_probability', () => {
  describe('fnv1a64', () => {
    it('returns a bigint', () => {
      const result = fnv1a64('test');
      expect(typeof result).toBe('bigint');
    });

    it('produces deterministic output', () => {
      const r1 = fnv1a64('hello');
      const r2 = fnv1a64('hello');
      expect(r1).toBe(r2);
    });

    it('produces different hashes for different inputs', () => {
      const r1 = fnv1a64('hello');
      const r2 = fnv1a64('world');
      expect(r1).not.toBe(r2);
    });

    it('produces non-zero hash for non-empty input', () => {
      const result = fnv1a64('test-string');
      expect(result).toBeGreaterThan(0n);
    });

    it('handles empty string', () => {
      const result = fnv1a64('');
      // FNV-1a offset basis for empty input
      expect(result).toBe(14695981039346656037n);
    });

    it('handles single character', () => {
      const result = fnv1a64('a');
      expect(typeof result).toBe('bigint');
      expect(result).not.toBe(fnv1a64('b'));
    });
  });

  describe('computeTriggerProbabilitySample', () => {
    it('returns a number in [0, 1)', () => {
      const result = computeTriggerProbabilitySample('slot-1', 100, 0);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(1);
    });

    it('is deterministic for same inputs', () => {
      const r1 = computeTriggerProbabilitySample('slot-1', 100, 0);
      const r2 = computeTriggerProbabilitySample('slot-1', 100, 0);
      expect(r1).toBe(r2);
    });

    it('produces different values for different slot ids', () => {
      const r1 = computeTriggerProbabilitySample('slot-1', 100, 0);
      const r2 = computeTriggerProbabilitySample('slot-2', 100, 0);
      expect(r1).not.toBe(r2);
    });

    it('produces different values for different ticks', () => {
      const r1 = computeTriggerProbabilitySample('slot-1', 100, 0);
      const r2 = computeTriggerProbabilitySample('slot-1', 200, 0);
      expect(r1).not.toBe(r2);
    });

    it('produces different values for different trigger counts', () => {
      const r1 = computeTriggerProbabilitySample('slot-1', 100, 0);
      const r2 = computeTriggerProbabilitySample('slot-1', 100, 5);
      expect(r1).not.toBe(r2);
    });
  });

  describe('evaluateTriggerProbability', () => {
    it('always returns true for probability >= 1.0', () => {
      expect(evaluateTriggerProbability(1.0, 'slot-1', 100, 0)).toBe(true);
      expect(evaluateTriggerProbability(1.5, 'slot-1', 100, 0)).toBe(true);
      expect(evaluateTriggerProbability(2.0, 'slot-1', 100, 0)).toBe(true);
    });

    it('always returns false for probability <= 0.0', () => {
      expect(evaluateTriggerProbability(0, 'slot-1', 100, 0)).toBe(false);
      expect(evaluateTriggerProbability(-0.5, 'slot-1', 100, 0)).toBe(false);
      expect(evaluateTriggerProbability(-1.0, 'slot-1', 100, 0)).toBe(false);
    });

    it('is deterministic for fractional probability', () => {
      const r1 = evaluateTriggerProbability(0.5, 'slot-1', 100, 0);
      const r2 = evaluateTriggerProbability(0.5, 'slot-1', 100, 0);
      expect(r1).toBe(r2);
    });

    it('returns boolean for fractional probability', () => {
      const result = evaluateTriggerProbability(0.5, 'slot-1', 100, 0);
      expect(typeof result).toBe('boolean');
    });

    it('triggers depend on sample vs probability', () => {
      // With probability 0.5, some should trigger and some shouldn't
      const results = Array.from({ length: 100 }, (_, i) =>
        evaluateTriggerProbability(0.5, 'slot-1', i, 0)
      );
      const trueCount = results.filter(Boolean).length;
      // With 100 samples and probability 0.5, we expect ~50 true results
      // Use a wide range to avoid flakiness
      expect(trueCount).toBeGreaterThan(10);
      expect(trueCount).toBeLessThan(90);
    });
  });
});
