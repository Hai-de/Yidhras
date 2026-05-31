// ── Prompt workflow metadata layer ──
// 定义 prompt workflow 执行快照和元数据的核心类型。
// 被 ai_shared_trace.ts 和 ai_shared_bundle.ts 依赖。

import type { PromptProcessingTrace } from './ai_shared_common.js';
export type {
  PromptProcessingTrace,
  PromptWorkflowPlacementSummarySnapshot,
  PromptWorkflowSnapshot,
  PromptWorkflowStepTraceSnapshot
} from './ai_shared_common.js';

/**
 * Prompt workflow metadata carried through prompt bundles and AI messages.
 */
export interface PromptWorkflowMetadata {
  workflow_task_type?: string | null | undefined | undefined;
  workflow_profile_id?: string | null | undefined | undefined;
  workflow_profile_version?: string | null | undefined | undefined;
  workflow_step_keys?: string[] | undefined | undefined;
  workflow_section_summary?: Record<string, unknown> | undefined | undefined;
  workflow_placement_summary?: Record<string, unknown> | undefined | undefined;
  workflow_variable_summary?: Record<string, unknown> | undefined | undefined;
  workflow_macro_summary?: unknown | undefined | undefined;
}

/**
 * Metadata carried by every PromptBundle (V2).
 */
export interface PromptBundleMetadata extends PromptWorkflowMetadata {
  prompt_version: string | null;
  source_prompt_keys: string[];
  processing_trace?: PromptProcessingTrace | undefined | undefined;
}
