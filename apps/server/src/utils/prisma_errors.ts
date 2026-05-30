import { Prisma } from '@prisma/client';

import type { AppErrorOptions } from './errors.js';
import { AppError, ErrorCode } from './errors.js';

const makeOpts = (cause: Error, context?: Record<string, unknown>): AppErrorOptions => {
  const opts: AppErrorOptions = { cause };
  if (context !== undefined) {
    opts.context = context;
  }
  return opts;
};

/**
 * Map Prisma errors to structured AppError instances.
 * Returns null for unrecognized errors — caller should handle fallback.
 */
export const mapPrismaError = (
  err: unknown,
  context?: Record<string, unknown>
): AppError | null => {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        return new AppError(
          ErrorCode.STORAGE_QUERY_FAIL,
          `Unique constraint violation on ${JSON.stringify(err.meta?.['target'])}`,
          makeOpts(err, context)
        );
      case 'P2025':
        return new AppError(
          ErrorCode.STORAGE_QUERY_FAIL,
          'Record not found',
          makeOpts(err, context)
        );
      default:
        return new AppError(
          ErrorCode.STORAGE_QUERY_FAIL,
          `Database query failed: ${err.message}`,
          makeOpts(err, context)
        );
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    return new AppError(
      ErrorCode.STORAGE_QUERY_FAIL,
      'Invalid database query',
      makeOpts(err, context)
    );
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    return new AppError(
      ErrorCode.STORAGE_QUERY_FAIL,
      'Database connection failed',
      makeOpts(err, context)
    );
  }

  if (err instanceof Prisma.PrismaClientRustPanicError) {
    return new AppError(
      ErrorCode.INTERNAL_ERROR,
      'Database engine crashed',
      makeOpts(err, context)
    );
  }

  return null;
};
