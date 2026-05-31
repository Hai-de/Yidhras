// ── Prompt processing trace layer ──
// 定义 prompt workflow pipeline 产生的完整处理追踪。
// 依赖 ai_shared_common.ts 中的快照类型。

import type {
  PromptWorkflowSnapshot,
  PromptWorkflowStepTraceSnapshot
} from './ai_shared_common.js';

export type { PromptProcessingTrace } from './ai_shared_common.js';
