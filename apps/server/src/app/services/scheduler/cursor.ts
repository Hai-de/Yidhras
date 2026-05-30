import { ApiError } from '../../../utils/api_error.js';
import { SCHEDULER_QUERY_INVALID } from './constants.js';
import type { SchedulerListCursor } from './types.js';

export const encodeSchedulerCursor = (value: SchedulerListCursor): string => {
  return Buffer.from(
    JSON.stringify({
      created_at: value.created_at,
      id: value.id
    }),
    'utf8'
  ).toString('base64url');
};

export const parseSchedulerCursor = (value: string | undefined): SchedulerListCursor | null => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  } catch (err: unknown) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'cursor is invalid', undefined, err instanceof Error ? err : undefined);
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated object
    typeof (parsed as Record<string, unknown>)['created_at'] !== 'string' ||
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated object
    typeof (parsed as Record<string, unknown>)['id'] !== 'string'
  ) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'cursor payload is invalid');
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated as string above
  const createdAt = (parsed as Record<string, unknown>)['created_at'] as string;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated as string above
  const id = (parsed as Record<string, unknown>)['id'] as string;
  if (!/^\d+$/.test(createdAt) || id.trim().length === 0) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'cursor payload is invalid');
  }

  return {
    created_at: createdAt,
    id
  };
};
