import { describe, expect, it } from 'vitest';

import {
  buildRunCursorWhere,
  encodeSchedulerCursor,
  parseDecisionFilters,
  parseLimit,
  parseOptionalIdFilter,
  parseOptionalKind,
  parseOptionalReason,
  parseOptionalSkipReason,
  parseOptionalTickFilter,
  parseOwnershipAssignmentFilters,
  parseOwnershipMigrationFilters,
  parseRebalanceRecommendationFilters,
  parseRunFilters,
  parseSchedulerCursor,
  parseSummaryJson,
  parseWorkerFilters
} from '../../../src/app/services/scheduler/helpers.js';

describe('scheduler helpers', () => {
  describe('encodeSchedulerCursor / parseSchedulerCursor', () => {
    it('roundtrips a cursor', () => {
      const cursor = { created_at: '1000', id: 'run-1' };
      const encoded = encodeSchedulerCursor(cursor);
      const decoded = parseSchedulerCursor(encoded);
      expect(decoded).toEqual(cursor);
    });

    it('returns null for undefined input', () => {
      expect(parseSchedulerCursor(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseSchedulerCursor('')).toBeNull();
    });

    it('throws for invalid base64', () => {
      expect(() => parseSchedulerCursor('not-valid-base64!!!')).toThrow();
    });

    it('throws for invalid cursor payload', () => {
      const encoded = Buffer.from(JSON.stringify({ bad: 'payload' })).toString('base64url');
      expect(() => parseSchedulerCursor(encoded)).toThrow();
    });

    it('throws for non-numeric created_at', () => {
      const encoded = Buffer.from(JSON.stringify({ created_at: 'abc', id: 'run-1' })).toString('base64url');
      expect(() => parseSchedulerCursor(encoded)).toThrow();
    });
  });

  describe('parseOptionalTickFilter', () => {
    it('returns null for undefined', () => {
      expect(parseOptionalTickFilter(undefined, 'from_tick')).toBeNull();
    });

    it('parses numeric value', () => {
      expect(parseOptionalTickFilter(100, 'from_tick')).toBe(100n);
    });

    it('parses string value', () => {
      expect(parseOptionalTickFilter('200', 'from_tick')).toBe(200n);
    });

    it('throws for negative number', () => {
      expect(() => parseOptionalTickFilter(-1, 'from_tick')).toThrow();
    });

    it('throws for non-integer string', () => {
      expect(() => parseOptionalTickFilter('abc', 'from_tick')).toThrow();
    });

    it('throws for non-safe integer', () => {
      expect(() => parseOptionalTickFilter(Number.MAX_SAFE_INTEGER + 1, 'from_tick')).toThrow();
    });
  });

  describe('parseLimit', () => {
    it('returns default for undefined', () => {
      const result = parseLimit(undefined);
      expect(result).toBeGreaterThan(0);
    });

    it('clamps to max limit', () => {
      const result = parseLimit(9999);
      expect(result).toBeLessThanOrEqual(200);
    });

    it('throws for zero', () => {
      expect(() => parseLimit(0)).toThrow();
    });

    it('throws for negative', () => {
      expect(() => parseLimit(-1)).toThrow();
    });

    it('parses string limit', () => {
      const result = parseLimit('50');
      expect(result).toBe(50);
    });

    it('throws for non-numeric string', () => {
      expect(() => parseLimit('abc')).toThrow();
    });
  });

  describe('parseOptionalIdFilter', () => {
    it('returns null for undefined', () => {
      expect(parseOptionalIdFilter(undefined, 'test')).toBeNull();
    });

    it('trims and returns non-empty string', () => {
      expect(parseOptionalIdFilter('  id-1  ', 'test')).toBe('id-1');
    });

    it('throws for empty string', () => {
      expect(() => parseOptionalIdFilter('', 'test')).toThrow();
    });

    it('throws for whitespace only', () => {
      expect(() => parseOptionalIdFilter('  ', 'test')).toThrow();
    });
  });

  describe('parseOptionalKind', () => {
    it('returns null for undefined', () => {
      expect(parseOptionalKind(undefined)).toBeNull();
    });

    it('parses valid kinds', () => {
      expect(parseOptionalKind('periodic')).toBe('periodic');
      expect(parseOptionalKind('event_driven')).toBe('event_driven');
    });

    it('throws for invalid kind', () => {
      expect(() => parseOptionalKind('invalid')).toThrow();
    });
  });

  describe('parseOptionalReason', () => {
    it('returns null for undefined', () => {
      expect(parseOptionalReason(undefined)).toBeNull();
    });

    it('parses valid reasons', () => {
      expect(parseOptionalReason('periodic_tick')).toBe('periodic_tick');
      expect(parseOptionalReason('bootstrap_seed')).toBe('bootstrap_seed');
    });

    it('throws for invalid reason', () => {
      expect(() => parseOptionalReason('invalid')).toThrow();
    });
  });

  describe('parseOptionalSkipReason', () => {
    it('returns null for undefined', () => {
      expect(parseOptionalSkipReason(undefined)).toBeNull();
    });

    it('parses valid skip reasons', () => {
      expect(parseOptionalSkipReason('pending_workflow')).toBe('pending_workflow');
    });

    it('throws for invalid skip reason', () => {
      expect(() => parseOptionalSkipReason('invalid')).toThrow();
    });
  });

  describe('parseRunFilters', () => {
    it('parses empty input', () => {
      const result = parseRunFilters({});
      expect(result.limit).toBeGreaterThan(0);
      expect(result.cursor).toBeNull();
      expect(result.from_tick).toBeNull();
      expect(result.to_tick).toBeNull();
    });

    it('throws when from_tick > to_tick', () => {
      expect(() => parseRunFilters({ from_tick: '200', to_tick: '100' })).toThrow();
    });
  });

  describe('parseDecisionFilters', () => {
    it('parses empty input', () => {
      const result = parseDecisionFilters({});
      expect(result.limit).toBeGreaterThan(0);
      expect(result.actor_id).toBeNull();
      expect(result.kind).toBeNull();
    });

    it('parses full input', () => {
      const result = parseDecisionFilters({
        limit: 10,
        actor_id: 'agent-1',
        kind: 'periodic',
        reason: 'periodic_tick'
      });
      expect(result.limit).toBe(10);
      expect(result.actor_id).toBe('agent-1');
      expect(result.kind).toBe('periodic');
      expect(result.reason).toBe('periodic_tick');
    });
  });

  describe('parseOwnershipAssignmentFilters', () => {
    it('parses empty input', () => {
      const result = parseOwnershipAssignmentFilters({});
      expect(result.worker_id).toBeNull();
      expect(result.partition_id).toBeNull();
    });
  });

  describe('parseOwnershipMigrationFilters', () => {
    it('parses empty input', () => {
      const result = parseOwnershipMigrationFilters({});
      expect(result.limit).toBeGreaterThan(0);
    });
  });

  describe('parseWorkerFilters', () => {
    it('parses empty input', () => {
      const result = parseWorkerFilters({});
      expect(result.worker_id).toBeNull();
      expect(result.status).toBeNull();
    });
  });

  describe('parseRebalanceRecommendationFilters', () => {
    it('parses empty input', () => {
      const result = parseRebalanceRecommendationFilters({});
      expect(result.limit).toBeGreaterThan(0);
    });
  });

  describe('parseSummaryJson', () => {
    it('parses valid JSON', () => {
      expect(parseSummaryJson('{"key":"value"}')).toEqual({ key: 'value' });
    });

    it('returns empty object for invalid JSON', () => {
      expect(parseSummaryJson('not json')).toEqual({});
    });
  });

  describe('buildRunCursorWhere', () => {
    it('returns always-true for null cursor', () => {
      const predicate = buildRunCursorWhere(null);
      expect(predicate({ created_at: 1000, id: 'run-1' } as any)).toBe(true);
    });

    it('filters runs before cursor position', () => {
      const predicate = buildRunCursorWhere({ created_at: '1000', id: 'run-1' });
      // run with earlier timestamp should pass
      expect(predicate({ created_at: 500, id: 'run-x' } as any)).toBe(true);
      // run with same timestamp but earlier id should pass
      expect(predicate({ created_at: 1000, id: 'aaa' } as any)).toBe(true);
      // run with later timestamp should not pass
      expect(predicate({ created_at: 2000, id: 'run-x' } as any)).toBe(false);
    });
  });
});
