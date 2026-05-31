import type { PromptBundleMetadata } from '@yidhras/contracts';

import type { AiMessage, AiResolvedTaskConfig } from '../ai/types.js';
import type { PromptTree } from './prompt_tree.js';

export interface PromptBundleV2 {
  slots: Record<string, string>;
  /** 显式渲染顺序（slot_id 数组，按 resolved_position 降序）。slots map 仅做随机查找。 */
  slot_order: string[];
  combined_prompt: string;
  metadata: PromptBundleMetadata;
  tree: PromptTree;
}

export interface PromptBundleToAiMessagesAdapter {
  adapt(bundle: PromptBundleV2, taskConfig: AiResolvedTaskConfig): AiMessage[];
}
