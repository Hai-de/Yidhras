// ── Shared prompt workflow types ──
// Common types used by both ai_shared_metadata.ts and ai_shared_trace.ts.
// This file has no imports from siblings to avoid cycles.

/**
 * Prompt workflow step execution trace.
 */
export interface PromptWorkflowStepTraceSnapshot {
  key: string;
  kind: string;
  status: 'completed' | 'skipped' | 'failed';
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  notes?: Record<string, unknown> | undefined | undefined;
}

/**
 * Fragment placement resolution summary.
 */
export interface PromptWorkflowPlacementSummarySnapshot {
  total_fragments: number;
  resolved_with_anchor: number;
  fallback_count: number;
}

/**
 * Prompt workflow execution snapshot carried in prompt metadata.
 */
export interface PromptWorkflowSnapshot {
  task_type: string | null;
  profile_id: string | null;
  profile_version: string | null;
  selected_step_keys: string[];
  step_traces?: PromptWorkflowStepTraceSnapshot[] | undefined | undefined;
  placement_summary?: PromptWorkflowPlacementSummarySnapshot | null | undefined | undefined;
  variable_summary?: Record<string, unknown> | null | undefined | undefined;
  macro_summary?: unknown | undefined | undefined;
  section_summary?: Record<string, unknown> | null | undefined | undefined;
}

/**
 * Processing trace produced by the prompt workflow pipeline.
 */
export interface PromptProcessingTrace {
  processor_names: string[];
  fragment_count_before: number;
  fragment_count_after: number;
  workflow_task_type?: string | null | undefined | undefined;
  workflow_profile_id?: string | null | undefined | undefined;
  workflow_profile_version?: string | null | undefined | undefined;
  workflow_step_keys?: string[] | undefined | undefined;
  workflow_step_traces?: PromptWorkflowStepTraceSnapshot[] | undefined | undefined;
  prompt_workflow?: PromptWorkflowSnapshot | null | undefined | undefined;
  steps?: Array<{
    processor_name: string;
    fragment_count_before: number;
    fragment_count_after: number;
    added_fragment_ids?: string[] | undefined | undefined;
    removed_fragment_ids?: string[] | undefined | undefined;
    notes?: Record<string, unknown> | undefined | undefined;
  }>;
  fragments: Array<{
    id: string;
    slot: string;
    source: string;
    priority: number;
    metadata?: Record<string, unknown> | undefined | undefined;
  }>;
  summary_compaction?: {
    summarized_fragment_ids: string[];
    summary_fragment_id: string;
  } | null;
  policy_filtering?: {
    filtered_fragment_ids: string[];
    reasons: Record<string, string>;
  } | null;
  token_budget_trimming?: {
    task_type?: string | null | undefined | undefined;
    budget: number;
    used: number;
    trimmed_fragment_ids: string[];
    kept_fragment_ids?: string[] | undefined | undefined;
    always_kept_fragment_ids?: string[] | undefined | undefined;
    kept_optional_fragment_ids?: string[] | undefined | undefined;
    slot_priority?: Partial<Record<string, number>> | undefined | undefined;
    optional_fragment_scores?: Array<{
      fragment_id: string;
      slot: string;
      score: number;
      estimated_cost: number;
      kept: boolean;
    }>;
    trimmed_by_slot?: Partial<Record<string, string[]>> | undefined | undefined;
    section_budget?: {
      mode: 'fragment_only' | 'section_level';
      total_budget: number;
      allocated_budget: number;
      allocations: Array<{
        section_id: string;
        section_type: string;
        slot: string;
        budget_share: number;
        budget_tokens: number;
        ranking_score: number;
        kept: boolean;
      }>;
      kept_section_ids: string[];
      dropped_section_ids: string[];
    } | null;
    trimmed_sources?: string[] | undefined | undefined;
    section_summary?: Record<string, unknown> | null | undefined | undefined;
  } | null;
}
