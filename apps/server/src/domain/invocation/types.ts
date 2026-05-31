export interface InvocationRequest {
  id: string;
  pack_id: string;
  source_action_intent_id: string;
  source_inference_id: string;
  invocation_type: string;
  capability_key: string | null;
  subject_entity_id: string | null;
  target_ref: Record<string, unknown> | null;
  payload: Record<string, unknown>;
  mediator_id: string | null;
  actor_ref: Record<string, unknown>;
  created_at: bigint;
}

export interface InvocationDispatchResult {
  outcome: 'completed' | 'dropped';
  reason: string | null;
  invocation_request: InvocationRequest;
  rule_execution_id: string | null;
}
