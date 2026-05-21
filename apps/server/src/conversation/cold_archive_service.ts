import { randomUUID } from 'node:crypto';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Prisma, PrismaClient } from '@prisma/client';

import { resolveWorkspaceRoot } from '../config/loader.js';

export interface ConversationColdArchiveFilters {
  memoryId?: string;
  beforeRecordedAt?: bigint | number | string;
  beforeTurn?: number;
}

export interface ConversationColdArchiveOptions extends ConversationColdArchiveFilters {
  outputDir?: string;
  limit?: number;
  now?: Date;
}

export interface ConversationColdArchiveEntry {
  id: string;
  memory_id: string;
  owner_agent_id: string;
  conversation_id: string;
  memory_pack_id: string | null;
  turn_number: number;
  speaker_agent_id: string;
  kind: string;
  original_content: string;
  current_content: string;
  provenance_json: string;
  modifications_json: string;
  recorded_at: string;
  source_inference_id: string | null;
  derived_from_entry_ids_json: string | null;
  turn_range_start: number | null;
  turn_range_end: number | null;
  tool_trace_json: string | null;
  archived: boolean;
  tags_json: string | null;
  metadata_json: string | null;
}

export interface ConversationColdArchivePayload {
  archive_id: string;
  schema: 'conversation_entries_cold_archive.v1';
  created_at: string;
  filters: {
    memory_id: string | null;
    before_recorded_at: string | null;
    before_turn: number | null;
    limit: number;
  };
  total_entries: number;
  entries: ConversationColdArchiveEntry[];
}

export interface ConversationColdArchiveResult {
  archiveId: string;
  archivePath: string | null;
  exportedCount: number;
  deletedCount: number;
  sizeBytes: number;
}

type ConversationEntryArchiveRow = {
  id: string;
  memory_id: string;
  turn_number: number;
  speaker_agent_id: string;
  kind: string;
  original_content: string;
  current_content: string;
  provenance_json: string;
  modifications_json: string;
  recorded_at: bigint;
  source_inference_id: string | null;
  derived_from_entry_ids_json: string | null;
  turn_range_start: number | null;
  turn_range_end: number | null;
  tool_trace_json: string | null;
  archived: boolean;
  tags_json: string | null;
  metadata_json: string | null;
  memory: {
    owner_agent_id: string;
    conversation_id: string;
    pack_id: string | null;
  };
};

const DEFAULT_LIMIT = 1000;
const DEFAULT_OUTPUT_DIR = 'data/conversation_archives';

const normalizeLimit = (limit: number | undefined): number => {
  if (limit === undefined) {
    return DEFAULT_LIMIT;
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`limit 必须是正整数，当前值: ${limit}`);
  }
  return limit;
};

const normalizeRecordedAt = (value: bigint | number | string | undefined): bigint | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`beforeRecordedAt 必须是整数 tick/毫秒值，当前值: ${value}`);
    }
    return BigInt(value);
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`beforeRecordedAt 必须是非负整数字符串，当前值: ${value}`);
  }
  return BigInt(trimmed);
};

const normalizeBeforeTurn = (value: number | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`beforeTurn 必须是正整数，当前值: ${value}`);
  }
  return value;
};

const resolveOutputDir = (outputDir: string | undefined): string => {
  const root = resolveWorkspaceRoot();
  const candidate = outputDir ?? DEFAULT_OUTPUT_DIR;
  return path.isAbsolute(candidate) ? candidate : path.resolve(root, candidate);
};

const buildWhere = (filters: ConversationColdArchiveFilters): Prisma.ConversationEntryRecordWhereInput => {
  const beforeRecordedAt = normalizeRecordedAt(filters.beforeRecordedAt);
  const beforeTurn = normalizeBeforeTurn(filters.beforeTurn);
  const where: Prisma.ConversationEntryRecordWhereInput = {
    archived: true
  };

  if (filters.memoryId) {
    where.memory_id = filters.memoryId;
  }
  if (beforeRecordedAt !== undefined) {
    where.recorded_at = { lt: beforeRecordedAt };
  }
  if (beforeTurn !== undefined) {
    where.turn_number = { lt: beforeTurn };
  }

  return where;
};

const toArchiveEntry = (row: ConversationEntryArchiveRow): ConversationColdArchiveEntry => ({
  id: row.id,
  memory_id: row.memory_id,
  owner_agent_id: row.memory.owner_agent_id,
  conversation_id: row.memory.conversation_id,
  memory_pack_id: row.memory.pack_id,
  turn_number: row.turn_number,
  speaker_agent_id: row.speaker_agent_id,
  kind: row.kind,
  original_content: row.original_content,
  current_content: row.current_content,
  provenance_json: row.provenance_json,
  modifications_json: row.modifications_json,
  recorded_at: row.recorded_at.toString(),
  source_inference_id: row.source_inference_id,
  derived_from_entry_ids_json: row.derived_from_entry_ids_json,
  turn_range_start: row.turn_range_start,
  turn_range_end: row.turn_range_end,
  tool_trace_json: row.tool_trace_json,
  archived: row.archived,
  tags_json: row.tags_json,
  metadata_json: row.metadata_json
});

const buildArchiveFileName = (archiveId: string, createdAt: Date): string => {
  const timestamp = createdAt.toISOString().replace(/[:.]/g, '-');
  return `${timestamp}_${archiveId}.json`;
};

export const archiveConversationEntriesToColdStorage = async (
  prisma: PrismaClient,
  options: ConversationColdArchiveOptions = {}
): Promise<ConversationColdArchiveResult> => {
  const limit = normalizeLimit(options.limit);
  const beforeRecordedAt = normalizeRecordedAt(options.beforeRecordedAt);
  const beforeTurn = normalizeBeforeTurn(options.beforeTurn);
  const where = buildWhere({
    memoryId: options.memoryId,
    beforeRecordedAt,
    beforeTurn
  });

  const rows = await prisma.conversationEntryRecord.findMany({
    where,
    orderBy: [{ recorded_at: 'asc' }, { id: 'asc' }],
    take: limit,
    include: {
      memory: {
        select: {
          owner_agent_id: true,
          conversation_id: true,
          pack_id: true
        }
      }
    }
  });

  if (rows.length === 0) {
    return {
      archiveId: '',
      archivePath: null,
      exportedCount: 0,
      deletedCount: 0,
      sizeBytes: 0
    };
  }

  const archiveId = randomUUID();
  const createdAt = options.now ?? new Date();
  const outputDir = resolveOutputDir(options.outputDir);
  const archivePath = path.join(outputDir, buildArchiveFileName(archiveId, createdAt));
  const tempPath = `${archivePath}.tmp`;

  const payload: ConversationColdArchivePayload = {
    archive_id: archiveId,
    schema: 'conversation_entries_cold_archive.v1',
    created_at: createdAt.toISOString(),
    filters: {
      memory_id: options.memoryId ?? null,
      before_recorded_at: beforeRecordedAt?.toString() ?? null,
      before_turn: beforeTurn ?? null,
      limit
    },
    total_entries: rows.length,
    entries: rows.map(row => toArchiveEntry(row as ConversationEntryArchiveRow))
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await rename(tempPath, archivePath);

  const entryIds = rows.map(row => row.id);
  const deleteResult = await prisma.conversationEntryRecord.deleteMany({
    where: {
      id: { in: entryIds },
      archived: true
    }
  });
  const archiveStat = await stat(archivePath);

  return {
    archiveId,
    archivePath,
    exportedCount: rows.length,
    deletedCount: deleteResult.count,
    sizeBytes: archiveStat.size
  };
};
