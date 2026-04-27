import type { NextFunction, Request, Response } from 'express';

import { ApiError } from '../../utils/api_error.js';
import { createLogger } from '../../utils/logger.js';
import type { AppContext } from '../context.js';
import { getErrorMessage } from '../http/errors.js';

const logger = createLogger('error-handler');

export const createGlobalErrorMiddleware = (context: AppContext) => {
  return (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const requestId = typeof res.locals.requestId === 'string' ? res.locals.requestId : 'req_unknown';
    const isApiError = err instanceof ApiError;
    const status = isApiError ? err.status : 500;
    const code = isApiError ? err.code : 'API_INTERNAL_ERROR';
    const message = getErrorMessage(err);
    const details = isApiError ? err.details : undefined;

    if (status >= 500) {
      logger.error(`[${requestId}] ${message}`, { error: message, code });
      context.notifications.push('error', `API 异常(${code}): ${message}`, code);
    } else {
      logger.warn(`[${requestId}] ${code}: ${message}`);
      context.notifications.push('warning', `API 请求异常(${code}): ${message}`, code);
    }

    res.status(status).json({
      success: false,
      error: {
        code,
        message,
        request_id: requestId,
        timestamp: Date.now(),
        ...(details === undefined ? {} : { details })
      }
    });
  };
};
