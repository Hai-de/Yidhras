// ── Prompt workflow metadata layer ──
// 定义 prompt workflow 执行快照和元数据的核心类型。
// 被 ai_shared_trace.ts 和 ai_shared_bundle.ts 依赖。

import type { PromptProcessingTrace } from './ai_shared_trace.js';

/**
 * Prompt workflow step execution trace.
 */
export interface PromptWorkflowStepTraceSnapshot {
  key: string;
  kind: string;
  status: 'completed' | 'skipped' | 'failed';
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  notes?: Record<string, unknown>;
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
  step_traces?: PromptWorkflowStepTraceSnapshot[];
  placement_summary?: PromptWorkflowPlacementSummarySnapshot | null;
  variable_summary?: Record<string, unknown> | null;
  macro_summary?: unknown;
  section_summary?: Record<string, unknown> | null;
}

/**
 * Prompt workflow metadata carried through prompt bundles and AI messages.
 */
export interface PromptWorkflowMetadata {
  workflow_task_type?: string | null;
  workflow_profile_id?: string | null;
  workflow_profile_version?: string | null;
  workflow_step_keys?: string[];
  workflow_section_summary?: Record<string, unknown>;
  workflow_placement_summary?: Record<string, unknown>;
  workflow_variable_summary?: Record<string, unknown>;
  workflow_macro_summary?: unknown;
}

/**
 * Metadata carried by every PromptBundle (V2).
 */
export interface PromptBundleMetadata extends PromptWorkflowMetadata {
  prompt_version: string | null;
  source_prompt_keys: string[];
  processing_trace?: PromptProcessingTrace;
}
