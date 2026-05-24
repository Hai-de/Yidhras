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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- from-any: JSON.parse boundary
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
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
    archived: row.archived,
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
      archived: entry.archived ?? false,
      tags_json: entry.tags ? JSON.stringify(entry.tags) : null,
      metadata_json: entry.metadata ? JSON.stringify(entry.metadata) : null
    };
  }

  private memoryRowToDomain(
    row: { id: string; owner_agent_id: string; conversation_id: string; display_name: string | null; summary: string | null; metadata_json: string | null },
    entryRows: PrismaConversationEntryRecord[]
  ): AgentConversationMemory {
    return {
      id: row.id,
      owner_agent_id: row.owner_agent_id,
      conversation_id: row.conversation_id,
      display_name: row.display_name ?? undefined,
      entries: entryRows.map(entryRecordToDomain),
      summary: row.summary ?? undefined,
      metadata: jsonParse<Record<string, unknown> | null>(row.metadata_json, null) ?? undefined
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

    return this.memoryRowToDomain(memory, entryRows);
  }

  async getById(conversationId: string): Promise<AgentConversationMemory | null> {
    const memory = await this.prisma.conversationMemory.findUnique({
      where: { id: conversationId }
    });
    if (!memory) return null;

    const entryRows = await this.prisma.conversationEntryRecord.findMany({
      where: { memory_id: memory.id },
      orderBy: { turn_number: 'asc' }
    });

    return this.memoryRowToDomain(memory, entryRows);
  }

  async listByAgent(ownerAgentId: string): Promise<AgentConversationMemory[]> {
    const memories = await this.prisma.conversationMemory.findMany({
      where: { owner_agent_id: ownerAgentId },
      orderBy: { updated_at: 'desc' }
    });

    if (memories.length === 0) return [];

    const memoryIds = memories.map((m) => m.id);
    const allEntries = await this.prisma.conversationEntryRecord.findMany({
      where: { memory_id: { in: memoryIds } },
      orderBy: { turn_number: 'asc' }
    });

    const entriesByMemory = new Map<string, PrismaConversationEntryRecord[]>();
    for (const e of allEntries) {
      const list = entriesByMemory.get(e.memory_id);
      if (list) {
        list.push(e);
      } else {
        entriesByMemory.set(e.memory_id, [e]);
      }
    }

    return memories.map((m) => this.memoryRowToDomain(m, entriesByMemory.get(m.id) ?? []));
  }

  async create(params: {
    ownerAgentId: string;
    conversationId: string;
    displayName?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AgentConversationMemory> {
    const now = BigInt(this.now());

    const memory = await this.prisma.conversationMemory.create({
      data: {
        id: params.conversationId,
        owner_agent_id: params.ownerAgentId,
        conversation_id: params.conversationId,
        display_name: params.displayName ?? null,
        metadata_json: params.metadata ? JSON.stringify(params.metadata) : null,
        created_at: now,
        updated_at: now
      }
    });

    return this.memoryRowToDomain(memory, []);
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

  async archiveEntries(entryIds: string[]): Promise<void> {
    if (entryIds.length === 0) return;
    await this.prisma.conversationEntryRecord.updateMany({
      where: { id: { in: entryIds } },
      data: { archived: true }
    });
  }

  async deleteMemory(memoryId: string): Promise<void> {
    await this.prisma.conversationMemory.delete({
      where: { id: memoryId }
    });
  }
}
