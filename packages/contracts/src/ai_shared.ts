// ── Barrel: Shared AI / Inference bridge types ──
// Consumer 端继续从此文件导入，内部按层拆分到 metadata / trace / bundle。

export type {
  PromptWorkflowMetadata,
  PromptWorkflowPlacementSummarySnapshot,
  PromptWorkflowSnapshot,
  PromptWorkflowStepTraceSnapshot
} from './ai_shared_metadata.js';

export type { PromptProcessingTrace } from './ai_shared_trace.js';

export type {
  PromptBundle,
  PromptBundleMetadata
} from './ai_shared_bundle.js';
