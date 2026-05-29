import type { SchedulerKind, SchedulerReason, SchedulerSkipReason } from '../../runtime/agent_scheduler.js';

export const SCHEDULER_QUERY_INVALID = 'SCHEDULER_QUERY_INVALID';

export const SCHEDULER_KINDS: SchedulerKind[] = ['periodic', 'event_driven'];

export const SCHEDULER_REASONS: SchedulerReason[] = [
  'periodic_tick',
  'bootstrap_seed',
  'event_followup',
  'relationship_change_followup',
  'snr_change_followup',
  'overlay_change_followup',
  'memory_change_followup'
];

export const SCHEDULER_SKIP_REASONS: SchedulerSkipReason[] = [
  'pending_workflow',
  'periodic_cooldown',
  'event_coalesced',
  'replay_window_periodic_suppressed',
  'replay_window_event_suppressed',
  'retry_window_periodic_suppressed',
  'retry_window_event_suppressed',
  'existing_same_idempotency',
  'limit_reached'
];
