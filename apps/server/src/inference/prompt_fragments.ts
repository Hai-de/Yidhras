export type PromptFragmentSlot =
  | 'system_core'
  | 'system_policy'
  | 'role_core'
  | 'world_context'
  | 'memory_short_term'
  | 'memory_long_term'
  | 'memory_summary'
  | 'output_contract'
  | 'post_process';

export interface PromptFragment {
  id: string;
  slot: PromptFragmentSlot;
  priority: number;
  content: string;
  source: string;
  removable?: boolean;
  replaceable?: boolean;
  metadata?: Record<string, unknown>;
}
