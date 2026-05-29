import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../src/utils/api_error.js';
import { getErrorMessage } from '../../../src/app/http/errors.js';
import { createRequestId } from '../../../src/app/middleware/request_id.js';
import { requireAuth } from '../../../src/app/middleware/require_auth.js';

describe('getErrorMessage', () => {
  it('returns message from Error instance', () => {
    expect(getErrorMessage(new Error('test error'))).toBe('test error');
  });

  it('returns String() for non-Error values', () => {
    expect(getErrorMessage('string error')).toBe('string error');
    expect(getErrorMessage(42)).toBe('42');
    expect(getErrorMessage(null)).toBe('null');
    expect(getErrorMessage(undefined)).toBe('undefined');
  });
});

describe('createRequestId', () => {
  it('returns string starting with req_', () => {
    const id = createRequestId();
    expect(id).toMatch(/^req_/);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createRequestId()));
    expect(ids.size).toBe(100);
  });
});

describe('requireAuth', () => {
  it('calls next when operator is present', () => {
    const middleware = requireAuth();
    const next = vi.fn();
    const req = { operator: { id: 'op-1', identity_id: 'id-1', role: 'user' } } as any;
    const res = {} as any;

    middleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('throws ApiError 401 when operator is missing', () => {
    const middleware = requireAuth();
    const next = vi.fn();
    const req = {} as any;
    const res = {} as any;

    expect(() => middleware(req, res, next)).toThrow(ApiError);
    try {
      middleware(req, res, next);
    } catch (err: any) {
      expect(err.status).toBe(401);
      expect(err.code).toBe('OPERATOR_REQUIRED');
    }
    expect(next).not.toHaveBeenCalled();
  });
});
