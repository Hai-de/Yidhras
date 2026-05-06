/**
 * runConversationHistoryTrack — produces per-entry PromptSectionDraft[] from AgentConversationMemory.
 * Design doc: .limcode/design/multi-turn-conversation-design.md §6.6
 */

import crypto from 'node:crypto';

import { renderEntryText } from '../../../conversation/entry_renderer.js';
import type { CompressionConfig, ConversationFormatConfig } from '../../../conversation/format_config.js';
import type { AgentConversationMemory, ConversationEntry } from '../../../conversation/types.js';
import type { PromptSlotConfig, ResolvedSlotPosition } from '../../../inference/prompt_slot_config.js';
import type { PromptSectionDraft, TrackResult } from '../types.js';

// ── Visible Entry Selection ────────────────────────────────

/**
 * Returns visible entries based on compression config.
 * - Filters out archived entries (soft-deleted by AI summary compaction)
 * - summary entries are always included (not affected by window_turns)
 * - If AI summaries exist: original entries truncated to window_turns
 * - If no AI summaries (fallback): original entries truncated to preserve_recent
 *
 * Design doc §6.6: "summaryEntries在前，recentEntries在后，按turn_number升序"
 */
export function getVisibleEntries(
  memory: AgentConversationMemory,
  compression: CompressionConfig
): ConversationEntry[] {
  const { window_turns: windowTurns } = compression;

  // Filter out soft-archived entries
  const active = memory.entries.filter((e) => !e.archived);
  const sorted = [...active].sort((a, b) => a.turn_number - b.turn_number);

  const summaryEntries = sorted.filter((e) => e.kind === 'summary');
  const originalEntries = sorted.filter((e) => e.kind !== 'summary');

  // window_turns controls the view window for original entries.
  // Summary entries are always included (they represent compressed older turns).
  const visibleRecent =
    windowTurns && windowTurns > 0 ? originalEntries.slice(-windowTurns) : originalEntries;

  return [...summaryEntries, ...visibleRecent];
}

// ── Role Resolution ────────────────────────────────────────

export type TranscriptMode = 'embed' | 'role_map';

/**
 * Resolve the message role for a conversation entry from the current agent's perspective.
 *
 * embed mode (default): all entries map to the same transcript target role ('transcript').
 *   The actual message role is determined by the slot → target_role mapping in message_assembly.
 * role_map mode (config-gated): own messages → 'assistant', other's messages → 'user'.
 */
export function resolveEntryRole(
  entry: ConversationEntry,
  currentAgentId: string,
  mode: TranscriptMode
): string {
  switch (mode) {
    case 'embed':
      return 'transcript';
    case 'role_map':
      return entry.speaker_agent_id === currentAgentId ? 'assistant' : 'user';
  }
}

// ── Track ──────────────────────────────────────────────────

export function runConversationHistoryTrack(input: {
  memory: AgentConversationMemory;
  slotRegistry: Record<string, PromptSlotConfig>;
  resolvedPositions?: ResolvedSlotPosition[];
  formatConfig: ConversationFormatConfig;
  currentAgentId: string;
}): TrackResult<PromptSectionDraft[]> {
  const { memory, formatConfig, currentAgentId } = input;
  const entries = getVisibleEntries(memory, formatConfig.compression);
  const mode: TranscriptMode = formatConfig.transcript.mode ?? 'embed';

  const drafts: PromptSectionDraft[] = entries.map((entry) => {
    const role = resolveEntryRole(entry, currentAgentId, mode);
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
