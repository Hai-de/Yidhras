import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parseBody, parseParams, parseQuery } from '../../../src/app/http/zod.js';
import type { ApiError } from '../../../src/utils/api_error.js';

describe('app/http/zod', () => {
  describe('parseBody', () => {
    const schema = z.object({ name: z.string(), age: z.number() });

    it('returns parsed data for valid input', () => {
      const result = parseBody(schema, { name: 'Alice', age: 30 }, 'TEST_INVALID');
      expect(result).toEqual({ name: 'Alice', age: 30 });
    });

    it('throws ApiError with code for invalid input', () => {
      try {
        parseBody(schema, { name: 123 }, 'BODY_INVALID');
        expect.unreachable('should have thrown');
      } catch (err: unknown) {
        expect((err as ApiError).status).toBe(400);
        expect((err as ApiError).code).toBe('BODY_INVALID');
      }
    });

    it('throws ApiError with 400 status', () => {
      try {
        parseBody(schema, null, 'BODY_INVALID');
        expect.unreachable('should have thrown');
      } catch (err: unknown) {
        expect((err as ApiError).status).toBe(400);
        expect((err as ApiError).code).toBe('BODY_INVALID');
      }
    });
  });

  describe('parseParams', () => {
    const schema = z.object({ id: z.string().uuid() });

    it('returns parsed params for valid input', () => {
      const id = '550e8400-e29b-41d4-a716-446655440000';
      const result = parseParams(schema, { id }, 'PARAMS_INVALID');
      expect(result.id).toBe(id);
    });

    it('throws for invalid params', () => {
      expect(() => parseParams(schema, { id: 'not-uuid' }, 'PARAMS_INVALID')).toThrow();
    });
  });

  describe('parseQuery', () => {
    const schema = z.object({ search: z.string().optional(), limit: z.coerce.number().optional() });

    it('normalizes and parses query with string values', () => {
      const result = parseQuery(schema, { search: '  hello  ' }, 'QUERY_INVALID');
      expect(result.search).toBe('hello');
    });

    it('flattens single-element arrays', () => {
      const result = parseQuery(schema, { search: ['hello'] }, 'QUERY_INVALID');
      expect(result.search).toBe('hello');
    });

    it('keeps multi-element arrays', () => {
      const arraySchema = z.object({ tags: z.array(z.string()).optional() });
      const result = parseQuery(arraySchema, { tags: ['a', 'b'] }, 'QUERY_INVALID');
      expect(result.tags).toEqual(['a', 'b']);
    });

    it('removes entries with empty string arrays', () => {
      const result = parseQuery(schema, { search: ['', '  '] }, 'QUERY_INVALID');
      // search is filtered out since all items are empty
      expect(result.search).toBeUndefined();
    });

    it('returns empty result for empty input', () => {
      const result = parseQuery(schema, {}, 'QUERY_INVALID');
      expect(result).toBeDefined();
    });

    it('passes through non-string objects unchanged', () => {
      const passthroughSchema = z.object({ value: z.number() });
      const result = parseQuery(passthroughSchema, { value: 42 }, 'QUERY_INVALID');
      expect(result.value).toBe(42);
    });
  });
});
