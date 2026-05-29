import type { NextFunction,Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { asyncHandler } from '../../../src/app/http/async_handler.js';

const makeReqRes = () => ({
  req: {} as Request,
  res: {} as Response,
  next: vi.fn() as NextFunction
});

describe('asyncHandler', () => {
  it('calls the handler with req, res, next', () => {
    const handler = vi.fn();
    const wrapped = asyncHandler(handler);
    const { req, res, next } = makeReqRes();

    wrapped(req, res, next);

    expect(handler).toHaveBeenCalledWith(req, res, next);
  });

  it('catches synchronous errors and forwards to next', () => {
    const error = new Error('sync error');
    const handler = vi.fn(() => { throw error; });
    const wrapped = asyncHandler(handler);
    const { req, res, next } = makeReqRes();

    wrapped(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it('catches async rejection and forwards to next', async () => {
    const error = new Error('async error');
    const handler = vi.fn(async () => { throw error; });
    const wrapped = asyncHandler(handler);
    const { req, res, next } = makeReqRes();

    wrapped(req, res, next);

    // The rejection is caught asynchronously; wait a tick
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(next).toHaveBeenCalledWith(error);
  });

  it('does not call next on success', () => {
    const handler = vi.fn();
    const wrapped = asyncHandler(handler);
    const { req, res, next } = makeReqRes();

    wrapped(req, res, next);

    expect(next).not.toHaveBeenCalled();
  });

  it('does not call next on async success', async () => {
    const handler = vi.fn(async () => {});
    const wrapped = asyncHandler(handler);
    const { req, res, next } = makeReqRes();

    wrapped(req, res, next);

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(next).not.toHaveBeenCalled();
  });
});
