import { createLogger } from './logger.js';

const captureLogger = createLogger('error-capture');

/**
 * Global error capture — the minimum bar for every formerly-empty catch block.
 *
 * Does NOT throw and does NOT interrupt the current control flow.
 * Guarantees that the error is recorded with structured context for debugging.
 *
 * Usage:
 *
 * ```typescript
 * } catch (err: unknown) {
 *   captureError(err, {
 *     module: 'my-module',
 *     message: 'Something failed',
 *     code: ErrorCode.STORAGE_QUERY_FAIL
 *   });
 * }
 * ```
 */
export const captureError = (
  error: unknown,
  context: {
    module: string;
    message: string;
    code?: string;
    data?: Record<string, unknown>;
  }
): void => {
  const err = error instanceof Error ? error : new Error(String(error));
  captureLogger.error(context.message, {
    error: err,
    code: context.code ?? 'CAPTURED_ERROR',
    data: {
      capture_module: context.module,
      ...(context.data ?? {})
    }
  });
};
