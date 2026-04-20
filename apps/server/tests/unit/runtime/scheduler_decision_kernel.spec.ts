import { describe, expect, it } from 'vitest';

import { evaluateSchedulerDecisionKernel } from '../../../src/app/runtime/scheduler_decision_kernel.js';
import type {
  EventDrivenSchedulerReason,
  SchedulerKernelEvaluateInput,
  SchedulerSignalPolicy
} from '../../../src/app/runtime/scheduler_decision_kernel_port.js';

const DEFAULT_SIGNAL_POLICY: Record<EventDrivenSchedulerReason, SchedulerSignalPolicy> = {
  event_followup: {
    priority_score: 8,
    delay_ticks: '1',
    coalesce_window_ticks: '2',
    suppression_tier: 'high'
  },
  relationship_change_followup: {
    priority_score: 10,
    delay_ticks: '3',
    coalesce_window_ticks: '2',
    suppression_tier: 'high'
  },
  snr_change_followup: {
    priority_score: 7,
    delay_ticks: '2',
    coalesce_window_ticks: '2',
    suppression_tier: 'low'
  },
  overlay_change_followup: {
    priority_score: 6,
    delay_ticks: '2',
    coalesce_window_ticks: '2',
    suppression_tier: 'low'
  },
  memory_change_followup: {
    priority_score: 5,
    delay_ticks: '2',
    coalesce_window_ticks: '2',
    suppression_tier: 'low'
  }
};

const buildInput = (
  overrides: Partial<SchedulerKernelEvaluateInput> = {}
): SchedulerKernelEvaluateInput => ({
  partition_id: 'p0',
  now_tick: '100',
  scheduler_reason: 'periodic_tick',
  limit: 10,
  cooldown_ticks: '5',
  max_candidates: 10,
  max_created_jobs_per_tick: 10,
  max_entity_activations_per_tick: 10,
  entity_single_flight_limit: 1,
  agents: [
    { id: 'agent-a', partition_id: 'p0' },
    { id: 'agent-b', partition_id: 'p0' }
  ],
  recent_signals: [],
  pending_intent_agent_ids: [],
  pending_job_keys: [],
  active_workflow_actor_ids: [],
  recent_scheduled_tick_by_agent: {},
  replay_recovery_actor_ids: [],
  retry_recovery_actor_ids: [],
  per_tick_activation_counts: {},
  signal_policy: DEFAULT_SIGNAL_POLICY,
  recovery_suppression: {
    replay: {
      suppress_periodic: true,
      suppress_event_tiers: ['high']
    },
    retry: {
      suppress_periodic: true,
      suppress_event_tiers: ['high', 'low']
    }
  },
  ...overrides
});

