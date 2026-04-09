import { describe, expect, it } from 'vitest';

import type {
  ContextApprovedDirective,
  ContextDeniedDirective,
  ContextDirectiveDeniedCode,
  ContextDirectiveRequest,
  ContextDirectiveType
} from '../../src/context/directives/types.js';

describe('context directives schema reservation', () => {
  it('supports the reserved directive types and deny codes without enabling execution', () => {
    const directiveTypes: ContextDirectiveType[] = [
      'create_self_note',
      'pin_node',
      'deprioritize_node',
      'summarize_cluster',
      'archive_overlay'
    ];

    const deniedCodes: ContextDirectiveDeniedCode[] = [
      'directive_execution_disabled',
      'hidden_mandatory_protected',
      'fixed_slot_reorder_forbidden',
      'source_of_truth_mutation_forbidden',
      'guard_node_hide_forbidden',
      'constitution_anchor_override_forbidden',
      'overlay_not_found',
      'unsupported_directive_type'
    ];

    const submitted: ContextDirectiveRequest = {
      id: 'directive-1',
      directive_type: 'create_self_note',
      submitted_by: 'model',
      target_node_id: null,
      target_overlay_id: null,
      payload: {
        title: 'remember target',
        content_text: 'need face confirmation'
      }
    };

    const approved: ContextApprovedDirective = {
      id: 'directive-2',
      directive_type: 'pin_node',
      approved_by: 'policy_engine',
      target_node_id: 'overlay-1',
      target_overlay_id: null,
      resulting_overlay_mutation_ids: ['overlay-mutation-1']
    };

    const denied: ContextDeniedDirective = {
      id: 'directive-3',
      directive_type: 'archive_overlay',
      denied_by: 'system',
      denial_code: 'directive_execution_disabled',
      denial_reason: 'Directive execution remains disabled in this phase.',
      target_node_id: null,
      target_overlay_id: 'overlay-1'
    };

    expect(directiveTypes).toHaveLength(5);
    expect(deniedCodes).toContain('directive_execution_disabled');
    expect(submitted.directive_type).toBe('create_self_note');
    expect(approved.resulting_overlay_mutation_ids).toEqual(['overlay-mutation-1']);
    expect(denied.denial_code).toBe('directive_execution_disabled');
  });
});
