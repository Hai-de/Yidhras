// ── Prompt processing trace layer ──
// 定义 prompt workflow pipeline 产生的完整处理追踪。
// 依赖 ai_shared_metadata.ts 中的快照类型。

import type {
  PromptWorkflowSnapshot,
  PromptWorkflowStepTraceSnapshot
} from './ai_shared_metadata.js';

/**
 * Processing trace produced by the prompt workflow pipeline.
 * Note: slot types use `string` here for contracts compatibility;
 * inference/types.ts keeps the stricter PromptFragment['slot'] union.
 */
export interface PromptProcessingTrace {
  processor_names: string[];
  fragment_count_before: number;
  fragment_count_after: number;
  workflow_task_type?: string | null;
  workflow_profile_id?: string | null;
  workflow_profile_version?: string | null;
  workflow_step_keys?: string[];
  workflow_step_traces?: PromptWorkflowStepTraceSnapshot[];
  prompt_workflow?: PromptWorkflowSnapshot | null;
  steps?: Array<{
    processor_name: string;
    fragment_count_before: number;
    fragment_count_after: number;
    added_fragment_ids?: string[];
    removed_fragment_ids?: string[];
    notes?: Record<string, unknown>;
  }>;
  fragments: Array<{
    id: string;
    slot: string;
    source: string;
    priority: number;
    metadata?: Record<string, unknown>;
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
    task_type?: string | null;
    budget: number;
    used: number;
    trimmed_fragment_ids: string[];
    kept_fragment_ids?: string[];
    always_kept_fragment_ids?: string[];
    kept_optional_fragment_ids?: string[];
    slot_priority?: Partial<Record<string, number>>;
    optional_fragment_scores?: Array<{
      fragment_id: string;
      slot: string;
      score: number;
      estimated_cost: number;
      kept: boolean;
    }>;
    trimmed_by_slot?: Partial<Record<string, string[]>>;
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
    trimmed_sources?: string[];
    section_summary?: Record<string, unknown> | null;
  } | null;
}
