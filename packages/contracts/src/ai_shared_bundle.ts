// ── Prompt bundle layer ──
// 定义传递给 inference provider 的 prompt bundle 及其 metadata。
// 依赖 ai_shared_metadata.ts 和 ai_shared_trace.ts。

import type { PromptWorkflowMetadata } from './ai_shared_metadata.js';
import type { PromptProcessingTrace } from './ai_shared_trace.js';

/**
 * Metadata carried by every PromptBundle.
 */
export interface PromptBundleMetadata extends PromptWorkflowMetadata {
  prompt_version: string | null;
  source_prompt_keys: string[];
  processing_trace?: PromptProcessingTrace;
}

/**
 * Prompt bundle passed to inference providers.
 */
export interface PromptBundle {
  system_prompt: string;
  role_prompt: string;
  world_prompt: string;
  context_prompt: string;
  output_contract_prompt: string;
  combined_prompt: string;
  metadata: PromptBundleMetadata;
}
