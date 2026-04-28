import type { PromptFragmentSlot } from '../../inference/prompt_slot_config.js';
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
  source_kind?: MemoryBlockSourceKind;
  source_id?: string;
  source_message_id?: string;
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
  created_at_tick: string;
  updated_at_tick: string;
}

export interface MemoryMutationPolicy {
  allow_insert: boolean;
  allow_rewrite: boolean;
  allow_delete: boolean;
}

export type MemoryPlacementSlot = Extract<
  PromptFragmentSlot,
  'system_policy' | 'role_core' | 'world_context' | 'memory_short_term' | 'memory_long_term' | 'memory_summary' | 'post_process'
>;

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
  case_sensitive?: boolean;
  fields?: Array<'content_text' | 'content_structured' | 'recent_trace_reasoning' | 'recent_event_text'>;
  score?: number;
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
  score?: number;
}

export interface MemoryRecentSourceTrigger {
  type: 'recent_source';
  source: 'trace' | 'intent' | 'event';
  match: {
    field: string;
    op: 'eq' | 'in' | 'contains' | 'exists' | 'gt' | 'lt';
    value?: unknown;
    values?: unknown[];
  };
  score?: number;
}

export type MemoryTrigger = MemoryKeywordTrigger | MemoryLogicTrigger | MemoryRecentSourceTrigger;

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
  pack_id?: string | null;
  limit: number;
}

export interface MemoryBlockUpsertInput {
  block: MemoryBlock;
  behavior: MemoryBehavior;
}

export interface DeleteMemoryBlockInput {
  memory_id: string;
  deleted_by: 'system' | 'agent' | 'model';
  reason?: string | null;
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
  attributes?: Record<string, unknown>;
  pack_state?: {
    actor_state?: Record<string, unknown> | null;
    world_state?: Record<string, unknown> | null;
    latest_event?: Record<string, unknown> | null;
  } | null;
  recent?: {
    trace?: MemoryRecentSourceRecord[];
    intent?: MemoryRecentSourceRecord[];
    event?: MemoryRecentSourceRecord[];
  };
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
  trigger_rate?: MemoryTriggerRateDecisionRecord | null;
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
  request_id?: string | null;
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
