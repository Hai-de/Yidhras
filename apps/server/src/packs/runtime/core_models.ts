export interface PackRuntimeWorldEntityRecord {
  id: string;
  pack_id: string;
  entity_kind: string;
  entity_type: string | null;
  label: string;
  tags: string[];
  static_schema_ref: string | null;
  payload_json: Record<string, unknown> | null;
  created_at: bigint;
  updated_at: bigint;
}

export interface PackRuntimeWorldEntityInput {
  id: string;
  pack_id: string;
  entity_kind: string;
  entity_type?: string | null;
  label: string;
  tags?: string[];
  static_schema_ref?: string | null;
  payload_json?: Record<string, unknown> | null;
  now: bigint;
}

export interface PackRuntimeEntityStateRecord {
  id: string;
  pack_id: string;
  entity_id: string;
  state_namespace: string;
  state_json: Record<string, unknown>;
  created_at: bigint;
  updated_at: bigint;
}

export interface PackRuntimeEntityStateInput {
  id: string;
  pack_id: string;
  entity_id: string;
  state_namespace: string;
  state_json: Record<string, unknown>;
  now: bigint;
}

export interface PackRuntimeAuthorityGrantRecord {
  id: string;
  pack_id: string;
  source_entity_id: string;
  target_selector_json: Record<string, unknown>;
  capability_key: string;
  grant_type: string;
  mediated_by_entity_id: string | null;
  scope_json: Record<string, unknown> | null;
  conditions_json: Record<string, unknown> | null;
  priority: number;
  status: string | null;
  revocable: boolean | null;
  created_at: bigint;
  updated_at: bigint;
}

export interface PackRuntimeAuthorityGrantInput {
  id: string;
  pack_id: string;
  source_entity_id: string;
  target_selector_json: Record<string, unknown>;
  capability_key: string;
  grant_type: string;
  mediated_by_entity_id?: string | null;
  scope_json?: Record<string, unknown> | null;
  conditions_json?: Record<string, unknown> | null;
  priority?: number;
  status?: string | null;
  revocable?: boolean | null;
  now: bigint;
}

export interface PackRuntimeMediatorBindingRecord {
  id: string;
  pack_id: string;
  mediator_id: string;
  subject_entity_id: string | null;
  binding_kind: string;
  status: string;
  metadata_json: Record<string, unknown> | null;
  created_at: bigint;
  updated_at: bigint;
}

export interface PackRuntimeMediatorBindingInput {
  id: string;
  pack_id: string;
  mediator_id: string;
  subject_entity_id?: string | null;
  binding_kind: string;
  status: string;
  metadata_json?: Record<string, unknown> | null;
  now: bigint;
}

export interface PackRuntimeRuleExecutionRecord {
  id: string;
  pack_id: string;
  rule_id: string;
  capability_key: string | null;
  mediator_id: string | null;
  subject_entity_id: string | null;
  target_entity_id: string | null;
  execution_status: string;
  payload_json: Record<string, unknown> | null;
  emitted_events_json: unknown[];
  created_at: bigint;
  updated_at: bigint;
}

export interface PackRuntimeRuleExecutionInput {
  id: string;
  pack_id: string;
  rule_id: string;
  capability_key?: string | null;
  mediator_id?: string | null;
  subject_entity_id?: string | null;
  target_entity_id?: string | null;
  execution_status: string;
  payload_json?: Record<string, unknown> | null;
  emitted_events_json?: unknown[];
  now: bigint;
}

export interface PackRuntimeMaterializeSummary {
  pack_id: string;
  world_entity_count: number;
  entity_state_count: number;
  authority_grant_count: number;
  mediator_binding_count: number;
}

export const DEFAULT_PACK_WORLD_ENTITY_ID = '__world__';
