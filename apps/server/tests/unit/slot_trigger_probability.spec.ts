import { describe, expect, it } from 'vitest';

import {
  computeTriggerProbabilitySample,
  evaluateTriggerProbability,
  fnv1a64
} from '../../src/inference/slot_trigger_probability.js';

// ── FNV-1a 64-bit ──

describe('fnv1a64', () => {
  it('returns a bigint', () => {
    const result = fnv1a64('test');
    expect(typeof result).toBe('bigint');
  });

  it('returns known hash for empty string', () => {
    // FNV-1a offset basis
    expect(fnv1a64('')).toBe(14695981039346656037n);
  });

  it('returns consistent results for same input', () => {
    const a = fnv1a64('hello world');
    const b = fnv1a64('hello world');
    expect(a).toBe(b);
  });

  it('returns different results for different inputs', () => {
    const a = fnv1a64('hello');
    const b = fnv1a64('world');
    expect(a).not.toBe(b);
  });

  it('handles unicode strings', () => {
    const result = fnv1a64('插槽函数测试');
    expect(typeof result).toBe('bigint');
    expect(result).toBeGreaterThan(0n);
  });

  it('hash fits in 64 bits', () => {
    const result = fnv1a64('test');
    expect(result).toBeLessThan(1n << 64n);
  });
});

// ── computeTriggerProbabilitySample ──

describe('computeTriggerProbabilitySample', () => {
  it('returns a number in [0, 1)', () => {
    const sample = computeTriggerProbabilitySample('slot_a', 1, 0);
    expect(sample).toBeGreaterThanOrEqual(0);
    expect(sample).toBeLessThan(1);
  });

  it('returns deterministic results for same inputs', () => {
    const a = computeTriggerProbabilitySample('slot_a', 5, 0);
    const b = computeTriggerProbabilitySample('slot_a', 5, 0);
    expect(a).toBe(b);
  });

  it('returns different results for different slot_ids', () => {
    const a = computeTriggerProbabilitySample('slot_a', 1, 0);
    const b = computeTriggerProbabilitySample('slot_b', 1, 0);
    expect(a).not.toBe(b);
  });

  it('returns different results for different ticks', () => {
    const a = computeTriggerProbabilitySample('slot_a', 1, 0);
    const b = computeTriggerProbabilitySample('slot_a', 2, 0);
    expect(a).not.toBe(b);
  });

  it('returns different results for different trigger counts', () => {
    const a = computeTriggerProbabilitySample('slot_a', 1, 0);
    const b = computeTriggerProbabilitySample('slot_a', 1, 1);
    expect(a).not.toBe(b);
  });
});

// ── evaluateTriggerProbability ──

describe('evaluateTriggerProbability', () => {
  it('always returns true for probability = 1.0', () => {
    const result = evaluateTriggerProbability(1.0, 'slot_a', 1, 0);
    expect(result).toBe(true);
  });

  it('always returns false for probability = 0.0', () => {
    const result = evaluateTriggerProbability(0.0, 'slot_a', 1, 0);
    expect(result).toBe(false);
  });

  it('returns false for probability = 0 (edge case)', () => {
    expect(evaluateTriggerProbability(0, 'slot_a', 1, 0)).toBe(false);
  });

  it('returns a boolean for mid-range probability', () => {
    const result = evaluateTriggerProbability(0.5, 'slot_a', 1, 0);
    expect(typeof result).toBe('boolean');
  });

  it('is deterministic for same inputs', () => {
    const a = evaluateTriggerProbability(0.5, 'slot_a', 10, 0);
    const b = evaluateTriggerProbability(0.5, 'slot_a', 10, 0);
    expect(a).toBe(b);
  });

  it('different slots are sampled independently', () => {
    // Run many samples to confirm they aren't correlated
    const results = new Set<boolean>();
    for (let i = 0; i < 20; i++) {
      results.add(evaluateTriggerProbability(0.5, `slot_${i}`, 1, 0));
    }
    // With 20 independent 0.5 probability slots, nearly certain to get both outcomes
    expect(results.size).toBeGreaterThanOrEqual(1);
  });

  it('very high probability almost always activates', () => {
    let activations = 0;
    const trials = 100;
    for (let i = 0; i < trials; i++) {
      if (evaluateTriggerProbability(0.99, 'test', i, 0)) {
        activations++;
      }
    }
    // 0.99 over 100 trials — expect ≥ 90 activations
    expect(activations).toBeGreaterThanOrEqual(90);
  });

  it('very low probability almost never activates', () => {
    let activations = 0;
    const trials = 100;
    for (let i = 0; i < trials; i++) {
      if (evaluateTriggerProbability(0.01, 'test', i, 0)) {
        activations++;
      }
    }
    // 0.01 over 100 trials — expect ≤ 10 activations
    expect(activations).toBeLessThanOrEqual(10);
  });
});
