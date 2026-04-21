import type { MemoryEntry, MemorySelectionResult } from '../../memory/types.js';
import type {
  ContextMutabilityPolicy,
  ContextNode,
  ContextNodeSourceKind,
  ContextPlacementPolicy,
  ContextVisibilityPolicy
} from '../types.js';

const resolveNodeType = (entry: MemoryEntry): string => {
  switch (entry.source_kind) {
    case 'trace':
      return 'recent_trace';
    case 'job':
      return 'recent_job';
    case 'intent':
      return 'recent_intent';
    case 'post':
      return 'recent_post';
    case 'event':
      return 'recent_event';
    case 'summary':
      return 'memory_summary';
    case 'manual':
      return 'manual_note';
    default:
      return 'memory_entry';
  }
};

const resolveVisibility = (entry: MemoryEntry): ContextVisibilityPolicy => {
  const policyGate = typeof entry.visibility?.policy_gate === 'string' ? entry.visibility.policy_gate : null;
  if (policyGate === 'deny') {
    return {
      level: 'hidden_mandatory',
      read_access: 'hidden',
      policy_gate: policyGate,
      blocked: true
    };
  }

  if (entry.source_kind === 'manual') {
    return {
      level: 'writable_overlay',
      read_access: 'visible',
      policy_gate: policyGate,
      blocked: false
    };
  }

  return {
    level: 'visible_flexible',
    read_access: 'visible',
    policy_gate: policyGate,
    blocked: false
  };
};

const resolveMutability = (entry: MemoryEntry): ContextMutabilityPolicy => {
  if (entry.source_kind === 'manual') {
    return {
      level: 'overlay',
      can_summarize: true,
      can_reorder: true,
      can_hide: true
    };
  }

  return {
    level: 'flexible',
    can_summarize: true,
    can_reorder: true,
    can_hide: true
  };
};

const resolvePlacement = (entry: MemoryEntry): ContextPlacementPolicy => {
  if (entry.source_kind === 'summary') {
    return {
      preferred_slot: 'memory_summary',
      locked: false,
      tier: 'memory'
    };
  }

  return {
    preferred_slot: entry.scope === 'long_term' ? 'memory_long_term' : 'memory_short_term',
    locked: false,
    tier: 'memory'
  };
};

const toSourceKind = (entry: MemoryEntry): ContextNodeSourceKind => {
  return entry.source_kind;
};

const toContextNode = (entry: MemoryEntry): ContextNode => {
  return {
    id: entry.id,
    node_type: resolveNodeType(entry),
    scope: 'agent',
    source_kind: toSourceKind(entry),
    source_ref: entry.source_ref ? ({ ...entry.source_ref } as Record<string, unknown>) : null,
    actor_ref:
      entry.actor_ref && typeof entry.actor_ref === 'object' && !Array.isArray(entry.actor_ref)
        ? ({ ...(entry.actor_ref as unknown as Record<string, unknown>) } as Record<string, unknown>)
        : null,
    content: {
      text: entry.content.text,
      ...(entry.content.structured ? { structured: entry.content.structured } : {})
    },
    tags: entry.tags,
    importance: entry.importance,
    salience: entry.salience,
    confidence: entry.confidence ?? null,
    created_at: entry.created_at,
    occurred_at: entry.occurred_at ?? null,
    expires_at: entry.expires_at ?? null,
    visibility: resolveVisibility(entry),
    mutability: resolveMutability(entry),
    placement_policy: resolvePlacement(entry),
    provenance: {
      created_by: entry.source_kind === 'manual' ? 'agent' : 'system',
      created_at_tick: entry.created_at,
      parent_node_ids: []
    },
    metadata: {
      memory_scope: entry.scope,
      source_kind: entry.source_kind,
      ...(entry.metadata ? { memory_metadata: entry.metadata } : {})
    }
  };
};

export const buildContextNodesFromMemorySelection = (selection: MemorySelectionResult): ContextNode[] => {
  return [...selection.short_term, ...selection.long_term, ...selection.summaries].map(toContextNode);
};
