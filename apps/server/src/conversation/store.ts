/**
 * ConversationStore — abstract interface for conversation memory persistence.
 * Design doc: .limcode/design/multi-turn-conversation-design.md §6.3
 */

import type { AgentConversationMemory, ConversationEntry, EntryModification } from './types.js';

export interface ConversationStore {
  getOrCreate(
    ownerAgentId: string,
    conversationId: string
  ): Promise<AgentConversationMemory>;

  appendEntry(memoryId: string, entry: ConversationEntry): Promise<void>;

  appendEntriesInTransaction(entries: Array<{ memoryId: string; entry: ConversationEntry }>): Promise<void>;

  modifyEntry(entryId: string, modification: EntryModification): Promise<void>;

  getEntries(
    memoryId: string,
    opts?: { limit?: number; before?: number }
  ): Promise<ConversationEntry[]>;

  updateSummary(memoryId: string, summary: string): Promise<void>;

  /** Mark entries as archived (soft delete for AI compaction). */
  archiveEntries(entryIds: string[]): Promise<void>;

  deleteMemory(memoryId: string): Promise<void>;
}
