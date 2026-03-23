import type { NextFunction, Request, Response } from 'express';

export const createRequestId = (): string => {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

export const requestIdMiddleware = () => {
  return (_req: Request, res: Response, next: NextFunction) => {
    const requestId = createRequestId();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  };
};
