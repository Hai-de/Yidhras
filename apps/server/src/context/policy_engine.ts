import type {
  ContextNode,
  ContextNodeOperationDecision,
  ContextNodePlacementDecision,
  ContextNodePolicyDecision,
  ContextNodeVisibilityDecision,
  ContextPolicyBlockedNode,
  ContextPolicyLockedNode,
  ContextPolicyReasonCode,
  ContextPolicyVisibilityDenial,
  ContextSelectionResult,
  ContextVisibilityLevel
} from './types.js';

const resolveAdmission = (level: ContextVisibilityLevel, blocked: boolean): ContextNodeVisibilityDecision['admission'] => {
  if (blocked) {
    return 'deny';
  }

  if (level === 'hidden_mandatory') {
    return 'allow_hidden';
  }

  return 'allow';
};

const buildReasonCodes = (node: ContextNode): ContextPolicyReasonCode[] => {
  const reasonCodes: ContextPolicyReasonCode[] = [];

  if (node.visibility.level === 'hidden_mandatory') {
    reasonCodes.push('hidden_mandatory');
  }

  if (node.visibility.policy_gate === 'deny' || node.visibility.blocked === true) {
    reasonCodes.push('policy_gate_deny');
  }

  if (node.placement_policy.locked) {
    reasonCodes.push('fixed_slot_locked');
  }

  if (!node.mutability.can_summarize || !node.mutability.can_reorder || !node.mutability.can_hide) {
    reasonCodes.push('transform_denied');
  }

  if (node.visibility.level === 'writable_overlay' || node.mutability.level === 'overlay') {
    reasonCodes.push('overlay_only_mutation');
  }

  return Array.from(new Set(reasonCodes));
};

const buildVisibilityDecision = (node: ContextNode): ContextNodeVisibilityDecision => {
  const blocked = node.visibility.policy_gate === 'deny' || node.visibility.blocked === true;

  return {
    level: node.visibility.level,
    read_access: node.visibility.read_access,
    admission: resolveAdmission(node.visibility.level, blocked),
  };
};

const buildOperationDecision = (node: ContextNode): ContextNodeOperationDecision => {
  const summarizeAllowed = node.visibility.level !== 'hidden_mandatory' && node.mutability.can_summarize;
  const reorderAllowed = !node.placement_policy.locked && node.mutability.can_reorder;
  const hideAllowed = node.visibility.level === 'visible_flexible' && node.mutability.can_hide;
  const contentMutationAllowed = node.visibility.level === 'writable_overlay' && node.mutability.level === 'overlay';

  return {
    summarize_allowed: summarizeAllowed,
    reorder_allowed: reorderAllowed,
    hide_allowed: hideAllowed,
    content_mutation_allowed: contentMutationAllowed
  };
};

const buildPlacementDecision = (node: ContextNode): ContextNodePlacementDecision => {
  return {
    preferred_slot: node.placement_policy.preferred_slot,
    tier: node.placement_policy.tier,
    locked: node.placement_policy.locked,
    move_allowed: !node.placement_policy.locked && node.mutability.can_reorder
  };
};

export interface ContextPolicyEngineResult {
  selected_nodes: ContextNode[];
  hidden_nodes: ContextNode[];
  denied_nodes: ContextNode[];
  policy_decisions: ContextNodePolicyDecision[];
  blocked_nodes: ContextPolicyBlockedNode[];
  locked_nodes: ContextPolicyLockedNode[];
  visibility_denials: ContextPolicyVisibilityDenial[];
}

export const evaluateContextPolicies = (nodes: ContextNode[]): ContextPolicyEngineResult => {
  const selectedNodes: ContextNode[] = [];
  const hiddenNodes: ContextNode[] = [];
  const deniedNodes: ContextNode[] = [];
  const policyDecisions: ContextNodePolicyDecision[] = [];
  const blockedNodes: ContextPolicyBlockedNode[] = [];
  const lockedNodes: ContextPolicyLockedNode[] = [];
  const visibilityDenials: ContextPolicyVisibilityDenial[] = [];

  for (const node of nodes) {
    const reasonCodes = buildReasonCodes(node);
    const visibility = buildVisibilityDecision(node);
    const operations = buildOperationDecision(node);
    const placement = buildPlacementDecision(node);

    const decision: ContextNodePolicyDecision = {
      node_id: node.id,
      node_type: node.node_type,
      source_kind: node.source_kind,
      visibility,
      operations,
      placement,
      reason_codes: reasonCodes
    };

    policyDecisions.push(decision);

    if (visibility.admission === 'deny') {
      deniedNodes.push(node);
      visibilityDenials.push({
        node_id: node.id,
        read_access: visibility.read_access,
        reason_codes: reasonCodes
      });
      blockedNodes.push({
        node_id: node.id,
        reason_codes: reasonCodes
      });
      continue;
    }

    if (visibility.admission === 'allow_hidden') {
      visibilityDenials.push({
        node_id: node.id,
        read_access: visibility.read_access,
        reason_codes: reasonCodes
      });
      hiddenNodes.push(node);
    } else {
      selectedNodes.push(node);
    }

    if (placement.locked) {
      lockedNodes.push({
        node_id: node.id,
        preferred_slot: placement.preferred_slot,
        tier: placement.tier,
        reason_codes: reasonCodes
      });
    }
  }

  return {
    selected_nodes: selectedNodes,
    hidden_nodes: hiddenNodes,
    denied_nodes: deniedNodes,
    policy_decisions: policyDecisions,
    blocked_nodes: blockedNodes,
    locked_nodes: lockedNodes,
    visibility_denials: visibilityDenials
  };
};

export const applyPolicyDecisionsToSelection = (
  selection: ContextSelectionResult,
  policyResult: ContextPolicyEngineResult
): ContextSelectionResult => {
  const deniedNodeIds = new Set(policyResult.denied_nodes.map(node => node.id));
  const hiddenNodeIds = new Set(policyResult.hidden_nodes.map(node => node.id));

  return {
    nodes: selection.nodes.filter(node => !deniedNodeIds.has(node.id) && !hiddenNodeIds.has(node.id)),
    dropped_nodes: [
      ...selection.dropped_nodes,
      ...policyResult.denied_nodes.map(node => ({
        node_id: node.id,
        reason: 'policy_denied',
        source_kind: node.source_kind,
        node_type: node.node_type
      })),
      ...policyResult.hidden_nodes.map(node => ({
        node_id: node.id,
        reason: 'hidden_mandatory',
        source_kind: node.source_kind,
        node_type: node.node_type
      }))
    ].filter((entry, index, array) => {
      const firstIndex = array.findIndex(candidate => candidate.node_id === entry.node_id && candidate.reason === entry.reason);
      return firstIndex === index;
    })
  };
};
