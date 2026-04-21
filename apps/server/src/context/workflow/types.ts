import type { AiMessage } from '../../ai/types.js';
import type {
  PromptFragment,
  PromptFragmentAnchor,
  PromptFragmentPlacementMode,
  PromptFragmentSlot
} from '../../inference/prompt_fragments.js';
import type {
  InferenceActorRef,
  InferenceStrategy,
  PromptBundle
} from '../../inference/types.js';
import type { ContextNode, ContextRun } from '../types.js';

export type PromptWorkflowTaskType =
  | 'agent_decision'
  | 'context_summary'
  | 'memory_compaction'
  | 'intent_grounding_assist'
  | (string & {});

export type PromptWorkflowSectionPolicy = 'minimal' | 'standard' | 'expanded';

export type PromptWorkflowStepKind =
  | 'memory_projection'
  | 'node_working_set_filter'
  | 'node_grouping'
  | 'summary_compaction'
  | 'token_budget_trim'
  | 'placement_resolution'
  | 'fragment_assembly'
  | 'bundle_finalize'
  | 'ai_message_projection';

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
    strategies?: Array<InferenceStrategy | string>;
    pack_ids?: string[];
  };
  defaults?: {
    token_budget?: number;
    section_policy?: PromptWorkflowSectionPolicy;
  };
  steps: PromptWorkflowStepSpec[];
}

export type PromptSectionDraftType =
  | 'system_instruction'
  | 'role_context'
  | 'world_context'
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
  section_type: PromptSectionDraftType;
  title?: string | null;
  slot: PromptFragmentSlot;
  source_node_ids: string[];
  content_blocks: PromptSectionContentBlock[];
  placement?: {
    anchor?: PromptFragmentAnchor | null;
    placement_mode?: PromptFragmentPlacementMode | null;
    depth?: number | null;
    order?: number | null;
  };
  metadata?: Record<string, unknown>;
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

export interface PromptWorkflowStepTrace {
  key: string;
  kind: PromptWorkflowStepKind;
  status: 'completed' | 'skipped' | 'failed';
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  notes?: Record<string, unknown>;
}

export interface PromptWorkflowPlacementSummary {
  total_fragments: number;
  resolved_with_anchor: number;
  fallback_count: number;
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
  compatibility?: {
    legacy_processors_used: string[];
  };
}

export interface PromptWorkflowState {
  context_run: ContextRun;
  actor_ref: InferenceActorRef;
  task_type: PromptWorkflowTaskType;
  strategy: InferenceStrategy;
  pack_id: string;
  profile: PromptWorkflowProfile;
  selected_nodes: ContextNode[];
  working_set: ContextNode[];
  grouped_nodes: Record<string, ContextNode[]>;
  section_drafts: PromptSectionDraft[];
  fragments: PromptFragment[];
  prompt_bundle: PromptBundle | null;
  ai_messages?: AiMessage[];
  compatibility: Record<string, never>;
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
}

export const createPromptWorkflowDiagnostics = (profile: PromptWorkflowProfile): PromptWorkflowDiagnostics => ({
  profile_id: profile.id,
  profile_version: profile.version,
  selected_step_keys: profile.steps.filter(step => step.enabled !== false).map(step => step.key),
  step_traces: [],
  compatibility: {
    legacy_processors_used: []
  }
});

export const createInitialPromptWorkflowState = (input: {
  context_run: ContextRun;
  actor_ref: InferenceActorRef;
  task_type: PromptWorkflowTaskType;
  strategy: InferenceStrategy;
  pack_id: string;
  profile: PromptWorkflowProfile;
  fragments?: PromptFragment[];
  compatibility?: Record<string, never>;
}): PromptWorkflowState => {
  return {
    context_run: input.context_run,
    actor_ref: input.actor_ref,
    task_type: input.task_type,
    strategy: input.strategy,
    pack_id: input.pack_id,
    profile: input.profile,
    selected_nodes: input.context_run.nodes,
    working_set: input.context_run.nodes,
    grouped_nodes: {},
    section_drafts: [],
    fragments: input.fragments ?? [],
    prompt_bundle: null,
    compatibility: {},
    diagnostics: createPromptWorkflowDiagnostics(input.profile)
  };
};
