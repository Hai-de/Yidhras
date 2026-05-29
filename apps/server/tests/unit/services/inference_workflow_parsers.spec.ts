import { describe, expect, it } from 'vitest';

import {
  parseInferenceJobListLimit,
  parseOptionalFilterId,
  parseOptionalCreatedAtFilter,
  parseInferenceJobStatuses,
  ensureNonEmptyId
} from '../../../src/app/services/inference_workflow/parsers.js';

describe('parseInferenceJobListLimit', () => {
  it('returns default limit when value is undefined', () => {
    expect(parseInferenceJobListLimit(undefined)).toBe(20);
  });

  it('returns default limit when value is not finite', () => {
    expect(parseInferenceJobListLimit(Infinity)).toBe(20);
    expect(parseInferenceJobListLimit(NaN)).toBe(20);
  });

  it('clamps to max limit', () => {
    expect(parseInferenceJobListLimit(1000)).toBe(100);
  });

  it('clamps to min limit', () => {
    expect(parseInferenceJobListLimit(0)).toBe(1);
    expect(parseInferenceJobListLimit(-5)).toBe(1);
  });

  it('truncates fractional values', () => {
    expect(parseInferenceJobListLimit(10.5)).toBe(10);
    expect(parseInferenceJobListLimit(10.9)).toBe(10);
  });

  it('returns requested limit when within bounds', () => {
    expect(parseInferenceJobListLimit(25)).toBe(25);
    expect(parseInferenceJobListLimit(1)).toBe(1);
    expect(parseInferenceJobListLimit(100)).toBe(100);
  });
});

describe('parseOptionalFilterId', () => {
  it('returns null for undefined', () => {
    expect(parseOptionalFilterId(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseOptionalFilterId('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(parseOptionalFilterId('   ')).toBeNull();
  });

  it('returns trimmed string for valid input', () => {
    expect(parseOptionalFilterId('  test-id  ')).toBe('test-id');
  });

  it('returns string as-is when already trimmed', () => {
    expect(parseOptionalFilterId('test-id')).toBe('test-id');
  });
});

describe('parseOptionalCreatedAtFilter', () => {
  it('returns null for undefined', () => {
    expect(parseOptionalCreatedAtFilter(undefined, 'field')).toBeNull();
  });

  it('converts valid number to BigInt', () => {
    expect(parseOptionalCreatedAtFilter(12345, 'field')).toBe(12345n);
  });

  it('converts zero to BigInt', () => {
    expect(parseOptionalCreatedAtFilter(0, 'field')).toBe(0n);
  });

  it('throws for negative number', () => {
    expect(() => parseOptionalCreatedAtFilter(-1, 'field')).toThrow(/non-negative safe integer/);
  });

  it('throws for non-integer number', () => {
    expect(() => parseOptionalCreatedAtFilter(1.5, 'field')).toThrow(/non-negative safe integer/);
  });

  it('throws for Infinity', () => {
    expect(() => parseOptionalCreatedAtFilter(Infinity, 'field')).toThrow(/non-negative safe integer/);
  });

  it('throws for NaN', () => {
    expect(() => parseOptionalCreatedAtFilter(NaN, 'field')).toThrow(/non-negative safe integer/);
  });

  it('converts valid numeric string to BigInt', () => {
    expect(parseOptionalCreatedAtFilter('12345', 'field')).toBe(12345n);
  });

  it('trims whitespace from string', () => {
    expect(parseOptionalCreatedAtFilter('  12345  ', 'field')).toBe(12345n);
  });

  it('throws for non-numeric string', () => {
    expect(() => parseOptionalCreatedAtFilter('abc', 'field')).toThrow(/non-negative integer string/);
  });

  it('throws for string with mixed content', () => {
    expect(() => parseOptionalCreatedAtFilter('12abc', 'field')).toThrow(/non-negative integer string/);
  });

  it('throws for negative string', () => {
    expect(() => parseOptionalCreatedAtFilter('-5', 'field')).toThrow(/non-negative integer string/);
  });
});

describe('parseInferenceJobStatuses', () => {
  it('returns null for undefined', () => {
    expect(parseInferenceJobStatuses(undefined)).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(parseInferenceJobStatuses([])).toBeNull();
  });

  it('returns null for array of empty strings', () => {
    expect(parseInferenceJobStatuses(['', '  '])).toBeNull();
  });

  it('accepts valid statuses', () => {
    const result = parseInferenceJobStatuses(['pending', 'running']);
    expect(result).toEqual(['pending', 'running']);
  });

  it('deduplicates statuses', () => {
    const result = parseInferenceJobStatuses(['pending', 'pending', 'running']);
    expect(result).toEqual(['pending', 'running']);
  });

  it('trims whitespace', () => {
    const result = parseInferenceJobStatuses(['  pending  ', ' running ']);
    expect(result).toEqual(['pending', 'running']);
  });

  it('throws for invalid status', () => {
    expect(() => parseInferenceJobStatuses(['pending', 'invalid_status'])).toThrow(/unsupported decision job status/);
  });
});

describe('ensureNonEmptyId', () => {
  it('returns trimmed string for valid input', () => {
    expect(ensureNonEmptyId('  test-id  ', 'field')).toBe('test-id');
  });

  it('throws for undefined', () => {
    expect(() => ensureNonEmptyId(undefined, 'field')).toThrow(/field is required/);
  });

  it('throws for empty string', () => {
    expect(() => ensureNonEmptyId('', 'field')).toThrow(/field is required/);
  });

  it('throws for whitespace-only string', () => {
    expect(() => ensureNonEmptyId('   ', 'field')).toThrow(/field is required/);
  });

  it('includes field name in error message', () => {
    expect(() => ensureNonEmptyId('', 'my_field')).toThrow(/my_field is required/);
  });
});
