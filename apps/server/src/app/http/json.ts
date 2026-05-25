import type { Response } from 'express';

export interface ApiSuccessMeta {
  pagination?: {
    has_next_page?: boolean;
    next_cursor?: string | null;
  };
  warnings?: Array<{
    code: string;
    message: string;
  }>;
  schema_version?: string;
}

export interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
  meta?: ApiSuccessMeta;
}

export const toJsonSafe = (value: unknown): unknown => {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(item => toJsonSafe(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- toJsonSafe return type
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, toJsonSafe(item)])
    );
  }

  return value;
};

export const buildJsonOkBody = <T>(data: T, meta?: ApiSuccessMeta): ApiSuccessEnvelope<T> => {
  return {
    success: true,
    data,
    ...(meta ? { meta } : {})
  };
};

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- callers benefit from data type constraint
export const jsonOk = <T>(res: Response, data: T, meta?: ApiSuccessMeta): void => {
  res.json(buildJsonOkBody(data, meta));
};
