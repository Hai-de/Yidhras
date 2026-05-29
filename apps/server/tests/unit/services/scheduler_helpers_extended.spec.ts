import { describe, expect, it, vi } from 'vitest';

import {
  encodeSchedulerCursor,
  parseSchedulerCursor,
  parseOptionalTickFilter,
  parseLimit,
  parseOptionalIdFilter,
  parseOptionalKind,
  parseOptionalReason,
  parseOptionalSkipReason,
  parseRunFilters,
  parseDecisionFilters,
  parseOwnershipAssignmentFilters,
  parseOwnershipMigrationFilters,
  parseWorkerFilters,
  parseRebalanceRecommendationFilters,
  parseSummaryJson,
  buildRunCursorWhere,
  buildDecisionCursorWhere,
  toRunReadModel,
  toCandidateDecisionReadModel,
  toOwnershipMigrationReadModel,
  toWorkerRuntimeReadModel,
  toRebalanceRecommendationReadModel,
  buildRunCrossLinkSummary,
  buildSchedulerOwnershipSummary,
  getFilteredPackIds,
  SCHEDULER_KINDS,
  SCHEDULER_REASONS,
  SCHEDULER_SKIP_REASONS,
  SCHEDULER_QUERY_INVALID
} from '../../../src/app/services/scheduler/helpers.js';

// Mock runtime_config to provide default config values
vi.mock('../../../src/config/runtime_config.js', () => ({
  getSchedulerObservabilityConfig: () => ({
    default_query_limit: 20,
    max_query_limit: 100,
    default_observation_sample_runs: 50,
    max_observation_sample_runs: 200
  })
}));

