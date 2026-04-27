import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import type { AppInfrastructure } from '../../app/context.js';
import { getErrorMessage } from '../../app/http/errors.js';
import { toJsonSafe } from '../../app/http/json.js';
import type {
  ContextOverlayArchiveInput,
  ContextOverlayCreateInput,
  ContextOverlayEntry,
  ContextOverlayQuery,
  ContextOverlayStatus,
  ContextOverlayStore,
  ContextOverlayUpdateInput
} from './types.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const normalizeTags = (value: unknown): string[] => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  } catch {
    return [];
  }
};

const normalizeSourceNodeIds = (value: unknown): string[] => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  } catch {
    return [];
  }
};

const normalizeStructuredContent = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return toJsonSafe(value) as Record<string, unknown>;
};

const stringifyStringArray = (values: string[]): string => {
  return JSON.stringify(Array.from(new Set(values.filter(value => value.trim().length > 0))));
};

const toJsonValue = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(toJsonSafe(value))) as Prisma.InputJsonValue;
};

const toOverlayEntry = (record: {
  id: string;
  actor_id: string;
  pack_id: string | null;
  overlay_type: string;
  title: string | null;
  content_text: string;
  content_structured: Prisma.JsonValue | null;
  tags: string;
  status: string;
  persistence_mode: string;
  source_node_ids: string;
  created_by: string;
  created_at_tick: bigint;
  updated_at_tick: bigint;
}): ContextOverlayEntry => {
  return {
    id: record.id,
    actor_id: record.actor_id,
    pack_id: record.pack_id,
    overlay_type: record.overlay_type as ContextOverlayEntry['overlay_type'],
    title: record.title,
    content_text: record.content_text,
    content_structured: normalizeStructuredContent(record.content_structured),
    tags: normalizeTags(record.tags),
    status: record.status as ContextOverlayStatus,
    persistence_mode: record.persistence_mode as ContextOverlayEntry['persistence_mode'],
    source_node_ids: normalizeSourceNodeIds(record.source_node_ids),
    created_by: record.created_by as ContextOverlayEntry['created_by'],
    created_at_tick: record.created_at_tick.toString(),
    updated_at_tick: record.updated_at_tick.toString()
  };
};

const normalizeLimit = (limit?: number): number => {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
};

const isMissingOverlayTableError = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2021';
  }

  const message = getErrorMessage(error);
  return message.includes('ContextOverlayEntry') && message.includes('does not exist');
};

export const createContextOverlayStore = (context: AppInfrastructure): ContextOverlayStore => {
  return {
    async listEntries(input: ContextOverlayQuery): Promise<ContextOverlayEntry[]> {
      let rows: Awaited<ReturnType<typeof context.prisma.contextOverlayEntry.findMany>> = [];
      try {
        rows = await context.prisma.contextOverlayEntry.findMany({
          where: {
            actor_id: input.actor_id,
            ...(input.pack_id === undefined ? {} : { pack_id: input.pack_id }),
            status: {
              in: input.statuses ?? ['active']
            }
          },
          orderBy: [{ updated_at_tick: 'desc' }, { created_at_tick: 'desc' }, { id: 'desc' }],
          take: normalizeLimit(input.limit)
        });
      } catch (error) {
        if (isMissingOverlayTableError(error)) {
          return [];
        }

        throw error;
      }

      return rows.map(toOverlayEntry);
    },
    async getEntryById(id: string): Promise<ContextOverlayEntry | null> {
      try {
        const row = await context.prisma.contextOverlayEntry.findUnique({
          where: {
            id
          }
        });

        return row ? toOverlayEntry(row) : null;
      } catch (error) {
        if (isMissingOverlayTableError(error)) {
          return null;
        }

        throw error;
      }
    },
    async createEntry(input: ContextOverlayCreateInput): Promise<ContextOverlayEntry> {
      try {
        const created = await context.prisma.contextOverlayEntry.create({
          data: {
            id: input.id ?? randomUUID(),
            actor_id: input.actor_id,
            pack_id: input.pack_id ?? null,
            overlay_type: input.overlay_type,
            title: input.title ?? null,
            content_text: input.content_text,
            content_structured:
              input.content_structured && Object.keys(input.content_structured).length > 0
                ? toJsonValue(input.content_structured)
                : Prisma.JsonNull,
            tags: stringifyStringArray(input.tags ?? []),
            status: input.status ?? 'active',
            persistence_mode: input.persistence_mode ?? 'sticky',
            source_node_ids: stringifyStringArray(input.source_node_ids ?? []),
            created_by: input.created_by,
            created_at_tick: BigInt(input.created_at_tick),
            updated_at_tick: BigInt(input.updated_at_tick ?? input.created_at_tick)
          }
        });

        return toOverlayEntry(created);
      } catch (error) {
        if (isMissingOverlayTableError(error)) {
          throw new Error('ContextOverlayEntry table is not available yet. Run prisma migrate deploy before creating overlay entries.');
        }

        throw error;
      }
    },
    async updateEntry(input: ContextOverlayUpdateInput): Promise<ContextOverlayEntry> {
      try {
        const updated = await context.prisma.contextOverlayEntry.update({
          where: {
            id: input.id
          },
          data: {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.content_text !== undefined ? { content_text: input.content_text } : {}),
            ...(input.content_structured !== undefined
              ? {
                  content_structured:
                    input.content_structured && Object.keys(input.content_structured).length > 0
                      ? toJsonValue(input.content_structured)
                      : Prisma.JsonNull
                }
              : {}),
            ...(input.tags !== undefined ? { tags: stringifyStringArray(input.tags) } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.persistence_mode !== undefined ? { persistence_mode: input.persistence_mode } : {}),
            ...(input.source_node_ids !== undefined ? { source_node_ids: stringifyStringArray(input.source_node_ids) } : {}),
            updated_at_tick: BigInt(input.updated_at_tick)
          }
        });

        return toOverlayEntry(updated);
      } catch (error) {
        if (isMissingOverlayTableError(error)) {
          throw new Error('ContextOverlayEntry table is not available yet. Run prisma migrate deploy before updating overlay entries.');
        }

        throw error;
      }
    },
    async archiveEntry(input: ContextOverlayArchiveInput): Promise<ContextOverlayEntry> {
      return this.updateEntry({
        id: input.id,
        status: 'archived',
        updated_at_tick: input.updated_at_tick
      });
    }
  };
};
