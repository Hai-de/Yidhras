import { Prisma } from '@prisma/client';

import { ApiError } from '../../../utils/api_error.js';
import type { AppContext } from '../../context.js';
import { ensureNonEmptyId } from './parsers.js';
import type { AiInvocationRecord } from './types.js';

export interface ListAiInvocationsInput {
  status?: string[];
  provider?: string;
  model?: string;
  task_type?: string;
  source_inference_id?: string;
  route_id?: string;
  has_error?: boolean;
  from_created_at?: string | number;
  to_created_at?: string | number;
  cursor?: string;
  limit?: number;
}

export interface AiInvocationListItem {
  id: string;
  task_id: string;
  task_type: string;
  source_inference_id: string | null;
  provider: string;
  model: string;
  route_id: string | null;
  status: string;
  finish_reason: string;
  attempted_models: string[];
  fallback_used: boolean;
  latency_ms: number | null;
  usage: unknown;
  safety: unknown;
  error_code: string | null;
  error_message: string | null;
  error_stage: string | null;
  audit_level: string;
  created_at: string;
  completed_at: string | null;
}

export interface AiInvocationsListSnapshot {
  items: AiInvocationListItem[];
  page_info: {
    has_next_page: boolean;
    next_cursor: string | null;
  };
  summary: {
    returned: number;
    limit: number;
    counts_by_status: Record<string, number>;
    filters: {
      status: string[] | null;
      provider: string | null;
      model: string | null;
      task_type: string | null;
      source_inference_id: string | null;
      route_id: string | null;
      has_error: boolean | null;
      from_created_at: string | null;
      to_created_at: string | null;
      cursor: string | null;
    };
  };
}

interface ParsedAiInvocationCursor {
  created_at: string;
  id: string;
}

interface ParsedAiInvocationFilters {
  status: string[] | null;
  provider: string | null;
  model: string | null;
  task_type: string | null;
  source_inference_id: string | null;
  route_id: string | null;
  has_error: boolean | null;
  from_created_at: bigint | null;
  to_created_at: bigint | null;
  cursor: ParsedAiInvocationCursor | null;
  limit: number;
}

const DEFAULT_AI_INVOCATION_LIST_LIMIT = 20;
const MAX_AI_INVOCATION_LIST_LIMIT = 100;
const AI_INVOCATION_STATUSES = ['completed', 'failed', 'blocked', 'timeout'] as const;

const parseOptionalFilterString = (value: string | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseOptionalCreatedAtFilter = (value: string | number | undefined, fieldName: string): bigint | null => {
  if (value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ApiError(400, 'AI_INVOCATION_QUERY_INVALID', `${fieldName} must be a non-negative safe integer`);
    }

    return BigInt(value);
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ApiError(400, 'AI_INVOCATION_QUERY_INVALID', `${fieldName} must be a non-negative integer string`, {
      field: fieldName,
      value
    });
  }

  return BigInt(trimmed);
};

const parseAiInvocationStatuses = (value: string[] | undefined): string[] | null => {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const normalized = Array.from(
    new Set(
      value
        .map(item => item.trim())
        .filter(item => item.length > 0)
    )
  );

  if (normalized.length === 0) {
    return null;
  }

  const invalidStatuses = normalized.filter(item => !(AI_INVOCATION_STATUSES as readonly string[]).includes(item));
  if (invalidStatuses.length > 0) {
    throw new ApiError(400, 'AI_INVOCATION_QUERY_INVALID', 'status contains unsupported ai invocation status', {
      invalid_statuses: invalidStatuses,
      allowed_statuses: AI_INVOCATION_STATUSES
    });
  }

  return normalized;
};

const parseAiInvocationCursor = (value: string | undefined): ParsedAiInvocationCursor | null => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new ApiError(400, 'AI_INVOCATION_QUERY_INVALID', 'cursor is invalid');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, 'AI_INVOCATION_QUERY_INVALID', 'cursor payload is invalid');
  }

  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.created_at !== 'string' || !/^\d+$/.test(candidate.created_at) || typeof candidate.id !== 'string' || candidate.id.length === 0) {
    throw new ApiError(400, 'AI_INVOCATION_QUERY_INVALID', 'cursor payload is invalid');
  }

  return {
    created_at: candidate.created_at,
    id: candidate.id
  };
};

const parseAiInvocationListLimit = (value: number | undefined): number => {
  const requestedLimit = typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : DEFAULT_AI_INVOCATION_LIST_LIMIT;

  return Math.min(MAX_AI_INVOCATION_LIST_LIMIT, Math.max(1, requestedLimit));
};

const parseAiInvocationFilters = (input: ListAiInvocationsInput): ParsedAiInvocationFilters => {
  const fromCreatedAt = parseOptionalCreatedAtFilter(input.from_created_at, 'from_created_at');
  const toCreatedAt = parseOptionalCreatedAtFilter(input.to_created_at, 'to_created_at');

  if (fromCreatedAt !== null && toCreatedAt !== null && fromCreatedAt > toCreatedAt) {
    throw new ApiError(400, 'AI_INVOCATION_QUERY_INVALID', 'from_created_at must be less than or equal to to_created_at', {
      from_created_at: fromCreatedAt.toString(),
      to_created_at: toCreatedAt.toString()
    });
  }

  return {
    status: parseAiInvocationStatuses(input.status),
    provider: parseOptionalFilterString(input.provider),
    model: parseOptionalFilterString(input.model),
    task_type: parseOptionalFilterString(input.task_type),
    source_inference_id: parseOptionalFilterString(input.source_inference_id),
    route_id: parseOptionalFilterString(input.route_id),
    has_error: typeof input.has_error === 'boolean' ? input.has_error : null,
    from_created_at: fromCreatedAt,
    to_created_at: toCreatedAt,
    cursor: parseAiInvocationCursor(input.cursor),
    limit: parseAiInvocationListLimit(input.limit)
  };
};

