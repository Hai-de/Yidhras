import { z } from 'zod';
import { fromError } from 'zod-validation-error';

import { ApiError } from '../../utils/api_error.js';

const flattenQueryValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    const normalized = value
      .map(item => (typeof item === 'string' ? item.trim() : String(item)))
      .filter(item => item !== '');

    if (normalized.length === 0) {
      return undefined;
    }

    if (normalized.length === 1) {
      return normalized[0];
    }

    return normalized;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  return value;
};

const normalizeQueryObject = (value: unknown): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, flattenQueryValue(item)])
      .filter(([, item]) => item !== undefined)
  );
};

const toApiError = (error: z.ZodError, code: string): ApiError => {
  const validationError = fromError(error);
  return new ApiError(400, code, validationError.message, {
    issues: error.issues
  });
};

export const parseBody = <T>(schema: z.ZodType<T>, value: unknown, code: string): T => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw toApiError(result.error, code);
  }

  return result.data;
};

export const parseQuery = <T>(schema: z.ZodType<T>, value: unknown, code: string): T => {
  const result = schema.safeParse(normalizeQueryObject(value));
  if (!result.success) {
    throw toApiError(result.error, code);
  }

  return result.data;
};

export const parseParams = <T>(schema: z.ZodType<T>, value: unknown, code: string): T => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw toApiError(result.error, code);
  }

  return result.data;
};
