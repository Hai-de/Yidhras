/**
 * ConversationCompactionService — triggers AI summary compaction after entry writes.
 * Hybrid approach: non-AI truncation fallback + AI summary enhancement via dedicated path.
 * Design doc: .limcode/design/multi-turn-conversation-design.md §6.6
 */

import crypto from 'node:crypto';

import type { ModelGateway } from '../ai/gateway.js';
import type { AiResolvedTaskConfig } from '../ai/types.js';
import type { CompactionAuditStore } from './compaction_audit.js';
import { runCompactionInference } from './compaction_inference.js';
import type { ConversationFormatConfig } from './format_config.js';
import type { ConversationStore } from './store.js';
import type { AgentConversationMemory, ConversationEntry } from './types.js';

// ── Types ───────────────────────────────────────────────────

export interface ConversationCompactionService {
  /**
   * Call after entry write. Checks the threshold and triggers AI compaction if needed.
   * Returns true if compaction was triggered (regardless of success/failure).
   */
  maybeCompact(input: {
    memory: AgentConversationMemory;
    formatConfig: ConversationFormatConfig;
    store: ConversationStore;
    gateway: ModelGateway;
    taskConfig: AiResolvedTaskConfig;
    auditStore: CompactionAuditStore;
  }): Promise<boolean>;
}

// ── Implementation ──────────────────────────────────────────

export class DefaultConversationCompactionService implements ConversationCompactionService {
  async maybeCompact(input: {
    memory: AgentConversationMemory;
    formatConfig: ConversationFormatConfig;
    store: ConversationStore;
    gateway: ModelGateway;
    taskConfig: AiResolvedTaskConfig;
    auditStore: CompactionAuditStore;
  }): Promise<boolean> {
    const { memory, formatConfig, store, gateway, taskConfig, auditStore } = input;
    const { compression } = formatConfig;

    // Guard: AI summary disabled for this agent
    if (!compression.enable_ai_summary) {
      return false;
    }

    // Guard: below threshold
    if (memory.entries.length <= compression.summary_trigger_turns) {
      return false;
    }

    // Determine which entries to compress (keep preserve_recent most recent)
    const sorted = [...memory.entries].sort((a, b) => a.turn_number - b.turn_number);
    const preserveRecent = compression.preserve_recent && compression.preserve_recent > 0
      ? compression.preserve_recent
      : 1;
    const entriesToCompress = sorted.slice(0, -preserveRecent);

    if (entriesToCompress.length === 0) {
      return false;
    }

    const auditEntryId = crypto.randomUUID();
    const sourceEntryIds = entriesToCompress.map((e) => e.id);
    const triggeredAt = Date.now();

    let summaryEntry: ConversationEntry | null = null;
    let auditStatus: 'success' | 'failed' = 'failed';
    let errorMessage: string | undefined;

    try {
      const result = await runCompactionInference({
        entries: entriesToCompress,
        agentId: memory.owner_agent_id,
        conversationId: memory.conversation_id,
        gateway,
        taskConfig,
        model: undefined // use default model from taskConfig
      });

      const turnRange = {
        start: entriesToCompress[0].turn_number,
        end: entriesToCompress[entriesToCompress.length - 1].turn_number
      };

      summaryEntry = {
        id: crypto.randomUUID(),
        turn_number: sorted[sorted.length - 1].turn_number + 1,
        speaker_agent_id: memory.owner_agent_id,
        kind: 'summary',
        original_content: result.summaryText,
        current_content: result.summaryText,
        provenance: {
          operator: { kind: 'agent', id: memory.owner_agent_id },
          capability: 'conversation.record'
        },
        recorded_at: triggeredAt,
        modifications: [],
        turn_range: turnRange,
        derived_from_entry_ids: sourceEntryIds,
        archived: false
      };

      // Soft-archive old entries and append summary entry
      await store.archiveEntries(sourceEntryIds);
      await store.appendEntry(memory.id, summaryEntry);

      auditStatus = 'success';
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    // Write audit entry regardless of outcome
    await auditStore.append({
      id: auditEntryId,
      agent_id: memory.owner_agent_id,
      conversation_id: memory.conversation_id,
      triggered_at: triggeredAt,
      source_entry_ids: sourceEntryIds,
      summary_entry_id: summaryEntry?.id ?? '',
      summary_model: summaryEntry ? 'compaction-model' : '',
      summary_prompt_tokens: 0,
      summary_completion_tokens: 0,
      summary_duration_ms: 0,
      status: auditStatus,
      error_message: errorMessage
    });

    return true;
  }
}
