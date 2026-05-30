import type { InferenceActorRef } from '../../inference/types.js';

export type MemoryBlockKind =
  | 'fact'
  | 'reflection'
  | 'plan'
  | 'dossier'
  | 'rule'
  | 'hypothesis'
  | 'reminder'
  | 'summary';

export type MemoryBlockStatus = 'active' | 'deleted';

export type MemoryBlockSourceKind =
  | 'trace'
  | 'intent'
  | 'job'
  | 'post'
  | 'event'
  | 'manual'
  | 'overlay';

export interface MemoryBlockSourceRef {
  source_kind?: MemoryBlockSourceKind | undefined;
  source_id?: string | undefined;
  source_message_id?: string | undefined;
}

export interface MemoryBlock {
  id: string;
  owner_agent_id: string;
  pack_id: string | null;
  kind: MemoryBlockKind;
  status: MemoryBlockStatus;
  title: string | null;
  content_text: string;
  content_structured: Record<string, unknown> | null;
  tags: string[];
  keywords: string[];
  source_ref: MemoryBlockSourceRef | null;
  importance: number;
  salience: number;
  confidence: number | null;
  embedding: number[] | null;
  embedding_model: string | null;
  created_at_tick: string;
  updated_at_tick: string;
}

export interface MemoryMutationPolicy {
  allow_insert: boolean;
  allow_rewrite: boolean;
  allow_delete: boolean;
}

/** Memory placement target slots. Phase 4: PromptFragmentSlot is now string. */
export type MemoryPlacementSlot = string;

export type MemoryPlacementAnchorKind = 'slot_start' | 'slot_end' | 'source' | 'tag' | 'fragment_id';

export interface MemoryPlacementAnchor {
  kind: MemoryPlacementAnchorKind;
  value: string;
}

export interface MemoryPlacementRule {
  slot: MemoryPlacementSlot;
  anchor: MemoryPlacementAnchor | null;
  mode: 'prepend' | 'append' | 'before_anchor' | 'after_anchor';
  depth: number;
  order: number;
}

export type MemoryActivationMode = 'always' | 'keyword' | 'logic' | 'hybrid';

export interface MemoryKeywordTrigger {
  type: 'keyword';
  match: 'any' | 'all';
  keywords: string[];
  case_sensitive?: boolean | undefined;
  fields?: Array<'content_text' | 'content_structured' | 'recent_trace_reasoning' | 'recent_event_text'> | undefined;
  score?: number | undefined;
}

export type MemoryLogicExpr =
  | { op: 'and'; items: MemoryLogicExpr[] }
  | { op: 'or'; items: MemoryLogicExpr[] }
  | { op: 'not'; item: MemoryLogicExpr }
  | { op: 'eq'; path: string; value: unknown }
  | { op: 'in'; path: string; values: unknown[] }
  | { op: 'gt'; path: string; value: number }
  | { op: 'lt'; path: string; value: number }
  | { op: 'contains'; path: string; value: string }
  | { op: 'exists'; path: string };

export interface MemoryLogicTrigger {
  type: 'logic';
  expr: MemoryLogicExpr;
  score?: number | undefined;
}

export interface MemoryRecentSourceTrigger {
  type: 'recent_source';
  source: 'trace' | 'intent' | 'event';
  match: {
    field: string;
    op: 'eq' | 'in' | 'contains' | 'exists' | 'gt' | 'lt';
    value?: unknown;
    values?: unknown[] | undefined;
  };
  score?: number | undefined;
}

export interface MemorySemanticTrigger {
  type: 'semantic';
  threshold: number;
  query_template?: string | undefined;
  fields?: Array<'content_text' | 'content_structured'> | undefined;
  score?: number | undefined;
}

export type MemoryTrigger =
  | MemoryKeywordTrigger
  | MemoryLogicTrigger
  | MemoryRecentSourceTrigger
  | MemorySemanticTrigger;

export interface MemoryActivationRule {
  mode: MemoryActivationMode;
  trigger_rate: number;
  min_score: number;
  triggers: MemoryTrigger[];
}

export interface MemoryRetentionRule {
  retain_rounds_after_trigger: number;
  cooldown_rounds_after_insert: number;
  delay_rounds_before_insert: number;
}

export interface MemoryBehavior {
  mutation: MemoryMutationPolicy;
  placement: MemoryPlacementRule;
  activation: MemoryActivationRule;
  retention: MemoryRetentionRule;
}

export interface MemoryRuntimeState {
  memory_id: string;
  trigger_count: number;
  last_triggered_tick: string | null;
  last_inserted_tick: string | null;
  cooldown_until_tick: string | null;
  delayed_until_tick: string | null;
  retain_until_tick: string | null;
  currently_active: boolean;
  last_activation_score: number | null;
  recent_distance_from_latest_message: number | null;
}

