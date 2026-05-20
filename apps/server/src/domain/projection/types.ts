export interface ProjectionWhenClause {
  tick_interval?: number;
  on_event_type?: string;
  entity_type_is?: string;
}

export interface ProjectionThenClause {
  compute: 'count' | 'sum' | 'max' | 'min' | 'collect';
  source_entity_type?: string;
  source_state_key?: string;
  source_collection?: string;
  target_projection: string;
  aggregate_by?: string[];
  filter_condition?: Record<string, unknown>;
}

export interface ProjectionRuleDef {
  id: string;
  when: ProjectionWhenClause;
  then: ProjectionThenClause;
}

export interface ProjectionEvaluationContext {
  packId: string;
  currentTick: bigint;
  entities: Array<{ id: string; entity_kind: string; entity_type: string | null }>;
  entityStates: Array<{ entity_id: string; state_namespace: string; state_json: Record<string, unknown> }>;
  mediatorBindings: Array<{ mediator_id: string; subject_entity_id: string | null; binding_kind: string }>;
  authorityGrants: Array<{ id: string; source_entity_id: string; capability_key: string; status: string | null }>;
  ruleExecutionRecords: Array<{ id: string; rule_id: string; execution_status: string; payload_json: Record<string, unknown> | null }>;
}

export interface ProjectionEvaluationResult {
  projection_key: string;
  computed_value: unknown;
  dimensions: Record<string, string>;
}
