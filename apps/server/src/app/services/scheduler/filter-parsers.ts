import { getSchedulerObservabilityConfig } from '../../../config/runtime_config.js';
import { ApiError } from '../../../utils/api_error.js';
import type { SchedulerKind, SchedulerReason, SchedulerSkipReason } from '../../runtime/agent_scheduler.js';
import { SCHEDULER_KINDS, SCHEDULER_QUERY_INVALID, SCHEDULER_REASONS, SCHEDULER_SKIP_REASONS } from './constants.js';
import { parseSchedulerCursor } from './cursor.js';
import type {
  ListSchedulerDecisionsInput,
  ListSchedulerOwnershipAssignmentsInput,
  ListSchedulerOwnershipMigrationsInput,
  ListSchedulerRebalanceRecommendationsInput,
  ListSchedulerRunsInput,
  ListSchedulerWorkersInput,
  SchedulerDecisionFilters,
  SchedulerOwnershipAssignmentFilters,
  SchedulerOwnershipMigrationFilters,
  SchedulerRebalanceRecommendationFilters,
  SchedulerRunFilters,
  SchedulerWorkerFilters} from './types.js';

// ---------------------------------------------------------------------------
// Primitive parsers
// ---------------------------------------------------------------------------

export const parseLimit = (value: string | number | undefined): number => {
  const config = getSchedulerObservabilityConfig();
  if (value === undefined) {
    return config.default_query_limit;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'limit must be a positive safe integer');
    }
    return Math.min(value, config.max_query_limit);
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'limit must be a positive integer string');
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'limit must be a positive safe integer');
  }

  return Math.min(parsed, config.max_query_limit);
};

export const parseOptionalTickFilter = (
  value: string | number | undefined,
  fieldName: 'from_tick' | 'to_tick'
): bigint | null => {
  if (value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ApiError(400, SCHEDULER_QUERY_INVALID, `${fieldName} must be a non-negative safe integer number or integer string`);
    }
    return BigInt(value);
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, `${fieldName} must be a non-negative integer string`, {
      field: fieldName,
      value
    });
  }

  return BigInt(trimmed);
};

export const parseOptionalIdFilter = (value: string | undefined, fieldName: string): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, `${fieldName} must not be empty`);
  }

  return trimmed;
};

export const parseOptionalKind = (value: string | undefined): SchedulerKind | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim() as SchedulerKind;
  if (!SCHEDULER_KINDS.includes(normalized)) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'kind is unsupported', { kind: value });
  }

  return normalized;
};

export const parseOptionalReason = (value: string | undefined): SchedulerReason | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim() as SchedulerReason;
  if (!SCHEDULER_REASONS.includes(normalized)) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'reason is unsupported', { reason: value });
  }

  return normalized;
};

export const parseOptionalSkipReason = (value: string | undefined): SchedulerSkipReason | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim() as SchedulerSkipReason;
  if (!SCHEDULER_SKIP_REASONS.includes(normalized)) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'skipped_reason is unsupported', { skipped_reason: value });
  }

  return normalized;
};

const parseOptionalPartitionId = (value: string | undefined): string | null => {
  return parseOptionalIdFilter(value, 'partition_id');
};

// ---------------------------------------------------------------------------
// Filter builders
// ---------------------------------------------------------------------------

export const parseRunFilters = (input: ListSchedulerRunsInput): SchedulerRunFilters => {
  const fromTick = parseOptionalTickFilter(input.from_tick, 'from_tick');
  const toTick = parseOptionalTickFilter(input.to_tick, 'to_tick');
  if (fromTick !== null && toTick !== null && fromTick > toTick) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'from_tick must be less than or equal to to_tick', {
      from_tick: fromTick.toString(),
      to_tick: toTick.toString()
    });
  }

  return {
    limit: parseLimit(input.limit),
    cursor: parseSchedulerCursor(input.cursor),
    from_tick: fromTick,
    to_tick: toTick,
    worker_id: parseOptionalIdFilter(input.worker_id, 'worker_id'),
    partition_id: parseOptionalPartitionId(input.partition_id),
    pack_id: parseOptionalIdFilter(input.pack_id, 'pack_id')
  };
};

export const parseDecisionFilters = (input: ListSchedulerDecisionsInput): SchedulerDecisionFilters => {
  const fromTick = parseOptionalTickFilter(input.from_tick, 'from_tick');
  const toTick = parseOptionalTickFilter(input.to_tick, 'to_tick');
  if (fromTick !== null && toTick !== null && fromTick > toTick) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'from_tick must be less than or equal to to_tick', {
      from_tick: fromTick.toString(),
      to_tick: toTick.toString()
    });
  }

  return {
    limit: parseLimit(input.limit),
    cursor: parseSchedulerCursor(input.cursor),
    actor_id: parseOptionalIdFilter(input.actor_id, 'actor_id'),
    kind: parseOptionalKind(input.kind),
    reason: parseOptionalReason(input.reason),
    skipped_reason: parseOptionalSkipReason(input.skipped_reason),
    from_tick: fromTick,
    to_tick: toTick,
    partition_id: parseOptionalPartitionId(input.partition_id),
    pack_id: parseOptionalIdFilter(input.pack_id, 'pack_id')
  };
};

export const parseOwnershipAssignmentFilters = (
  input: ListSchedulerOwnershipAssignmentsInput
): SchedulerOwnershipAssignmentFilters => ({
  worker_id: parseOptionalIdFilter(input.worker_id, 'worker_id'),
  partition_id: parseOptionalPartitionId(input.partition_id),
  status: parseOptionalIdFilter(input.status, 'status'),
  pack_id: parseOptionalIdFilter(input.pack_id, 'pack_id')
});

export const parseOwnershipMigrationFilters = (
  input: ListSchedulerOwnershipMigrationsInput
): SchedulerOwnershipMigrationFilters => ({
  limit: parseLimit(input.limit),
  partition_id: parseOptionalPartitionId(input.partition_id),
  worker_id: parseOptionalIdFilter(input.worker_id, 'worker_id'),
  status: parseOptionalIdFilter(input.status, 'status'),
  pack_id: parseOptionalIdFilter(input.pack_id, 'pack_id')
});

export const parseWorkerFilters = (input: ListSchedulerWorkersInput): SchedulerWorkerFilters => ({
  worker_id: parseOptionalIdFilter(input.worker_id, 'worker_id'),
  status: parseOptionalIdFilter(input.status, 'status'),
  pack_id: parseOptionalIdFilter(input.pack_id, 'pack_id')
});

export const parseRebalanceRecommendationFilters = (
  input: ListSchedulerRebalanceRecommendationsInput
): SchedulerRebalanceRecommendationFilters => ({
  limit: parseLimit(input.limit),
  partition_id: parseOptionalPartitionId(input.partition_id),
  worker_id: parseOptionalIdFilter(input.worker_id, 'worker_id'),
  status: parseOptionalIdFilter(input.status, 'status'),
  suppress_reason: parseOptionalIdFilter(input.suppress_reason, 'suppress_reason'),
  pack_id: parseOptionalIdFilter(input.pack_id, 'pack_id')
});
