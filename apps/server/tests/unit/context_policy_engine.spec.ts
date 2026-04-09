import { describe, expect, it } from 'vitest';

import { applyPolicyDecisionsToSelection, evaluateContextPolicies } from '../../src/context/policy_engine.js';
import type { ContextNode, ContextSelectionResult } from '../../src/context/types.js';

const buildNode = (input: Partial<ContextNode> & { id: string; node_type: string }): ContextNode => ({
  id: input.id,
  node_type: input.node_type,
  scope: input.scope ?? 'agent',
  source_kind: input.source_kind ?? 'trace',
  source_ref: input.source_ref ?? null,
  actor_ref: input.actor_ref ?? null,
  content: input.content ?? { text: input.id },
  tags: input.tags ?? [],
  importance: input.importance ?? 0.5,
  salience: input.salience ?? 0.5,
  confidence: input.confidence ?? null,
  created_at: input.created_at ?? '1000',
  occurred_at: input.occurred_at ?? '1000',
  expires_at: input.expires_at ?? null,
  visibility: input.visibility ?? {
    level: 'visible_flexible',
    read_access: 'visible',
    policy_gate: 'allow',
    blocked: false
  },
  mutability: input.mutability ?? {
    level: 'flexible',
    can_summarize: true,
    can_reorder: true,
    can_hide: true
  },
  placement_policy: input.placement_policy ?? {
    preferred_slot: 'memory_short_term',
    locked: false,
    tier: 'memory'
  },
  provenance: input.provenance ?? {
    created_by: 'system',
    created_at_tick: '1000',
    parent_node_ids: []
  },
  metadata: input.metadata ?? {}
});

describe('context policy engine', () => {
  it('classifies hidden mandatory, fixed and overlay nodes into node-level decisions', () => {
    const hiddenNode = buildNode({
      id: 'hidden-node',
      node_type: 'system_instruction',
      visibility: {
        level: 'hidden_mandatory',
        read_access: 'hidden',
        policy_gate: 'allow',
        blocked: false
      },
      mutability: {
        level: 'immutable',
        can_summarize: false,
        can_reorder: false,
        can_hide: false
      },
      placement_policy: {
        preferred_slot: 'system_core',
        locked: true,
        tier: 'system'
      }
    });

    const deniedNode = buildNode({
      id: 'denied-node',
      node_type: 'recent_intent',
      visibility: {
        level: 'visible_flexible',
        read_access: 'visible',
        policy_gate: 'deny',
        blocked: true
      }
    });

    const overlayNode = buildNode({
      id: 'overlay-node',
      node_type: 'self_note',
      source_kind: 'manual',
      visibility: {
        level: 'writable_overlay',
        read_access: 'visible',
        policy_gate: 'allow',
        blocked: false
      },
      mutability: {
        level: 'overlay',
        can_summarize: true,
        can_reorder: true,
        can_hide: true
      },
      placement_policy: {
        preferred_slot: 'memory_long_term',
        locked: false,
        tier: 'memory'
      }
    });

    const fixedNode = buildNode({
      id: 'fixed-node',
      node_type: 'policy_summary',
      source_kind: 'policy_summary',
      visibility: {
        level: 'visible_fixed',
        read_access: 'visible',
        policy_gate: 'allow',
        blocked: false
      },
      mutability: {
        level: 'fixed',
        can_summarize: false,
        can_reorder: false,
        can_hide: false
      },
      placement_policy: {
        preferred_slot: 'system_policy',
        locked: true,
        tier: 'system'
      }
    });

    const result = evaluateContextPolicies([hiddenNode, deniedNode, overlayNode, fixedNode]);

    expect(result.hidden_nodes.map(node => node.id)).toEqual(['hidden-node']);
    expect(result.denied_nodes.map(node => node.id)).toEqual(['denied-node']);
    expect(result.selected_nodes.map(node => node.id)).toEqual(['overlay-node', 'fixed-node']);

    const hiddenDecision = result.policy_decisions.find(item => item.node_id === 'hidden-node');
    expect(hiddenDecision?.visibility.admission).toBe('allow_hidden');
    expect(hiddenDecision?.placement.locked).toBe(true);
    expect(hiddenDecision?.reason_codes).toContain('hidden_mandatory');

    const deniedDecision = result.policy_decisions.find(item => item.node_id === 'denied-node');
    expect(deniedDecision?.visibility.admission).toBe('deny');
    expect(deniedDecision?.reason_codes).toContain('policy_gate_deny');

    const overlayDecision = result.policy_decisions.find(item => item.node_id === 'overlay-node');
    expect(overlayDecision?.operations.content_mutation_allowed).toBe(true);
    expect(overlayDecision?.reason_codes).toContain('overlay_only_mutation');

    const fixedDecision = result.policy_decisions.find(item => item.node_id === 'fixed-node');
    expect(fixedDecision?.operations.reorder_allowed).toBe(false);
    expect(result.locked_nodes.some(item => item.node_id === 'fixed-node')).toBe(true);
  });

  it('applies node-level policy denials and hidden nodes back into selection results', () => {
    const selection: ContextSelectionResult = {
      nodes: [
        buildNode({ id: 'visible-node', node_type: 'recent_trace' }),
        buildNode({
          id: 'denied-node',
          node_type: 'recent_intent',
          visibility: {
            level: 'visible_flexible',
            read_access: 'visible',
            policy_gate: 'deny',
            blocked: true
          }
        }),
        buildNode({
          id: 'hidden-node',
          node_type: 'system_instruction',
          visibility: {
            level: 'hidden_mandatory',
            read_access: 'hidden',
            policy_gate: 'allow',
            blocked: false
          },
          mutability: {
            level: 'immutable',
            can_summarize: false,
            can_reorder: false,
            can_hide: false
          },
          placement_policy: {
            preferred_slot: 'system_core',
            locked: true,
            tier: 'system'
          }
        })
      ],
      dropped_nodes: []
    };

    const policyResult = evaluateContextPolicies(selection.nodes);
    const nextSelection = applyPolicyDecisionsToSelection(selection, policyResult);

    expect(nextSelection.nodes.map(node => node.id)).toEqual(['visible-node']);
    expect(nextSelection.dropped_nodes).toEqual([
      {
        node_id: 'denied-node',
        reason: 'policy_denied',
        source_kind: 'trace',
        node_type: 'recent_intent'
      },
      {
        node_id: 'hidden-node',
        reason: 'hidden_mandatory',
        source_kind: 'trace',
        node_type: 'system_instruction'
      }
    ]);
    expect(policyResult.visibility_denials.some(entry => entry.node_id === 'hidden-node')).toBe(true);
  });
});
