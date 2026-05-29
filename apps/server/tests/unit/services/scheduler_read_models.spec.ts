import { describe, expect, it } from 'vitest';

import {
  buildDecisionCursorWhere,
  buildRunCrossLinkSummary,
  buildSchedulerOwnershipSummary,
  toCandidateDecisionReadModel,
  toOwnershipMigrationReadModel,
  toRebalanceRecommendationReadModel,
  toRunReadModel,
  toWorkerRuntimeReadModel
} from '../../../src/app/services/scheduler/helpers.js';

describe('scheduler read-model converters', () => {
  describe('toRunReadModel', () => {
    it('converts raw scheduler run to read model', () => {
      const result = toRunReadModel({
        id: 'run-1',
        worker_id: 'worker-1',
        partition_id: 'part-1',
        lease_holder: 'worker-1',
        lease_expires_at_snapshot: 5000n,
        tick: 100n,
        summary: { decisions: 5, skipped: 2 },
        started_at: 1000n,
        finished_at: 2000n,
        created_at: 1500n
      });

      expect(result.id).toBe('run-1');
      expect(result.worker_id).toBe('worker-1');
      expect(result.tick).toBe('100');
      expect(result.started_at).toBe('1000');
      expect(result.finished_at).toBe('2000');
      expect(result.lease_holder).toBe('worker-1');
      expect(result.lease_expires_at_snapshot).toBe('5000');
    });

    it('handles null lease values', () => {
      const result = toRunReadModel({
        id: 'run-2',
        worker_id: 'worker-1',
        partition_id: 'part-1',
        lease_holder: null,
        lease_expires_at_snapshot: null,
        tick: 50n,
        summary: {},
        started_at: 100n,
        finished_at: 200n,
        created_at: 150n
      });

      expect(result.lease_holder).toBeNull();
      expect(result.lease_expires_at_snapshot).toBeNull();
    });
  });

  describe('toCandidateDecisionReadModel', () => {
    it('converts raw candidate to read model', () => {
      const result = toCandidateDecisionReadModel({
        id: 'dec-1',
        scheduler_run_id: 'run-1',
        partition_id: 'part-1',
        actor_id: 'agent-1',
        kind: 'periodic',
        candidate_reasons: ['periodic_tick'],
        chosen_reason: 'periodic_tick',
        scheduled_for_tick: 100n,
        priority_score: 0.95,
        skipped_reason: null,
        created_job_id: 'job-1',
        created_at: 1000n
      });

      expect(result.id).toBe('dec-1');
      expect(result.kind).toBe('periodic');
      expect(result.candidate_reasons).toEqual(['periodic_tick']);
      expect(result.coalesced_secondary_reason_count).toBe(0);
      expect(result.has_coalesced_signals).toBe(false);
    });

    it('calculates coalesced signals for event_driven kind', () => {
      const result = toCandidateDecisionReadModel({
        id: 'dec-2',
        scheduler_run_id: 'run-1',
        partition_id: 'part-1',
        actor_id: 'agent-1',
        kind: 'event_driven',
        candidate_reasons: ['event_followup', 'relationship_change_followup', 'snr_change_followup'],
        chosen_reason: 'event_followup',
        scheduled_for_tick: 100n,
        priority_score: 0.8,
        skipped_reason: null,
        created_job_id: null,
        created_at: 1000n
      });

      expect(result.coalesced_secondary_reason_count).toBe(2);
      expect(result.has_coalesced_signals).toBe(true);
    });

    it('handles non-array candidate_reasons', () => {
      const result = toCandidateDecisionReadModel({
        id: 'dec-3',
        scheduler_run_id: 'run-1',
        partition_id: 'part-1',
        actor_id: 'agent-1',
        kind: 'periodic',
        candidate_reasons: 'invalid',
        chosen_reason: 'periodic_tick',
        scheduled_for_tick: 100n,
        priority_score: 0.5,
        skipped_reason: 'limit_reached',
        created_job_id: null,
        created_at: 1000n
      });

      expect(result.candidate_reasons).toEqual([]);
      expect(result.skipped_reason).toBe('limit_reached');
    });
  });

  describe('toOwnershipMigrationReadModel', () => {
    it('converts migration to read model', () => {
      const result = toOwnershipMigrationReadModel({
        id: 'mig-1',
        partition_id: 'part-1',
        from_worker_id: 'worker-1',
        to_worker_id: 'worker-2',
        status: 'completed',
        reason: 'rebalance',
        details: { score: 0.9 },
        created_at: 1000n,
        updated_at: 2000n,
        completed_at: 3000n
      });

      expect(result.id).toBe('mig-1');
      expect(result.from_worker_id).toBe('worker-1');
      expect(result.to_worker_id).toBe('worker-2');
      expect(result.completed_at).toBe('3000');
    });

    it('handles null completed_at', () => {
      const result = toOwnershipMigrationReadModel({
        id: 'mig-2',
        partition_id: 'part-1',
        from_worker_id: null,
        to_worker_id: 'worker-2',
        status: 'pending',
        reason: null,
        details: null,
        created_at: 1000n,
        updated_at: 1000n,
        completed_at: null
      });

      expect(result.from_worker_id).toBeNull();
      expect(result.completed_at).toBeNull();
    });
  });

  describe('toWorkerRuntimeReadModel', () => {
    it('converts worker to read model', () => {
      const result = toWorkerRuntimeReadModel({
        worker_id: 'worker-1',
        status: 'active',
        last_heartbeat_at: 5000n,
        owned_partition_count: 3,
        active_migration_count: 1,
        capacity_hint: 10,
        updated_at: 6000n
      });

      expect(result.worker_id).toBe('worker-1');
      expect(result.status).toBe('active');
      expect(result.last_heartbeat_at).toBe('5000');
      expect(result.owned_partition_count).toBe(3);
      expect(result.capacity_hint).toBe(10);
    });
  });

  describe('toRebalanceRecommendationReadModel', () => {
    it('converts recommendation to read model', () => {
      const result = toRebalanceRecommendationReadModel({
        id: 'rec-1',
        partition_id: 'part-1',
        from_worker_id: 'worker-1',
        to_worker_id: 'worker-2',
        status: 'pending',
        reason: 'load_balance',
        score: 0.85,
        suppress_reason: null,
        details: {},
        created_at: 1000n,
        updated_at: 1000n,
        applied_migration_id: null
      });

      expect(result.id).toBe('rec-1');
      expect(result.score).toBe(0.85);
      expect(result.applied_migration_id).toBeNull();
    });
  });

  describe('buildDecisionCursorWhere', () => {
    it('returns always-true for null cursor', () => {
      const predicate = buildDecisionCursorWhere(null);
      expect(predicate({ created_at: 1000, id: 'dec-1' } as any)).toBe(true);
    });

    it('filters decisions before cursor', () => {
      const predicate = buildDecisionCursorWhere({ created_at: '1000', id: 'dec-1' });
      expect(predicate({ created_at: 500, id: 'dec-x' } as any)).toBe(true);
      expect(predicate({ created_at: 1000, id: 'aaa' } as any)).toBe(true);
      expect(predicate({ created_at: 2000, id: 'dec-x' } as any)).toBe(false);
    });
  });

  describe('buildRunCrossLinkSummary', () => {
    it('returns null when no candidates have workflow links', () => {
      const result = buildRunCrossLinkSummary([
        { id: 'dec-1', workflow_link: null } as any
      ]);
      expect(result).toBeNull();
    });

    it('aggregates workflow links from candidates', () => {
      const result = buildRunCrossLinkSummary([
        {
          id: 'dec-1',
          workflow_link: {
            job_id: 'job-1',
            status: 'completed',
            workflow_state: 'workflow_completed',
            intent_type: 'post_message',
            audit_entry: { summary: 'test' }
          }
        },
        {
          id: 'dec-2',
          workflow_link: {
            job_id: 'job-2',
            status: 'completed',
            workflow_state: 'workflow_completed',
            intent_type: 'adjust_relationship',
            audit_entry: { summary: 'test2' }
          }
        }
      ] as any);

      expect(result).not.toBeNull();
      expect(result!.linked_workflow_count).toBe(2);
      expect(result!.workflow_state_breakdown).toHaveLength(1);
      expect(result!.linked_intent_type_breakdown).toHaveLength(2);
      expect(result!.recent_audit_summaries).toHaveLength(2);
    });
  });

  describe('buildSchedulerOwnershipSummary', () => {
    it('returns empty summary for no items', () => {
      const result = buildSchedulerOwnershipSummary([]);
      expect(result.returned).toBe(0);
      expect(result.assigned_count).toBe(0);
      expect(result.active_partition_count).toBe(0);
    });

    it('counts statuses correctly', () => {
      const items = [
        { worker_id: 'w1', status: 'assigned', source: 'bootstrap' },
        { worker_id: 'w1', status: 'assigned', source: 'bootstrap' },
        { worker_id: 'w2', status: 'migrating', source: 'rebalance' },
        { worker_id: null, status: 'released', source: 'manual' }
      ] as any[];

      const result = buildSchedulerOwnershipSummary(items);
      expect(result.returned).toBe(4);
      expect(result.assigned_count).toBe(2);
      expect(result.migrating_count).toBe(1);
      expect(result.released_count).toBe(1);
      expect(result.active_partition_count).toBe(3);
      expect(result.top_workers).toHaveLength(2);
    });
  });
});
