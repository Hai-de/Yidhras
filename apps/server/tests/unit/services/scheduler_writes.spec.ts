import { describe, expect, it, vi } from 'vitest';

import { writeDetailedSnapshot, recordSchedulerRunSnapshot, emitAggregatedMetrics } from '../../../src/app/services/scheduler/writes.js';
import type { AppContext } from '../../../src/app/context.js';
import type { AgentSchedulerCandidateDecisionSnapshot, AgentSchedulerRunResult } from '../../../src/app/runtime/agent_scheduler.js';
import { DEFAULT_SCHEDULER_PARTITION_ID } from '../../../src/app/runtime/scheduler_partitioning.js';

function makeSummary(): AgentSchedulerRunResult {
  return {
    total_candidates: 3,
    scheduled: 2,
    skipped: 1,
    errors: 0,
    duration_ms: 150
  } as unknown as AgentSchedulerRunResult;
}

function makeCandidateDecision(overrides: Partial<AgentSchedulerCandidateDecisionSnapshot> = {}): AgentSchedulerCandidateDecisionSnapshot {
  return {
    actor_id: 'actor-1',
    kind: 'agent',
    candidate_reasons: ['new_turn'],
    chosen_reason: 'new_turn',
    scheduled_for_tick: 100n,
    priority_score: 0.8,
    ...overrides
  } as unknown as AgentSchedulerCandidateDecisionSnapshot;
}

function makeMockContext(adapter?: Record<string, unknown>): AppContext {
  return {
    schedulerStorage: adapter ?? undefined
  } as unknown as AppContext;
}

describe('scheduler/writes', () => {
  describe('writeDetailedSnapshot', () => {
    it('should write snapshot and candidate decisions to adapter', () => {
      const adapter = {
        open: vi.fn(),
        writeDetailedSnapshot: vi.fn(),
        writeCandidateDecision: vi.fn()
      };
      const ctx = makeMockContext(adapter);
      const candidates = [makeCandidateDecision(), makeCandidateDecision({ actor_id: 'actor-2' })];

      const runId = writeDetailedSnapshot('pack-1', ctx, {
        workerId: 'worker-1',
        tick: 42n,
        startedAt: 1000n,
        finishedAt: 2000n,
        summary: makeSummary(),
        candidateDecisions: candidates
      });

      expect(runId).toBeDefined();
      expect(typeof runId).toBe('string');
      expect(adapter.open).toHaveBeenCalledWith('pack-1');
      expect(adapter.writeDetailedSnapshot).toHaveBeenCalledOnce();
      expect(adapter.writeCandidateDecision).toHaveBeenCalledTimes(2);
    });

    it('should use default partition id when not specified', () => {
      const adapter = {
        open: vi.fn(),
        writeDetailedSnapshot: vi.fn(),
        writeCandidateDecision: vi.fn()
      };
      const ctx = makeMockContext(adapter);

      writeDetailedSnapshot('pack-1', ctx, {
        workerId: 'worker-1',
        tick: 42n,
        startedAt: 1000n,
        finishedAt: 2000n,
        summary: makeSummary(),
        candidateDecisions: []
      });

      const writeCall = adapter.writeDetailedSnapshot.mock.calls[0]![1];
      expect(writeCall.partition_id).toBe(DEFAULT_SCHEDULER_PARTITION_ID);
    });

    it('should use custom partition id when provided', () => {
      const adapter = {
        open: vi.fn(),
        writeDetailedSnapshot: vi.fn(),
        writeCandidateDecision: vi.fn()
      };
      const ctx = makeMockContext(adapter);

      writeDetailedSnapshot('pack-1', ctx, {
        workerId: 'worker-1',
        partitionId: 'custom-partition',
        tick: 42n,
        startedAt: 1000n,
        finishedAt: 2000n,
        summary: makeSummary(),
        candidateDecisions: []
      });

      const writeCall = adapter.writeDetailedSnapshot.mock.calls[0]![1];
      expect(writeCall.partition_id).toBe('custom-partition');
    });

    it('should use workerId as lease_holder when leaseHolder not provided', () => {
      const adapter = {
        open: vi.fn(),
        writeDetailedSnapshot: vi.fn(),
        writeCandidateDecision: vi.fn()
      };
      const ctx = makeMockContext(adapter);

      writeDetailedSnapshot('pack-1', ctx, {
        workerId: 'worker-1',
        tick: 42n,
        startedAt: 1000n,
        finishedAt: 2000n,
        summary: makeSummary(),
        candidateDecisions: []
      });

      const writeCall = adapter.writeDetailedSnapshot.mock.calls[0]![1];
      expect(writeCall.lease_holder).toBe('worker-1');
    });

    it('should use custom lease_holder when provided', () => {
      const adapter = {
        open: vi.fn(),
        writeDetailedSnapshot: vi.fn(),
        writeCandidateDecision: vi.fn()
      };
      const ctx = makeMockContext(adapter);

      writeDetailedSnapshot('pack-1', ctx, {
        workerId: 'worker-1',
        leaseHolder: 'custom-leaser',
        tick: 42n,
        startedAt: 1000n,
        finishedAt: 2000n,
        summary: makeSummary(),
        candidateDecisions: []
      });

      const writeCall = adapter.writeDetailedSnapshot.mock.calls[0]![1];
      expect(writeCall.lease_holder).toBe('custom-leaser');
    });

    it('should not write to adapter when schedulerStorage is undefined', () => {
      const ctx = makeMockContext(undefined);
      const runId = writeDetailedSnapshot('pack-1', ctx, {
        workerId: 'worker-1',
        tick: 42n,
        startedAt: 1000n,
        finishedAt: 2000n,
        summary: makeSummary(),
        candidateDecisions: []
      });
      expect(runId).toBeDefined();
    });
  });

  describe('emitAggregatedMetrics', () => {
    it('should be a no-op stub', () => {
      expect(() => emitAggregatedMetrics('pack-1', makeSummary())).not.toThrow();
    });
  });

  describe('recordSchedulerRunSnapshot', () => {
    it('should write snapshot and return runId when packId is provided', () => {
      const adapter = {
        open: vi.fn(),
        writeDetailedSnapshot: vi.fn(),
        writeCandidateDecision: vi.fn()
      };
      const ctx = makeMockContext(adapter);

      const runId = recordSchedulerRunSnapshot(ctx, {
        workerId: 'worker-1',
        tick: 42n,
        startedAt: 1000n,
        finishedAt: 2000n,
        summary: makeSummary(),
        candidateDecisions: []
      }, 'pack-1');

      expect(runId).toBeDefined();
      expect(adapter.open).toHaveBeenCalledWith('pack-1');
    });

    it('should return random UUID when packId is not provided', () => {
      const ctx = makeMockContext();
      const runId = recordSchedulerRunSnapshot(ctx, {
        workerId: 'worker-1',
        tick: 42n,
        startedAt: 1000n,
        finishedAt: 2000n,
        summary: makeSummary(),
        candidateDecisions: []
      });
      expect(runId).toBeDefined();
      expect(typeof runId).toBe('string');
    });
  });
});
