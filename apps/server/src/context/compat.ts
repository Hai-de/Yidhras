import type { MemoryContextPack, MemoryEntry, MemorySourceKind } from '../memory/types.js';
import type { ContextDroppedNode, ContextNode, ContextRun } from './types.js';

const MEMORY_SOURCE_KIND_SET = new Set<MemorySourceKind>(['trace', 'intent', 'job', 'post', 'event', 'summary', 'manual']);

const isMemorySourceKind = (value: string): value is MemorySourceKind => {
  return MEMORY_SOURCE_KIND_SET.has(value as MemorySourceKind);
};

const isMemorySlot = (value: unknown): value is 'memory_short_term' | 'memory_long_term' | 'memory_summary' => {
  return value === 'memory_short_term' || value === 'memory_long_term' || value === 'memory_summary';
};

const toPolicyGate = (node: ContextNode): string | null => {
  return typeof node.visibility.policy_gate === 'string' ? node.visibility.policy_gate : null;
};

const toMemoryEntry = (node: ContextNode): MemoryEntry | null => {
  if (!isMemorySourceKind(node.source_kind)) {
    return null;
  }

  const preferredSlot = node.placement_policy.preferred_slot;
  if (!isMemorySlot(preferredSlot)) {
    return null;
  }

  const scope = preferredSlot === 'memory_long_term' ? 'long_term' : 'short_term';

  return {
    id: node.id,
    scope,
    actor_ref:
      node.actor_ref && typeof node.actor_ref === 'object' && !Array.isArray(node.actor_ref)
        ? (node.actor_ref as unknown as MemoryEntry['actor_ref'])
        : null,
    source_kind: node.source_kind,
    source_ref: node.source_ref ? ({ ...node.source_ref } as MemoryEntry['source_ref']) : null,
    content: {
      text: node.content.text,
      ...(node.content.structured ? { structured: node.content.structured } : {})
    },
    tags: node.tags,
    importance: node.importance,
    salience: node.salience,
    confidence: node.confidence ?? null,
    visibility: {
      policy_gate: toPolicyGate(node)
    },
    created_at: node.created_at,
    occurred_at: node.occurred_at ?? null,
    expires_at: node.expires_at ?? null,
    metadata: {
      node_type: node.node_type,
      ...(node.metadata ? { context_metadata: node.metadata } : {})
    }
  };
};

const toDroppedEntry = (entry: ContextDroppedNode) => ({
  entry_id: entry.node_id,
  reason: entry.reason
});

export const buildLegacyMemoryContextPack = (contextRun: ContextRun): MemoryContextPack => {
  const selectedEntries = contextRun.nodes
    .filter(node => node.source_kind !== 'overlay')
    .map(toMemoryEntry)
    .filter((entry): entry is MemoryEntry => entry !== null);

  const short_term = selectedEntries.filter(entry => entry.scope === 'short_term' && entry.source_kind !== 'summary');
  const long_term = selectedEntries.filter(entry => entry.scope === 'long_term');
  const summaries = selectedEntries.filter(entry => entry.source_kind === 'summary');
  const dropped = contextRun.diagnostics.dropped_nodes.map(toDroppedEntry);

  return {
    short_term,
    long_term,
    summaries,
    diagnostics: {
      selected_count: selectedEntries.length,
      skipped_count: dropped.length,
      memory_selection: {
        selected_entry_ids: selectedEntries.map(entry => entry.id),
        dropped
      },
      prompt_processing_trace: null
    }
  };
};
