import { describe, expect, it } from 'vitest';

import {
  isRecord,
  toRecord,
  toTickString,
  normalizeJobStatus,
  normalizeJobIntentClass,
  normalizeIntentStatus,
  buildPendingSourceKey,
  hasMaterializedInferenceTrace,
  resolveDecisionJobInferenceId,
  RUNNABLE_JOB_STATUSES,
  INFERENCE_JOB_STATUSES,
  ACTION_INTENT_STATUSES,
  DEFAULT_DECISION_JOB_LOCK_TICKS,
  DEFAULT_INFERENCE_JOB_LIST_LIMIT,
  MAX_INFERENCE_JOB_LIST_LIMIT
} from '../../../src/app/services/inference_workflow/types.js';

describe('inference_workflow/types', () => {
  describe('constants', () => {
    it('RUNNABLE_JOB_STATUSES contains expected statuses', () => {
      expect(RUNNABLE_JOB_STATUSES).toEqual(['pending', 'running']);
    });

    it('INFERENCE_JOB_STATUSES contains expected statuses', () => {
      expect(INFERENCE_JOB_STATUSES).toEqual(['pending', 'running', 'completed', 'failed']);
    });

    it('ACTION_INTENT_STATUSES contains expected statuses', () => {
      expect(ACTION_INTENT_STATUSES).toEqual(['pending', 'dispatching', 'completed', 'failed', 'dropped']);
    });

    it('DEFAULT_DECISION_JOB_LOCK_TICKS is 5n', () => {
      expect(DEFAULT_DECISION_JOB_LOCK_TICKS).toBe(5n);
    });

    it('DEFAULT_INFERENCE_JOB_LIST_LIMIT is 20', () => {
      expect(DEFAULT_INFERENCE_JOB_LIST_LIMIT).toBe(20);
    });

    it('MAX_INFERENCE_JOB_LIST_LIMIT is 100', () => {
      expect(MAX_INFERENCE_JOB_LIST_LIMIT).toBe(100);
    });
  });

  describe('isRecord', () => {
    it('returns true for plain objects', () => {
      expect(isRecord({})).toBe(true);
      expect(isRecord({ a: 1 })).toBe(true);
    });

    it('returns false for null', () => {
      expect(isRecord(null)).toBe(false);
    });

    it('returns false for arrays', () => {
      expect(isRecord([])).toBe(false);
      expect(isRecord([1, 2])).toBe(false);
    });

    it('returns false for primitives', () => {
      expect(isRecord(42)).toBe(false);
      expect(isRecord('str')).toBe(false);
      expect(isRecord(true)).toBe(false);
      expect(isRecord(undefined)).toBe(false);
    });
  });

  describe('toRecord', () => {
    it('returns the object when it is a record', () => {
      const obj = { a: 1 };
      expect(toRecord(obj)).toBe(obj);
    });

    it('returns empty object for non-record values', () => {
      expect(toRecord(null)).toEqual({});
      expect(toRecord(42)).toEqual({});
      expect(toRecord('str')).toEqual({});
      expect(toRecord([])).toEqual({});
      expect(toRecord(undefined)).toEqual({});
    });
  });

  describe('toTickString', () => {
    it('converts bigint to string', () => {
      expect(toTickString(100n)).toBe('100');
      expect(toTickString(0n)).toBe('0');
      expect(toTickString(999999999999n)).toBe('999999999999');
    });

    it('returns null for null', () => {
      expect(toTickString(null)).toBeNull();
    });
  });

  describe('normalizeJobStatus', () => {
    it('returns valid statuses as-is', () => {
      expect(normalizeJobStatus('pending')).toBe('pending');
      expect(normalizeJobStatus('running')).toBe('running');
      expect(normalizeJobStatus('completed')).toBe('completed');
      expect(normalizeJobStatus('failed')).toBe('failed');
    });

    it('returns failed for invalid status', () => {
      expect(normalizeJobStatus('unknown')).toBe('failed');
      expect(normalizeJobStatus('')).toBe('failed');
    });
  });

  describe('normalizeJobIntentClass', () => {
    it('returns valid intent classes as-is', () => {
      expect(normalizeJobIntentClass('direct_inference')).toBe('direct_inference');
      expect(normalizeJobIntentClass('scheduler_periodic')).toBe('scheduler_periodic');
      expect(normalizeJobIntentClass('scheduler_event_followup')).toBe('scheduler_event_followup');
      expect(normalizeJobIntentClass('replay_recovery')).toBe('replay_recovery');
      expect(normalizeJobIntentClass('retry_recovery')).toBe('retry_recovery');
      expect(normalizeJobIntentClass('operator_forced')).toBe('operator_forced');
    });

    it('returns direct_inference for invalid intent class', () => {
      expect(normalizeJobIntentClass('unknown')).toBe('direct_inference');
      expect(normalizeJobIntentClass('')).toBe('direct_inference');
    });
  });

  describe('normalizeIntentStatus', () => {
    it('returns valid statuses as-is', () => {
      expect(normalizeIntentStatus('pending')).toBe('pending');
      expect(normalizeIntentStatus('dispatching')).toBe('dispatching');
      expect(normalizeIntentStatus('completed')).toBe('completed');
      expect(normalizeIntentStatus('failed')).toBe('failed');
      expect(normalizeIntentStatus('dropped')).toBe('dropped');
    });

    it('returns failed for invalid status', () => {
      expect(normalizeIntentStatus('unknown')).toBe('failed');
      expect(normalizeIntentStatus('')).toBe('failed');
    });
  });

  describe('buildPendingSourceKey', () => {
    it('returns trimmed key for valid string', () => {
      expect(buildPendingSourceKey('my-key')).toBe('my-key');
      expect(buildPendingSourceKey('  key  ')).toBe('key');
    });

    it('returns null for null/undefined', () => {
      expect(buildPendingSourceKey(null)).toBeNull();
      expect(buildPendingSourceKey(undefined)).toBeNull();
    });

    it('returns null for empty or whitespace-only strings', () => {
      expect(buildPendingSourceKey('')).toBeNull();
      expect(buildPendingSourceKey('   ')).toBeNull();
    });
  });

  describe('hasMaterializedInferenceTrace', () => {
    it('returns true when source_inference_id exists and pending_source_key is null', () => {
      expect(hasMaterializedInferenceTrace({
        source_inference_id: 'inf-1',
        pending_source_key: null
      })).toBe(true);
    });

    it('returns false when source_inference_id is null', () => {
      expect(hasMaterializedInferenceTrace({
        source_inference_id: null,
        pending_source_key: null
      })).toBe(false);
    });

    it('returns false when source_inference_id is empty', () => {
      expect(hasMaterializedInferenceTrace({
        source_inference_id: '',
        pending_source_key: null
      })).toBe(false);
    });

    it('returns false when pending_source_key is set', () => {
      expect(hasMaterializedInferenceTrace({
        source_inference_id: 'inf-1',
        pending_source_key: 'pending-key'
      })).toBe(false);
    });
  });

  describe('resolveDecisionJobInferenceId', () => {
    it('prefers source_inference_id', () => {
      expect(resolveDecisionJobInferenceId({
        source_inference_id: 'inf-1',
        pending_source_key: 'key-1',
        id: 'job-1'
      })).toBe('inf-1');
    });

    it('falls back to pending_source_key when source_inference_id is null', () => {
      expect(resolveDecisionJobInferenceId({
        source_inference_id: null,
        pending_source_key: 'key-1',
        id: 'job-1'
      })).toBe('key-1');
    });

    it('falls back to id when both are null', () => {
      expect(resolveDecisionJobInferenceId({
        source_inference_id: null,
        pending_source_key: null,
        id: 'job-1'
      })).toBe('job-1');
    });
  });
});
