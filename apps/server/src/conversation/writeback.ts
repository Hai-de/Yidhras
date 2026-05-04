/**
 * Conversation write-back — creates ConversationEntry records after successful inference.
 * Design doc: .limcode/design/multi-turn-conversation-design.md §5.1, §6.10
 */

import crypto from 'node:crypto';

import type { ConversationStore } from './store.js';
import type { AgentConversationMemory, ConversationEntry, EntryProvenance } from './types.js';

export type NowProvider = () => number;

export interface WritebackInput {
  store: ConversationStore;

  /** Both agents' conversation memories (speaker + listener) */
  speakerMemory: AgentConversationMemory;
  listenerMemory: AgentConversationMemory;

  /** The agent that produced the response */
  speakerAgentId: string;
  /** The agent that is the recipient */
  listenerAgentId: string;

  /** The model's text response */
  responseContent: string;

  /** The inference ID that produced this response */
  inferenceId: string;

  /** Tool call trace (optional, only included in final reply) */
  toolTrace?: {
    tools_called: string[];
    total_rounds: number;
    total_tool_calls: number;
  };

  /** Time provider for deterministic timestamps (defaults to Date.now) */
  now?: NowProvider;
}

export interface WritebackResult {
  speakerEntry: ConversationEntry;
  listenerEntry: ConversationEntry;
}

function buildProvenance(operatorId: string): EntryProvenance {
  return {
    operator: { kind: 'agent', id: operatorId },
    capability: 'conversation.record'
  };
}

function nextTurnNumber(memory: AgentConversationMemory): number {
  if (memory.entries.length === 0) {
    return 1;
  }
  const maxTurn = memory.entries.reduce((max, e) => Math.max(max, e.turn_number), 0);
  return maxTurn + 1;
}

function buildEntry(params: {
  memory: AgentConversationMemory;
  speakerAgentId: string;
  responseContent: string;
  inferenceId: string;
  provenance: EntryProvenance;
  toolTrace?: WritebackInput['toolTrace'];
  derivedFromEntryIds?: string[];
  now: NowProvider;
}): ConversationEntry {
  const nowMs = params.now();
  const turnNumber = nextTurnNumber(params.memory);

  return {
    id: crypto.randomUUID(),
    turn_number: turnNumber,
    speaker_agent_id: params.speakerAgentId,
    kind: 'original',
    original_content: params.responseContent,
    current_content: params.responseContent,
    provenance: params.provenance,
    recorded_at: nowMs,
    modifications: [],
    source_inference_id: params.inferenceId,
    derived_from_entry_ids: params.derivedFromEntryIds,
    tool_trace: params.toolTrace
      ? {
          tools_called: params.toolTrace.tools_called,
          total_rounds: params.toolTrace.total_rounds,
          total_tool_calls: params.toolTrace.total_tool_calls
        }
      : undefined
  };
}

/**
 * Write conversation entries to both agents' memories after successful inference.
 * Both writes happen within the same logical operation; if either fails,
 * the caller should treat the inference as failed.
 *
 * Design doc §5.1: "写入是推理流程最后一步，写入失败 → 推理标记失败"
 */
export async function writeConversationEntries(
  input: WritebackInput
): Promise<WritebackResult> {
  const { store, speakerMemory, listenerMemory, speakerAgentId } = input;
  const now = input.now ?? Date.now;

  const recordProvenance = buildProvenance(speakerAgentId);

  const speakerEntry = buildEntry({
    memory: speakerMemory,
    speakerAgentId,
    responseContent: input.responseContent,
    inferenceId: input.inferenceId,
    provenance: recordProvenance,
    toolTrace: input.toolTrace,
    now
  });

  const listenerEntry = buildEntry({
    memory: listenerMemory,
    speakerAgentId,
    responseContent: input.responseContent,
    inferenceId: input.inferenceId,
    provenance: recordProvenance,
    toolTrace: input.toolTrace,
    now
  });

  // Write both entries in a single transaction to guarantee atomicity.
  // Design doc §5.1: "A 和 B 的 entry 在同一事务中写入，失败则整次推理标记失败"
  await store.appendEntriesInTransaction([
    { memoryId: speakerMemory.id, entry: speakerEntry },
    { memoryId: listenerMemory.id, entry: listenerEntry }
  ]);

  return { speakerEntry, listenerEntry };
}
