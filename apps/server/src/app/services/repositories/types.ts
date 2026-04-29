// Domain record types shared across repositories.
// Extracted from existing repository files to avoid Prisma type dependencies.

export interface ActionIntentRecord {
  id: string;
  source_inference_id: string;
  intent_type: string;
  actor_ref: unknown;
  target_ref: unknown;
  payload: unknown;
  scheduled_after_ticks: bigint | null;
  scheduled_for_tick: bigint | null;
  status: string;
  locked_by: string | null;
  locked_at: bigint | null;
  lock_expires_at: bigint | null;
  dispatch_started_at: bigint | null;
  dispatched_at: bigint | null;
  transmission_delay_ticks: bigint | null;
  transmission_policy: string;
  transmission_drop_chance: number;
  drop_reason: string | null;
  dispatch_error_code: string | null;
  dispatch_error_message: string | null;
  created_at: bigint;
  updated_at: bigint;
}

export interface ActionIntentDispatchReflection {
  id: string;
  source_inference_id: string;
  intent_type: string;
  actor_agent_id: string;
  target_ref: Record<string, unknown> | null;
  semantic_intent_kind: string | null;
  event_summaries: Array<{ id: string; type: string; title: string }>;
}
