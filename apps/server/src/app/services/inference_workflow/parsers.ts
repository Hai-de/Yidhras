import { z } from 'zod';

import type {
  InferenceJobReplayInput,
  InferenceJobStatus,
  InferenceStrategy
} from '../../../inference/types.js';
import { ApiError } from '../../../utils/api_error.js';
import type {
  InferenceJobsListCursor,
  InferenceRequestInput,
  ParsedInferenceJobsFilters
} from './types.js';
import {
  DEFAULT_INFERENCE_JOB_LIST_LIMIT,
  INFERENCE_JOB_STATUSES,
  MAX_INFERENCE_JOB_LIST_LIMIT,
  isRecord
} from './types.js';

export interface ListInferenceJobsInput {
  status?: string[];
  agent_id?: string;
  identity_id?: string;
  strategy?: string;
  job_type?: string;
  from_tick?: string | number;
  to_tick?: string | number;
  from_created_at?: string | number;
  to_created_at?: string | number;
  cursor?: string;
  limit?: number;
  has_error?: boolean;
  action_intent_id?: string;
}

const storedRequestInputSchema = z.object({
  agent_id: z.string().optional(),
  identity_id: z.string().optional(),
  strategy: z.string().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  idempotency_key: z.string().optional()
});

const replayInputSchema = z.object({
  reason: z.string().trim().min(1).optional(),
  idempotency_key: z.string().trim().min(1).optional(),
  overrides: z.object({
    strategy: z.enum(['mock', 'rule_based'] satisfies InferenceStrategy[]).optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
    agent_id: z.string().optional(),
    identity_id: z.string().optional()
  }).optional()
});

const inferenceJobsCursorSchema = z.object({
  created_at: z.string().regex(/^\d+$/),
  id: z.string().min(1)
});

export const parseInferenceJobListLimit = (value: number | undefined): number => {
  const requestedLimit =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.trunc(value)
      : DEFAULT_INFERENCE_JOB_LIST_LIMIT;

  return Math.min(MAX_INFERENCE_JOB_LIST_LIMIT, Math.max(1, requestedLimit));
};

export const parseOptionalFilterId = (value: string | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const parseOptionalCreatedAtFilter = (value: string | number | undefined, fieldName: string): bigint | null => {
  if (value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ApiError(400, 'INFERENCE_INPUT_INVALID', `${fieldName} must be a non-negative safe integer`);
    }

    return BigInt(value);
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ApiError(400, 'INFERENCE_INPUT_INVALID', `${fieldName} must be a non-negative integer string`, {
      field: fieldName,
      value
    });
  }

  return BigInt(trimmed);
};

export const parseInferenceJobStatuses = (value: string[] | undefined): InferenceJobStatus[] | null => {
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

  const invalidStatuses = normalized.filter(item => !(INFERENCE_JOB_STATUSES as readonly string[]).includes(item));
  if (invalidStatuses.length > 0) {
    throw new ApiError(400, 'INFERENCE_INPUT_INVALID', 'status contains unsupported decision job status', {
      invalid_statuses: invalidStatuses,
      allowed_statuses: INFERENCE_JOB_STATUSES
    });
  }

  return normalized as InferenceJobStatus[];
};

export const parseInferenceJobsCursor = (value: string | undefined): InferenceJobsListCursor | null => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new ApiError(400, 'INFERENCE_INPUT_INVALID', 'cursor is invalid');
  }

  const result = inferenceJobsCursorSchema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError(400, 'INFERENCE_INPUT_INVALID', 'cursor payload is invalid');
  }

  return result.data;
};

export const ensureNonEmptyId = (value: string | undefined, fieldName: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(400, 'INFERENCE_INPUT_INVALID', `${fieldName} is required`);
  }

  return value.trim();
};

export const normalizeStoredRequestInput = (value: unknown): InferenceRequestInput => {
  const result = storedRequestInputSchema.safeParse(value);
  if (!result.success) {
    throw new ApiError(500, 'INFERENCE_INPUT_INVALID', 'Persisted job request_input must be an object');
  }

  return result.data;
};

export const normalizeReplayInput = (input: InferenceJobReplayInput | undefined): InferenceJobReplayInput => {
  const candidate = isRecord(input) ? input : {};
  const result = replayInputSchema.safeParse(candidate);

  if (!result.success) {
    throw new ApiError(400, 'INFERENCE_INPUT_INVALID', 'Replay input is invalid', {
      issues: result.error.issues
    });
  }

  return result.data;
};

export const parseInferenceJobsFilters = (input: ListInferenceJobsInput): ParsedInferenceJobsFilters => {
  const fromCreatedAt = parseOptionalCreatedAtFilter(input.from_created_at ?? input.from_tick, 'from_created_at');
  const toCreatedAt = parseOptionalCreatedAtFilter(input.to_created_at ?? input.to_tick, 'to_created_at');

  if (fromCreatedAt !== null && toCreatedAt !== null && fromCreatedAt > toCreatedAt) {
    throw new ApiError(400, 'INFERENCE_INPUT_INVALID', 'from_created_at must be less than or equal to to_created_at', {
      from_created_at: fromCreatedAt.toString(),
      to_created_at: toCreatedAt.toString()
    });
  }

  return {
    status: parseInferenceJobStatuses(input.status),
    agent_id: parseOptionalFilterId(input.agent_id),
    identity_id: parseOptionalFilterId(input.identity_id),
    strategy: parseOptionalFilterId(input.strategy),
    job_type: parseOptionalFilterId(input.job_type),
    from_created_at: fromCreatedAt,
    to_created_at: toCreatedAt,
    cursor: parseInferenceJobsCursor(input.cursor),
    limit: parseInferenceJobListLimit(input.limit),
    has_error: typeof input.has_error === 'boolean' ? input.has_error : null,
    action_intent_id: parseOptionalFilterId(input.action_intent_id)
  };
};
