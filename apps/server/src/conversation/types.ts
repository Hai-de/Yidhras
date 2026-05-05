/**
 * Core types for the multi-turn conversation system.
 * Design doc: .limcode/design/multi-turn-conversation-design.md §6.1, §6.2
 */

// ── Constants ──────────────────────────────────────────────

export const MAX_MODIFICATIONS_PER_ENTRY = 50;

// ── Provenance ─────────────────────────────────────────────

export interface EntryProvenance {
  operator: {
    kind: 'agent' | 'user' | 'plugin' | 'data_cleaner';
    id: string;
  };
  capability:
    | 'conversation.insert'
    | 'conversation.modify'
    | 'conversation.delete'
    | 'conversation.record';
  rule?: string;
}

// ── Modification History ───────────────────────────────────

export interface EntryModification {
  modified_by: EntryProvenance;
  modified_at: number;
  previous_content: string;
  new_content: string;
  reason?: string;
}

// ── Tool Trace ─────────────────────────────────────────────

export interface EntryToolTrace {
  tools_called: string[];
  total_rounds: number;
  total_tool_calls: number;
}

// ── Conversation Entry ─────────────────────────────────────

export type ConversationEntryKind = 'original' | 'summary';

export interface ConversationEntry {
  id: string;
  turn_number: number;
  speaker_agent_id: string;
  kind: ConversationEntryKind;

  // Content (dual-field: immutable snapshot + mutable current)
  original_content: string;
  current_content: string;

  // Provenance & audit
  provenance: EntryProvenance;
  recorded_at: number;
  modifications: EntryModification[];

  // Causal chain
  source_inference_id?: string;
  derived_from_entry_ids?: string[];

  // Summary-specific
  turn_range?: { start: number; end: number };

  // Tool call trace (final reply only)
  tool_trace?: EntryToolTrace;

  // Soft archive (AI summary compaction)
  archived?: boolean;

  // Metadata
  tags?: string[];
  metadata?: Record<string, unknown>;
}

// ── Agent Conversation Memory ──────────────────────────────

export interface AgentConversationMemory {
  id: string;
  owner_agent_id: string;
  conversation_id: string;
  entries: ConversationEntry[];
  summary?: string;
  metadata?: Record<string, unknown>;
}

// ── Conversation ID ────────────────────────────────────────

/**
 * Deterministic triple for one-to-one conversation lookup (Phase 1).
 * Phase 2/3 will introduce explicit conversation IDs.
 */
export interface ConversationIdTriple {
  agent_a_id: string;
  agent_b_id: string;
  simulation_id: string;
}

/**
 * Derive a deterministic conversation_id from the agent pair + simulation.
 * Sorts agent IDs so order-independent.
 */
export function deriveConversationId(triple: ConversationIdTriple): string {
  const agents = [triple.agent_a_id, triple.agent_b_id].sort();
  return `${agents[0]}:${agents[1]}:${triple.simulation_id}`;
}