describe('scheduler decision kernel', () => {
  it('creates periodic scheduler job drafts and summary for eligible agents', () => {
    const result = evaluateSchedulerDecisionKernel(buildInput());

    expect(result.candidate_decisions).toEqual([
      expect.objectContaining({
        actor_id: 'agent-a',
        kind: 'periodic',
        chosen_reason: 'periodic_tick',
        scheduled_for_tick: '100',
        should_create_job: true,
        skipped_reason: null
      }),
      expect.objectContaining({
        actor_id: 'agent-b',
        kind: 'periodic',
        chosen_reason: 'periodic_tick',
        scheduled_for_tick: '100',
        should_create_job: true,
        skipped_reason: null
      })
    ]);
    expect(result.job_drafts).toEqual([
      expect.objectContaining({
        actor_id: 'agent-a',
        kind: 'periodic',
        intent_class: 'scheduler_periodic',
        job_source: 'scheduler'
      }),
      expect.objectContaining({
        actor_id: 'agent-b',
        kind: 'periodic',
        intent_class: 'scheduler_periodic',
        job_source: 'scheduler'
      })
    ]);
    expect(result.summary).toEqual({
      scanned_count: 2,
      eligible_count: 2,
      created_count: 2,
      skipped_pending_count: 0,
      skipped_cooldown_count: 0,
      created_periodic_count: 2,
      created_event_driven_count: 0,
      signals_detected_count: 0,
      scheduled_for_future_count: 0,
      skipped_existing_idempotency_count: 0,
      skipped_by_reason: {
        pending_workflow: 0,
        periodic_cooldown: 0,
        event_coalesced: 0,
        existing_same_idempotency: 0,
        replay_window_periodic_suppressed: 0,
        replay_window_event_suppressed: 0,
        retry_window_periodic_suppressed: 0,
        retry_window_event_suppressed: 0,
        limit_reached: 0
      }
    });
  });

  it('merges event-driven signals by priority and keeps candidate ordering deterministic', () => {
    const result = evaluateSchedulerDecisionKernel(buildInput({
      entity_single_flight_limit: 2,
      recent_signals: [
        { agent_id: 'agent-b', reason: 'event_followup', created_at: '100' },
        { agent_id: 'agent-b', reason: 'relationship_change_followup', created_at: '100' }
      ]
    }));

    expect(result.candidate_decisions.map(item => ({
      actor_id: item.actor_id,
      kind: item.kind,
      chosen_reason: item.chosen_reason,
      candidate_reasons: item.candidate_reasons,
      scheduled_for_tick: item.scheduled_for_tick,
      should_create_job: item.should_create_job
    }))).toEqual([
      {
        actor_id: 'agent-b',
        kind: 'event_driven',
        chosen_reason: 'relationship_change_followup',
        candidate_reasons: ['relationship_change_followup', 'event_followup'],
        scheduled_for_tick: '103',
        should_create_job: true
      },
      {
        actor_id: 'agent-a',
        kind: 'periodic',
        chosen_reason: 'periodic_tick',
        candidate_reasons: ['periodic_tick'],
        scheduled_for_tick: '100',
        should_create_job: true
      },
      {
        actor_id: 'agent-b',
        kind: 'periodic',
        chosen_reason: 'periodic_tick',
        candidate_reasons: ['periodic_tick'],
        scheduled_for_tick: '100',
        should_create_job: true
      }
    ]);
    expect(result.job_drafts[0]).toEqual(expect.objectContaining({
      actor_id: 'agent-b',
      kind: 'event_driven',
      intent_class: 'scheduler_event_followup',
      secondary_reasons: ['event_followup']
    }));
    expect(result.summary.signals_detected_count).toBe(2);
    expect(result.summary.created_event_driven_count).toBe(1);
    expect(result.summary.created_periodic_count).toBe(2);
    expect(result.summary.scheduled_for_future_count).toBe(1);
    expect(result.summary.skipped_by_reason.event_coalesced).toBe(1);
  });

  it('suppresses periodic candidates when an actor already has pending workflow', () => {
    const result = evaluateSchedulerDecisionKernel(buildInput({
      active_workflow_actor_ids: ['agent-a']
    }));

    expect(result.candidate_decisions).toEqual([
      expect.objectContaining({
        actor_id: 'agent-a',
        skipped_reason: 'pending_workflow',
        should_create_job: false
      }),
      expect.objectContaining({
        actor_id: 'agent-b',
        skipped_reason: null,
        should_create_job: true
      })
    ]);
    expect(result.job_drafts).toHaveLength(1);
    expect(result.job_drafts[0]?.actor_id).toBe('agent-b');
    expect(result.summary.skipped_pending_count).toBe(1);
    expect(result.summary.created_count).toBe(1);
  });

  it('suppresses periodic candidates that are still inside cooldown window', () => {
    const result = evaluateSchedulerDecisionKernel(buildInput({
      recent_scheduled_tick_by_agent: {
        'agent-a': '98'
      }
    }));

    expect(result.candidate_decisions).toEqual([
      expect.objectContaining({
        actor_id: 'agent-a',
        skipped_reason: 'periodic_cooldown',
        should_create_job: false
      }),
      expect.objectContaining({
        actor_id: 'agent-b',
        skipped_reason: null,
        should_create_job: true
      })
    ]);
    expect(result.summary.skipped_cooldown_count).toBe(1);
    expect(result.summary.skipped_by_reason.periodic_cooldown).toBe(1);
  });

  it('applies replay recovery suppression to both event-driven and periodic candidates', () => {
    const result = evaluateSchedulerDecisionKernel(buildInput({
      entity_single_flight_limit: 2,
      agents: [{ id: 'agent-a', partition_id: 'p0' }],
      recent_signals: [
        { agent_id: 'agent-a', reason: 'event_followup', created_at: '100' }
      ],
      replay_recovery_actor_ids: ['agent-a']
    }));

    expect(result.candidate_decisions.map(item => ({
      kind: item.kind,
      skipped_reason: item.skipped_reason,
      should_create_job: item.should_create_job
    }))).toEqual([
      {
        kind: 'event_driven',
        skipped_reason: 'replay_window_event_suppressed',
        should_create_job: false
      },
      {
        kind: 'periodic',
        skipped_reason: 'replay_window_periodic_suppressed',
        should_create_job: false
      }
    ]);
    expect(result.job_drafts).toEqual([]);
    expect(result.summary.created_count).toBe(0);
    expect(result.summary.skipped_by_reason.replay_window_event_suppressed).toBe(1);
    expect(result.summary.skipped_by_reason.replay_window_periodic_suppressed).toBe(1);
  });

  it('enforces max created jobs per tick and marks remaining candidates as limit_reached', () => {
    const result = evaluateSchedulerDecisionKernel(buildInput({
      limit: 1,
      max_created_jobs_per_tick: 1
    }));

    expect(result.candidate_decisions).toEqual([
      expect.objectContaining({
        actor_id: 'agent-a',
        skipped_reason: null,
        should_create_job: true
      }),
      expect.objectContaining({
        actor_id: 'agent-b',
        skipped_reason: 'limit_reached',
        should_create_job: false
      })
    ]);
    expect(result.job_drafts).toHaveLength(1);
    expect(result.summary.created_count).toBe(1);
    expect(result.summary.skipped_by_reason.limit_reached).toBe(1);
  });

  it('enforces per-entity activation limit when the same actor receives multiple candidates', () => {
    const result = evaluateSchedulerDecisionKernel(buildInput({
      entity_single_flight_limit: 2,
      max_entity_activations_per_tick: 1,
      agents: [{ id: 'agent-a', partition_id: 'p0' }],
      recent_signals: [
        { agent_id: 'agent-a', reason: 'event_followup', created_at: '100' }
      ]
    }));

    expect(result.candidate_decisions).toEqual([
      expect.objectContaining({
        actor_id: 'agent-a',
        kind: 'event_driven',
        skipped_reason: null,
        should_create_job: true
      }),
      expect.objectContaining({
        actor_id: 'agent-a',
        kind: 'periodic',
        skipped_reason: 'limit_reached',
        should_create_job: false
      })
    ]);
    expect(result.summary.created_count).toBe(1);
    expect(result.summary.created_event_driven_count).toBe(1);
    expect(result.summary.created_periodic_count).toBe(0);
    expect(result.summary.skipped_by_reason.limit_reached).toBe(1);
  });
});
