import { describe, expect, it } from 'vitest';

import {
  ensureNonEmptyId,
  parseInferenceJobListLimit,
  parseInferenceJobsFilters,
  parseInferenceJobStatuses,
  parseOptionalCreatedAtFilter,
  parseOptionalFilterId} from '../../../src/app/services/inference_workflow/parsers.js';

describe('inference_workflow/parsers', () => {
  describe('parseInferenceJobListLimit', () => {
    it('returns default when value is undefined', () => {
      expect(parseInferenceJobListLimit(undefined)).toBe(20);
    });

    it('returns clamped value within range', () => {
      expect(parseInferenceJobListLimit(50)).toBe(50);
      expect(parseInferenceJobListLimit(1)).toBe(1);
      expect(parseInferenceJobListLimit(100)).toBe(100);
    });

    it('clamps to max limit', () => {
      expect(parseInferenceJobListLimit(200)).toBe(100);
      expect(parseInferenceJobListLimit(1000)).toBe(100);
    });

    it('clamps to min limit', () => {
      expect(parseInferenceJobListLimit(0)).toBe(1);
      expect(parseInferenceJobListLimit(-5)).toBe(1);
    });

    it('truncates fractional values', () => {
      expect(parseInferenceJobListLimit(10.7)).toBe(10);
      expect(parseInferenceJobListLimit(1.1)).toBe(1);
    });

    it('returns default for non-finite values', () => {
      expect(parseInferenceJobListLimit(Infinity)).toBe(20);
      expect(parseInferenceJobListLimit(-Infinity)).toBe(20);
      expect(parseInferenceJobListLimit(NaN)).toBe(20);
    });
  });

  describe('parseOptionalFilterId', () => {
    it('returns null for undefined', () => {
      expect(parseOptionalFilterId(undefined)).toBeNull();
    });

    it('returns trimmed value for valid string', () => {
      expect(parseOptionalFilterId('  agent-1  ')).toBe('agent-1');
      expect(parseOptionalFilterId('id')).toBe('id');
    });

    it('returns null for empty string', () => {
      expect(parseOptionalFilterId('')).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      expect(parseOptionalFilterId('   ')).toBeNull();
    });
  });

  describe('parseOptionalCreatedAtFilter', () => {
    it('returns null for undefined', () => {
      expect(parseOptionalCreatedAtFilter(undefined, 'field')).toBeNull();
    });

    it('converts number to bigint', () => {
      expect(parseOptionalCreatedAtFilter(100, 'field')).toBe(100n);
      expect(parseOptionalCreatedAtFilter(0, 'field')).toBe(0n);
    });

    it('converts numeric string to bigint', () => {
      expect(parseOptionalCreatedAtFilter('123', 'field')).toBe(123n);
      expect(parseOptionalCreatedAtFilter('  456  ', 'field')).toBe(456n);
    });

    it('throws for negative number', () => {
      expect(() => parseOptionalCreatedAtFilter(-1, 'field')).toThrow('must be a non-negative safe integer');
    });

    it('throws for non-integer number', () => {
      expect(() => parseOptionalCreatedAtFilter(1.5, 'field')).toThrow('must be a non-negative safe integer');
    });

    it('throws for non-numeric string', () => {
      expect(() => parseOptionalCreatedAtFilter('abc', 'field')).toThrow('must be a non-negative integer string');
    });

    it('throws for mixed alphanumeric string', () => {
      expect(() => parseOptionalCreatedAtFilter('12abc', 'field')).toThrow();
    });
  });

  describe('parseInferenceJobStatuses', () => {
    it('returns null for undefined', () => {
      expect(parseInferenceJobStatuses(undefined)).toBeNull();
    });

    it('returns null for empty array', () => {
      expect(parseInferenceJobStatuses([])).toBeNull();
    });

    it('parses valid statuses', () => {
      const result = parseInferenceJobStatuses(['pending', 'running']);
      expect(result).toEqual(['pending', 'running']);
    });

    it('deduplicates statuses', () => {
      const result = parseInferenceJobStatuses(['pending', 'pending', 'running']);
      expect(result).toEqual(['pending', 'running']);
    });

    it('trims whitespace', () => {
      const result = parseInferenceJobStatuses(['  pending  ', '  completed  ']);
      expect(result).toEqual(['pending', 'completed']);
    });

    it('returns null when all items are empty after trim', () => {
      expect(parseInferenceJobStatuses(['', '  '])).toBeNull();
    });

    it('throws for invalid status', () => {
      expect(() => parseInferenceJobStatuses(['pending', 'unknown'])).toThrow();
    });
  });

  describe('ensureNonEmptyId', () => {
    it('returns trimmed string for valid input', () => {
      expect(ensureNonEmptyId('  my-id  ', 'field')).toBe('my-id');
    });

    it('throws for undefined', () => {
      expect(() => ensureNonEmptyId(undefined, 'field')).toThrow('field is required');
    });

    it('throws for empty string', () => {
      expect(() => ensureNonEmptyId('', 'field')).toThrow('field is required');
    });

    it('throws for whitespace-only string', () => {
      expect(() => ensureNonEmptyId('   ', 'field')).toThrow('field is required');
    });
  });

  describe('parseInferenceJobsFilters', () => {
    it('returns default filters for empty input', () => {
      const result = parseInferenceJobsFilters({});
      expect(result.status).toBeNull();
      expect(result.agent_id).toBeNull();
      expect(result.identity_id).toBeNull();
      expect(result.strategy).toBeNull();
      expect(result.job_type).toBeNull();
      expect(result.from_created_at).toBeNull();
      expect(result.to_created_at).toBeNull();
      expect(result.cursor).toBeNull();
      expect(result.limit).toBe(20);
      expect(result.has_error).toBeNull();
      expect(result.action_intent_id).toBeNull();
      expect(result.pack_ids).toBeNull();
    });

    it('parses filter fields', () => {
      const result = parseInferenceJobsFilters({
        status: ['pending'],
        agent_id: 'agent-1',
        limit: 50
      });
      expect(result.status).toEqual(['pending']);
      expect(result.agent_id).toBe('agent-1');
      expect(result.limit).toBe(50);
    });

    it('handles has_error boolean', () => {
      expect(parseInferenceJobsFilters({ has_error: true }).has_error).toBe(true);
      expect(parseInferenceJobsFilters({ has_error: false }).has_error).toBe(false);
      expect(parseInferenceJobsFilters({}).has_error).toBeNull();
    });

    it('parses pack_ids', () => {
      expect(parseInferenceJobsFilters({ pack_ids: ['p1', 'p2'] }).pack_ids).toEqual(['p1', 'p2']);
      expect(parseInferenceJobsFilters({ pack_ids: [] }).pack_ids).toBeNull();
      expect(parseInferenceJobsFilters({}).pack_ids).toBeNull();
    });

    it('throws when from > to', () => {
      expect(() => parseInferenceJobsFilters({
        from_created_at: 200,
        to_created_at: 100
      })).toThrow('from_created_at must be less than or equal to to_created_at');
    });
  });
});