export interface MemoryBlockRecord {
  block: MemoryBlock;
  behavior: MemoryBehavior;
  state: MemoryRuntimeState | null;
}

export interface MemoryBlockCandidateQuery {
  owner_agent_id: string;
  pack_id?: string | null | undefined;
  limit: number;
}

export interface MemoryBlockUpsertInput {
  block: MemoryBlock;
  behavior: MemoryBehavior;
}

export interface DeleteMemoryBlockInput {
  memory_id: string;
  deleted_by: 'system' | 'agent' | 'model';
  reason?: string | null | undefined;
}

export interface LongMemoryBlockStore {
  listCandidateBlocks(input: MemoryBlockCandidateQuery): Promise<MemoryBlockRecord[]>;
  upsertBlock(input: MemoryBlockUpsertInput): Promise<MemoryBlockRecord>;
  updateRuntimeState(state: MemoryRuntimeState): Promise<MemoryRuntimeState>;
  hardDeleteBlock(input: DeleteMemoryBlockInput): Promise<void>;
}

export interface MemoryRecentSourceRecord {
  id: string;
  kind: 'trace' | 'intent' | 'event';
  payload: Record<string, unknown>;
  occurred_at_tick: string;
}

export interface MemoryActivationEvaluation {
  memory_id: string;
  status: 'inactive' | 'delayed' | 'active' | 'retained' | 'cooling';
  trigger_diagnostics: MemoryBlockTriggerDiagnostics;
  activation_score: number;
  matched_triggers: string[];
  reason: string | null;
  recent_distance_from_latest_message: number | null;
}

export interface MemoryEvaluationContext {
  actor_ref: InferenceActorRef;
  resolved_agent_id: string | null;
  pack_id: string | null;
  current_tick: string;
  attributes?: Record<string, unknown> | undefined;
  pack_state?: {
    actor_state?: Record<string, unknown> | null | undefined;
    world_state?: Record<string, unknown> | null | undefined;
    latest_event?: Record<string, unknown> | null | undefined;
  } | null;
  recent?: {
    trace?: MemoryRecentSourceRecord[] | undefined;
    intent?: MemoryRecentSourceRecord[] | undefined;
    event?: MemoryRecentSourceRecord[] | undefined;
  };
  query_embedding?: number[] | undefined;
}

export type MemoryTriggerEngineMode = 'rust_primary';

export interface MemoryTriggerRateDecisionRecord {
  present: boolean;
  value: number | null;
  applied: boolean;
  sample: number | null;
  passed: boolean | null;
}

export interface MemoryTriggerRateDecisionSummary {
  present_count: number;
  applied_count: number;
  blocked_count: number;
}

export interface MemoryTriggerSourceRecordResult {
  memory_id: string;
  evaluation: MemoryActivationEvaluation;
  next_runtime_state: MemoryRuntimeState;
  should_materialize: boolean;
  materialize_reason: 'active' | 'retained' | null;
  trigger_rate?: MemoryTriggerRateDecisionRecord | null | undefined;
}

export interface MemoryTriggerSourceDiagnostics {
  candidate_count: number;
  materialized_count: number;
  status_counts: Record<'active' | 'retained' | 'delayed' | 'cooling' | 'inactive', number>;
  trigger_rate: MemoryTriggerRateDecisionSummary;
}

export interface MemoryBlockTriggerDiagnostics {
  trigger_rate: MemoryTriggerRateDecisionRecord;
  base_match: boolean;
  score_passed: boolean;
  fresh_trigger_attempt: boolean;
}

export interface MemoryTriggerSourceEvaluateInput {
  protocol_version: string;
  request_id?: string | null | undefined;
  evaluation_context: MemoryEvaluationContext;
  candidates: MemoryBlockRecord[];
}

export interface MemoryTriggerSourceEvaluateResult {
  protocol_version: string;
  records: MemoryTriggerSourceRecordResult[];
  diagnostics: MemoryTriggerSourceDiagnostics;
}

export type MemoryTriggerEngineEvaluationMetadata = {
  provider: MemoryTriggerEngineMode;
};

// -- Vector search types --

export interface MemoryVectorSearchInput {
  owner_agent_id: string;
  pack_id?: string | null | undefined;
  query_text?: string | undefined;
  query_embedding?: number[] | undefined;
  threshold?: number | undefined;
  limit: number;
}

export interface MemoryVectorSearchResult {
  block: MemoryBlock;
  similarity: number;
}
