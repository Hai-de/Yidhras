import type { PromptFragmentSlot } from '../inference/prompt_slot_config.js';
import type {
  ContextApprovedDirective,
  ContextDeniedDirective,
  ContextDirectiveRequest
} from './directives/types.js';

export type ContextNodeScope = 'system' | 'pack' | 'agent' | 'plugin';
export type ContextNodeSourceKind =
  | 'trace'
  | 'intent'
  | 'job'
  | 'post'
  | 'event'
  | 'summary'
  | 'manual'
  | 'policy_summary'
  | 'pack_state'
  | 'world_state'
  | 'overlay'
  | 'spatial_proximity';

export type ContextVisibilityLevel =
  | 'hidden_mandatory'
  | 'visible_fixed'
  | 'visible_flexible'
  | 'writable_overlay';

export type ContextReadAccess = 'visible' | 'exists_only' | 'hidden';

export interface ContextVisibilityPolicy {
  level: ContextVisibilityLevel;
  read_access: ContextReadAccess;
  /** Policy gate for field-level visibility control. */
  policy_gate?: string | null | undefined;
  blocked?: boolean | undefined;
}

export type ContextMutabilityLevel = 'immutable' | 'fixed' | 'flexible' | 'overlay';

export interface ContextMutabilityPolicy {
  level: ContextMutabilityLevel;
  can_summarize: boolean;
  can_reorder: boolean;
  can_hide: boolean;
}

export type ContextPlacementTier = 'system' | 'world' | 'memory' | 'output' | 'post_process' | 'other';

export interface ContextPlacementPolicy {
  preferred_slot: PromptFragmentSlot | null;
  locked: boolean;
  tier: ContextPlacementTier;
}

export interface ContextNodeContent {
  text: string;
  structured?: Record<string, unknown> | undefined;
  raw?: unknown;
}

export interface ContextNodeProvenance {
  created_by: 'system' | 'agent' | 'plugin';
  created_at_tick: string;
  parent_node_ids?: string[] | undefined;
}

// Known node_type values — kept as constants for discoverability.
// Dynamic node types (memory blocks, overlays, plugins) are allowed.
export const KNOWN_CONTEXT_NODE_TYPES = {
  SPATIAL_PROXIMITY: 'spatial_proximity',
  POLICY_SUMMARY: 'policy_summary',
  PACK_ACTOR_STATE: 'pack_actor_state_snapshot',
  PACK_WORLD_STATE: 'pack_world_state_snapshot',
  OWNED_ARTIFACTS: 'owned_artifacts_snapshot',
  PACK_LATEST_EVENT: 'pack_latest_event_snapshot',
  MEMORY_BLOCK: 'memory_block',
  OVERLAY: 'overlay_node',
  TRACE: 'trace',
  CONVERSATION_TURN: 'conversation_turn',
  NARRATIVE_EVENT: 'narrative_event'
} as const;

export type ContextNodeType = string;

export interface ContextNode {
  id: string;
  node_type: ContextNodeType;
  scope: ContextNodeScope;
  source_kind: ContextNodeSourceKind;
  source_ref: Record<string, unknown> | null;
  actor_ref?: Record<string, unknown> | null | undefined;
  content: ContextNodeContent;
  tags: string[];
  importance: number;
  salience: number;
  confidence?: number | null | undefined;
  created_at: string;
  occurred_at?: string | null | undefined;
  expires_at?: string | null | undefined;
  visibility: ContextVisibilityPolicy;
  mutability: ContextMutabilityPolicy;
  placement_policy: ContextPlacementPolicy;
  provenance: ContextNodeProvenance;
  metadata?: Record<string, unknown> | undefined;
}

export interface ContextDroppedNode {
  node_id: string;
  reason: string;
  source_kind?: ContextNodeSourceKind | null | undefined;
  node_type?: ContextNodeType | null | undefined;
}

export interface ContextSelectionResult {
  nodes: ContextNode[];
  dropped_nodes: ContextDroppedNode[];
}

export interface ContextPromptAssemblySummary {
  total_fragments: number;
  fragments_by_slot: Record<string, number>;
  fragment_sources: string[];
}

export type ContextPolicyReasonCode =
  | 'policy_gate_deny'
  | 'hidden_mandatory'
  | 'fixed_slot_locked'
  | 'transform_denied'
  | 'overlay_only_mutation';

