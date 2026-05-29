import { describe, expect, it } from 'vitest';

import { buildCacheKey, resolveCacheTtl, createInMemoryPromptCache } from '../../../src/ai/cache.js';
import type { ModelGatewayRequest } from '../../../src/ai/types.js';

describe('buildCacheKey', () => {
  it('returns consistent hash for same input', () => {
    const request: ModelGatewayRequest = {
      invocation_id: 'inv-1',
      task_id: 'task-1',
      task_type: 'agent_decision',
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
      response_mode: 'json_object',
      execution: { timeout_ms: 5000, retry_limit: 3, allow_fallback: true }
    };
    const key1 = buildCacheKey(request);
    const key2 = buildCacheKey(request);
    expect(key1).toBe(key2);
  });

  it('returns different hash for different messages', () => {
    const request1: ModelGatewayRequest = {
      invocation_id: 'inv-1',
      task_id: 'task-1',
      task_type: 'agent_decision',
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
      response_mode: 'json_object',
      execution: { timeout_ms: 5000, retry_limit: 3, allow_fallback: true }
    };
    const request2: ModelGatewayRequest = {
      invocation_id: 'inv-1',
      task_id: 'task-1',
      task_type: 'agent_decision',
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'world' }] }],
      response_mode: 'json_object',
      execution: { timeout_ms: 5000, retry_limit: 3, allow_fallback: true }
    };
    expect(buildCacheKey(request1)).not.toBe(buildCacheKey(request2));
  });

  it('returns different hash for different pack_id', () => {
    const request: ModelGatewayRequest = {
      invocation_id: 'inv-1',
      task_id: 'task-1',
      task_type: 'agent_decision',
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
      response_mode: 'json_object',
      execution: { timeout_ms: 5000, retry_limit: 3, allow_fallback: true }
    };
    expect(buildCacheKey(request, 'pack-1')).not.toBe(buildCacheKey(request, 'pack-2'));
  });
});

describe('resolveCacheTtl', () => {
  it('returns default TTL for unknown task type', () => {
    expect(resolveCacheTtl('unknown_task')).toBe(120_000);
  });

  it('returns override TTL for known task types', () => {
    expect(resolveCacheTtl('embedding')).toBe(3_600_000);
    expect(resolveCacheTtl('memory_compaction')).toBe(600_000);
    expect(resolveCacheTtl('context_summary')).toBe(300_000);
    expect(resolveCacheTtl('classification')).toBe(180_000);
    expect(resolveCacheTtl('moderation')).toBe(120_000);
    expect(resolveCacheTtl('agent_decision')).toBe(60_000);
  });
});

describe('createInMemoryPromptCache', () => {
  it('returns null on cache miss', () => {
    const cache = createInMemoryPromptCache();
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('returns stored entry on cache hit', () => {
    const cache = createInMemoryPromptCache();
    const entry = { key: 'k1', result: { data: 'test' }, createdAt: Date.now(), ttlMs: 60000 };
    cache.set('k1', entry);
    const result = cache.get('k1');
    expect(result).toEqual(entry);
  });

  it('evicts expired entries on get', () => {
    const cache = createInMemoryPromptCache();
    const entry = { key: 'k1', result: 'test', createdAt: Date.now() - 100000, ttlMs: 50000 };
    cache.set('k1', entry);
    expect(cache.get('k1')).toBeNull();
  });

  it('tracks stats correctly', () => {
    const cache = createInMemoryPromptCache();
    expect(cache.stats()).toEqual({ size: 0, hits: 0, misses: 0 });

    cache.set('k1', { key: 'k1', result: 'test', createdAt: Date.now(), ttlMs: 60000 });
    expect(cache.stats()).toEqual({ size: 1, hits: 0, misses: 0 });

    cache.get('k1');
    expect(cache.stats()).toEqual({ size: 1, hits: 1, misses: 0 });

    cache.get('nonexistent');
    expect(cache.stats()).toEqual({ size: 1, hits: 1, misses: 1 });
  });

  it('evicts LRU entry when at capacity', () => {
    const cache = createInMemoryPromptCache(2);
    const now = Date.now();

    cache.set('k1', { key: 'k1', result: 'a', createdAt: now, ttlMs: 60000 });
    cache.set('k2', { key: 'k2', result: 'b', createdAt: now, ttlMs: 60000 });
    cache.set('k3', { key: 'k3', result: 'c', createdAt: now, ttlMs: 60000 });

    expect(cache.get('k1')).toBeNull(); // evicted
    expect(cache.get('k2')).not.toBeNull();
    expect(cache.get('k3')).not.toBeNull();
  });

  it('invalidates entry', () => {
    const cache = createInMemoryPromptCache();
    cache.set('k1', { key: 'k1', result: 'test', createdAt: Date.now(), ttlMs: 60000 });
    cache.invalidate('k1');
    expect(cache.get('k1')).toBeNull();
  });

  it('handles invalidation of nonexistent key', () => {
    const cache = createInMemoryPromptCache();
    expect(() => cache.invalidate('nonexistent')).not.toThrow();
  });

  it('updates existing key on set', () => {
    const cache = createInMemoryPromptCache();
    const now = Date.now();
    cache.set('k1', { key: 'k1', result: 'old', createdAt: now, ttlMs: 60000 });
    cache.set('k1', { key: 'k1', result: 'new', createdAt: now, ttlMs: 60000 });
    expect(cache.get('k1')!.result).toBe('new');
    expect(cache.stats().size).toBe(1);
  });
});