describe('scheduler helpers', () => {
  describe('encodeSchedulerCursor / parseSchedulerCursor', () => {
    it('round-trips a cursor', () => {
      const cursor = { created_at: '1000', id: 'run-1' };
      const encoded = encodeSchedulerCursor(cursor);
      const parsed = parseSchedulerCursor(encoded);
      expect(parsed).toEqual(cursor);
    });

    it('returns null for undefined cursor', () => {
      expect(parseSchedulerCursor(undefined)).toBeNull();
    });

    it('returns null for empty string cursor', () => {
      expect(parseSchedulerCursor('')).toBeNull();
    });

    it('throws on invalid base64 cursor', () => {
      expect(() => parseSchedulerCursor('not-valid-base64!!!')).toThrow();
    });

    it('throws on cursor with missing fields', () => {
      const bad = Buffer.from(JSON.stringify({ created_at: '1000' }), 'utf8').toString('base64url');
      expect(() => parseSchedulerCursor(bad)).toThrow();
    });
  });

  describe('parseOptionalTickFilter', () => {
    it('returns null for undefined', () => {
      expect(parseOptionalTickFilter(undefined, 'from_tick')).toBeNull();
    });

    it('parses number value', () => {
      expect(parseOptionalTickFilter(100, 'from_tick')).toBe(100n);
    });

    it('parses string value', () => {
      expect(parseOptionalTickFilter('200', 'to_tick')).toBe(200n);
    });

    it('throws on negative number', () => {
      expect(() => parseOptionalTickFilter(-1, 'from_tick')).toThrow();
    });

    it('throws on non-integer string', () => {
      expect(() => parseOptionalTickFilter('abc', 'from_tick')).toThrow();
    });

    it('throws on float number', () => {
      expect(() => parseOptionalTickFilter(1.5, 'from_tick')).toThrow();
    });
  });

  describe('parseLimit', () => {
    it('returns default for undefined', () => {
      expect(parseLimit(undefined)).toBe(20);
    });

    it('parses valid number', () => {
      expect(parseLimit(10)).toBe(10);
    });

    it('caps at max_query_limit', () => {
      expect(parseLimit(200)).toBe(100);
    });

    it('parses valid string', () => {
      expect(parseLimit('50')).toBe(50);
    });

    it('throws on zero', () => {
      expect(() => parseLimit(0)).toThrow();
    });

    it('throws on negative', () => {
      expect(() => parseLimit(-1)).toThrow();
    });

    it('throws on non-numeric string', () => {
      expect(() => parseLimit('abc')).toThrow();
    });
  });

  describe('parseOptionalIdFilter', () => {
    it('returns null for undefined', () => {
      expect(parseOptionalIdFilter(undefined, 'worker_id')).toBeNull();
    });

    it('returns trimmed string', () => {
      expect(parseOptionalIdFilter('  worker-1  ', 'worker_id')).toBe('worker-1');
    });

    it('throws on empty string', () => {
      expect(() => parseOptionalIdFilter('  ', 'worker_id')).toThrow();
    });
  });

  describe('parseOptionalKind', () => {
    it('returns null for undefined', () => {
      expect(parseOptionalKind(undefined)).toBeNull();
    });

    it('accepts valid kinds', () => {
      for (const kind of SCHEDULER_KINDS) {
        expect(parseOptionalKind(kind)).toBe(kind);
      }
    });

    it('throws on invalid kind', () => {
      expect(() => parseOptionalKind('invalid')).toThrow();
    });
  });

  describe('parseOptionalReason', () => {
    it('returns null for undefined', () => {
      expect(parseOptionalReason(undefined)).toBeNull();
    });

    it('accepts valid reasons', () => {
      for (const reason of SCHEDULER_REASONS) {
        expect(parseOptionalReason(reason)).toBe(reason);
      }
    });

    it('throws on invalid reason', () => {
      expect(() => parseOptionalReason('invalid')).toThrow();
    });
  });

  describe('parseOptionalSkipReason', () => {
    it('returns null for undefined', () => {
      expect(parseOptionalSkipReason(undefined)).toBeNull();
    });

    it('accepts valid skip reasons', () => {
      for (const reason of SCHEDULER_SKIP_REASONS) {
        expect(parseOptionalSkipReason(reason)).toBe(reason);
      }
    });

    it('throws on invalid skip reason', () => {
      expect(() => parseOptionalSkipReason('invalid')).toThrow();
    });
  });

  describe('parseRunFilters', () => {
    it('returns default filters for empty input', () => {
      const result = parseRunFilters({});
      expect(result.limit).toBe(20);
      expect(result.from_tick).toBeNull();
      expect(result.to_tick).toBeNull();
      expect(result.cursor).toBeNull();
    });

    it('applies tick filters', () => {
      const result = parseRunFilters({ from_tick: '100', to_tick: '200' });
      expect(result.from_tick).toBe(100n);
      expect(result.to_tick).toBe(200n);
    });
  });

  describe('parseDecisionFilters', () => {
    it('returns default filters for empty input', () => {
      const result = parseDecisionFilters({});
      expect(result.limit).toBe(20);
      expect(result.from_tick).toBeNull();
      expect(result.to_tick).toBeNull();
      expect(result.kind).toBeNull();
      expect(result.reason).toBeNull();
      expect(result.skipped_reason).toBeNull();
    });

    it('applies kind and reason filters', () => {
      const result = parseDecisionFilters({ kind: 'periodic', reason: 'periodic_tick' });
      expect(result.kind).toBe('periodic');
      expect(result.reason).toBe('periodic_tick');
    });
  });

  describe('parseOwnershipAssignmentFilters', () => {
    it('returns default filters', () => {
      const result = parseOwnershipAssignmentFilters({});
      expect(result.worker_id).toBeNull();
      expect(result.partition_id).toBeNull();
      expect(result.status).toBeNull();
    });
  });

  describe('parseOwnershipMigrationFilters', () => {
    it('returns default filters', () => {
      const result = parseOwnershipMigrationFilters({});
      expect(result.limit).toBe(20);
      expect(result.worker_id).toBeNull();
    });
  });

  describe('parseWorkerFilters', () => {
    it('returns default filters', () => {
      const result = parseWorkerFilters({});
      expect(result.worker_id).toBeNull();
      expect(result.status).toBeNull();
    });
  });

  describe('parseRebalanceRecommendationFilters', () => {
    it('returns default filters', () => {
      const result = parseRebalanceRecommendationFilters({});
      expect(result.limit).toBe(20);
      expect(result.worker_id).toBeNull();
    });
  });

  describe('parseSummaryJson', () => {
    it('parses valid JSON string', () => {
      const result = parseSummaryJson('{"key":"value"}');
      expect(result).toEqual({ key: 'value' });
    });

    it('returns empty object for invalid JSON', () => {
      const result = parseSummaryJson('not-json');
      expect(result).toEqual({});
    });

    it('handles null string', () => {
      const result = parseSummaryJson('null');
      expect(result).toBeNull();
    });
  });

  describe('buildRunCursorWhere', () => {
    it('returns always-true predicate for null cursor', () => {
      const pred = buildRunCursorWhere(null);
      expect(pred({ id: 'any', created_at: 0 } as never)).toBe(true);
    });

    it('filters runs after cursor', () => {
      const pred = buildRunCursorWhere({ created_at: '1000', id: 'run-1' });
      // Run before cursor should pass
      expect(pred({ id: 'run-0', created_at: 500 } as never)).toBe(true);
      // Run after cursor should not pass
      expect(pred({ id: 'run-2', created_at: 2000 } as never)).toBe(false);
    });
  });

  describe('buildDecisionCursorWhere', () => {
    it('returns always-true predicate for null cursor', () => {
      const pred = buildDecisionCursorWhere(null);
      expect(pred({ id: 'any', created_at: 0 } as never)).toBe(true);
    });

    it('builds cursor predicate', () => {
      const pred = buildDecisionCursorWhere({ created_at: '1000', id: 'dec-1' });
      expect(pred({ id: 'dec-0', created_at: 500 } as never)).toBe(true);
      expect(pred({ id: 'dec-2', created_at: 2000 } as never)).toBe(false);
    });
  });

  describe('toRunReadModel', () => {
    it('converts raw row to read model', () => {
      const raw = {
        id: 'run-1',
        worker_id: 'w-1',
        partition_id: 'p-0',
        lease_holder: null,
        tick: 1000n,
        lease_expires_at_snapshot: 2000n,
        started_at: 1000n,
        finished_at: 2000n,
        summary: null,
        created_at: 900n
      };

      const result = toRunReadModel(raw);
      expect(result.id).toBe('run-1');
      expect(result.worker_id).toBe('w-1');
      expect(result.partition_id).toBe('p-0');
      expect(result.created_at).toBe('900');
    });
  });

  describe('toCandidateDecisionReadModel', () => {
    it('converts raw row to read model', () => {
      const raw = {
        id: 'dec-1',
        scheduler_run_id: 'run-1',
        partition_id: 'p-0',
        actor_id: 'agent-1',
        kind: 'periodic',
        candidate_reasons: ['periodic_tick'],
        chosen_reason: 'periodic_tick',
        scheduled_for_tick: 1000n,
        priority_score: 0.5,
        skipped_reason: null,
        created_job_id: null,
        workflow_link: null,
        created_at: 900n
      };

      const result = toCandidateDecisionReadModel(raw);
      expect(result.id).toBe('dec-1');
      expect(result.kind).toBe('periodic');
      expect(result.created_at).toBe('900');
    });
  });

  describe('toOwnershipMigrationReadModel', () => {
    it('converts raw row to read model', () => {
      const raw = {
        id: 'mig-1',
        partition_id: 'p-0',
        from_worker_id: 'w-1',
        to_worker_id: 'w-2',
        status: 'completed',
        reason: 'rebalance',
        details: null,
        created_at: 1000n,
        updated_at: 1000n,
        completed_at: 2000n
      };

      const result = toOwnershipMigrationReadModel(raw);
      expect(result.id).toBe('mig-1');
      expect(result.status).toBe('completed');
    });
  });

  describe('toWorkerRuntimeReadModel', () => {
    it('converts raw row to read model', () => {
      const raw = {
        worker_id: 'w-1',
        status: 'active',
        last_heartbeat_at: 1000n,
        owned_partition_count: 3,
        active_migration_count: 0,
        capacity_hint: 10,
        updated_at: 1000n
      };

      const result = toWorkerRuntimeReadModel(raw);
      expect(result.worker_id).toBe('w-1');
      expect(result.status).toBe('active');
    });
  });

  describe('toRebalanceRecommendationReadModel', () => {
    it('converts raw row to read model', () => {
      const raw = {
        id: 'rec-1',
        partition_id: 'p-0',
        from_worker_id: 'w-1',
        to_worker_id: 'w-2',
        status: 'pending',
        reason: 'load_balance',
        score: 0.8,
        suppress_reason: null,
        details: null,
        applied_migration_id: null,
        created_at: 1000n,
        updated_at: 1000n
      };

      const result = toRebalanceRecommendationReadModel(raw);
      expect(result.id).toBe('rec-1');
      expect(result.status).toBe('pending');
    });
  });

  describe('buildRunCrossLinkSummary', () => {
    it('returns null for empty input', () => {
      const result = buildRunCrossLinkSummary([]);
      expect(result).toBeNull();
    });
  });

  describe('buildSchedulerOwnershipSummary', () => {
    it('returns empty summary for empty input', () => {
      const result = buildSchedulerOwnershipSummary([]);
      expect(result.returned).toBe(0);
      expect(result.assigned_count).toBe(0);
      expect(result.top_workers).toEqual([]);
    });
  });

  describe('getFilteredPackIds', () => {
    it('returns all pack ids when no filter', () => {
      const ctx = { schedulerStorage: { listOpenPackIds: () => ['pack-a', 'pack-b'] } } as never;
      const result = getFilteredPackIds(ctx);
      expect(result).toEqual(['pack-a', 'pack-b']);
    });

    it('returns empty when no schedulerStorage', () => {
      const ctx = {} as never;
      const result = getFilteredPackIds(ctx);
      expect(result).toEqual([]);
    });

    it('filters by pack id', () => {
      const ctx = { schedulerStorage: { listOpenPackIds: () => ['pack-a', 'pack-b'] } } as never;
      const result = getFilteredPackIds(ctx, 'pack-a');
      expect(result).toEqual(['pack-a']);
    });
  });
});