export type ContextAdmissionDecision = 'allow' | 'allow_hidden' | 'deny';

export interface ContextNodeVisibilityDecision {
  level: ContextVisibilityLevel;
  read_access: ContextReadAccess;
  admission: ContextAdmissionDecision;
}

export interface ContextNodeOperationDecision {
  summarize_allowed: boolean;
  reorder_allowed: boolean;
  hide_allowed: boolean;
  content_mutation_allowed: boolean;
}

export interface ContextNodePlacementDecision {
  preferred_slot: PromptFragmentSlot | null;
  tier: ContextPlacementTier;
  locked: boolean;
  move_allowed: boolean;
}

export interface ContextNodePolicyDecision {
  node_id: string;
  node_type: string;
  source_kind: ContextNodeSourceKind;
  visibility: ContextNodeVisibilityDecision;
  operations: ContextNodeOperationDecision;
  placement: ContextNodePlacementDecision;
  reason_codes: ContextPolicyReasonCode[];
}

export interface ContextPolicyBlockedNode {
  node_id: string;
  reason_codes: ContextPolicyReasonCode[];
}

export interface ContextPolicyLockedNode {
  node_id: string;
  preferred_slot: PromptFragmentSlot | null;
  tier: ContextPlacementTier;
  reason_codes: ContextPolicyReasonCode[];
}

export interface ContextPolicyVisibilityDenial {
  node_id: string;
  read_access: ContextReadAccess;
  reason_codes: ContextPolicyReasonCode[];
}

export interface ContextOverlayLoadedNode {
  node_id: string;
  overlay_id: string;
  overlay_type: string;
  persistence_mode: string;
  created_by: 'system' | 'agent';
  status: string;
  preferred_slot: PromptFragmentSlot | null;
}

export interface ContextOverlayMutationRecord {
  overlay_id: string;
  operation: 'created' | 'updated' | 'archived' | 'deleted';
  node_id?: string | null | undefined;
  status?: string | null | undefined;
}

export interface ContextMemoryBlockMutationRecord {
  memory_id: string;
  operation: 'created' | 'updated' | 'deleted';
  kind?: string | null | undefined;
  status?: string | null | undefined;
  source_kind?: string | null | undefined;
}

export interface ContextMemoryBlockDiagnostics {
  evaluated: Array<{
    memory_id: string;
    status: 'inactive' | 'delayed' | 'active' | 'retained' | 'cooling';
    activation_score: number;
    matched_triggers: string[];
    reason: string | null;
    recent_distance_from_latest_message: number | null;
  }>;
  inserted: string[];
  delayed: string[];
  cooling: string[];
  retained: string[];
  inactive: string[];
}

export interface ContextRunDiagnostics {
  source_adapter_names: string[];
  node_count: number;
  node_counts_by_type: Record<string, number>;
  selected_node_ids: string[];
  dropped_nodes: ContextDroppedNode[];
  policy_decisions?: ContextNodePolicyDecision[] | undefined;
  blocked_nodes?: ContextPolicyBlockedNode[] | undefined;
  locked_nodes?: ContextPolicyLockedNode[] | undefined;
  visibility_denials?: ContextPolicyVisibilityDenial[] | undefined;
  overlay_nodes_loaded?: ContextOverlayLoadedNode[] | undefined;
  overlay_nodes_mutated?: ContextOverlayMutationRecord[] | undefined;
  memory_block_mutations?: ContextMemoryBlockMutationRecord[] | undefined;
  memory_blocks?: ContextMemoryBlockDiagnostics | null | undefined;
  submitted_directives?: ContextDirectiveRequest[] | undefined;
  approved_directives?: ContextApprovedDirective[] | undefined;
  denied_directives?: ContextDeniedDirective[] | undefined;
  selected_node_summaries?: Array<{ id: string; node_type: ContextNodeType; source_kind: ContextNodeSourceKind; preferred_slot: PromptFragmentSlot | null }> | undefined;
  orchestration?: Record<string, unknown> | undefined;
  prompt_assembly?: ContextPromptAssemblySummary | null | undefined;
}

export interface ContextRun {
  id: string;
  created_at_tick: string;
  nodes: ContextNode[];
  selected_node_ids: string[];
  diagnostics: ContextRunDiagnostics;
}
