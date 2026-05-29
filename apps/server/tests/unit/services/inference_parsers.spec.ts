import { describe, expect, it } from 'vitest';

import {
  ensureNonEmptyId,
  normalizeReplayInput,
  normalizeStoredRequestInput,
  parseInferenceJobListLimit,
  parseInferenceJobStatuses,
  parseInferenceJobsCursor,
  parseInferenceJobsFilters,
  parseOptionalCreatedAtFilter,
  parseOptionalFilterId
} from '../../../src/app/services/inference_workflow/parsers.js';

describe('inference_workflow parsers', () => {
  describe('parseInferenceJobListLimit', () => {
    it('returns default for undefined', () => {
      expect(parseInferenceJobListLimit(undefined)).toBe(20);
    });

    it('clamps to minimum of 1', () => {
      expect(parseInferenceJobListLimit(0)).toBe(1);
      expect(parseInferenceJobListLimit(-5)).toBe(1);
    });

    it('clamps to MAX limit', () => {
      expect(parseInferenceJobListLimit(99999)).toBeLessThanOrEqual(100);
    });

    it('truncates fractional values', () => {
      expect(parseInferenceJobListLimit(5.7)).toBe(5);
    });

    it('passes through valid values', () => {
      expect(parseInferenceJobListLimit(25)).toBe(25);
    });

    it('returns default for NaN', () => {
      expect(parseInferenceJobListLimit(Number.NaN)).toBe(20);
    });
  });

  describe('parseOptionalFilterId', () => {
    it('returns null for undefined', () => {
      expect(parseOptionalFilterId(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseOptionalFilterId('')).toBeNull();
    });

    it('returns null for whitespace only', () => {
      expect(parseOptionalFilterId('   ')).toBeNull();
    });

    it('trims and returns non-empty string', () => {
      expect(parseOptionalFilterId('  agent-1  ')).toBe('agent-1');
    });
  });

  describe('parseOptionalCreatedAtFilter', () => {
    it('returns null for undefined', () => {
      expect(parseOptionalCreatedAtFilter(undefined, 'test')).toBeNull();
    });

    it('converts valid number to BigInt', () => {
      expect(parseOptionalCreatedAtFilter(100, 'test')).toBe(100n);
    });

    it('throws for unsafe integer', () => {
      expect(() => parseOptionalCreatedAtFilter(Number.MAX_SAFE_INTEGER + 1, 'test')).toThrow();
    });

    it('throws for negative number', () => {
      expect(() => parseOptionalCreatedAtFilter(-1, 'test')).toThrow();
    });

    it('converts valid numeric string to BigInt', () => {
      expect(parseOptionalCreatedAtFilter('12345', 'test')).toBe(12345n);
    });

    it('throws for non-numeric string', () => {
      expect(() => parseOptionalCreatedAtFilter('abc', 'test')).toThrow();
    });

    it('throws for mixed string', () => {
      expect(() => parseOptionalCreatedAtFilter('12abc', 'test')).toThrow();
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
      const result = parseInferenceJobStatuses(['completed', 'failed']);
      expect(result).toEqual(['completed', 'failed']);
    });

    it('deduplicates statuses', () => {
      const result = parseInferenceJobStatuses(['completed', 'completed']);
      expect(result).toEqual(['completed']);
    });

    it('throws for invalid status', () => {
      expect(() => parseInferenceJobStatuses(['completed', 'invalid_status'])).toThrow();
    });

    it('returns null for array of empty strings', () => {
      expect(parseInferenceJobStatuses(['', '  '])).toBeNull();
    });
  });

  describe('parseInferenceJobsCursor', () => {
    it('returns null for undefined', () => {
      expect(parseInferenceJobsCursor(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseInferenceJobsCursor('')).toBeNull();
    });

    it('returns null for whitespace string', () => {
      expect(parseInferenceJobsCursor('  ')).toBeNull();
    });

    it('throws for invalid base64', () => {
      expect(() => parseInferenceJobsCursor('not-valid-base64!!!')).toThrow();
    });

    it('parses valid cursor', () => {
      const cursor = JSON.stringify({ created_at: '12345', id: 'job-1' });
      const encoded = Buffer.from(cursor).toString('base64url');
      const result = parseInferenceJobsCursor(encoded);
      expect(result).toEqual({ created_at: '12345', id: 'job-1' });
    });
  });

  describe('ensureNonEmptyId', () => {
    it('throws for undefined', () => {
      expect(() => ensureNonEmptyId(undefined, 'test')).toThrow();
    });

    it('throws for empty string', () => {
      expect(() => ensureNonEmptyId('', 'test')).toThrow();
    });

    it('throws for whitespace only', () => {
      expect(() => ensureNonEmptyId('  ', 'test')).toThrow();
    });

    it('returns trimmed value', () => {
      expect(ensureNonEmptyId('  id-1  ', 'test')).toBe('id-1');
    });
  });

  describe('normalizeStoredRequestInput', () => {
    it('normalizes valid input', () => {
      const input = { agent_id: 'agent-1', strategy: 'mock' };
      const result = normalizeStoredRequestInput(input);
      expect(result.agent_id).toBe('agent-1');
      expect(result.strategy).toBe('mock');
    });

    it('normalizes empty object', () => {
      const result = normalizeStoredRequestInput({});
      expect(result).toBeDefined();
    });

    it('throws for non-object input', () => {
      expect(() => normalizeStoredRequestInput('invalid')).toThrow();
      expect(() => normalizeStoredRequestInput(null)).toThrow();
      expect(() => normalizeStoredRequestInput(42)).toThrow();
    });

    it('handles full input with all fields', () => {
      const input = {
        agent_id: 'agent-1',
        identity_id: 'id-1',
        actor_entity_id: 'entity-1',
        strategy: 'mock',
        attributes: { key: 'value' },
        idempotency_key: 'idem-1',
        workflow_source: {
          source_workflow_run_id: 'run-1',
          source_workflow_step_id: 'step-1',
          source_step_attempt: 1
        }
      };
      const result = normalizeStoredRequestInput(input);
      expect(result.agent_id).toBe('agent-1');
      expect(result.workflow_source?.source_workflow_run_id).toBe('run-1');
    });
  });

  describe('normalizeReplayInput', () => {
    it('normalizes undefined to empty object', () => {
      const result = normalizeReplayInput(undefined);
      expect(result).toBeDefined();
    });

    it('normalizes valid replay input', () => {
      const result = normalizeReplayInput({
        reason: 'test replay',
        overrides: { strategy: 'mock', attributes: { key: 'value' } }
      });
      expect(result.reason).toBe('test replay');
      expect(result.overrides?.strategy).toBe('mock');
    });

    it('throws for invalid input', () => {
      expect(() => normalizeReplayInput({ overrides: { strategy: 'invalid' } } as any)).toThrow();
    });
  });

  describe('parseInferenceJobsFilters', () => {
    it('parses empty input with defaults', () => {
      const result = parseInferenceJobsFilters({});
      expect(result.status).toBeNull();
      expect(result.agent_id).toBeNull();
      expect(result.identity_id).toBeNull();
      expect(result.strategy).toBeNull();
      expect(result.job_type).toBeNull();
      expect(result.from_created_at).toBeNull();
      expect(result.to_created_at).toBeNull();
      expect(result.cursor).toBeNull();
      expect(result.has_error).toBeNull();
      expect(result.action_intent_id).toBeNull();
      expect(result.pack_ids).toBeNull();
    });

    it('parses full filter input', () => {
      const result = parseInferenceJobsFilters({
        status: ['completed'],
        agent_id: 'agent-1',
        identity_id: 'id-1',
        strategy: 'mock',
        job_type: 'inference',
        from_created_at: '100',
        to_created_at: '200',
        limit: 50,
        has_error: true,
        action_intent_id: 'intent-1',
        pack_ids: ['pack-1']
      });
      expect(result.status).toEqual(['completed']);
      expect(result.agent_id).toBe('agent-1');
      expect(result.from_created_at).toBe(100n);
      expect(result.to_created_at).toBe(200n);
      expect(result.has_error).toBe(true);
      expect(result.pack_ids).toEqual(['pack-1']);
    });

    it('throws when from > to', () => {
      expect(() => parseInferenceJobsFilters({
        from_created_at: '200',
        to_created_at: '100'
      })).toThrow();
    });
  });
});
