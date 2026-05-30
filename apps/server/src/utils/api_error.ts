import type { AppErrorOptions } from './errors.js';
import { AppError } from './errors.js';

export class ApiError extends AppError {
  public readonly status: number;
  public details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown, cause?: Error) {
    const opts: AppErrorOptions = {};
    if (cause !== undefined) {
      opts.cause = cause;
    }
    super(code, message, opts);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}
