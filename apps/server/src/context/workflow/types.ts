import type { AiMessage } from '../../ai/types.js';
import type { PromptBundleV2 } from '../../inference/prompt_bundle_v2.js';
import type {
  PromptFragmentAnchor,
  PromptFragmentPlacementMode
} from '../../inference/prompt_fragment_v2.js';
import type {
  PromptFragmentSlot,
  PromptSlotConfig,
  ResolvedSlotPosition,
  SlotPositionDiagnostics
} from '../../inference/prompt_slot_config.js';
import type { PromptTree } from '../../inference/prompt_tree.js';
import type { SlotBehaviorProfile } from '../../inference/slot_behavior.js';
import type { SlotBehaviorState } from '../../inference/slot_behavior_state.js';
import type {
  InferenceActorRef,
  InferenceStrategy
} from '../../inference/types.js';
import type { ContextNode, ContextRun } from '../types.js';

export type PromptWorkflowTaskType =
  | 'agent_decision'
  | 'context_summary'
  | 'memory_compaction'
  | 'intent_grounding_assist'
  | (string & {});

export type PromptWorkflowStepKind =
  | 'memory_projection'
  | 'node_working_set_filter'
  | 'node_grouping'
  | 'summary_compaction'
  | 'token_budget_trim'
  | 'placement_resolution'
  | 'fragment_assembly'
  | 'behavior_control'
  | 'content_transform'
  | 'permission_filter'
  | 'bundle_finalize';

export interface PromptWorkflowStepSpec {
  key: string;
  kind: PromptWorkflowStepKind;
  enabled?: boolean | undefined;
  config?: Record<string, unknown> | undefined;
  requires?: string[] | undefined;
  produces?: string[] | undefined;
}

export interface PromptWorkflowProfile {
  id: string;
  version: string;
  description?: string | undefined;
  applies_to: {
    task_types?: string[] | undefined;
    strategies?: Array<string> | undefined;
    pack_ids?: string[] | undefined;
  };
  defaults?: {
    token_budget?: number | undefined;
    safety_margin_tokens?: number | undefined;
  } | undefined;
  tracks?: {
    template?: boolean | undefined;
    node?: boolean | undefined;
    snapshot?: boolean | undefined;
    conversation_history?: boolean | undefined;
  };
  /** Multi-turn conversation: YAML profile name (e.g. 'chat-first-turn') */
  conversation_profile?: string | undefined;
  steps: PromptWorkflowStepSpec[];
}

export type PromptSectionDraftType =
  | 'system_instruction'
  | 'role_context'
  | 'world_context'
  | 'system_policy'
  | 'recent_evidence'
  | 'memory_short_term'
  | 'memory_long_term'
  | 'memory_summary'
  | 'output_contract'
  | 'context_snapshot'
  | 'conversation_history';

export type PromptSectionContentBlock =
  | {
      kind: 'text';
      text: string;
      metadata?: Record<string, unknown> | undefined;
    }
  | {
      kind: 'json';
      json: Record<string, unknown>;
      metadata?: Record<string, unknown> | undefined;
    };

