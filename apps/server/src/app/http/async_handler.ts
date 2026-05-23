import type { NextFunction, Request, Response } from 'express';

export type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => void | Promise<void>;

export const asyncHandler = (handler: AsyncRequestHandler) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      void Promise.resolve(handler(req, res, next)).catch(next);
    } catch (error) {
      next(error);
    }
  };
};
