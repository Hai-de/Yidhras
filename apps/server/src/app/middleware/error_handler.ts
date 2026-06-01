import type { NextFunction, Request, Response } from 'express';

import { ApiError } from '../../utils/api_error.js';
import { createLogger } from '../../utils/logger.js';
import { NotificationCode } from '../../utils/notification_details.js';
import type { AppContext } from '../context.js';
import { getErrorMessage } from '../http/errors.js';

const logger = createLogger('error-handler');

export const createGlobalErrorMiddleware = (context: AppContext) => {
  return (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const requestId = typeof res.locals['requestId'] === 'string' ? res.locals['requestId'] : 'req_unknown';
    const isApiError = err instanceof ApiError;
    const status = isApiError ? err.status : 500;
    const code = isApiError ? err.code : 'API_INTERNAL_ERROR';
    const message = getErrorMessage(err);
    const apiDetails = isApiError ? err.details : undefined;

    const notifyCode = status >= 500
      ? NotificationCode.API_INTERNAL_ERROR
      : NotificationCode.API_REQUEST_ERROR;

    const notifyDetails: Record<string, unknown> = {
      module: 'error-handler',
      timestamp: Date.now(),
      request_id: requestId
    };

    if (status >= 500) {
      logger.error(`[${requestId}] ${message}`, { error: err instanceof Error ? err : new Error(String(err)), code });
      context.notifications.push('error', `API 异常(${code}): ${message}`, notifyCode, notifyDetails);
    } else {
      logger.warn(`[${requestId}] ${code}: ${message}`, { code });
      context.notifications.push('warning', `API 请求异常(${code}): ${message}`, notifyCode, notifyDetails);
    }

    res.status(status).json({
      success: false,
      error: {
        code,
        message,
        request_id: requestId,
        timestamp: Date.now(),
        ...(apiDetails === undefined ? {} : { details: apiDetails })
      }
    });
  };
};
