/**
 * runConversationHistoryTrack — produces per-entry PromptSectionDraft[] from AgentConversationMemory.
 * Design doc: .limcode/design/multi-turn-conversation-design.md §6.6
 */

import crypto from 'node:crypto';

import { renderEntryText } from '../../../conversation/entry_renderer.js';
import type { CompressionConfig, ConversationFormatConfig } from '../../../conversation/format_config.js';
import type { AgentConversationMemory, ConversationEntry } from '../../../conversation/types.js';
import type { PromptSlotConfig } from '../../../inference/prompt_slot_config.js';
import type { PromptSectionDraft, TrackResult } from '../types.js';

// ── Visible Entry Selection ────────────────────────────────

/**
 * Returns visible entries based on compression config.
 * - summary entries are always included (not affected by window_turns)
 * - original entries are truncated to the last N (window_turns)
 *
 * Design doc §6.6: "summaryEntries在前，recentEntries在后，按turn_number升序"
 */
export function getVisibleEntries(
  memory: AgentConversationMemory,
  compression: CompressionConfig
): ConversationEntry[] {
  const sorted = [...memory.entries].sort((a, b) => a.turn_number - b.turn_number);

  const summaryEntries = sorted.filter((e) => e.kind === 'summary');
  const recentEntries = sorted.filter((e) => e.kind !== 'summary');

  const { window_turns: windowTurns } = compression;
  const visibleRecent =
    windowTurns && windowTurns > 0 ? recentEntries.slice(-windowTurns) : recentEntries;

  return [...summaryEntries, ...visibleRecent];
}

// ── Role Resolution ────────────────────────────────────────

/**
 * Resolve the message role for a conversation entry from the current agent's perspective.
 * In one-to-one conversation: own messages → 'assistant', other's messages → 'user'.
 */
export function resolveEntryRole(
  entry: ConversationEntry,
  currentAgentId: string
): 'assistant' | 'user' {
  return entry.speaker_agent_id === currentAgentId ? 'assistant' : 'user';
}

// ── Track ──────────────────────────────────────────────────

export function runConversationHistoryTrack(input: {
  memory: AgentConversationMemory;
  slotRegistry: Record<string, PromptSlotConfig>;
  formatConfig: ConversationFormatConfig;
  currentAgentId: string;
}): TrackResult<PromptSectionDraft[]> {
  const { memory, formatConfig, currentAgentId } = input;
  const entries = getVisibleEntries(memory, formatConfig.compression);

  const drafts: PromptSectionDraft[] = entries.map((entry) => {
    const role = resolveEntryRole(entry, currentAgentId);
    const text = renderEntryText(entry, formatConfig.transcript, currentAgentId);

    return {
      id: crypto.randomUUID(),
      track: 'conversation_history',
      section_type: 'conversation_history',
      slot: 'conversation_history',
      priority: entry.turn_number,
      source_node_ids: [],
      content_blocks: [
        {
          kind: 'text',
          text,
          metadata: {
            entry_id: entry.id,
            turn_number: entry.turn_number
          }
        }
      ],
      removable: true,
      estimated_tokens: Math.ceil(text.length / 4),
      metadata: {
        entry_id: entry.id,
        entry_role: role,
        speaker_agent_id: entry.speaker_agent_id,
        conversation_entry_kind: entry.kind
      }
    };
  });

  return {
    result: drafts,
    trace: {
      track: 'conversation_history',
      input_summary: {
        total_entries: memory.entries.length,
        visible_entries: entries.length,
        window_turns: formatConfig.compression.window_turns
      },
      output_summary: { section_drafts_count: drafts.length },
      decisions: []
    }
  };
}
