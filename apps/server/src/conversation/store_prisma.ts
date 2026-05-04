/**
 * Prisma implementation of ConversationStore.
 * Design doc: .limcode/design/multi-turn-conversation-design.md §6.3
 */

import { type ConversationEntryRecord as PrismaConversationEntryRecord, type Prisma,PrismaClient } from '@prisma/client';

import type { ConversationStore } from './store.js';
import type {
  AgentConversationMemory,
  ConversationEntry,
  ConversationEntryKind,
  EntryModification,
  EntryProvenance,
  EntryToolTrace
} from './types.js';
import { MAX_MODIFICATIONS_PER_ENTRY } from './types.js';

// ── JSON Serialization Helpers ─────────────────────────────

function jsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function entryRecordToDomain(row: PrismaConversationEntryRecord): ConversationEntry {
  return {
    id: row.id,
    turn_number: row.turn_number,
    speaker_agent_id: row.speaker_agent_id,
    kind: row.kind as ConversationEntryKind,
    original_content: row.original_content,
    current_content: row.current_content,
    provenance: jsonParse<EntryProvenance>(row.provenance_json, {
      operator: { kind: 'agent', id: 'unknown' },
      capability: 'conversation.record'
    }),
    recorded_at: Number(row.recorded_at),
    modifications: jsonParse<EntryModification[]>(row.modifications_json, []),
    source_inference_id: row.source_inference_id ?? undefined,
    derived_from_entry_ids: jsonParse<string[] | null>(
      row.derived_from_entry_ids_json,
      null
    ) ?? undefined,
    turn_range:
      row.turn_range_start !== null && row.turn_range_end !== null
        ? { start: row.turn_range_start, end: row.turn_range_end }
        : undefined,
    tool_trace: jsonParse<EntryToolTrace | null>(row.tool_trace_json, null) ?? undefined,
    tags: jsonParse<string[] | null>(row.tags_json, null) ?? undefined,
    metadata: jsonParse<Record<string, unknown> | null>(row.metadata_json, null) ?? undefined
  };
}

// ── Store Implementation ───────────────────────────────────

export type NowProvider = () => number;

export class PrismaConversationStore implements ConversationStore {
  private readonly now: NowProvider;

  constructor(
    private readonly prisma: PrismaClient,
    options?: { now?: NowProvider }
  ) {
    this.now = options?.now ?? Date.now;
  }

  private entryToCreateData(memoryId: string, entry: ConversationEntry): Prisma.ConversationEntryRecordUncheckedCreateInput {
    return {
      id: entry.id,
      memory_id: memoryId,
      turn_number: entry.turn_number,
      speaker_agent_id: entry.speaker_agent_id,
      kind: entry.kind,
      original_content: entry.original_content,
      current_content: entry.current_content,
      provenance_json: JSON.stringify(entry.provenance),
      modifications_json: JSON.stringify(entry.modifications),
      recorded_at: BigInt(entry.recorded_at),
      source_inference_id: entry.source_inference_id ?? null,
      derived_from_entry_ids_json: entry.derived_from_entry_ids
        ? JSON.stringify(entry.derived_from_entry_ids)
        : null,
      turn_range_start: entry.turn_range?.start ?? null,
      turn_range_end: entry.turn_range?.end ?? null,
      tool_trace_json: entry.tool_trace ? JSON.stringify(entry.tool_trace) : null,
      tags_json: entry.tags ? JSON.stringify(entry.tags) : null,
      metadata_json: entry.metadata ? JSON.stringify(entry.metadata) : null
    };
  }

  async getOrCreate(
    ownerAgentId: string,
    conversationId: string
  ): Promise<AgentConversationMemory> {
    const now = BigInt(this.now());

    const memory = await this.prisma.conversationMemory.upsert({
      where: {
        owner_agent_id_conversation_id: {
          owner_agent_id: ownerAgentId,
          conversation_id: conversationId
        }
      },
      create: {
        owner_agent_id: ownerAgentId,
        conversation_id: conversationId,
        created_at: now,
        updated_at: now
      },
      update: {
        updated_at: now
      }
    });

    const entryRows = await this.prisma.conversationEntryRecord.findMany({
      where: { memory_id: memory.id },
      orderBy: { turn_number: 'asc' }
    });

    return {
      id: memory.id,
      owner_agent_id: memory.owner_agent_id,
      conversation_id: memory.conversation_id,
      entries: entryRows.map(entryRecordToDomain),
      summary: memory.summary ?? undefined,
      metadata: jsonParse<Record<string, unknown> | null>(memory.metadata_json, null) ?? undefined
    };
  }

  async appendEntry(memoryId: string, entry: ConversationEntry): Promise<void> {
    const now = BigInt(this.now());

    await this.prisma.conversationEntryRecord.create({
      data: this.entryToCreateData(memoryId, entry)
    });

    await this.prisma.conversationMemory.update({
      where: { id: memoryId },
      data: { updated_at: now }
    });
  }

  async appendEntriesInTransaction(
    entries: Array<{ memoryId: string; entry: ConversationEntry }>
  ): Promise<void> {
    const now = BigInt(this.now());
    const memoryIds = [...new Set(entries.map(e => e.memoryId))];

    await this.prisma.$transaction(async (tx) => {
      for (const { memoryId, entry } of entries) {
        await tx.conversationEntryRecord.create({
          data: this.entryToCreateData(memoryId, entry)
        });
      }
      for (const memoryId of memoryIds) {
        await tx.conversationMemory.update({
          where: { id: memoryId },
          data: { updated_at: now }
        });
      }
    });
  }

  async modifyEntry(entryId: string, modification: EntryModification): Promise<void> {
    const existing = await this.prisma.conversationEntryRecord.findUnique({
      where: { id: entryId }
    });
    if (!existing) {
      throw new Error(`ConversationEntryRecord not found: ${entryId}`);
    }

    const modifications = jsonParse<EntryModification[]>(existing.modifications_json, []);

    if (modifications.length >= MAX_MODIFICATIONS_PER_ENTRY) {
      const archived: EntryModification = {
        modified_by: {
          operator: { kind: 'data_cleaner', id: 'system' },
          capability: 'conversation.modify'
        },
        modified_at: this.now(),
        previous_content: `archived ${modifications.length} modifications`,
        new_content: 'archived',
        reason: 'archived_modifications'
      };
      const recentCount = MAX_MODIFICATIONS_PER_ENTRY - 1;
      const retained = modifications.slice(-recentCount);
      modifications.length = 0;
      modifications.push(archived, ...retained);
    }

    modifications.push(modification);

    await this.prisma.conversationEntryRecord.update({
      where: { id: entryId },
      data: {
        current_content: modification.new_content,
        modifications_json: JSON.stringify(modifications)
      }
    });
  }

  async getEntries(
    memoryId: string,
    opts?: { limit?: number; before?: number }
  ): Promise<ConversationEntry[]> {
    const where: Prisma.ConversationEntryRecordWhereInput = { memory_id: memoryId };
    if (opts?.before !== undefined) {
      where.turn_number = { lt: opts.before };
    }

    const rows = await this.prisma.conversationEntryRecord.findMany({
      where,
      orderBy: { turn_number: 'asc' },
      take: opts?.limit
    });

    return rows.map(entryRecordToDomain);
  }

  async updateSummary(memoryId: string, summary: string): Promise<void> {
    await this.prisma.conversationMemory.update({
      where: { id: memoryId },
      data: { summary, updated_at: BigInt(this.now()) }
    });
  }

  async deleteMemory(memoryId: string): Promise<void> {
    await this.prisma.conversationMemory.delete({
      where: { id: memoryId }
    });
  }
}
