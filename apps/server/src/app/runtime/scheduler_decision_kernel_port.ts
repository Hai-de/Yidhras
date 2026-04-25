import type { InferenceJobIntentClass } from '../../inference/types.js';

export type EventDrivenSchedulerReason =
  | 'event_followup'
  | 'relationship_change_followup'
  | 'snr_change_followup'
  | 'overlay_change_followup'
  | 'memory_change_followup';

export type SchedulerReason = EventDrivenSchedulerReason | 'periodic_tick' | 'bootstrap_seed';
export type SchedulerKind = 'periodic' | 'event_driven';
export type SchedulerRecoveryWindowType = 'replay' | 'retry';
export type SchedulerSkipReason =
  | 'pending_workflow'
  | 'periodic_cooldown'
  | 'event_coalesced'
  | 'existing_same_idempotency'
  | 'replay_window_periodic_suppressed'
  | 'replay_window_event_suppressed'
  | 'retry_window_periodic_suppressed'
  | 'retry_window_event_suppressed'
  | 'limit_reached';

export interface SchedulerSignalPolicy {
  priority_score: number;
  delay_ticks: string;
  coalesce_window_ticks: string;
  suppression_tier: 'high' | 'low';
}

export interface SchedulerRecoverySuppressionPolicy {
  suppress_periodic: boolean;
  suppress_event_tiers: Array<'high' | 'low'>;
}

export interface SchedulerKernelAgentRecord {
  id: string;
  partition_id: string;
}

export interface SchedulerKernelSignalRecord {
  agent_id: string;
  reason: EventDrivenSchedulerReason;
  created_at: string;
}

export interface SchedulerKernelCandidateDecision {
  actor_id: string;
  partition_id: string;
  kind: SchedulerKind;
  candidate_reasons: SchedulerReason[];
  chosen_reason: SchedulerReason;
  scheduled_for_tick: string;
  priority_score: number;
  skipped_reason: SchedulerSkipReason | null;
  should_create_job: boolean;
}

export interface SchedulerKernelJobDraft {
  actor_id: string;
  partition_id: string;
  kind: SchedulerKind;
  primary_reason: SchedulerReason;
  secondary_reasons: SchedulerReason[];
  scheduled_for_tick: string;
  priority_score: number;
  intent_class: Extract<InferenceJobIntentClass, 'scheduler_periodic' | 'scheduler_event_followup'>;
  job_source: 'scheduler';
}

export interface SchedulerKernelRunSummary {
  scanned_count: number;
  eligible_count: number;
  created_count: number;
  skipped_pending_count: number;
  skipped_cooldown_count: number;
  created_periodic_count: number;
  created_event_driven_count: number;
  signals_detected_count: number;
  scheduled_for_future_count: number;
  skipped_existing_idempotency_count: number;
  skipped_by_reason: Record<SchedulerSkipReason, number>;
}

export interface SchedulerKernelEvaluateInput {
  partition_id: string;
  now_tick: string;
  scheduler_reason: SchedulerReason;
  limit: number;
  cooldown_ticks: string;
  max_candidates: number;
  max_created_jobs_per_tick: number;
  max_entity_activations_per_tick: number;
  entity_single_flight_limit: number;
  agents: SchedulerKernelAgentRecord[];
  recent_signals: SchedulerKernelSignalRecord[];
  pending_intent_agent_ids: string[];
  pending_job_keys: string[];
  active_workflow_actor_ids: string[];
  recent_scheduled_tick_by_agent: Record<string, string>;
  replay_recovery_actor_ids: string[];
  retry_recovery_actor_ids: string[];
  per_tick_activation_counts: Record<string, number>;
  signal_policy: Record<EventDrivenSchedulerReason, SchedulerSignalPolicy>;
  recovery_suppression: Record<SchedulerRecoveryWindowType, SchedulerRecoverySuppressionPolicy>;
}

export interface SchedulerKernelEvaluateOutput {
  candidate_decisions: SchedulerKernelCandidateDecision[];
  job_drafts: SchedulerKernelJobDraft[];
  summary: SchedulerKernelRunSummary;
}

export interface SchedulerDecisionKernelPort {
  evaluate(input: SchedulerKernelEvaluateInput): Promise<SchedulerKernelEvaluateOutput>;
}

export interface AgentSchedulerCandidateDecisionSnapshot {
  actor_id: string;
  partition_id: string;
  kind: SchedulerKind;
  candidate_reasons: SchedulerReason[];
  chosen_reason: SchedulerReason;
  scheduled_for_tick: bigint;
  priority_score: number;
  skipped_reason: SchedulerSkipReason | null;
  created_job_id: string | null;
}

export interface AgentSchedulerRunResult extends SchedulerKernelRunSummary {
  scheduler_run_id?: string;
  scheduler_run_ids?: string[];
  partition_ids?: string[];
}

export const createInitialSkipCounts = (): Record<SchedulerSkipReason, number> => ({
  pending_workflow: 0,
  periodic_cooldown: 0,
  event_coalesced: 0,
  existing_same_idempotency: 0,
  replay_window_periodic_suppressed: 0,
  replay_window_event_suppressed: 0,
  retry_window_periodic_suppressed: 0,
  retry_window_event_suppressed: 0,
  limit_reached: 0
});

export const createEmptySchedulerRunResult = (partitionId: string): AgentSchedulerRunResult & { partition_id: string } => ({
  partition_id: partitionId,
  scanned_count: 0,
  eligible_count: 0,
  created_count: 0,
  skipped_pending_count: 0,
  skipped_cooldown_count: 0,
  created_periodic_count: 0,
  created_event_driven_count: 0,
  signals_detected_count: 0,
  scheduled_for_future_count: 0,
  skipped_existing_idempotency_count: 0,
  skipped_by_reason: createInitialSkipCounts()
});

