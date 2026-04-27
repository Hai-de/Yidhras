import { Prisma } from '@prisma/client';

import type { AppInfrastructure } from '../app/context.js';
import { getErrorMessage } from '../app/http/errors.js';
import { toJsonSafe } from '../app/http/json.js';
import type {
  LongTermMemorySearchInput,
  LongTermMemoryStore,
  MemoryEntry
} from './types.js';

const toMemoryEntry = (record: {
  id: string;
  owner_agent_id: string;
  kind: string;
  title: string | null;
  content_text: string;
  content_structured: Prisma.JsonValue | null;
  tags: string;
  importance: number;
  salience: number;
  confidence: number | null;
  created_at_tick: bigint;
  updated_at_tick: bigint;
}): MemoryEntry => {
  let tags: string[] = [];
  if (typeof record.tags === 'string' && record.tags.trim().length > 0) {
    try {
      const parsed = JSON.parse(record.tags) as unknown;
      if (Array.isArray(parsed)) {
        tags = parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
      }
    } catch {
      tags = [];
    }
  }

  const structured =
    record.content_structured && typeof record.content_structured === 'object' && !Array.isArray(record.content_structured)
      ? (toJsonSafe(record.content_structured) as Record<string, unknown>)
      : undefined;

  const titlePrefix = record.title && record.title.trim().length > 0 ? `${record.title.trim()}\n` : '';

  return {
    id: record.id,
    scope: 'long_term',
    actor_ref: null,
    source_kind: 'manual',
    source_ref: null,
    content: {
      text: `${titlePrefix}${record.content_text}`,
      ...(structured ? { structured } : {})
    },
    tags: ['memory_block', `memory_kind:${record.kind}`, ...tags],
    importance: record.importance,
    salience: record.salience,
    confidence: record.confidence,
    visibility: {
      policy_gate: 'allow'
    },
    created_at: record.created_at_tick.toString(),
    occurred_at: record.updated_at_tick.toString(),
    metadata: {
      owner_agent_id: record.owner_agent_id,
      memory_kind: record.kind,
      title: record.title
    }
  };
};

const isMissingMemoryBlockTablesError = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2021';
  }

  const message = getErrorMessage(error);
  return message.includes('MemoryBlock') && message.includes('does not exist');
};

export const createNoopLongTermMemoryStore = (): LongTermMemoryStore => {
  return {
    async search(_input: LongTermMemorySearchInput): Promise<MemoryEntry[]> {
      return [];
    },
    async save(_entries: MemoryEntry[]): Promise<void> {
      return;
    }
  };
};

export const createPrismaLongTermMemoryStore = (context: AppInfrastructure): LongTermMemoryStore => {
  return {
    async search(input: LongTermMemorySearchInput): Promise<MemoryEntry[]> {
      const agentId = input.actor_ref.agent_id;
      if (typeof agentId !== 'string' || agentId.trim().length === 0) {
        return [];
      }

      try {
        const rows = await context.prisma.memoryBlock.findMany({
          where: {
            owner_agent_id: agentId,
            status: 'active'
          },
          orderBy: [{ updated_at_tick: 'desc' }, { created_at_tick: 'desc' }, { id: 'desc' }],
          take: input.limit
        });

        return rows.map(toMemoryEntry);
      } catch (error) {
        if (isMissingMemoryBlockTablesError(error)) {
          return [];
        }

        throw error;
      }
    },
    async save(_entries: MemoryEntry[]): Promise<void> {
      return;
    }
  };
};
