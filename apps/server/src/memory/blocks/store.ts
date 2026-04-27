import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import type { AppInfrastructure } from '../../app/context.js';
import { getErrorMessage } from '../../app/http/errors.js';
import { toJsonSafe } from '../../app/http/json.js';
import type { AppContextPorts } from '../../app/services/app_context_ports.js';
import type {
  DeleteMemoryBlockInput,
  LongMemoryBlockStore,
  MemoryBehavior,
  MemoryBlock,
  MemoryBlockCandidateQuery,
  MemoryBlockRecord,
  MemoryBlockSourceRef,
  MemoryBlockStatus,
  MemoryBlockUpsertInput,
  MemoryRuntimeState
} from './types.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

const normalizeLimit = (limit: number | undefined): number => {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
};

const toJsonValue = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(toJsonSafe(value))) as Prisma.InputJsonValue;
};

const normalizeStringArrayField = (value: unknown): string[] => {
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

const stringifyUniqueStringArray = (values: string[]): string => {
  return JSON.stringify(Array.from(new Set(values.filter(value => value.trim().length > 0))));
};

const normalizeStructuredContent = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return toJsonSafe(value) as Record<string, unknown>;
};

const normalizeBehavior = (value: unknown): MemoryBehavior => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      mutation: {
        allow_insert: true,
        allow_rewrite: true,
        allow_delete: true
      },
      placement: {
        slot: 'memory_long_term',
        anchor: null,
        mode: 'append',
        depth: 0,
        order: 0
      },
      activation: {
        mode: 'always',
        trigger_rate: 1,
        min_score: 0,
        triggers: []
      },
      retention: {
        retain_rounds_after_trigger: 0,
        cooldown_rounds_after_insert: 0,
        delay_rounds_before_insert: 0
      }
    };
  }

  return toJsonSafe(value) as MemoryBehavior;
};

const normalizeSourceRef = (value: unknown): MemoryBlockSourceRef | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return toJsonSafe(value) as MemoryBlockSourceRef;
};

const toMemoryBlock = (record: {
  id: string;
  owner_agent_id: string;
  pack_id: string | null;
  kind: string;
  status: string;
  title: string | null;
  content_text: string;
  content_structured: Prisma.JsonValue | null;
  tags: string;
  keywords: string;
  source_ref: Prisma.JsonValue | null;
  importance: number;
  salience: number;
  confidence: number | null;
  created_at_tick: bigint;
  updated_at_tick: bigint;
}): MemoryBlock => {
  return {
    id: record.id,
    owner_agent_id: record.owner_agent_id,
    pack_id: record.pack_id,
    kind: record.kind as MemoryBlock['kind'],
    status: record.status as MemoryBlockStatus,
    title: record.title,
    content_text: record.content_text,
    content_structured: normalizeStructuredContent(record.content_structured),
    tags: normalizeStringArrayField(record.tags),
    keywords: normalizeStringArrayField(record.keywords),
    source_ref: normalizeSourceRef(record.source_ref),
    importance: record.importance,
    salience: record.salience,
    confidence: record.confidence,
    created_at_tick: record.created_at_tick.toString(),
    updated_at_tick: record.updated_at_tick.toString()
  };
};

const toRuntimeState = (record: {
  memory_block_id: string;
  trigger_count: number;
  last_triggered_tick: bigint | null;
  last_inserted_tick: bigint | null;
  cooldown_until_tick: bigint | null;
  delayed_until_tick: bigint | null;
  retain_until_tick: bigint | null;
  currently_active: boolean;
  last_activation_score: number | null;
  recent_distance_from_latest_message: number | null;
}): MemoryRuntimeState => {
  return {
    memory_id: record.memory_block_id,
    trigger_count: record.trigger_count,
    last_triggered_tick: record.last_triggered_tick?.toString() ?? null,
    last_inserted_tick: record.last_inserted_tick?.toString() ?? null,
    cooldown_until_tick: record.cooldown_until_tick?.toString() ?? null,
    delayed_until_tick: record.delayed_until_tick?.toString() ?? null,
    retain_until_tick: record.retain_until_tick?.toString() ?? null,
    currently_active: record.currently_active,
    last_activation_score: record.last_activation_score,
    recent_distance_from_latest_message: record.recent_distance_from_latest_message
  };
};