const encodeAiInvocationCursor = (item: Pick<AiInvocationListItem, 'created_at' | 'id'>): string => {
  return Buffer.from(JSON.stringify({ created_at: item.created_at, id: item.id }), 'utf8').toString('base64url');
};

const compareCursorPosition = (
  left: { created_at: string; id: string },
  right: { created_at: string; id: string }
): number => {
  const leftTick = BigInt(left.created_at);
  const rightTick = BigInt(right.created_at);

  if (leftTick === rightTick) {
    return right.id.localeCompare(left.id);
  }

  return leftTick > rightTick ? -1 : 1;
};

const buildAiInvocationWhere = (filters: ParsedAiInvocationFilters): Prisma.AiInvocationRecordWhereInput => {
  return {
    ...(filters.status ? { status: { in: filters.status } } : {}),
    ...(filters.provider ? { provider: filters.provider } : {}),
    ...(filters.model ? { model: filters.model } : {}),
    ...(filters.task_type ? { task_type: filters.task_type } : {}),
    ...(filters.source_inference_id ? { source_inference_id: filters.source_inference_id } : {}),
    ...(filters.route_id ? { route_id: filters.route_id } : {}),
    ...(filters.has_error === null
      ? {}
      : filters.has_error
        ? { error_code: { not: null } }
        : { error_code: null }),
    ...(filters.from_created_at !== null || filters.to_created_at !== null
      ? {
          created_at: {
            ...(filters.from_created_at !== null ? { gte: filters.from_created_at } : {}),
            ...(filters.to_created_at !== null ? { lte: filters.to_created_at } : {})
          }
        }
      : {})
  };
};

const parseAttemptedModels = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
};

const toListItem = (record: AiInvocationRecord): AiInvocationListItem => ({
  id: record.id,
  task_id: record.task_id,
  task_type: record.task_type,
  source_inference_id: record.source_inference_id,
  provider: record.provider,
  model: record.model,
  route_id: record.route_id,
  status: record.status,
  finish_reason: record.finish_reason,
  attempted_models: parseAttemptedModels(record.attempted_models_json),
  fallback_used: record.fallback_used,
  latency_ms: record.latency_ms,
  usage: record.usage_json,
  safety: record.safety_json,
  error_code: record.error_code,
  error_message: record.error_message,
  error_stage: record.error_stage,
  audit_level: record.audit_level,
  created_at: record.created_at.toString(),
  completed_at: record.completed_at?.toString() ?? null
});

export const getAiInvocationById = async (context: AppContext, invocationId?: string): Promise<AiInvocationRecord> => {
  const id = ensureNonEmptyId(invocationId, 'ai_invocation_id');
  const record = await context.repos.inference.getPrisma().aiInvocationRecord.findUnique({
    where: { id }
  });

  if (!record) {
    throw new ApiError(404, 'AI_INVOCATION_NOT_FOUND', 'AI invocation record not found', {
      ai_invocation_id: id
    });
  }

  return record;
};

export const listAiInvocations = async (
  context: AppContext,
  input: ListAiInvocationsInput
): Promise<AiInvocationsListSnapshot> => {
  const filters = parseAiInvocationFilters(input);
  const records = await context.repos.inference.getPrisma().aiInvocationRecord.findMany({
    where: buildAiInvocationWhere(filters),
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: filters.limit + 1
  });

  const cursorFilteredItems = records
    .map(record => toListItem(record as AiInvocationRecord))
    .filter(item => {
      if (!filters.cursor) {
        return true;
      }
      return compareCursorPosition({ created_at: item.created_at, id: item.id }, filters.cursor) > 0;
    });

  const hasNextPage = cursorFilteredItems.length > filters.limit;
  const pageItems = hasNextPage ? cursorFilteredItems.slice(0, filters.limit) : cursorFilteredItems;
  const countsByStatus = pageItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});

  return {
    items: pageItems,
    page_info: {
      has_next_page: hasNextPage,
      next_cursor: hasNextPage ? encodeAiInvocationCursor(pageItems[pageItems.length - 1]!) : null
    },
    summary: {
      returned: pageItems.length,
      limit: filters.limit,
      counts_by_status: countsByStatus,
      filters: {
        status: filters.status,
        provider: filters.provider,
        model: filters.model,
        task_type: filters.task_type,
        source_inference_id: filters.source_inference_id,
        route_id: filters.route_id,
        has_error: filters.has_error,
        from_created_at: filters.from_created_at?.toString() ?? null,
        to_created_at: filters.to_created_at?.toString() ?? null,
        cursor: filters.cursor ? Buffer.from(JSON.stringify(filters.cursor), 'utf8').toString('base64url') : null
      }
    }
  };
};
