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

export type PromptFragmentPlacementMode = 'prepend' | 'append' | 'before_anchor' | 'after_anchor';
export type PromptFragmentAnchorKind = 'slot_start' | 'slot_end' | 'source' | 'tag' | 'fragment_id';

export interface PromptFragmentAnchor {
  kind: PromptFragmentAnchorKind;
  value: string;
}

export interface PromptFragment {
  id: string;
  slot: PromptFragmentSlot;
  priority: number;
  content: string;
  source: string;
  removable?: boolean;
  replaceable?: boolean;
  anchor?: PromptFragmentAnchor | null;
  placement_mode?: PromptFragmentPlacementMode | null;
  depth?: number | null;
  order?: number | null;
  metadata?: Record<string, unknown>;
}