const isMissingMemoryBlockTablesError = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2021';
  }

  const message = getErrorMessage(error);
  return (
    (message.includes('MemoryBlock') ||
      message.includes('MemoryBlockBehavior') ||
      message.includes('MemoryBlockRuntimeState') ||
      message.includes('MemoryBlockDeletionAudit')) &&
    message.includes('does not exist')
  );
};

type MemoryBlockStoreContext = AppInfrastructure & Pick<AppContextPorts, 'activePackRuntime'>;

export const createPrismaLongMemoryBlockStore = (context: MemoryBlockStoreContext): LongMemoryBlockStore => {
  return {
    async listCandidateBlocks(input: MemoryBlockCandidateQuery): Promise<MemoryBlockRecord[]> {
      try {
        const rows = await context.prisma.memoryBlock.findMany({
          where: {
            owner_agent_id: input.owner_agent_id,
            ...(input.pack_id === undefined ? {} : { pack_id: input.pack_id }),
            status: 'active'
          },
          include: {
            behavior: true,
            runtime_state: true
          },
          orderBy: [{ updated_at_tick: 'desc' }, { created_at_tick: 'desc' }, { id: 'desc' }],
          take: normalizeLimit(input.limit)
        });

        return rows.map(row => ({
          block: toMemoryBlock(row),
          behavior: normalizeBehavior(row.behavior?.behavior_json),
          state: row.runtime_state ? toRuntimeState(row.runtime_state) : null
        }));
      } catch (error) {
        if (isMissingMemoryBlockTablesError(error)) {
          return [];
        }

        throw error;
      }
    },

    async upsertBlock(input: MemoryBlockUpsertInput): Promise<MemoryBlockRecord> {
      try {
        const result = await context.prisma.$transaction(async prisma => {
          const block = await prisma.memoryBlock.upsert({
            where: { id: input.block.id },
            update: {
              owner_agent_id: input.block.owner_agent_id,
              pack_id: input.block.pack_id,
              kind: input.block.kind,
              status: input.block.status,
              title: input.block.title,
              content_text: input.block.content_text,
              content_structured:
                input.block.content_structured && Object.keys(input.block.content_structured).length > 0
                  ? toJsonValue(input.block.content_structured)
                  : Prisma.JsonNull,
              tags: stringifyUniqueStringArray(input.block.tags),
              keywords: stringifyUniqueStringArray(input.block.keywords),
              source_ref: input.block.source_ref ? toJsonValue(input.block.source_ref) : Prisma.JsonNull,
              importance: input.block.importance,
              salience: input.block.salience,
              confidence: input.block.confidence,
              updated_at_tick: BigInt(input.block.updated_at_tick)
            },
            create: {
              id: input.block.id || randomUUID(),
              owner_agent_id: input.block.owner_agent_id,
              pack_id: input.block.pack_id,
              kind: input.block.kind,
              status: input.block.status,
              title: input.block.title,
              content_text: input.block.content_text,
              content_structured:
                input.block.content_structured && Object.keys(input.block.content_structured).length > 0
                  ? toJsonValue(input.block.content_structured)
                  : Prisma.JsonNull,
              tags: stringifyUniqueStringArray(input.block.tags),
              keywords: stringifyUniqueStringArray(input.block.keywords),
              source_ref: input.block.source_ref ? toJsonValue(input.block.source_ref) : Prisma.JsonNull,
              importance: input.block.importance,
              salience: input.block.salience,
              confidence: input.block.confidence,
              created_at_tick: BigInt(input.block.created_at_tick),
              updated_at_tick: BigInt(input.block.updated_at_tick)
            }
          });

          await prisma.memoryBlockBehavior.upsert({
            where: { memory_block_id: block.id },
            update: {
              behavior_json: toJsonValue(input.behavior),
              updated_at_tick: BigInt(input.block.updated_at_tick)
            },
            create: {
              memory_block_id: block.id,
              behavior_json: toJsonValue(input.behavior),
              created_at_tick: BigInt(input.block.created_at_tick),
              updated_at_tick: BigInt(input.block.updated_at_tick)
            }
          });

          const runtimeState = await prisma.memoryBlockRuntimeState.findUnique({
            where: { memory_block_id: block.id }
          });

          return {
            block: toMemoryBlock(block),
            behavior: input.behavior,
            state: runtimeState ? toRuntimeState(runtimeState) : null
          };
        });

        return result;
      } catch (error) {
        if (isMissingMemoryBlockTablesError(error)) {
          throw new Error('MemoryBlock tables are not available yet. Run prisma migrate deploy before using long memory blocks.');
        }

        throw error;
      }
    },

    async updateRuntimeState(state: MemoryRuntimeState): Promise<MemoryRuntimeState> {
      try {
        const updated = await context.prisma.memoryBlockRuntimeState.upsert({
          where: {
            memory_block_id: state.memory_id
          },
          update: {
            trigger_count: state.trigger_count,
            last_triggered_tick: state.last_triggered_tick ? BigInt(state.last_triggered_tick) : null,
            last_inserted_tick: state.last_inserted_tick ? BigInt(state.last_inserted_tick) : null,
            cooldown_until_tick: state.cooldown_until_tick ? BigInt(state.cooldown_until_tick) : null,
            delayed_until_tick: state.delayed_until_tick ? BigInt(state.delayed_until_tick) : null,
            retain_until_tick: state.retain_until_tick ? BigInt(state.retain_until_tick) : null,
            currently_active: state.currently_active,
            last_activation_score: state.last_activation_score,
            recent_distance_from_latest_message: state.recent_distance_from_latest_message
          },
          create: {
            memory_block_id: state.memory_id,
            trigger_count: state.trigger_count,
            last_triggered_tick: state.last_triggered_tick ? BigInt(state.last_triggered_tick) : null,
            last_inserted_tick: state.last_inserted_tick ? BigInt(state.last_inserted_tick) : null,
            cooldown_until_tick: state.cooldown_until_tick ? BigInt(state.cooldown_until_tick) : null,
            delayed_until_tick: state.delayed_until_tick ? BigInt(state.delayed_until_tick) : null,
            retain_until_tick: state.retain_until_tick ? BigInt(state.retain_until_tick) : null,
            currently_active: state.currently_active,
            last_activation_score: state.last_activation_score,
            recent_distance_from_latest_message: state.recent_distance_from_latest_message
          }
        });

        return toRuntimeState(updated);
      } catch (error) {
        if (isMissingMemoryBlockTablesError(error)) {
          throw new Error('MemoryBlock runtime state table is not available yet. Run prisma migrate deploy before updating memory runtime state.');
        }

        throw error;
      }
    },

    async hardDeleteBlock(input: DeleteMemoryBlockInput): Promise<void> {
      try {
        const activePackRuntime = context.activePackRuntime!;
        await context.prisma.$transaction(async prisma => {
          await prisma.memoryBlockDeletionAudit.create({
            data: {
              id: randomUUID(),
              memory_block_id: input.memory_id,
              deleted_by: input.deleted_by,
              actor_id: null,
              reason: input.reason ?? null,
              deleted_at_tick: activePackRuntime.getCurrentTick()
            }
          });

          await prisma.memoryBlockBehavior.deleteMany({ where: { memory_block_id: input.memory_id } });
          await prisma.memoryBlockRuntimeState.deleteMany({ where: { memory_block_id: input.memory_id } });
          await prisma.memoryBlock.deleteMany({ where: { id: input.memory_id } });
        });
      } catch (error) {
        if (isMissingMemoryBlockTablesError(error)) {
          throw new Error('MemoryBlock tables are not available yet. Run prisma migrate deploy before deleting memory blocks.');
        }

        throw error;
      }
    }
  };
};
