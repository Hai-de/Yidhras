import { describe, expect, it } from 'vitest';

import { cosineSimilarity } from '../../../src/memory/vector/vector_store.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = [0.3, 0.5, 0.8, 0.1];
    const result = cosineSimilarity(v, v);
    expect(result).toBeCloseTo(1.0, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    const result = cosineSimilarity(a, b);
    expect(result).toBeCloseTo(0, 5);
  });

  it('returns -1 for opposite vectors', () => {
    const a = [1, 2, 3];
    const b = [-1, -2, -3];
    const result = cosineSimilarity(a, b);
    expect(result).toBeCloseTo(-1, 5);
  });

  it('handles real embedding-like vectors', () => {
    const a = [0.1, 0.2, 0.3, 0.4, 0.5];
    const b = [0.15, 0.25, 0.35, 0.45, 0.55];
    const result = cosineSimilarity(a, b);
    expect(result).toBeGreaterThan(0.99);
  });

  it('handles vectors with varying similarity', () => {
    const query = [0.8, 0.6, 0.1, 0.3];
    const near = [0.7, 0.65, 0.15, 0.25];
    const far = [0.1, 0.2, 0.9, 0.7];

    const nearSim = cosineSimilarity(query, near);
    const farSim = cosineSimilarity(query, far);

    expect(nearSim).toBeGreaterThan(farSim);
    expect(nearSim).toBeGreaterThan(0.9);
    expect(farSim).toBeLessThan(0.5);
  });

  it('returns 0 for zero vector', () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    const result = cosineSimilarity(a, b);
    expect(result).toBe(0);
  });
});
