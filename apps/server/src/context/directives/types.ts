export type ContextDirectiveType =
  | 'create_self_note'
  | 'pin_node'
  | 'deprioritize_node'
  | 'summarize_cluster'
  | 'archive_overlay';

export type ContextDirectiveStatus = 'submitted' | 'approved' | 'denied';

export type ContextDirectiveDeniedCode =
  | 'directive_execution_disabled'
  | 'hidden_mandatory_protected'
  | 'fixed_slot_reorder_forbidden'
  | 'source_of_truth_mutation_forbidden'
  | 'guard_node_hide_forbidden'
  | 'constitution_anchor_override_forbidden'
  | 'overlay_not_found'
  | 'unsupported_directive_type';

export interface ContextDirectiveRequest {
  id: string;
  directive_type: ContextDirectiveType;
  submitted_by: 'system' | 'agent' | 'model';
  target_node_id?: string | null;
  target_overlay_id?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface ContextApprovedDirective {
  id: string;
  directive_type: ContextDirectiveType;
  approved_by: 'system' | 'policy_engine';
  target_node_id?: string | null;
  target_overlay_id?: string | null;
  resulting_overlay_mutation_ids?: string[];
}

export interface ContextDeniedDirective {
  id: string;
  directive_type: ContextDirectiveType;
  denied_by: 'system' | 'policy_engine';
  denial_code: ContextDirectiveDeniedCode;
  denial_reason: string;
  target_node_id?: string | null;
  target_overlay_id?: string | null;
}
