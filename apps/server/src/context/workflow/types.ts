import type { AiMessage } from '../../ai/types.js';
import type { PromptBundleV2 } from '../../inference/prompt_bundle_v2.js';
import type {
  PromptFragmentAnchor,
  PromptFragmentPlacementMode
} from '../../inference/prompt_fragment_v2.js';
import type { PromptFragmentSlot, PromptSlotConfig } from '../../inference/prompt_slot_config.js';
import type { PromptTree } from '../../inference/prompt_tree.js';
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
  | 'permission_filter'
  | 'bundle_finalize';

export interface PromptWorkflowStepSpec {
  key: string;
  kind: PromptWorkflowStepKind;
  enabled?: boolean;
  config?: Record<string, unknown>;
  requires?: string[];
  produces?: string[];
}

export interface PromptWorkflowProfile {
  id: string;
  version: string;
  description?: string;
  applies_to: {
    task_types?: string[];
    strategies?: Array<string>;
    pack_ids?: string[];
  };
  defaults?: {
    token_budget?: number;
    safety_margin_tokens?: number;
  };
  tracks?: {
    template?: boolean;
    node?: boolean;
    snapshot?: boolean;
  };
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
  | 'context_snapshot';

export type PromptSectionContentBlock =
  | {
      kind: 'text';
      text: string;
      metadata?: Record<string, unknown>;
    }
  | {
      kind: 'json';
      json: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    };

export interface PromptSectionDraft {
  id: string;
  track: 'template' | 'node' | 'snapshot' | (string & {});
  section_type: PromptSectionDraftType;
  title?: string | null;
  slot: PromptFragmentSlot;
  priority: number;
  source_node_ids: string[];
  content_blocks: PromptSectionContentBlock[];
  placement?: {
    anchor?: PromptFragmentAnchor | null;
    placement_mode?: PromptFragmentPlacementMode | null;
    depth?: number | null;
    order?: number | null;
  };
  removable: boolean;
  estimated_tokens?: number;
  metadata?: Record<string, unknown>;
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
  notes?: Record<string, unknown>;
}

export interface PromptWorkflowPlacementSummary {
  total_fragments: number;
  resolved_with_anchor: number;
  fallback_count: number;
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
  node_counts?: Record<string, number>;
  working_set_counts?: Record<string, number>;
  section_summary?: Record<string, unknown>;
  section_budget?: PromptWorkflowSectionBudgetSummary;
  placement_summary?: PromptWorkflowPlacementSummary;
  track_traces?: TrackTrace[];
}

export interface PromptWorkflowState {
  context_run: ContextRun | null;
  actor_ref: InferenceActorRef;
  task_type: PromptWorkflowTaskType;
  strategy: InferenceStrategy;
  pack_id: string;
  profile: PromptWorkflowProfile;
  include_sections?: string[];
  selected_nodes: ContextNode[];
  working_set: ContextNode[];
  grouped_nodes: Record<string, ContextNode[]>;
  section_drafts: PromptSectionDraft[];
  ai_messages?: AiMessage[];
  tree?: PromptTree;
  bundle?: PromptBundleV2;
  slot_registry?: Record<string, PromptSlotConfig>;
  diagnostics: PromptWorkflowDiagnostics;
}

export interface PromptWorkflowSelectionInput {
  task_type: PromptWorkflowTaskType;
  strategy: InferenceStrategy;
  pack_id: string;
  profile_id?: string | null;
}

export interface PromptWorkflowRunOptions {
  task_type?: PromptWorkflowTaskType;
  profile_id?: string | null;
  include_sections?: string[];
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
  tree?: PromptTree;
  include_sections?: string[];
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
    diagnostics: createPromptWorkflowDiagnostics(input.profile)
  };
};