export interface PromptSectionDraft {
  id: string;
  track: 'template' | 'node' | 'snapshot' | (string & {});
  section_type: PromptSectionDraftType;
  title?: string | null | undefined;
  slot: PromptFragmentSlot;
  priority: number;
  source_node_ids: string[];
  content_blocks: PromptSectionContentBlock[];
  placement?: {
    anchor?: PromptFragmentAnchor | null | undefined;
    placement_mode?: PromptFragmentPlacementMode | null | undefined;
    depth?: number | null | undefined;
    order?: number | null | undefined;
  };
  removable: boolean;
  estimated_tokens?: number | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface TrackResult<T> {
  result: T;
  trace: TrackTrace;
}

export interface PromptWorkflowSectionBudgetAllocation {
  section_id: string;
  section_type: PromptSectionDraftType;
  slot: PromptFragmentSlot;
  budget_share: number;
  budget_tokens: number;
  ranking_score: number;
  kept: boolean;
}

export interface PromptWorkflowSectionBudgetSummary {
  mode: 'fragment_only' | 'section_level';
  total_budget: number;
  allocated_budget: number;
  allocations: PromptWorkflowSectionBudgetAllocation[];
  kept_section_ids: string[];
  dropped_section_ids: string[];
}

export interface StepSnapshotSummary {
  section_drafts_count: number;
  fragment_count: number;
  total_estimated_tokens: number;
  denied_fragment_count: number;
  working_set_node_count: number;
}

export interface PromptWorkflowStepTrace {
  key: string;
  kind: PromptWorkflowStepKind;
  status: 'completed' | 'skipped' | 'failed';
  before: StepSnapshotSummary;
  after: StepSnapshotSummary;
  notes?: Record<string, unknown> | undefined;
}

export interface AnchorDiagnostic {
  draft_id: string;
  slot_id: string;
  anchor_kind: string;
  anchor_value: string;
  code: 'resolved' | 'target_not_found' | 'tag_not_implemented';
  message?: string | undefined;
}

export interface PromptWorkflowPlacementSummary {
  total_fragments: number;
  resolved_with_anchor: number;
  fallback_count: number;
  anchor_diagnostics?: AnchorDiagnostic[] | undefined;
}

export interface TrackTrace {
  track: 'template' | 'node' | 'snapshot' | (string & {});
  input_summary: Record<string, unknown>;
  output_summary: Record<string, unknown>;
  decisions: Record<string, unknown>[];
}

export interface PromptWorkflowDiagnostics {
  profile_id: string;
  profile_version: string;
  selected_step_keys: string[];
  step_traces: PromptWorkflowStepTrace[];
  node_counts?: Record<string, number> | undefined;
  working_set_counts?: Record<string, number> | undefined;
  section_summary?: Record<string, unknown> | undefined;
  section_budget?: PromptWorkflowSectionBudgetSummary | undefined;
  placement_summary?: PromptWorkflowPlacementSummary | undefined;
  slot_position_diagnostics?: SlotPositionDiagnostics | undefined;
  track_traces?: TrackTrace[] | undefined;
}

export interface SlotBehaviorDiagnostic {
  profiles_evaluated: number;
  slots_activated: string[];
  slots_disabled: string[];
  evaluation_errors: { slot_id: string; error: string }[];
}

export interface PromptWorkflowState {
  context_run: ContextRun | null;
  actor_ref: InferenceActorRef;
  task_type: PromptWorkflowTaskType;
  strategy: InferenceStrategy;
  pack_id: string;
  profile: PromptWorkflowProfile;
  include_sections?: string[] | undefined;
  selected_nodes: ContextNode[];
  working_set: ContextNode[];
  grouped_nodes: Record<string, ContextNode[]>;
  section_drafts: PromptSectionDraft[];
  ai_messages?: AiMessage[] | undefined;
  tree?: PromptTree | undefined;
  bundle?: PromptBundleV2 | undefined;
  slot_registry?: Record<string, PromptSlotConfig> | undefined;
  resolved_positions?: ResolvedSlotPosition[] | undefined;
  diagnostics: PromptWorkflowDiagnostics;
  behavior_profiles?: SlotBehaviorProfile[] | undefined;
  behavior_states?: Record<string, SlotBehaviorState> | undefined;
  slot_behavior_diagnostics?: SlotBehaviorDiagnostic | undefined;
}

export interface PromptWorkflowSelectionInput {
  task_type: PromptWorkflowTaskType;
  strategy: InferenceStrategy;
  pack_id: string;
  profile_id?: string | null | undefined;
}

export interface PromptWorkflowRunOptions {
  task_type?: PromptWorkflowTaskType | undefined;
  profile_id?: string | null | undefined;
  include_sections?: string[] | undefined;
}

export const createPromptWorkflowDiagnostics = (profile: PromptWorkflowProfile): PromptWorkflowDiagnostics => ({
  profile_id: profile.id,
  profile_version: profile.version,
  selected_step_keys: profile.steps.filter(step => step.enabled !== false).map(step => step.key),
  step_traces: []
});

export const createInitialPromptWorkflowState = (input: {
  context_run: ContextRun | null;
  actor_ref: InferenceActorRef;
  task_type: PromptWorkflowTaskType;
  strategy: InferenceStrategy;
  pack_id: string;
  profile: PromptWorkflowProfile;
  tree?: PromptTree | undefined;
  include_sections?: string[] | undefined;
}): PromptWorkflowState => {
  const safeNodes = input.context_run?.nodes ?? [];
  return {
    context_run: input.context_run,
    actor_ref: input.actor_ref,
    task_type: input.task_type,
    strategy: input.strategy,
    pack_id: input.pack_id,
    profile: input.profile,
    include_sections: input.include_sections,
    selected_nodes: safeNodes,
    working_set: safeNodes,
    grouped_nodes: {},
    section_drafts: [],
    tree: input.tree,
    resolved_positions: input.tree?.resolved_positions ?? [],
    diagnostics: createPromptWorkflowDiagnostics(input.profile)
  };
};
