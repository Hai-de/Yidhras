import { describe, expect, it } from 'vitest';

import { extractSemanticType } from '../../../src/inference/helpers.js';

describe('extractSemanticType', () => {
  it('extracts semantic_type from valid JSON object with the field', () => {
    const result = extractSemanticType(
      JSON.stringify({ semantic_type: 'investigation_conducted', subject_entity_id: 'alice' })
    );
    expect(result).toBe('investigation_conducted');
  });

  it('returns null for JSON object without semantic_type field', () => {
    const result = extractSemanticType(
      JSON.stringify({ subject_entity_id: 'alice', location_id: 'lab' })
    );
    expect(result).toBeNull();
  });

  it('returns null when semantic_type is not a string', () => {
    expect(extractSemanticType(JSON.stringify({ semantic_type: 42 }))).toBeNull();
    expect(extractSemanticType(JSON.stringify({ semantic_type: true }))).toBeNull();
    expect(extractSemanticType(JSON.stringify({ semantic_type: null }))).toBeNull();
    expect(extractSemanticType(JSON.stringify({ semantic_type: ['a'] }))).toBeNull();
    expect(extractSemanticType(JSON.stringify({ semantic_type: {} }))).toBeNull();
  });

  it('returns null for JSON array', () => {
    expect(extractSemanticType(JSON.stringify([1, 2, 3]))).toBeNull();
  });

  it('returns null for JSON primitive (string, number, boolean)', () => {
    expect(extractSemanticType(JSON.stringify('hello'))).toBeNull();
    expect(extractSemanticType(JSON.stringify(42))).toBeNull();
    expect(extractSemanticType(JSON.stringify(true))).toBeNull();
  });

  it('returns null for null input', () => {
    expect(extractSemanticType(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractSemanticType('')).toBeNull();
    expect(extractSemanticType('   ')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(extractSemanticType('not json at all')).toBeNull();
    expect(extractSemanticType('{broken')).toBeNull();
  });

  it('extracts semantic_type when it is the only field', () => {
    const result = extractSemanticType(JSON.stringify({ semantic_type: 'event_observed' }));
    expect(result).toBe('event_observed');
  });

  it('returns null for empty JSON object', () => {
    const result = extractSemanticType(JSON.stringify({}));
    expect(result).toBeNull();
  });
});
