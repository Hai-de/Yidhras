import { describe, expect, it } from 'vitest';

import { DynamicsCalculator } from '../../../src/dynamics/algorithms.js';

describe('DynamicsCalculator', () => {
  describe('calculate', () => {
    it('applies linear algorithm with default factor', () => {
      const result = DynamicsCalculator.calculate(1.0, 5.0, { type: 'linear', params: {} });
      expect(result).toBe(5.0);
    });

    it('applies linear algorithm with custom factor', () => {
      const result = DynamicsCalculator.calculate(1.0, 5.0, { type: 'linear', params: { factor: 2.0 } });
      expect(result).toBe(10.0);
    });

    it('applies exponential algorithm with default params', () => {
      const result = DynamicsCalculator.calculate(0, 1.0, { type: 'exponential', params: {} });
      // delta * base^currentSnr * scale = 1 * 2^0 * 1 = 1
      expect(result).toBe(1.0);
    });

    it('applies exponential algorithm with custom base', () => {
      const result = DynamicsCalculator.calculate(2, 1.0, { type: 'exponential', params: { base: 3.0, scale: 2.0 } });
      // delta * 3^2 * 2 = 1 * 9 * 2 = 18
      expect(result).toBe(18.0);
    });

    it('applies sigmoid algorithm', () => {
      // With default steepness=10 and midpoint=0.5, at currentSnr=0.5 sigmoid = 0.5
      const result = DynamicsCalculator.calculate(0.5, 10.0, { type: 'sigmoid', params: {} });
      // sigmoid(0) = 1/(1+exp(0)) = 0.5, so result = 10 * 0.5 = 5
      expect(result).toBeCloseTo(5.0, 10);
    });

    it('applies sigmoid with custom steepness', () => {
      // High steepness, at midpoint sigmoid should be ~0.5
      const result = DynamicsCalculator.calculate(0.5, 1.0, { type: 'sigmoid', params: { steepness: 20, midpoint: 0.5 } });
      expect(result).toBeCloseTo(0.5, 10);
    });

    it('applies clamped_linear algorithm', () => {
      const config = { type: 'clamped_linear' as const, params: { max_delta: 1.0, min_delta: -1.0 } };
      // Within bounds
      expect(DynamicsCalculator.calculate(1.0, 0.5, config)).toBe(0.5);
      // Above max
      expect(DynamicsCalculator.calculate(1.0, 5.0, config)).toBe(1.0);
      // Below min
      expect(DynamicsCalculator.calculate(1.0, -5.0, config)).toBe(-1.0);
    });

    it('applies clamped_linear with default bounds', () => {
      const config = { type: 'clamped_linear' as const, params: {} };
      expect(DynamicsCalculator.calculate(1.0, 0.5, config)).toBe(0.5);
      expect(DynamicsCalculator.calculate(1.0, 100, config)).toBe(1.0);
      expect(DynamicsCalculator.calculate(1.0, -100, config)).toBe(-1.0);
    });

    it('returns delta for unknown algorithm type', () => {
      const result = DynamicsCalculator.calculate(1.0, 7.0, { type: 'unknown' as any, params: {} });
      expect(result).toBe(7.0);
    });

    it('handles negative delta values', () => {
      const linear = DynamicsCalculator.calculate(1.0, -3.0, { type: 'linear', params: { factor: 2.0 } });
      expect(linear).toBe(-6.0);
    });

    it('handles zero delta', () => {
      const linear = DynamicsCalculator.calculate(1.0, 0, { type: 'linear', params: {} });
      expect(linear).toBe(0);
    });

    it('handles negative currentSnr in exponential', () => {
      const result = DynamicsCalculator.calculate(-1, 1.0, { type: 'exponential', params: { base: 2.0 } });
      // 2^(-1) = 0.5
      expect(result).toBeCloseTo(0.5, 10);
    });

    it('handles large currentSnr in sigmoid', () => {
      // sigmoid(x) approaches 1 as x increases
      const result = DynamicsCalculator.calculate(100, 10.0, { type: 'sigmoid', params: { steepness: 10, midpoint: 0.5 } });
      expect(result).toBeCloseTo(10.0, 5);
    });

    it('handles negative currentSnr in sigmoid', () => {
      // sigmoid(x) approaches 0 as x decreases
      const result = DynamicsCalculator.calculate(-100, 10.0, { type: 'sigmoid', params: { steepness: 10, midpoint: 0.5 } });
      expect(result).toBeCloseTo(0, 5);
    });
  });
});
